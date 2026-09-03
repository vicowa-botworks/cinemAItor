import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createProject } from "../src/db/projects.ts";
import { getAssetById } from "../src/db/assets.ts";
import { registerModel } from "../src/db/models.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

let baseUrl = "";
let ownerToken: string;
let ownerId: number;
let memberToken: string;
let projectId: string;
let t2iModelId: string;
let i2iModelId: string;
let t2vModelId: string;
let i2vModelId: string;
let voiceModelId: string;

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, json };
}

function uniqueSlug(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function randomImageBytes(seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(64 + seed);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  crypto.getRandomValues(bytes.subarray(8));
  return bytes;
}

async function upload(
  assetId: string,
  token: string,
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/v1/assets/${assetId}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(filename),
    },
    body: bytes,
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, json };
}

/** Create a metadata asset, upload a version of the given media kind, return its id. */
async function createMediaAsset(
  token: string,
  assetType: string,
  filename: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const created = await req(
    "POST",
    "/api/v1/assets",
    {
      unique_slug: uniqueSlug(assetType),
      display_name: `Media ${assetType}`,
      asset_type: assetType,
    },
    token,
  );
  assertEquals(created.status, 201);
  const assetId = (created.json as { id: string }).id;
  const up = await upload(assetId, token, bytes, filename);
  assertEquals(up.status, 201);
  return assetId;
}

async function waitForJob(
  token: string,
  jobId: string,
  statuses: string[],
  timeoutMs = 10000,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const { status, json } = await req(
      "GET",
      `/api/v1/jobs/${jobId}`,
      undefined,
      token,
    );
    assertEquals(status, 200);
    const job = json as Record<string, unknown>;
    if (statuses.includes(job.status as string)) return job;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`job ${jobId} stuck in ${job.status}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function jobVersions(token: string, assetId: string) {
  const { status, json } = await req(
    "GET",
    `/api/v1/assets/${assetId}/versions`,
    undefined,
    token,
  );
  assertEquals(status, 200);
  return json as { version_number: number }[];
}

describe("asset generation api", () => {
  beforeEach(async () => {
    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(health.status, 200);

      const res = await req(
        "POST",
        "/api/v1/auth/bootstrap",
        {
          email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Studio Admin",
        },
      );
      assertEquals(res.status, 201);
      const user = res.json as { token: string; user: { id: number } };
      ownerToken = user.token;
      ownerId = user.user.id;

      const memberRes = await req(
        "POST",
        "/api/auth/register",
        {
          email: `member.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Member",
        },
      );
      assertEquals(memberRes.status, 201);
      memberToken = (memberRes.json as { token: string }).token;

      projectId = createProject({ name: "Gen Project" }, ownerId).id;
      t2iModelId = registerModel(ownerId, {
        name: "mock-t2i",
        version: "1.0",
        backend: "mock",
        task_types: ["text_to_image"],
        enabled: true,
      }).id;
      i2iModelId = registerModel(ownerId, {
        name: "mock-i2i",
        version: "1.0",
        backend: "mock",
        task_types: ["image_to_image"],
        enabled: true,
      }).id;
      t2vModelId = registerModel(ownerId, {
        name: "mock-t2v",
        version: "1.0",
        backend: "mock",
        task_types: ["text_to_video"],
        enabled: true,
      }).id;
      i2vModelId = registerModel(ownerId, {
        name: "mock-i2v",
        version: "1.0",
        backend: "mock",
        task_types: ["image_to_video"],
        enabled: true,
      }).id;
      voiceModelId = registerModel(ownerId, {
        name: "mock-voice",
        version: "1.0",
        backend: "mock",
        task_types: ["voice"],
        enabled: true,
      }).id;
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("requires authentication", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { status } = await req("POST", "/api/v1/assets/generate", {
          kind: "image",
          prompt: "a lighthouse",
          unique_slug: uniqueSlug("lh"),
        });
        assertEquals(status, 401);
      })();
    }));

  it("generates a new image asset from a prompt", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const slug = uniqueSlug("lighthouse");
        const gen = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "a lighthouse at dusk",
            unique_slug: slug,
            display_name: "Lighthouse",
          },
          ownerToken,
        );
        assertEquals(gen.status, 202);
        const body = gen.json as {
          job_id: string;
          job_type: string;
          asset_id: string;
          model_id: string;
        };
        assertEquals(body.job_type, "text_to_image");
        assertEquals(body.model_id, t2iModelId);

        const job = await waitForJob(ownerToken, body.job_id, ["succeeded"]);
        assertEquals(job.candidate_count, 2);

        const versions = await jobVersions(ownerToken, body.asset_id);
        assertEquals(versions.map((v) => v.version_number), [2, 1]);

        const asset = getAssetById(body.asset_id)!;
        assertEquals(asset.unique_slug, slug);
        assertEquals(asset.asset_type, "image");
        assertEquals(asset.display_name, "Lighthouse");
        assertEquals(asset.library_scope, "global");
        assert(asset.active_version_id, "last candidate should be active");

        const { status, json } = await req(
          "GET",
          `/api/v1/assets/${body.asset_id}`,
          undefined,
          ownerToken,
        );
        assertEquals(status, 200);
        const detail = json as Record<string, unknown>;
        assertEquals(detail.unique_slug, slug);
      })();
    });
  });

  it("threads the device choice and the model VRAM requirement into job settings", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const localModelId = registerModel(ownerId, {
          name: "local-cli-t2i",
          version: "1.0",
          backend: "local_cli",
          task_types: ["text_to_image"],
          enabled: true,
          vram_requirement_mb: 51200,
          default_settings: {
            command: "sh",
            args: ["-c", "echo ok > {output}"],
          },
        }).id;
        const gen = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "a lighthouse at dusk",
            unique_slug: uniqueSlug("vramcheck"),
            display_name: "VRAM check",
            model_id: localModelId,
            device: "cuda",
          },
          ownerToken,
        );
        assertEquals(gen.status, 202);
        const body = gen.json as { job_id: string };
        const { status, json } = await req(
          "GET",
          `/api/v1/jobs/${body.job_id}`,
          undefined,
          ownerToken,
        );
        assertEquals(status, 200);
        const settings = (json as { settings: Record<string, unknown> }).settings;
        assertEquals(settings.device, "cuda");
        assertEquals(settings.min_free_vram_mb, 51200);
      })();
    });
  });

  it("threads the quality profile into job settings and rejects unknown profiles", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const profiledModelId = registerModel(ownerId, {
          name: "mock-t2i-profiled",
          version: "1.0",
          backend: "mock",
          task_types: ["text_to_image"],
          enabled: true,
          draft_settings: { resolution: "512" },
          production_settings: { resolution: "1024" },
        }).id;

        const gen = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "a lighthouse at dusk",
            unique_slug: uniqueSlug("profiled"),
            model_id: profiledModelId,
            profile: "production",
          },
          ownerToken,
        );
        assertEquals(gen.status, 202);
        const body = gen.json as { job_id: string; asset_id: string };

        const { status, json } = await req(
          "GET",
          `/api/v1/jobs/${body.job_id}`,
          undefined,
          ownerToken,
        );
        assertEquals(status, 200);
        const settings = (json as { settings: Record<string, unknown> }).settings;
        assertEquals(settings.profile, "production");

        // Draft profile on the edit endpoint (same asset, new versions).
        const edit = await req(
          "POST",
          `/api/v1/assets/${body.asset_id}/generate`,
          {
            kind: "image",
            prompt: "warmer light",
            model_id: profiledModelId,
            profile: "draft",
          },
          ownerToken,
        );
        assertEquals(edit.status, 202);
        const editJobId = (edit.json as { job_id: string }).job_id;
        const editJob = await req(
          "GET",
          `/api/v1/jobs/${editJobId}`,
          undefined,
          ownerToken,
        );
        assertEquals(
          (editJob.json as { settings: Record<string, unknown> }).settings.profile,
          "draft",
        );

        // No profile → no profile key in the job settings.
        const plain = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "a lighthouse at dawn",
            unique_slug: uniqueSlug("plain"),
            model_id: profiledModelId,
          },
          ownerToken,
        );
        assertEquals(plain.status, 202);
        const plainJob = await req(
          "GET",
          `/api/v1/jobs/${(plain.json as { job_id: string }).job_id}`,
          undefined,
          ownerToken,
        );
        assert(
          !("profile" in (plainJob.json as { settings: Record<string, unknown> }).settings),
          "no profile key without the profile field",
        );

        // Unknown profile → 400 (asset created nothing, job not queued).
        const bad = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "a lighthouse",
            unique_slug: uniqueSlug("badprofile"),
            model_id: profiledModelId,
            profile: "ultra",
          },
          ownerToken,
        );
        assertEquals(bad.status, 400);
      })();
    });
  });

  it("generates a new video asset with the text_to_video task", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const gen = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "video",
            prompt: "waves crashing on the lighthouse",
            unique_slug: uniqueSlug("clip"),
          },
          ownerToken,
        );
        assertEquals(gen.status, 202);
        const body = gen.json as {
          job_id: string;
          job_type: string;
          asset_id: string;
          model_id: string;
        };
        assertEquals(body.job_type, "text_to_video");
        assertEquals(body.model_id, t2vModelId);
        const job = await waitForJob(ownerToken, body.job_id, ["succeeded"]);
        assertEquals(job.candidate_count, 2);
        const asset = getAssetById(body.asset_id)!;
        assertEquals(asset.asset_type, "video");
      })();
    });
  });

  it("upgrades to image_to_image when an image reference is provided", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const refAssetId = await createMediaAsset(
          ownerToken,
          "image",
          "ref.png",
          randomImageBytes(16),
        );
        const gen = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "add falling snow",
            unique_slug: uniqueSlug("snowy"),
            references: [{ asset_id: refAssetId }],
          },
          ownerToken,
        );
        assertEquals(gen.status, 202);
        const body = gen.json as {
          job_id: string;
          job_type: string;
          model_id: string;
        };
        assertEquals(body.job_type, "image_to_image");
        assertEquals(body.model_id, i2iModelId);
        const job = await waitForJob(ownerToken, body.job_id, ["succeeded"]);
        const inputs = job.input_asset_versions as {
          asset_id: string;
          version_number: number;
        }[];
        assertEquals(inputs.length, 1);
        assertEquals(inputs[0].asset_id, refAssetId);
        assertEquals(inputs[0].version_number, 1);
      })();
    });
  });

  it("upgrades to image_to_video with a video reference and honors explicit versions", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const refAssetId = await createMediaAsset(
          ownerToken,
          "video",
          "ref.mp4",
          new Uint8Array(128),
        );
        // Upload a second version so the explicit version_number matters.
        const up2 = await upload(
          refAssetId,
          ownerToken,
          new Uint8Array(192),
          "ref2.mp4",
        );
        assertEquals(up2.status, 201);

        const gen = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "video",
            prompt: "make it loop",
            unique_slug: uniqueSlug("loop"),
            references: [{ asset_id: refAssetId, version_number: 1 }],
          },
          ownerToken,
        );
        assertEquals(gen.status, 202);
        const body = gen.json as {
          job_id: string;
          job_type: string;
          model_id: string;
        };
        assertEquals(body.job_type, "image_to_video");
        assertEquals(body.model_id, i2vModelId);
        const job = await waitForJob(ownerToken, body.job_id, ["succeeded"]);
        const inputs = job.input_asset_versions as {
          asset_id: string;
          version_number: number;
        }[];
        assertEquals(inputs[0].asset_id, refAssetId);
        assertEquals(inputs[0].version_number, 1);
      })();
    });
  });

  it("stores multiple candidates as versions and activates the last", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const gen = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "three takes of a red fox",
            unique_slug: uniqueSlug("fox"),
            candidates: 3,
          },
          ownerToken,
        );
        assertEquals(gen.status, 202);
        const body = gen.json as { job_id: string; asset_id: string };
        const job = await waitForJob(ownerToken, body.job_id, ["succeeded"]);
        assertEquals(job.candidate_count, 3);
        const versions = await jobVersions(ownerToken, body.asset_id);
        assertEquals(versions.map((v) => v.version_number), [3, 2, 1]);
        const active = (await req(
          "GET",
          `/api/v1/assets/${body.asset_id}`,
          undefined,
          ownerToken,
        )).json as { active_version: { version_number: number } | null };
        assertEquals(active.active_version?.version_number, 3);
      })();
    });
  });

  it("edits an existing asset using its current version as reference", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const assetId = await createMediaAsset(
          ownerToken,
          "character",
          "hero.png",
          randomImageBytes(32),
        );
        const gen = await req(
          "POST",
          `/api/v1/assets/${assetId}/generate`,
          {
            kind: "image",
            prompt: "relight with warm sunset tones",
            include_current: true,
            candidates: 2,
          },
          ownerToken,
        );
        assertEquals(gen.status, 202);
        const body = gen.json as { job_id: string; job_type: string; asset_id: string };
        assertEquals(body.job_type, "image_to_image");
        assertEquals(body.asset_id, assetId);
        const job = await waitForJob(ownerToken, body.job_id, ["succeeded"]);
        assertEquals(job.candidate_count, 2);
        const versions = await jobVersions(ownerToken, assetId);
        assertEquals(versions.map((v) => v.version_number), [3, 2, 1]);
        const asset = getAssetById(assetId)!;
        assert(asset.active_version_id);
      })();
    });
  });

  it("edits without references as a text task and accepts other references", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const targetId = await createMediaAsset(
          ownerToken,
          "image",
          "target.png",
          randomImageBytes(16),
        );
        const refId = await createMediaAsset(
          ownerToken,
          "prop",
          "prop.png",
          randomImageBytes(24),
        );

        const plain = await req(
          "POST",
          `/api/v1/assets/${targetId}/generate`,
          { kind: "image", prompt: "full restyle as claymation" },
          ownerToken,
        );
        assertEquals(plain.status, 202);
        const plainBody = plain.json as { job_id: string; job_type: string };
        assertEquals(plainBody.job_type, "text_to_image");
        await waitForJob(ownerToken, plainBody.job_id, ["succeeded"]);

        const withRef = await req(
          "POST",
          `/api/v1/assets/${targetId}/generate`,
          {
            kind: "image",
            prompt: "add the prop to the scene",
            references: [{ asset_id: refId }],
          },
          ownerToken,
        );
        assertEquals(withRef.status, 202);
        const refBody = withRef.json as { job_id: string; job_type: string };
        assertEquals(refBody.job_type, "image_to_image");
        await waitForJob(ownerToken, refBody.job_id, ["succeeded"]);
      })();
    });
  });

  it("creates project-scoped generated assets", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const gen = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "concept art for the village",
            unique_slug: uniqueSlug("village"),
            library_scope: "project",
            project_id: projectId,
          },
          ownerToken,
        );
        assertEquals(gen.status, 202);
        const body = gen.json as { job_id: string; asset_id: string };
        await waitForJob(ownerToken, body.job_id, ["succeeded"]);
        const asset = getAssetById(body.asset_id)!;
        assertEquals(asset.library_scope, "project");
        assertEquals(asset.project_id, projectId);
      })();
    });
  });

  it("validates the generation request", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const cases: { body: Record<string, unknown>; status: number }[] = [
          { body: { kind: "image", unique_slug: uniqueSlug("a") }, status: 400 },
          {
            body: { kind: "audio", prompt: "x", unique_slug: uniqueSlug("b") },
            status: 400,
          },
          {
            body: { kind: "image", prompt: "x", unique_slug: "Bad Slug!" },
            status: 400,
          },
          {
            body: {
              kind: "image",
              prompt: "x",
              unique_slug: uniqueSlug("c"),
              asset_type: "video",
            },
            status: 400,
          },
          {
            body: {
              kind: "image",
              prompt: "x",
              unique_slug: uniqueSlug("d"),
              candidates: 0,
            },
            status: 400,
          },
          {
            body: {
              kind: "image",
              prompt: "x",
              unique_slug: uniqueSlug("e"),
              candidates: 9,
            },
            status: 400,
          },
          {
            body: {
              kind: "image",
              prompt: "x",
              unique_slug: uniqueSlug("f"),
              library_scope: "project",
            },
            status: 400,
          },
          {
            body: {
              kind: "image",
              prompt: "x",
              unique_slug: uniqueSlug("g"),
              model_id: voiceModelId,
            },
            status: 400,
          },
          {
            body: {
              kind: "image",
              prompt: "x",
              unique_slug: uniqueSlug("h"),
              references: [{ version_number: 1 }],
            },
            status: 400,
          },
        ];
        for (const { body, status } of cases) {
          const { status: actual } = await req(
            "POST",
            "/api/v1/assets/generate",
            body,
            ownerToken,
          );
          assertEquals(actual, status, JSON.stringify(body));
        }

        // Duplicate slug conflicts.
        const dupSlug = uniqueSlug("dup");
        const created = await req(
          "POST",
          "/api/v1/assets",
          { unique_slug: dupSlug, display_name: "Dup", asset_type: "reference" },
          ownerToken,
        );
        assertEquals(created.status, 201);
        const dup2 = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "x",
            unique_slug: dupSlug,
          },
          ownerToken,
        );
        assertEquals(dup2.status, 409);
      })();
    });
  });

  it("rejects bad references", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        // Unknown asset.
        const missing = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "x",
            unique_slug: uniqueSlug("m"),
            references: [{ asset_id: "asset_does_not_exist" }],
          },
          ownerToken,
        );
        assertEquals(missing.status, 404);

        // Asset without any version.
        const empty = await req(
          "POST",
          "/api/v1/assets",
          {
            unique_slug: uniqueSlug("empty"),
            display_name: "Empty",
            asset_type: "reference",
          },
          ownerToken,
        );
        assertEquals(empty.status, 201);
        const emptyId = (empty.json as { id: string }).id;
        const noVersion = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "x",
            unique_slug: uniqueSlug("nv"),
            references: [{ asset_id: emptyId }],
          },
          ownerToken,
        );
        assertEquals(noVersion.status, 400);

        // Non-image/video version.
        const meta = await req(
          "POST",
          "/api/v1/assets",
          {
            unique_slug: uniqueSlug("notes"),
            display_name: "Notes",
            asset_type: "reference",
          },
          ownerToken,
        );
        assertEquals(meta.status, 201);
        const metaId = (meta.json as { id: string }).id;
        const noteUpload = await fetch(
          `${baseUrl}/api/v1/assets/${metaId}/upload`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${ownerToken}`,
              "Content-Type": "application/octet-stream",
              "X-File-Name": encodeURIComponent("notes.txt"),
            },
            body: new TextEncoder().encode("some notes"),
          },
        );
        assertEquals(noteUpload.status, 201);
        const notMedia = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "x",
            unique_slug: uniqueSlug("nm"),
            references: [{ asset_id: metaId }],
          },
          ownerToken,
        );
        assertEquals(notMedia.status, 400);

        // Unknown version number.
        const refAssetId = await createMediaAsset(
          ownerToken,
          "image",
          "r.png",
          randomImageBytes(12),
        );
        const badVersion = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "x",
            unique_slug: uniqueSlug("bv"),
            references: [{ asset_id: refAssetId, version_number: 7 }],
          },
          ownerToken,
        );
        assertEquals(badVersion.status, 400);
      })();
    });
  });

  it("isolates generation from users without access", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const ownerAssetId = await createMediaAsset(
          ownerToken,
          "image",
          "owner.png",
          randomImageBytes(12),
        );

        // Member cannot generate into the owner's asset.
        const denied = await req(
          "POST",
          `/api/v1/assets/${ownerAssetId}/generate`,
          { kind: "image", prompt: "hijack" },
          memberToken,
        );
        assertEquals(denied.status, 404);

        // Member cannot reference the owner's asset.
        const ref = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "x",
            unique_slug: uniqueSlug("steal"),
            references: [{ asset_id: ownerAssetId }],
          },
          memberToken,
        );
        assertEquals(ref.status, 404);

        // Member can still generate their own assets.
        const own = await req(
          "POST",
          "/api/v1/assets/generate",
          {
            kind: "image",
            prompt: "a paper boat",
            unique_slug: uniqueSlug("boat"),
          },
          memberToken,
        );
        assertEquals(own.status, 202);
        const body = own.json as { job_id: string };
        await waitForJob(memberToken, body.job_id, ["succeeded"]);
      })();
    });
  });
});
