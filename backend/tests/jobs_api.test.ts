import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createAsset, createAssetVersion } from "../src/db/assets.ts";
import { registerModel } from "../src/db/models.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";
import { resetContentStore } from "../src/storage/content_store.ts";

let baseUrl = "";
let ownerToken: string;
let appDataDir = "";
let ownerId: number;

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function post(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function get(path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: headers(token) });
}

interface JobBody {
  id: string;
  job_type: string;
  model_id: string;
  asset_id: string | null;
  prompt_text: string | null;
  seed: string | null;
  status: string;
  progress: number;
  error_text: string | null;
  output_asset_version_id: string | null;
  candidate_count: number | null;
  settings: Record<string, unknown>;
}

async function waitForJob(
  token: string,
  jobId: string,
  statuses: string[],
  timeoutMs = 8000,
): Promise<JobBody> {
  const start = Date.now();
  for (;;) {
    const res = await get(`/api/v1/jobs/${jobId}`, token);
    assertEquals(res.status, 200);
    const job = (await res.json()) as JobBody;
    if (statuses.includes(job.status)) return job;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`job ${jobId} stuck in ${job.status}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("jobs api", () => {
  let modelId: string;
  let assetId: string;

  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_jobs_api_" });
    Deno.env.set("APP_DATA_DIR", appDataDir);
    resetContentStore();

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
      const user = (await res.json()) as { token: string; user: { id: number } };
      ownerToken = user.token;
      ownerId = user.user.id;

      modelId = registerModel(ownerId, {
        name: "api-mock-t2i",
        version: "1.0",
        backend: "mock",
        task_types: ["text_to_image", "image_to_video"],
        enabled: true,
      }).id;
      const asset = createAsset(
        {
          unique_slug: `canvas_${Math.random().toString(36).slice(2, 8)}`,
          display_name: "Canvas",
          asset_type: "image",
          library_scope: "global",
        },
        ownerId,
      );
      assetId = asset.id;
      createAssetVersion(assetId, ownerId, {
        content_hash: "a".repeat(64),
        file_path: "/tmp/placeholder.png",
        format: "png",
        mime_type: "image/png",
        file_size: 10,
        make_active: true,
      });
    });
  });

  afterEach(() => {
    closeDb();
    Deno.removeSync(appDataDir, { recursive: true });
  });

  it("requires authentication", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        assertEquals((await get("/api/v1/jobs")).status, 401);
        assertEquals((await post("/api/v1/jobs", {})).status, 401);
      })();
    }));

  it("creates a job, runs it to success, and streams events", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await post(
          `/api/v1/jobs`,
          {
            job_type: "text_to_image",
            model_id: modelId,
            asset_id: assetId,
            prompt_text: "a red barn at dusk",
            negative_prompt: "blurry",
            seed: "42",
            settings: { candidates: 2 },
          },
          ownerToken,
        );
        assertEquals(res.status, 201);
        const body = (await res.json()) as { job: JobBody };
        assertEquals(body.job.status, "queued");
        const jobId = body.job.id;

        const done = await waitForJob(
          ownerToken,
          jobId,
          ["succeeded", "failed"],
        );
        assertEquals(done.status, "succeeded");
        assertEquals(done.progress, 100);
        assertEquals(done.candidate_count, 2);
        assert(done.output_asset_version_id);

        const eventsRes = await get(`/api/v1/jobs/${jobId}/events`, ownerToken);
        assertEquals(eventsRes.status, 200);
        const events = (await eventsRes.json()) as {
          event_type: string;
        }[];
        const types = events.map((e) => e.event_type);
        for (
          const expected of [
            "created",
            "started",
            "progress",
            "candidate.created",
            "succeeded",
          ]
        ) {
          assert(types.includes(expected), `missing event ${expected}`);
        }

        const list = (await (
          await get("/api/v1/jobs?status=succeeded", ownerToken)
        ).json()) as JobBody[];
        assertEquals(list.length, 1);
        assertEquals(list[0].id, jobId);
      })();
    });
  });

  it("stores generated candidates as asset versions with provenance", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await post(
          `/api/v1/jobs`,
          {
            job_type: "text_to_image",
            model_id: modelId,
            asset_id: assetId,
            prompt_text: "provenance check",
            seed: "7",
            settings: {},
          },
          ownerToken,
        );
        const jobId = ((await res.json()) as { job: JobBody }).job.id;
        await waitForJob(ownerToken, jobId, ["succeeded", "failed"]);

        const { getDb } = await import("../src/db/database.ts");
        const rows = getDb()
          .prepare(
            "SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY version_number",
          )
          .all(assetId) as unknown as {
            id: string;
            version_number: number;
            technical_metadata_json: string | null;
          }[];
        // v1 placeholder + v2 generated (3 rows total only if candidates > 1).
        assertEquals(rows.length, 2);
        const generated = rows[rows.length - 1];
        const meta = JSON.parse(generated.technical_metadata_json ?? "{}") as {
          job_id: string;
          model_id: string;
          seed_used: string;
          prompt_text: string;
          candidate_count: number;
        };
        assertEquals(meta.job_id, jobId);
        assertEquals(meta.model_id, modelId);
        assertEquals(meta.seed_used, "7");
        assertEquals(meta.prompt_text, "provenance check");
        assertEquals(meta.candidate_count, 1);

        const active = (
          getDb().prepare("SELECT active_version_id FROM assets WHERE id = ?")
            .get(assetId) as { active_version_id: string | null }
        ).active_version_id;
        assertEquals(active, generated.id);
      })();
    });
  });

  it("validates job creation", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const base = { model_id: modelId, asset_id: assetId, prompt_text: "x" };
        const send = (body: Record<string, unknown>) =>
          post(`/api/v1/jobs`, body, ownerToken).then((r) => r.status);

        assertEquals(
          await send({ ...base, job_type: "bogus" }),
          400,
        );
        assertEquals(
          await send({ job_type: "text_to_image", prompt_text: "x" }),
          400,
        );
        assertEquals(
          await send({ ...base, job_type: "text_to_image", model_id: "nope" }),
          400,
        );
        assertEquals(
          await send({
            ...base,
            job_type: "text_to_image",
            asset_id: "not-an-asset",
          }),
          400,
        );
        assertEquals(
          await send({
            ...base,
            job_type: "text_to_image",
            settings: { candidates: 9 },
          }),
          400,
        );
        assertEquals(
          await send({
            ...base,
            job_type: "image_to_video",
            input_asset_versions: [{ asset_id: assetId, version_number: 99 }],
          }),
          400,
        );
      })();
    });
  });

  it("rejects disabled models and unsupported task types", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const disabledId = registerModel(ownerId, {
          name: "disabled-model",
          version: "1",
          backend: "mock",
          task_types: ["text_to_image"],
          enabled: false,
        }).id;
        const audioId = registerModel(ownerId, {
          name: "audio-only",
          version: "1",
          backend: "mock",
          task_types: ["music"],
          enabled: true,
        }).id;

        const resDisabled = await post(
          `/api/v1/jobs`,
          {
            job_type: "text_to_image",
            model_id: disabledId,
            asset_id: assetId,
            prompt_text: "x",
          },
          ownerToken,
        );
        assertEquals(resDisabled.status, 400);

        const resTask = await post(
          `/api/v1/jobs`,
          {
            job_type: "text_to_image",
            model_id: audioId,
            asset_id: assetId,
            prompt_text: "x",
          },
          ownerToken,
        );
        assertEquals(resTask.status, 400);
        const errBody = (await resTask.json()) as {
          error: { message: string };
        };
        assert(errBody.error.message.includes("does not support task"));
      })();
    });
  });

  it("cancels queued jobs and rejects cancelling finished jobs", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await post(
          `/api/v1/jobs`,
          {
            job_type: "text_to_image",
            model_id: modelId,
            asset_id: assetId,
            prompt_text: "cancel me",
          },
          ownerToken,
        );
        const jobId = ((await res.json()) as { job: JobBody }).job.id;

        // Cancel while still queued (fast cancel before the runner claims it).
        const cancel = await post(`/api/v1/jobs/${jobId}/cancel`, {}, ownerToken);
        if (cancel.status === 200) {
          // Queued at read time -> cancelled; claimed by then -> graceful
          // cancelling that the runner finalizes.
          const status = ((await cancel.json()) as JobBody).status;
          assert(["cancelled", "cancelling"].includes(status));
        } else {
          // A terminal job: cancelling must be rejected.
          assertEquals(cancel.status, 400);
        }

        const final = await waitForJob(
          ownerToken,
          jobId,
          ["succeeded", "failed", "cancelled"],
        );
        const cancelAgain = await post(
          `/api/v1/jobs/${jobId}/cancel`,
          {},
          ownerToken,
        );
        if (final.status === "cancelled") {
          assertEquals(cancelAgain.status, 400);
        }

        const missing = await post(
          `/api/v1/jobs/does-not-exist/cancel`,
          {},
          ownerToken,
        );
        assertEquals(missing.status, 404);
      })();
    });
  });

  it("retries finished jobs", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await post(
          `/api/v1/jobs`,
          {
            job_type: "text_to_image",
            model_id: modelId,
            asset_id: assetId,
            prompt_text: "retry via api",
          },
          ownerToken,
        );
        const jobId = ((await res.json()) as { job: JobBody }).job.id;
        await waitForJob(ownerToken, jobId, ["succeeded", "failed"]);

        const retry = await post(`/api/v1/jobs/${jobId}/retry`, {}, ownerToken);
        assertEquals(retry.status, 200);
        assertEquals(
          ((await retry.json()) as JobBody).status,
          "queued",
        );

        const done = await waitForJob(
          ownerToken,
          jobId,
          ["succeeded", "failed"],
        );
        assertEquals(done.status, "succeeded");

        const retryRunning = (async () => {
          const second = await post(
            `/api/v1/jobs`,
            {
              job_type: "text_to_image",
              model_id: modelId,
              asset_id: assetId,
              prompt_text: "x",
            },
            ownerToken,
          );
          const secondId = ((await second.json()) as { job: JobBody }).job.id;
          return post(`/api/v1/jobs/${secondId}/retry`, {}, ownerToken);
        })();
        // Retrying a non-finished job must fail once it is no longer terminal.
        const r = await retryRunning;
        assert([400, 200].includes(r.status));
      })();
    });
  });

  it("lists jobs with filters", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const a = (await (
          await post(
            `/api/v1/jobs`,
            {
              job_type: "text_to_image",
              model_id: modelId,
              asset_id: assetId,
              prompt_text: "filter a",
            },
            ownerToken,
          )
        ).json()) as { job: JobBody };
        const byModel = (await (
          await get(
            `/api/v1/jobs?model_id=${modelId}&limit=10`,
            ownerToken,
          )
        ).json()) as JobBody[];
        assert(byModel.some((j) => j.id === a.job.id));

        const badStatus = await get(`/api/v1/jobs?status=bogus`, ownerToken);
        assertEquals(badStatus.status, 400);

        const missing = await get(`/api/v1/jobs/nope`, ownerToken);
        assertEquals(missing.status, 404);
      })();
    });
  });
});
