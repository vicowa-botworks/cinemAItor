import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createAsset, createAssetVersion } from "../src/db/assets.ts";
import { createProject } from "../src/db/projects.ts";
import { registerModel } from "../src/db/models.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

let baseUrl = "";
let ownerToken: string;
let ownerId: number;
let projectId: string;
let t2iModelId: string;
let i2vModelId: string;

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
    const { status, json } = await req("GET", `/api/v1/jobs/${jobId}`, undefined, token);
    assertEquals(status, 200);
    const job = json as Record<string, unknown>;
    if (statuses.includes(job.status as string)) return job;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`job ${jobId} stuck in ${job.status}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("storyboards and scenes api", () => {
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

      projectId = createProject({ name: "Test Film" }, ownerId).id;
      t2iModelId = registerModel(ownerId, {
        name: "api-mock-t2i",
        version: "1.0",
        backend: "mock",
        task_types: ["text_to_image"],
        enabled: true,
      }).id;
      i2vModelId = registerModel(ownerId, {
        name: "api-mock-i2v",
        version: "1.0",
        backend: "mock",
        task_types: ["image_to_video"],
        enabled: true,
      }).id;
      createAsset(
        {
          unique_slug: "captain",
          display_name: "Captain",
          asset_type: "character",
          library_scope: "global",
        },
        ownerId,
      );
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("requires authentication", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        assertEquals((await req("GET", "/api/v1/storyboards")).status, 401);
        assertEquals((await req("GET", "/api/v1/scenes")).status, 401);
      })();
    }));

  it("creates a storyboard, panels with prompts, and warnings", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const board = await req(
          "POST",
          "/api/v1/storyboards",
          { project_id: projectId, name: "Act 1" },
          ownerToken,
        );
        assertEquals(board.status, 201);
        const boardId = (board.json as { id: string }).id;

        const p1 = await req(
          "POST",
          `/api/v1/storyboards/${boardId}/panels`,
          {
            panel_order: 1,
            prompt: "@captain greets the @crew",
            mood: "hopeful",
          },
          ownerToken,
        );
        assertEquals(p1.status, 201);
        const p1body = p1.json as {
          id: string;
          panel_order: number;
          prompt: {
            content: string;
            version_number: number;
            warnings: string[];
          } | null;
        };
        assertEquals(p1body.panel_order, 1);
        assert(p1body.prompt);
        assertEquals(p1body.prompt.version_number, 1);
        assertEquals(p1body.prompt.warnings.length, 1);
        assert(p1body.prompt.warnings[0].includes("@crew"));

        const dup = await req(
          "POST",
          `/api/v1/storyboards/${boardId}/panels`,
          { panel_order: 1 },
          ownerToken,
        );
        assertEquals(dup.status, 400);

        const detail = await req(
          "GET",
          `/api/v1/storyboards/${boardId}`,
          undefined,
          ownerToken,
        );
        assertEquals(detail.status, 200);
        const body = detail.json as {
          storyboard: { name: string };
          panels: { panel_order: number }[];
        };
        assertEquals(body.storyboard.name, "Act 1");
        assertEquals(body.panels.length, 1);

        // Permission: unknown project rejected.
        const noProject = await req(
          "POST",
          "/api/v1/storyboards",
          { project_id: "does-not-exist", name: "X" },
          ownerToken,
        );
        assertEquals(noProject.status, 404);
      })();
    });
  });

  it("links a generated preview to the panel", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const board = await req(
          "POST",
          "/api/v1/storyboards",
          { project_id: projectId, name: "Act 2" },
          ownerToken,
        );
        const boardId = (board.json as { id: string }).id;
        const panel = await req(
          "POST",
          `/api/v1/storyboards/${boardId}/panels`,
          { panel_order: 1, prompt: "@captain sails" },
          ownerToken,
        );
        const panelId = (panel.json as { id: string }).id;

        const gen = await req(
          "POST",
          `/api/v1/storyboards/${boardId}/panels/${panelId}/generate-preview`,
          { model_id: t2iModelId, seed: "12" },
          ownerToken,
        );
        assertEquals(gen.status, 202);
        const genBody = gen.json as {
          job_id: string;
          asset_id: string;
          model_id: string;
          warnings: string[];
        };
        assertEquals(genBody.model_id, t2iModelId);

        const job = await waitForJob(ownerToken, genBody.job_id, [
          "succeeded",
          "failed",
        ]);
        assertEquals(job.status, "succeeded");

        const fresh = await req(
          "GET",
          `/api/v1/storyboards/${boardId}`,
          undefined,
          ownerToken,
        );
        const panels = (fresh.json as {
          panels: {
            id: string;
            status: string;
            preview_asset_version_id: string | null;
          }[];
        }).panels;
        const mine = panels.find((p) => p.id === panelId);
        assert(mine);
        assertEquals(mine.status, "preview_ready");
        assert(mine.preview_asset_version_id);
      })();
    });
  });

  it("generates scenes as i2v from a linked panel preview and t2v without", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        // Scene without image input and no t2v model: clear error.
        const scene = await req(
          "POST",
          "/api/v1/scenes",
          { project_id: projectId, name: "Open Water", prompt: "@waves crash" },
          ownerToken,
        );
        assertEquals(scene.status, 201);
        const sceneId = (scene.json as { id: string }).id;

        const t2vFail = await req(
          "POST",
          `/api/v1/scenes/${sceneId}/generate`,
          {},
          ownerToken,
        );
        assertEquals(t2vFail.status, 400);
        assert(
          String(
            (t2vFail.json as { error: { message: string } }).error.message,
          ).includes("text_to_video"),
        );

        // With a linked panel that has a preview: i2v job.
        const board = await req(
          "POST",
          "/api/v1/storyboards",
          { project_id: projectId, name: "Board" },
          ownerToken,
        );
        const boardId = (board.json as { id: string }).id;
        const panel = await req(
          "POST",
          `/api/v1/storyboards/${boardId}/panels`,
          { panel_order: 1, prompt: "@waves at night" },
          ownerToken,
        );
        const panelId = (panel.json as { id: string }).id;
        const preview = await req(
          "POST",
          `/api/v1/storyboards/${boardId}/panels/${panelId}/generate-preview`,
          { model_id: t2iModelId },
          ownerToken,
        );
        const previewJob = (preview.json as { job_id: string }).job_id;
        const done = await waitForJob(ownerToken, previewJob, [
          "succeeded",
          "failed",
        ]);
        assertEquals(done.status, "succeeded");

        const link = await req(
          "PATCH",
          `/api/v1/storyboards/${boardId}/panels/${panelId}`,
          { linked_scene_id: sceneId },
          ownerToken,
        );
        assertEquals(link.status, 200);

        const sceneGen = await req(
          "POST",
          `/api/v1/scenes/${sceneId}/generate`,
          { model_id: i2vModelId },
          ownerToken,
        );
        assertEquals(sceneGen.status, 202);
        const sg = sceneGen.json as { job_type: string; job_id: string };
        assertEquals(sg.job_type, "image_to_video");

        const sceneJob = await waitForJob(ownerToken, sg.job_id, [
          "succeeded",
          "failed",
        ]);
        assertEquals(sceneJob.status, "succeeded");
      })();
    });
  });

  it("threads the device choice and VRAM requirement into creative job settings", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const localT2iId = registerModel(ownerId, {
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
        const localI2vId = registerModel(ownerId, {
          name: "local-cli-i2v",
          version: "1.0",
          backend: "local_cli",
          task_types: ["image_to_video"],
          enabled: true,
          vram_requirement_mb: 65536,
          default_settings: {
            command: "sh",
            args: ["-c", "echo ok > {output}"],
          },
        }).id;

        const board = await req(
          "POST",
          "/api/v1/storyboards",
          { project_id: projectId, name: "VRAM board" },
          ownerToken,
        );
        const boardId = (board.json as { id: string }).id;
        const p1 = await req(
          "POST",
          `/api/v1/storyboards/${boardId}/panels`,
          { panel_order: 1, prompt: "a quiet harbor" },
          ownerToken,
        );
        const p1Id = (p1.json as { id: string }).id;
        const p2 = await req(
          "POST",
          `/api/v1/storyboards/${boardId}/panels`,
          { panel_order: 2, prompt: "waves at night" },
          ownerToken,
        );
        const p2Id = (p2.json as { id: string }).id;

        // Panel preview: explicit device + the model's VRAM requirement.
        const preview = await req(
          "POST",
          `/api/v1/storyboards/${boardId}/panels/${p1Id}/generate-preview`,
          { model_id: localT2iId, device: "cpu" },
          ownerToken,
        );
        assertEquals(preview.status, 202);
        const previewJobId = (preview.json as { job_id: string }).job_id;
        const p1job = (await req(
          "GET",
          `/api/v1/jobs/${previewJobId}`,
          undefined,
          ownerToken,
        )).json as { settings: Record<string, unknown> };
        assertEquals(p1job.settings.device, "cpu");
        assertEquals(p1job.settings.min_free_vram_mb, 51200);

        // Scene generation (i2v from a linked panel preview) with a device.
        const preview2 = await req(
          "POST",
          `/api/v1/storyboards/${boardId}/panels/${p2Id}/generate-preview`,
          { model_id: t2iModelId },
          ownerToken,
        );
        const p2done = await waitForJob(
          ownerToken,
          (preview2.json as { job_id: string }).job_id,
          ["succeeded", "failed"],
        );
        assertEquals(p2done.status, "succeeded");
        const scene = await req(
          "POST",
          "/api/v1/scenes",
          { project_id: projectId, name: "Harbor scene", prompt: "waves" },
          ownerToken,
        );
        const sceneId = (scene.json as { id: string }).id;
        const link = await req(
          "PATCH",
          `/api/v1/storyboards/${boardId}/panels/${p2Id}`,
          { linked_scene_id: sceneId },
          ownerToken,
        );
        assertEquals(link.status, 200);
        const sceneGen = await req(
          "POST",
          `/api/v1/scenes/${sceneId}/generate`,
          { model_id: localI2vId, device: "cpu" },
          ownerToken,
        );
        assertEquals(sceneGen.status, 202);
        const sceneJob = (await req(
          "GET",
          `/api/v1/jobs/${(sceneGen.json as { job_id: string }).job_id}`,
          undefined,
          ownerToken,
        )).json as { settings: Record<string, unknown> };
        assertEquals(sceneJob.settings.device, "cpu");
        assertEquals(sceneJob.settings.min_free_vram_mb, 65536);

        // No device and no declared requirement: neither key is injected.
        const preview3 = await req(
          "POST",
          `/api/v1/storyboards/${boardId}/panels/${p2Id}/generate-preview`,
          { model_id: t2iModelId },
          ownerToken,
        );
        const p3job = (await req(
          "GET",
          `/api/v1/jobs/${(preview3.json as { job_id: string }).job_id}`,
          undefined,
          ownerToken,
        )).json as { settings: Record<string, unknown> };
        assertEquals(p3job.settings.device, undefined);
        assertEquals(p3job.settings.min_free_vram_mb, undefined);
      })();
    });
  });

  it("threads the device choice into audio and timeline-score job settings", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const localMusicId = registerModel(ownerId, {
          name: "local-cli-music",
          version: "1.0",
          backend: "local_cli",
          task_types: ["music"],
          enabled: true,
          vram_requirement_mb: 40000,
          default_settings: {
            command: "sh",
            args: ["-c", "echo ok > {output}"],
          },
        }).id;

        // Audio generation: explicit device + the model's VRAM requirement.
        const audio = await req(
          "POST",
          "/api/v1/audio/generate",
          {
            kind: "music",
            prompt: "tense underscore",
            project_id: projectId,
            model_id: localMusicId,
            device: "cuda",
          },
          ownerToken,
        );
        assertEquals(audio.status, 202);
        const audioJob = (await req(
          "GET",
          `/api/v1/jobs/${(audio.json as { job_id: string }).job_id}`,
          undefined,
          ownerToken,
        )).json as { settings: Record<string, unknown> };
        assertEquals(audioJob.settings.device, "cuda");
        assertEquals(audioJob.settings.min_free_vram_mb, 40000);

        // Timeline score: a cut is required, so stage a video item first.
        const clip = createAsset(
          {
            unique_slug: `vram_clip_${Math.random().toString(36).slice(2, 8)}`,
            display_name: "Clip",
            asset_type: "video",
            library_scope: "global",
          },
          ownerId,
        );
        const clipVersion = createAssetVersion(clip.id, ownerId, {
          content_hash: "f".repeat(64),
          file_path: "/tmp/vram_clip.mp4",
          format: "mp4",
          mime_type: "video/mp4",
          file_size: 1000,
          make_active: true,
        }).id;
        const tl = await req(
          "POST",
          "/api/v1/timelines",
          { project_id: projectId, name: "Score cut" },
          ownerToken,
        );
        assertEquals(tl.status, 201);
        const timelineId = (tl.json as { id: string }).id;
        const track = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/tracks`,
          { track_type: "video", name: "V1" },
          ownerToken,
        );
        assertEquals(track.status, 201);
        const trackId = (track.json as { id: string }).id;
        const item = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/items`,
          { track_id: trackId, asset_version_id: clipVersion, start_time: 0, end_time: 4 },
          ownerToken,
        );
        assertEquals(item.status, 201);

        const score = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/score`,
          { prompt: "tense underscore", model_id: localMusicId, device: "cpu" },
          ownerToken,
        );
        assertEquals(score.status, 202);
        const scoreJob = (await req(
          "GET",
          `/api/v1/jobs/${(score.json as { job: { job_id: string } }).job.job_id}`,
          undefined,
          ownerToken,
        )).json as { settings: Record<string, unknown> };
        assertEquals(scoreJob.settings.device, "cpu");
        assertEquals(scoreJob.settings.min_free_vram_mb, 40000);
      })();
    });
  });

  it("batch-generates all shots of a scene (skip shots without prompts)", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const scene = await req(
          "POST",
          "/api/v1/scenes",
          { project_id: projectId, name: "Harbor", prompt: "scene fallback prompt" },
          ownerToken,
        );
        assertEquals(scene.status, 201);
        const sceneId = (scene.json as { id: string }).id;

        const s1 = await req(
          "POST",
          `/api/v1/scenes/${sceneId}/shots`,
          { shot_order: 1, name: "Wide", prompt: "wide shot from the harbor" },
          ownerToken,
        );
        assertEquals(s1.status, 201);
        const shot1 = (s1.json as { id: string }).id;

        const s2 = await req(
          "POST",
          `/api/v1/scenes/${sceneId}/shots`,
          { shot_order: 2, name: "Close" },
          ownerToken,
        );
        assertEquals(s2.status, 201);
        const shot2 = (s2.json as { id: string }).id;

        // Without a linked panel preview, batch generation uses the scene's
        // t2v path when a text_to_video model is available.
        const t2vModelId = registerModel(ownerId, {
          name: "api-mock-t2v",
          version: "1.0",
          backend: "mock",
          task_types: ["text_to_video"],
          enabled: true,
        }).id;

        const res = await req(
          "POST",
          `/api/v1/scenes/${sceneId}/batch-generate`,
          { model_id: t2vModelId },
          ownerToken,
        );
        assertEquals(res.status, 202);
        const batch = res.json as {
          job_type: string;
          jobs: { shot_id: string; job_id: string; asset_id: string }[];
          skipped: { shot_id: string; reason: string }[];
        };
        assertEquals(batch.job_type, "text_to_video");
        assertEquals(batch.jobs.length, 2, "both shots fall back to the scene prompt");
        assertEquals(batch.skipped.length, 0);
        assertEquals(batch.jobs[0].shot_id, shot1);
        assertEquals(batch.jobs[1].shot_id, shot2);

        for (const j of batch.jobs) {
          const done = await waitForJob(ownerToken, j.job_id, ["succeeded", "failed"]);
          assertEquals(done.status, "succeeded");
        }

        // Runner linked outputs back: both shots are generated.
        const shots = await req(
          "GET",
          `/api/v1/scenes/${sceneId}/shots`,
          undefined,
          ownerToken,
        );
        const list = shots.json as {
          id: string;
          status: string;
          generated_asset_version_id: string | null;
        }[];
        for (const id of [shot1, shot2]) {
          const found = list.find((s) => s.id === id);
          assert(found);
          assertEquals(found.status, "generated");
          assertEquals(found.generated_asset_version_id !== null, true);
        }

        // A scene whose shots have no prompts at all: 400.
        const empty = await req(
          "POST",
          "/api/v1/scenes",
          { project_id: projectId, name: "Silent" },
          ownerToken,
        );
        const emptyId = (empty.json as { id: string }).id;
        await req(
          "POST",
          `/api/v1/scenes/${emptyId}/shots`,
          { shot_order: 1, name: "No prompt" },
          ownerToken,
        );
        const fail = await req(
          "POST",
          `/api/v1/scenes/${emptyId}/batch-generate`,
          {},
          ownerToken,
        );
        assertEquals(fail.status, 400);
        assert(
          String(
            (fail.json as { error: { message: string } }).error.message,
          ).includes("No shot in this scene has a prompt"),
        );

        // A scene with no shots: 400.
        const bare = await req(
          "POST",
          "/api/v1/scenes",
          { project_id: projectId, name: "Bare" },
          ownerToken,
        );
        const bareId = (bare.json as { id: string }).id;
        const bareFail = await req(
          "POST",
          `/api/v1/scenes/${bareId}/batch-generate`,
          {},
          ownerToken,
        );
        assertEquals(bareFail.status, 400);
      })();
    });
  });

  it("manages shots under scenes", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const scene = await req(
          "POST",
          "/api/v1/scenes",
          { project_id: projectId, name: "Shots" },
          ownerToken,
        );
        const sceneId = (scene.json as { id: string }).id;

        const s1 = await req(
          "POST",
          `/api/v1/scenes/${sceneId}/shots`,
          { shot_order: 1, name: "Wide", prompt: "wide shot" },
          ownerToken,
        );
        assertEquals(s1.status, 201);
        const shot1 = s1.json as {
          id: string;
          prompt: { content: string } | null;
        };
        assert(shot1.prompt);
        assertEquals(shot1.prompt.content, "wide shot");

        const dup = await req(
          "POST",
          `/api/v1/scenes/${sceneId}/shots`,
          { shot_order: 1 },
          ownerToken,
        );
        assertEquals(dup.status, 400);

        const list = await req(
          "GET",
          `/api/v1/scenes/${sceneId}/shots`,
          undefined,
          ownerToken,
        );
        assertEquals(
          (list.json as { shot_order: number }[]).length,
          1,
        );

        const del = await req(
          "DELETE",
          `/api/v1/scenes/${sceneId}/shots/${shot1.id}`,
          undefined,
          ownerToken,
        );
        assertEquals(del.status, 200);
        assertEquals(
          (
            await req(
              "GET",
              `/api/v1/scenes/${sceneId}/shots`,
              undefined,
              ownerToken,
            )
          ).json as unknown[],
          [],
        );

        const missing = await req(
          "GET",
          `/api/v1/scenes/does-not-exist`,
          undefined,
          ownerToken,
        );
        assertEquals(missing.status, 404);
      })();
    });
  });
});
