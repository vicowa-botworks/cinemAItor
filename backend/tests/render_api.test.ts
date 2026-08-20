import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createAsset, createAssetVersion } from "../src/db/assets.ts";
import { createItem, createTimeline, createTrack } from "../src/db/timelines.ts";
import { MockRenderEngine, setRenderEngine } from "../src/services/render_engine.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

let baseUrl = "";
let ownerToken: string;
let ownerId: number;
let projectId: string;
let timelineId: string;
let appData: string;

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
  renderId: string,
  expected: string,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const res = await req("GET", `/api/v1/renders/${renderId}`, undefined, ownerToken);
    const job = res.json as Record<string, unknown>;
    if (job.status === expected) return job;
    if (Date.now() - start > 10000) {
      throw new Error(`Render job did not reach ${expected}: ${JSON.stringify(job)}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("renders api", () => {
  beforeEach(async () => {
    appData = Deno.makeTempDirSync({ prefix: "cinemaitor_render_api_" });
    Deno.env.set("APP_DATA_DIR", appData);
    Deno.env.set("RENDER_ENGINE", "mock");
    setRenderEngine(new MockRenderEngine());

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

      const { createProject } = await import("../src/db/projects.ts");
      projectId = createProject({ name: "Test Film" }, ownerId).id;
      const asset = createAsset(
        {
          unique_slug: `clip_${Math.random().toString(36).slice(2, 8)}`,
          display_name: "Clip",
          asset_type: "video",
          library_scope: "global",
        },
        ownerId,
      );
      const version = createAssetVersion(asset.id, ownerId, {
        content_hash: "e".repeat(64),
        file_path: "/tmp/render-clip.mp4",
        format: "mp4",
        mime_type: "video/mp4",
        file_size: 1000,
        make_active: true,
      });
      timelineId = createTimeline(ownerId, {
        project_id: projectId,
        name: "Main",
      }).id;
      const track = createTrack(ownerId, timelineId, {
        track_type: "video",
        name: "V1",
      });
      createItem(ownerId, timelineId, {
        track_id: track.id,
        asset_version_id: version.id,
        start_time: 0,
        end_time: 2,
      });
      const subTrack = createTrack(ownerId, timelineId, {
        track_type: "subtitle",
        name: "SUB",
      });
      createItem(ownerId, timelineId, {
        track_id: subTrack.id,
        asset_version_id: null,
        text: "Main title: Test Film",
        text_style: { position: "bottom" },
        start_time: 0,
        end_time: 2,
      });
    });
  });

  afterEach(() => {
    setRenderEngine(null);
    closeDb();
    Deno.removeSync(appData, { recursive: true });
  });

  it("lists default presets and allows admin to create more", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const list = await req("GET", "/api/v1/render-presets", undefined, ownerToken);
        assertEquals(list.status, 200);
        const ids = (list.json as { id: string }[]).map((p) => p.id);
        assert(ids.includes("preset-final"));

        const created = await req(
          "POST",
          "/api/v1/render-presets",
          { name: "4K", kind: "final", output_format: "mp4", resolution: "3840x2160" },
          ownerToken,
        );
        assertEquals(created.status, 201);

        // Non-admin cannot create presets.
        await registerOtherUser();
        const res = await req(
          "POST",
          "/api/v1/render-presets",
          { name: "Nope", kind: "draft", output_format: "mp4" },
          otherToken,
        );
        assertEquals(res.status, 403);
      })();
    }));

  it("renders a timeline end to end and exposes exports", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const created = await req(
          "POST",
          "/api/v1/renders",
          { project_id: projectId, timeline_id: timelineId, preset_id: "preset-final" },
          ownerToken,
        );
        assertEquals(created.status, 202);
        const job = created.json as Record<string, unknown>;
        assertEquals(job.status, "queued");
        const renderId = job.id as string;

        const done = await waitForJob(renderId, "succeeded");
        assert(done.output_path);
        const report = done.validation_report as { ok: boolean; checks: Record<string, boolean> };
        assertEquals(report.ok, true);

        const log = await req("GET", `/api/v1/renders/${renderId}/log`, undefined, ownerToken);
        assertEquals(log.status, 200);
        const events = log.json as { level: string; message: string }[];
        assert(events.some((e) => e.message.includes("Export")));

        const exportsRes = await req(
          "GET",
          `/api/v1/exports?project_id=${projectId}`,
          undefined,
          ownerToken,
        );
        assertEquals(exportsRes.status, 200);
        const exports = exportsRes.json as Record<string, unknown>[];
        assertEquals(exports.length, 1);
        assertEquals(exports[0].render_job_id, renderId);
        assertEquals(exports[0].format, "mp4");
        assert(exports[0].asset_version_id);

        // Cancel after success -> conflict.
        const cancel = await req("POST", `/api/v1/renders/${renderId}/cancel`, {}, ownerToken);
        assertEquals(cancel.status, 409);
      })();
    }));

  it("rejects unknown presets, missing items, and other users", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const unknownPreset = await req(
          "POST",
          "/api/v1/renders",
          { project_id: projectId, timeline_id: timelineId, preset_id: "nope" },
          ownerToken,
        );
        assertEquals(unknownPreset.status, 404);

        const emptyTimelineId = createTimeline(ownerId, {
          project_id: projectId,
          name: "Empty",
        }).id;
        const empty = await req(
          "POST",
          "/api/v1/renders",
          { project_id: projectId, timeline_id: emptyTimelineId },
          ownerToken,
        );
        assertEquals(empty.status, 400);

        await registerOtherUser();
        const denied = await req(
          "POST",
          "/api/v1/renders",
          { project_id: projectId, timeline_id: timelineId },
          otherToken,
        );
        assertEquals(denied.status, 404);

        const missing = await req("GET", "/api/v1/renders/does-not-exist", undefined, ownerToken);
        assertEquals(missing.status, 404);
      })();
    }));
});

let otherToken = "";

async function registerOtherUser(): Promise<void> {
  const res = await req(
    "POST",
    "/api/auth/register",
    {
      email: `user.${Math.random().toString(36).slice(2)}@example.com`,
      password: "password123",
      display_name: "Other",
    },
  );
  otherToken = (res.json as { token: string }).token ?? "";
}
