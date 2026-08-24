import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { closeDb, getDb } from "../src/db/database.ts";
import { createProject } from "../src/db/projects.ts";
import { registerModel } from "../src/db/models.ts";
import { scoreDuration, type ScoreInput, suggestScore } from "../src/services/score_suggestion.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

// ---------------------------------------------------------------------------
// Pure service
// ---------------------------------------------------------------------------

describe("score suggestion (pure)", () => {
  function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
    return {
      timeline_duration: 47,
      video_item_count: 3,
      music_item_count: 0,
      dialogue_item_count: 2,
      panels: [
        {
          panel_order: 1,
          time_of_day: "night",
          lighting: "low-key",
          mood: "tense",
          music_cue: "low piano",
        },
        {
          panel_order: 2,
          time_of_day: "night",
          lighting: "low-key",
          mood: "tense",
          music_cue: "drone",
        },
        {
          panel_order: 3,
          time_of_day: "dawn",
          lighting: "low-key",
          mood: "tense",
          music_cue: null,
        },
      ],
      ...overrides,
    };
  }

  it("synthesizes a deterministic prompt from dominant panel fields", () => {
    const s = suggestScore(input());
    assertEquals(s.time_of_day, "night");
    assertEquals(s.lighting, "low-key");
    assertEquals(s.mood, "tense");
    assertEquals(s.music_cues, ["drone", "low piano"]);
    assertEquals(s.duration_seconds, 50);
    assertEquals(s.has_existing_music, false);
    assertEquals(s.has_dialogue, true);
    assertEquals(
      s.prompt,
      "Stated cues: drone; low piano. Cinematic instrumental score, 50s, " +
        "night, low-key, tense, leaves space for dialogue.",
    );
  });

  it("falls back to a generic tag list when panels declare nothing", () => {
    const s = suggestScore(
      input({
        panels: [],
        timeline_duration: 0,
        dialogue_item_count: 0,
      }),
    );
    assertEquals(
      s.prompt,
      "Cinematic instrumental score, 5s, timeless and " +
        "atmospheric, no dialogue on the cut.",
    );
  });

  it("mentions existing score and missing dialogue", () => {
    const s = suggestScore(input({
      music_item_count: 2,
      dialogue_item_count: 0,
      panels: [],
    }));
    assertEquals(
      s.prompt,
      "Cinematic instrumental score, 50s, timeless and " +
        "atmospheric, no dialogue on the cut, complements the existing score on " +
        "the cut.",
    );
  });

  it("dedupes and caps stated music cues", () => {
    const s = suggestScore(input({
      panels: [1, 2, 3, 4, 5].map((n) => ({
        panel_order: n,
        time_of_day: null,
        lighting: null,
        mood: null,
        music_cue: `cue ${n}`,
      })),
    }));
    assertEquals(s.music_cues, ["cue 1", "cue 2", "cue 3", "cue 4"]);
  });

  it("ignores n/a values when picking dominant fields", () => {
    const s = suggestScore(input({
      panels: [
        { panel_order: 1, time_of_day: "n/a", lighting: null, mood: null, music_cue: null },
        { panel_order: 2, time_of_day: "N/A", lighting: "moody", mood: null, music_cue: null },
        { panel_order: 3, time_of_day: "dusk", lighting: null, mood: null, music_cue: null },
      ],
    }));
    assertEquals(s.time_of_day, "dusk");
    assertEquals(s.lighting, "moody");
  });

  it("lists human-readable sources", () => {
    const s = suggestScore(input());
    assertEquals(s.sources, [
      "Cut length 47s → 50s target",
      'Time of day: "night" (2 of 3 panels)',
      'Lighting: "low-key" (3 of 3 panels)',
      'Mood: "tense" (3 of 3 panels)',
      'Music cues: "drone", "low piano"',
      "Dialogue: 2 item(s) on the cut",
      "Cut: 3 video item(s)",
    ]);
  });

  it("is stable across repeated calls", () => {
    assertEquals(suggestScore(input()), suggestScore(input()));
  });

  it("rounds duration up to five-second steps with bounds", () => {
    assertEquals(scoreDuration(0), 5);
    assertEquals(scoreDuration(1), 5);
    assertEquals(scoreDuration(5), 5);
    assertEquals(scoreDuration(48), 50);
    assertEquals(scoreDuration(50), 50);
    assertEquals(scoreDuration(1800), 1800);
    assertEquals(scoreDuration(2000), 1800);
    assertEquals(scoreDuration(NaN), 5);
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

let baseUrl = "";
let ownerToken = "";
let otherToken = "";
let ownerId = 0;
let projectId = "";
let musicModelId = "";

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

function videoBytes(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(128);
  // Fake MP4 signature (ftyp box) so media-type inference sees video/mp4.
  bytes.set(
    [
      0,
      0,
      0,
      24,
      0x66,
      0x74,
      0x79,
      0x70,
      0x69,
      0x73,
      0x6f,
      0x6d,
      0,
      0,
      0,
      1,
      0x69,
      0x73,
      0x6f,
      0x6d,
      0x6d,
      0x70,
      0x34,
      0x31,
    ],
    0,
  );
  crypto.getRandomValues(bytes.subarray(24));
  return bytes;
}

async function createCut(
  token: string,
  withVideo: boolean,
): Promise<{
  timelineId: string;
  videoVersionId: string | null;
  storyboardId: string | null;
}> {
  const tl = await req("POST", "/api/v1/timelines", {
    project_id: projectId,
    name: "Cut",
  }, token);
  assertEquals(tl.status, 201);
  const timeline = tl.json as { id: string };

  const videoVersionId: string | null = withVideo
    ? await (async () => {
      const assetRes = await req("POST", "/api/v1/assets", {
        unique_slug: `clip_${Math.random().toString(36).slice(2, 10)}`,
        display_name: "Clip",
        asset_type: "video",
      }, token);
      assertEquals(assetRes.status, 201);
      const asset = assetRes.json as { id: string };
      const up = await fetch(
        `${baseUrl}/api/v1/assets/${asset.id}/upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent("clip.mp4"),
          },
          body: videoBytes(),
        },
      );
      assertEquals(up.status, 201);
      const body = (await up.json()) as { version: { id: string } };
      return body.version.id;
    })()
    : null;

  const trackType = videoVersionId ? "video" : "text";
  const track = await req(
    "POST",
    `/api/v1/timelines/${timeline.id}/tracks`,
    { track_type: trackType, name: trackType },
    token,
  );
  assertEquals(track.status, 201);
  const trackId = (track.json as { id: string }).id;

  if (videoVersionId) {
    const item = await req(
      "POST",
      `/api/v1/timelines/${timeline.id}/items`,
      {
        track_id: trackId,
        asset_version_id: videoVersionId,
        start_time: 0,
        end_time: 47,
      },
      token,
    );
    assertEquals(item.status, 201);
  }

  const storyboardId: string | null = await (async () => {
    const board = await req(
      "POST",
      "/api/v1/storyboards",
      { project_id: projectId, name: "Board" },
      token,
    );
    assertEquals(board.status, 201);
    const boardId = (board.json as { id: string }).id;
    for (
      const fields of [
        {
          panel_order: 1,
          time_of_day: "night",
          lighting: "low-key",
          mood: "tense",
          music_cue: "low piano",
        },
        { panel_order: 2, time_of_day: "night", lighting: "low-key", mood: "tense" },
      ]
    ) {
      const panel = await req(
        "POST",
        `/api/v1/storyboards/${boardId}/panels`,
        { prompt: "A shot", ...fields },
        token,
      );
      assertEquals(panel.status, 201);
    }
    return boardId;
  })();

  return { timelineId: timeline.id, videoVersionId, storyboardId };
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

describe("score suggestion api", () => {
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
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("requires authentication", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { status } = await req(
          "GET",
          "/api/v1/timelines/nope/score-suggestion",
        );
        assertEquals(status, 401);
      })();
    }));

  it("404s for a missing timeline", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { status } = await req(
          "GET",
          "/api/v1/timelines/nope/score-suggestion",
          undefined,
          ownerToken,
        );
        assertEquals(status, 404);
      })();
    }));

  it("does not leak timelines of other users' projects", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { timelineId } = await createCut(ownerToken, false);
        const { status } = await req(
          "GET",
          `/api/v1/timelines/${timelineId}/score-suggestion`,
          undefined,
          otherToken,
        );
        assertEquals(status, 404);
      })();
    }));

  it("returns the synthesized suggestion for an assembled cut", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { timelineId } = await createCut(ownerToken, true);
        const { status, json } = await req(
          "GET",
          `/api/v1/timelines/${timelineId}/score-suggestion`,
          undefined,
          ownerToken,
        );
        assertEquals(status, 200);
        const body = json as {
          timeline_id: string;
          project_id: string;
          suggestion: {
            prompt: string;
            duration_seconds: number;
            time_of_day: string | null;
            music_cues: string[];
          };
        };
        assertEquals(body.timeline_id, timelineId);
        assertEquals(body.project_id, projectId);
        assertEquals(body.suggestion.duration_seconds, 50);
        assertEquals(body.suggestion.time_of_day, "night");
        assertEquals(body.suggestion.music_cues, ["low piano"]);
        assertEquals(
          body.suggestion.prompt,
          "Stated cues: low piano. Cinematic instrumental score, 50s, night, " +
            "low-key, tense, no dialogue on the cut.",
        );
      })();
    }));

  it("refuses to generate a score without a video cut (400)", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { timelineId } = await createCut(ownerToken, false);
        const { status } = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/score`,
          {},
          ownerToken,
        );
        assertEquals(status, 400);
      })();
    }));

  it("requires write access to generate a score", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { timelineId } = await createCut(ownerToken, true);
        const { status } = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/score`,
          {},
          otherToken,
        );
        assertEquals(status, 404);
      })();
    }));

  it("enqueues a music job from the synthesized prompt", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { timelineId } = await createCut(ownerToken, true);
        const { status, json } = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/score`,
          {},
          ownerToken,
        );
        assertEquals(status, 202);
        const body = json as {
          suggestion: { prompt: string };
          job: { job_id: string; job_type: string; asset_id: string; model_id: string };
        };
        assertEquals(body.job.job_type, "music");
        assertEquals(body.job.model_id, musicModelId);

        const job = await waitForJob(ownerToken, body.job.job_id, ["succeeded"]);
        assertEquals(job.project_id, projectId);
        const versionId = job.output_asset_version_id as string;
        assertEquals(typeof versionId, "string");

        const db = getDb();
        const versionRow = db.prepare(
          "SELECT * FROM asset_versions WHERE id = ?",
        ).get(versionId) as Record<string, unknown>;
        const meta = JSON.parse(versionRow.technical_metadata_json as string) as Record<
          string,
          unknown
        >;
        assertEquals(meta.prompt_text, body.suggestion.prompt);
        assertEquals(meta.job_type, "music");
      })();
    }));

  it("honors a prompt override and model selection", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { timelineId } = await createCut(ownerToken, true);
        const override = "sparse ambient pad, 50s";
        const { status, json } = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/score`,
          { prompt: override, model_id: musicModelId },
          ownerToken,
        );
        assertEquals(status, 202);
        const body = json as {
          suggestion: { prompt: string };
          job: { job_id: string; model_id: string };
        };
        assertEquals(body.job.model_id, musicModelId);
        // The synthesized suggestion is still reported for the UI.
        assertEquals(body.suggestion.prompt.includes("Cinematic"), true);

        const job = await waitForJob(ownerToken, body.job.job_id, ["succeeded"]);
        const versionId = job.output_asset_version_id as string;
        const versionRow = getDb().prepare(
          "SELECT * FROM asset_versions WHERE id = ?",
        ).get(versionId) as Record<string, unknown>;
        const meta = JSON.parse(versionRow.technical_metadata_json as string) as Record<
          string,
          unknown
        >;
        assertEquals(meta.prompt_text, override);
      })();
    }));

  it("replaces a blank prompt override with a 400", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { timelineId } = await createCut(ownerToken, true);
        const { status } = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/score`,
          { prompt: "   " },
          ownerToken,
        );
        assertEquals(status, 400);
      })();
    }));
});
