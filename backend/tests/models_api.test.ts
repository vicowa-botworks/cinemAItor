import { Application } from "@oak/oak";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { closeDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { hashPassword } from "../src/services/password.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

let baseUrl = "";
let adminToken: string;
let appDataDir = "";
let sourceFile = "";

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function post(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function get(path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: headers(token) });
}

function patch(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function del(path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: "DELETE", headers: headers(token) });
}

interface ModelBody {
  id: string;
  name: string;
  version: string;
  backend: string;
  task_types: string[];
  enabled: boolean;
  file_hash: string | null;
  installed_at: string | null;
  health_status: string | null;
  license: string | null;
  default_settings: Record<string, unknown>;
}

describe("models api", () => {
  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_models_api_" });
    Deno.env.set("APP_DATA_DIR", appDataDir);
    sourceFile = join(appDataDir, "model-source.bin");
    await Deno.writeFile(sourceFile, new Uint8Array([1, 2, 3, 4, 5]));

    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(health.status, 200);

      const res = await post("/api/v1/auth/bootstrap", {
        email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
        password: "password123",
        display_name: "Studio Admin",
      });
      assertEquals(res.status, 201);
      adminToken = ((await res.json()) as { token: string }).token;
    });
  });

  afterEach(() => {
    closeDb();
    Deno.env.delete("APP_DATA_DIR");
    Deno.removeSync(appDataDir, { recursive: true });
  });

  function registerModel(
    body: Record<string, unknown>,
    token = adminToken,
  ): Promise<Response> {
    return post("/api/v1/models", body, token);
  }

  it("requires authentication", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        assertEquals((await get("/api/v1/models")).status, 401);
        assertEquals((await post("/api/v1/models", {})).status, 401);
      })();
    }));

  it("non-admin users cannot manage models", async () => {
    const email = `user.${Math.random().toString(36).slice(2)}@example.com`;
    createUser(email, await hashPassword("password123"), "Regular User");
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const login = await post("/api/v1/auth/login", {
          email,
          password: "password123",
        });
        assertEquals(login.status, 200);
        const userToken = ((await login.json()) as { token: string }).token;

        // Read access is allowed...
        assertEquals((await get("/api/v1/models", userToken)).status, 200);
        // ...but mutations are not.
        assertEquals(
          (await registerModel(
            { name: "x", version: "1", backend: "mock" },
            userToken,
          )).status,
          403,
        );
      })();
    });
  });

  it("registers lists and gets models", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await registerModel({
          name: "sd-xl",
          version: "1.0",
          backend: "local_cli",
          source: "local",
          source_path: sourceFile,
          license: "OpenRAIL",
          task_types: ["text_to_image"],
          output_types: ["image"],
          default_settings: { command: "sd-runner", steps: 20 },
          vram_requirement_mb: 8192,
          dependencies: ["python3"],
        });
        assertEquals(res.status, 201);
        const model = (await res.json()) as ModelBody;
        assertEquals(model.name, "sd-xl");
        assertEquals(model.task_types, ["text_to_image"]);
        assertEquals(model.enabled, true);
        assertEquals(model.installed_at, null);
        assertEquals(model.license, "OpenRAIL");
        assertEquals(model.default_settings, { command: "sd-runner", steps: 20 });

        const list = await get("/api/v1/models", adminToken);
        assertEquals(list.status, 200);
        const rows = (await list.json()) as ModelBody[];
        assertEquals(rows.length, 1);

        const byTask = await get(
          "/api/v1/models?task_type=text_to_image",
          adminToken,
        );
        assertEquals(((await byTask.json()) as ModelBody[]).length, 1);
        const byI2v = await get(
          "/api/v1/models?task_type=image_to_video",
          adminToken,
        );
        assertEquals(((await byI2v.json()) as ModelBody[]).length, 0);

        const one = await get(`/api/v1/models/${model.id}`, adminToken);
        assertEquals(one.status, 200);
        assertEquals(((await one.json()) as ModelBody).id, model.id);

        const missing = await get("/api/v1/models/nope", adminToken);
        assertEquals(missing.status, 404);
      })();
    });
  });

  it("normalizes HF dashed task type aliases on registration", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await registerModel({
          name: "hf-dashed",
          version: "1.0",
          backend: "local_cli",
          source: "local",
          source_path: sourceFile,
          license: "OpenRAIL",
          task_types: ["image-to-image", "text_to_image"],
          default_settings: { command: "sd-runner" },
        });
        assertEquals(res.status, 201);
        const model = (await res.json()) as ModelBody;
        assertEquals(model.task_types, ["image_to_image", "text_to_image"]);

        const byTask = await get("/api/v1/models?task_type=image_to_image", adminToken);
        assertEquals(((await byTask.json()) as ModelBody[]).length, 1);

        // Unknown dashed names still 400.
        assertEquals(
          (
            await registerModel({
              name: "x",
              version: "1",
              backend: "mock",
              task_types: ["foo-bar"],
            })
          ).status,
          400,
        );
      })();
    });
  });

  it("validates registration input", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        assertEquals((await registerModel({ version: "1", backend: "mock" })).status, 400);
        assertEquals(
          (await registerModel({ name: "x", version: "1", backend: "nope" })).status,
          400,
        );
        assertEquals(
          (
            await registerModel({
              name: "x",
              version: "1",
              backend: "mock",
              task_types: ["bogus"],
            })
          ).status,
          400,
        );
        assertEquals(
          (await registerModel({ name: "x", version: "1", backend: "local_cli" })).status,
          400,
        );
        assertEquals(
          (
            await registerModel({
              name: "y",
              version: "1",
              backend: "comfyui",
              default_settings: { endpoint: "http://127.0.0.1:8188" },
            })
          ).status,
          400,
        );
      })();
    });
  });

  it("installs from a local file, verifies, and reports health", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const reg = await registerModel({
          name: "local-img",
          version: "1.0",
          backend: "local_cli",
          source: "local",
          source_path: sourceFile,
          task_types: ["text_to_image"],
          default_settings: { command: "sd-runner" },
        });
        const model = (await reg.json()) as ModelBody;

        const install = await post(
          `/api/v1/models/${model.id}/install`,
          {},
          adminToken,
        );
        assertEquals(install.status, 201);
        const installBody = (await install.json()) as {
          model: ModelBody;
          install: { fileHash: string; fileBytes: number };
        };
        assert(installBody.model.installed_at);
        assertEquals(installBody.install.fileBytes, 5);
        assertEquals(installBody.install.fileHash.length, 64);

        const verify = await post(
          `/api/v1/models/${model.id}/verify`,
          {},
          adminToken,
        );
        assertEquals(verify.status, 200);
        const verifyBody = (await verify.json()) as {
          valid: boolean;
          message: string;
        };
        assertEquals(verifyBody.valid, true);

        const health = await post(
          `/api/v1/models/${model.id}/health-check`,
          {},
          adminToken,
        );
        assertEquals(health.status, 200);
        const healthBody = (await health.json()) as {
          status: string;
          model: ModelBody;
        };
        assertEquals(healthBody.status, "ok");
        assertEquals(healthBody.model.health_status, "ok");

        // Install without any source fails.
        const bare = (await registerModel({
          name: "bare",
          version: "1",
          backend: "local_cli",
          task_types: ["text_to_image"],
          default_settings: { command: "sd-runner" },
        })).json() as Promise<ModelBody>;
        const bareModel = await bare;
        const noSource = await post(
          `/api/v1/models/${bareModel.id}/install`,
          {},
          adminToken,
        );
        assertEquals(noSource.status, 400);
      })();
    });
  });

  it("url installs require explicit consent", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const reg = await registerModel({
          name: "url-model",
          version: "1.0",
          backend: "mock",
          source: "url",
          repository_url: "http://127.0.0.1:9/does-not-matter.bin",
          task_types: ["text_to_image"],
        });
        const model = (await reg.json()) as ModelBody;

        const withoutConsent = await post(
          `/api/v1/models/${model.id}/install`,
          {},
          adminToken,
        );
        assertEquals(withoutConsent.status, 400);
        const errBody = (await withoutConsent.json()) as { error: { message: string } };
        assert(errBody.error.message.toLowerCase().includes("consent"));
      })();
    });
  });

  it("reports install progress while a URL install streams", async () => {
    const payload = new Uint8Array(8192).fill(7);
    const app = new Application();
    app.use((ctx) => {
      ctx.response.status = 200;
      ctx.response.headers.set("Content-Length", String(payload.byteLength));
      ctx.response.body = new ReadableStream({
        async start(c) {
          for (let i = 0; i < payload.byteLength; i += 1024) {
            await new Promise((r) => setTimeout(r, 40));
            c.enqueue(payload.slice(i, i + 1024));
          }
          c.close();
        },
      });
    });
    const probe = await Deno.listen({ port: 0, hostname: "127.0.0.1" });
    const port = (probe.addr as Deno.NetAddr).port;
    await probe.close();
    const downloadAbort = new AbortController();
    const listenP = app.listen({
      port,
      hostname: "127.0.0.1",
      signal: downloadAbort.signal,
    });
    listenP.catch(() => {});
    const downloadBase = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      try {
        const probe = await fetch(`${downloadBase}/`);
        await probe.body?.cancel().catch(() => {});
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 25));
      }
    }

    try {
      await withServer(async (base) => {
        baseUrl = base;
        const reg = await registerModel({
          name: "progress-url-model",
          version: "1.0",
          backend: "mock",
          source: "url",
          repository_url: `${downloadBase}/model.bin`,
          task_types: ["text_to_image"],
        });
        const model = (await reg.json()) as ModelBody;

        const installP = post(`/api/v1/models/${model.id}/install`, {
          consent: true,
        }, adminToken);

        // The list endpoint shows the in-flight install (poll until visible).
        interface ProgressEntry {
          model_id: string;
          received_bytes: number;
          total_bytes: number | null;
          source: string;
          speed_bytes_per_sec: number;
        }
        let seen: ProgressEntry | undefined;
        const t0 = Date.now();
        while (!seen && Date.now() - t0 < 5000) {
          const listRes = await get("/api/v1/models/install-progress", adminToken);
          assertEquals(listRes.status, 200);
          const listBody = (await listRes.json()) as { installs: ProgressEntry[] };
          seen = listBody.installs.find((x) => x.model_id === model.id);
          if (!seen) await new Promise((r) => setTimeout(r, 25));
        }
        assert(seen, "expected the in-flight install to appear in the progress list");
        // Poll until the entry carries the advertised total: the entry is
        // registered before the first response headers arrive.
        while (seen && seen.total_bytes === null && Date.now() - t0 < 5000) {
          const listRes = await get("/api/v1/models/install-progress", adminToken);
          seen = ((await listRes.json()) as { installs: ProgressEntry[] }).installs
            .find((x) => x.model_id === model.id);
          if (seen) await new Promise((r) => setTimeout(r, 25));
        }
        assert(seen, "expected the in-flight install to report a total");
        assertEquals(seen.source, "url");
        assertEquals(seen.total_bytes, payload.byteLength);
        assert(
          typeof seen.speed_bytes_per_sec === "number" && seen.speed_bytes_per_sec >= 0,
          "speed_bytes_per_sec must be a non-negative number",
        );

        // The per-model endpoint agrees.
        const perRes = await get(`/api/v1/models/${model.id}/install-progress`, adminToken);
        assertEquals(perRes.status, 200);
        const perBody = (await perRes.json()) as {
          in_progress: boolean;
          received_bytes: number;
          total_bytes: number | null;
          source: string;
        };
        assertEquals(perBody.in_progress, true);
        assertEquals(perBody.total_bytes, payload.byteLength);

        // Bytes grow while the stream is running.
        let received = seen.received_bytes;
        const t1 = Date.now();
        while (received === 0 && Date.now() - t1 < 4000) {
          await new Promise((r) => setTimeout(r, 25));
          const b = (await (await get(
            `/api/v1/models/${model.id}/install-progress`,
            adminToken,
          )).json()) as { in_progress: boolean; received_bytes: number };
          if (!b.in_progress) break;
          received = b.received_bytes;
        }
        assert(received > 0, "expected received_bytes to grow while the download streams");

        const installRes = await installP;
        assertEquals(installRes.status, 201);

        // The entry clears once the install settles.
        const after = (await (await get(
          `/api/v1/models/${model.id}/install-progress`,
          adminToken,
        )).json()) as { in_progress: boolean };
        assertEquals(after.in_progress, false);
        const listAfter =
          (await (await get("/api/v1/models/install-progress", adminToken)).json()) as {
            installs: unknown[];
          };
        assertEquals(listAfter.installs.length, 0);
      });
    } finally {
      downloadAbort.abort();
    }
  });

  it("guards the install-progress endpoints", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        assertEquals((await get("/api/v1/models/install-progress")).status, 401);
        assertEquals(
          (await get("/api/v1/models/unknown-model/install-progress")).status,
          401,
        );
        assertEquals(
          (
            await get("/api/v1/models/unknown-model/install-progress", adminToken)
          ).status,
          404,
        );
      })();
    }));

  it("enables and disables models via patch", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const reg = await registerModel({
          name: "t2i-model",
          version: "1",
          backend: "mock",
          task_types: ["text_to_image"],
        });
        const model = (await reg.json()) as ModelBody;

        const off = await patch(`/api/v1/models/${model.id}`, { enabled: false }, adminToken);
        assertEquals(off.status, 200);
        assertEquals(((await off.json()) as ModelBody).enabled, false);

        const t2i = (await (
          await get("/api/v1/models?task_type=text_to_image&enabled=true", adminToken)
        ).json()) as ModelBody[];
        assertEquals(t2i.length, 0);

        const on = await patch(`/api/v1/models/${model.id}`, { enabled: true }, adminToken);
        assertEquals(((await on.json()) as ModelBody).enabled, true);
      })();
    });
  });

  it("reports hardware and requirement warnings", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await registerModel({
          name: "hungry-model",
          version: "1",
          backend: "mock",
          task_types: ["text_to_image"],
          vram_requirement_mb: 999_999_999,
          ram_requirement_mb: 999_999_999,
          dependencies: ["definitely_not_a_real_command_xyz"],
        });

        const res = await get("/api/v1/models/hardware", adminToken);
        assertEquals(res.status, 200);
        const body = (await res.json()) as {
          hardware: {
            platform: string;
            cpu_count: number;
            mem_total_mb: number | null;
            gpu: unknown;
          };
          warnings: { model_id: string; warning: string }[];
        };
        assertEquals(body.hardware.platform, Deno.build.os);
        assert(body.hardware.cpu_count >= 1);
        if (body.hardware.gpu !== null) {
          const g = body.hardware.gpu as Record<string, unknown>;
          for (
            const key of [
              "vendor",
              "model",
              "vram_mb",
              "vram_used_mb",
              "driver_version",
              "cuda_version",
            ]
          ) {
            assert(key in g, `gpu report missing key: ${key}`);
          }
        }
        const texts = body.warnings.map((w) => w.warning);
        assert(texts.some((t) => t.includes("VRAM")));
        assert(texts.some((t) => t.includes("RAM")));
        assert(texts.some((t) => t.includes("Missing dependency")));
      })();
    });
  });

  it("deletes models and their files", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const reg = await registerModel({
          name: "delete-me",
          version: "1",
          backend: "mock",
          source: "local",
          source_path: sourceFile,
          task_types: ["text_to_image"],
        });
        const model = (await reg.json()) as ModelBody;
        await post(`/api/v1/models/${model.id}/install`, {}, adminToken);

        const deleted = await del(`/api/v1/models/${model.id}`, adminToken);
        assertEquals(deleted.status, 200);
        await (deleted.json());

        const fileCheck = await Deno.stat(
          join(appDataDir, "models", model.id, "model.bin"),
        ).then(() => true).catch(() => false);
        assertEquals(fileCheck, false);

        assertEquals(
          (await get(`/api/v1/models/${model.id}`, adminToken)).status,
          404,
        );
        assertEquals(
          (await del(`/api/v1/models/${model.id}`, adminToken)).status,
          404,
        );
      })();
    });
  });

  it("writes audit entries for model lifecycle", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const reg = await registerModel({
          name: "audit-me",
          version: "1",
          backend: "mock",
          task_types: ["text_to_image"],
        });
        const model = (await reg.json()) as ModelBody;
        await patch(`/api/v1/models/${model.id}`, { enabled: false }, adminToken);
        await del(`/api/v1/models/${model.id}`, adminToken);

        const { getDb } = await import("../src/db/database.ts");
        const actions = (
          getDb()
            .prepare(
              "SELECT action FROM audit_logs WHERE entity_type = 'model' ORDER BY rowid",
            )
            .all() as unknown as { action: string }[]
        ).map((r) => r.action);
        assertEquals(actions, ["model.register", "model.disable", "model.remove"]);
      })();
    });
  });
});
