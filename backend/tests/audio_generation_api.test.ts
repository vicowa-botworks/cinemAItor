import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { closeDb, getDb } from "../src/db/database.ts";
import { createProject } from "../src/db/projects.ts";
import { type Asset, getAssetById } from "../src/db/assets.ts";
import { createScene } from "../src/db/scenes.ts";
import { registerModel } from "../src/db/models.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

let baseUrl = "";
let ownerToken: string;
let ownerId: number;
let otherToken: string;
let projectId: string;
let musicModelId: string;
let voiceModelId: string;
let sfxModelId: string;

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

describe("audio generation api", () => {
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

      const otherRes = await req(
        "POST",
        "/api/auth/register",
        {
          email: `member.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Member",
        },
      );
      assertEquals(otherRes.status, 201);
      otherToken = (otherRes.json as { token: string }).token;

      projectId = createProject({ name: "Score Project" }, ownerId).id;
      musicModelId = registerModel(ownerId, {
        name: "mock-music",
        version: "1.0",
        backend: "mock",
        task_types: ["music"],
        enabled: true,
      }).id;
      voiceModelId = registerModel(ownerId, {
        name: "mock-voice",
        version: "1.0",
        backend: "mock",
        task_types: ["voice"],
        enabled: true,
      }).id;
      sfxModelId = registerModel(ownerId, {
        name: "mock-sfx",
        version: "1.0",
        backend: "mock",
        task_types: ["audio"],
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
        const { status } = await req("POST", "/api/v1/audio/generate", {
          kind: "music",
          prompt: "test",
          project_id: projectId,
        });
        assertEquals(status, 401);
      })();
    }));

  it("generates music from a prompt into a fresh audio asset", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { status, json } = await req(
          "POST",
          "/api/v1/audio/generate",
          { kind: "music", prompt: "tense, low strings", project_id: projectId },
          ownerToken,
        );
        assertEquals(status, 202);
        const result = json as {
          job_id: string;
          job_type: string;
          asset_id: string;
          model_id: string;
        };
        assertEquals(result.job_type, "music");
        assertEquals(result.model_id, musicModelId);

        const job = await waitForJob(ownerToken, result.job_id, ["succeeded"]);
        assertEquals(job.status, "succeeded");
        assertEquals(job.project_id, projectId);
        const versionId = job.output_asset_version_id as string;
        assertEquals(typeof versionId, "string");

        const asset = getAssetById(result.asset_id) as Asset;
        assertEquals(asset.asset_type, "audio");
        assertEquals(asset.unique_slug.startsWith("music_"), true);
        const db = getDb();
        const versionRow = db.prepare(
          "SELECT * FROM asset_versions WHERE id = ?",
        ).get(versionId) as Record<string, unknown>;
        assertEquals(versionRow.mime_type, "audio/wav");
        assertEquals(versionRow.version_number, 1);
        const meta = JSON.parse(versionRow.technical_metadata_json as string) as Record<
          string,
          unknown
        >;
        assertEquals(meta.prompt_text, "tense, low strings");
        assertEquals(meta.job_type, "music");
        assertEquals(meta.model_id, musicModelId);
        assertEquals(typeof meta.seed_used, "string");
      })();
    });
  });

  it("generates voiceover for a scene", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const scene = await createScene(ownerId, {
          name: "Diner",
          project_id: projectId,
        });
        const { status, json } = await req(
          "POST",
          "/api/v1/audio/generate",
          {
            kind: "voiceover",
            prompt: "Long time no see, captain.",
            scene_id: scene.id,
          },
          ownerToken,
        );
        assertEquals(status, 202);
        const result = json as { job_id: string; job_type: string; asset_id: string };
        assertEquals(result.job_type, "voice");

        const job = await waitForJob(ownerToken, result.job_id, ["succeeded"]);
        assertEquals(job.project_id, projectId);
        assertEquals(job.scene_id, scene.id);

        const asset = getAssetById(result.asset_id) as Asset;
        assertEquals(asset.asset_type, "audio");
        assertEquals(asset.unique_slug.startsWith("voiceover_"), true);
      })();
    });
  });

  it("generates sfx", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { status, json } = await req(
          "POST",
          "/api/v1/audio/generate",
          { kind: "sfx", prompt: "distant thunder roll", project_id: projectId },
          ownerToken,
        );
        assertEquals(status, 202);
        const result = json as { job_id: string; job_type: string; model_id: string };
        assertEquals(result.job_type, "audio");
        assertEquals(result.model_id, sfxModelId);

        const job = await waitForJob(ownerToken, result.job_id, ["succeeded"]);
        assertEquals(job.status, "succeeded");
      })();
    });
  });

  it("validates input", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const base = { kind: "music", project_id: projectId };
        let r = await req("POST", "/api/v1/audio/generate", base, ownerToken);
        assertEquals(r.status, 400, "missing prompt");

        r = await req(
          "POST",
          "/api/v1/audio/generate",
          { ...base, prompt: "  " },
          ownerToken,
        );
        assertEquals(r.status, 400, "blank prompt");

        r = await req(
          "POST",
          "/api/v1/audio/generate",
          { kind: "hologram", prompt: "x", project_id: projectId },
          ownerToken,
        );
        assertEquals(r.status, 400, "unknown kind");

        r = await req(
          "POST",
          "/api/v1/audio/generate",
          { kind: "music", prompt: "x" },
          ownerToken,
        );
        assertEquals(r.status, 400, "missing project/scene");

        const disabled = await req(
          "PATCH",
          `/api/v1/models/${voiceModelId}`,
          { enabled: false },
          ownerToken,
        );
        assertEquals(disabled.status, 200);
        r = await req(
          "POST",
          "/api/v1/audio/generate",
          { kind: "voiceover", prompt: "x", project_id: projectId },
          ownerToken,
        );
        assertEquals(r.status, 400, "no enabled voice model");

        r = await req(
          "POST",
          "/api/v1/audio/generate",
          {
            kind: "voiceover",
            prompt: "x",
            project_id: projectId,
            model_id: musicModelId,
          },
          ownerToken,
        );
        assertEquals(r.status, 400, "model without voice task");
      })();
    });
  });

  it("enforces project permissions", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { status } = await req(
          "POST",
          "/api/v1/audio/generate",
          { kind: "music", prompt: "x", project_id: projectId },
          otherToken,
        );
        assertEquals(status, 404);
      })();
    });
  });
});
