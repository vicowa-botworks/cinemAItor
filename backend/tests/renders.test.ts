import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import * as schema from "../src/db/schema.ts";
import { getDb, resetDb } from "../src/db/database.ts";
import { createProject } from "../src/db/projects.ts";
import { createAsset, createAssetVersion } from "../src/db/assets.ts";
import { createItem, createTimeline, createTrack } from "../src/db/timelines.ts";
import {
  cancelRenderJob,
  createPreset,
  createRenderJob,
  ensureDefaultPresets,
  getRenderJob,
  listPresets,
  listRenderEvents,
  listRenderJobs,
  rawGetRenderJob,
  TERMINAL_RENDER_STATUSES,
} from "../src/db/renders.ts";
import { type RenderRunner, startRenderRunner } from "../src/services/render_runner.ts";
import { MockRenderEngine, setRenderEngine } from "../src/services/render_engine.ts";
import { getContentStore, resetContentStore } from "../src/storage/content_store.ts";

let ownerId: number;
let otherId: number;
let projectId: string;
let timelineId: string;
let appData: string;
let runner: RenderRunner | null = null;
let mediaAssetId: string;

describe("renders", () => {
  beforeEach(async () => {
    Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
    resetDb();
    getDb(":memory:");
    ensureDefaultPresets();
    appData = Deno.makeTempDirSync({ prefix: "cinemaitor_render_test_" });
    Deno.env.set("APP_DATA_DIR", appData);
    resetContentStore();

    setRenderEngine(new MockRenderEngine());

    ownerId = schema.createUser("owner@example.com", "hash123", "Owner", "admin");
    otherId = schema.createUser("other@example.com", "hash456", "Other");
    projectId = createProject({ name: "Film" }, ownerId).id;

    // A media asset with a real stored file.
    mediaAssetId = createAsset(
      {
        unique_slug: `clip_${Math.random().toString(36).slice(2, 8)}`,
        display_name: "Clip",
        asset_type: "video",
        library_scope: "global",
      },
      ownerId,
    ).id;
    const tmp = Deno.makeTempFileSync();
    await Deno.writeTextFile(tmp, "fake-media-bytes");
    const stored = await getContentStore().put(tmp, "clip.mp4");
    Deno.removeSync(tmp);
    createAssetVersion(mediaAssetId, ownerId, {
      content_hash: stored.hash,
      file_path: stored.path,
      format: "mp4",
      mime_type: "video/mp4",
      file_size: stored.size,
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
    const version = getDb()
      .prepare(
        "SELECT id FROM asset_versions WHERE asset_id = ? ORDER BY version_number DESC LIMIT 1",
      )
      .get(mediaAssetId) as { id: string };
    createItem(ownerId, timelineId, {
      track_id: track.id,
      asset_version_id: version.id,
      start_time: 0,
      end_time: 2,
    });
  });

  afterEach(async () => {
    if (runner) {
      await runner.stop();
      runner = null;
    }
    setRenderEngine(null);
    resetDb();
    Deno.removeSync(appData, { recursive: true });
  });

  it("seeds default presets", () => {
    const presets = listPresets();
    const ids = presets.map((p) => p.id);
    assert(ids.includes("preset-draft"));
    assert(ids.includes("preset-final"));
    assert(ids.includes("preset-audio"));
    const created = createPreset(ownerId, {
      name: "Custom 4k",
      kind: "final",
      output_format: "mp4",
      resolution: "3840x2160",
    });
    assertEquals(created.kind, "final");
  });

  it("validates render creation", () => {
    // Unknown preset.
    assertThrows(
      () =>
        createRenderJob(ownerId, {
          project_id: projectId,
          timeline_id: timelineId,
          preset_id: "nope",
        }),
      Error,
      "Preset not found",
    );
    // Timeline from another project.
    const otherProject = createProject({ name: "Other" }, ownerId).id;
    assertThrows(
      () =>
        createRenderJob(ownerId, {
          project_id: otherProject,
          timeline_id: timelineId,
        }),
      Error,
      "different project",
    );
    // Empty timeline.
    const empty = createTimeline(ownerId, {
      project_id: projectId,
      name: "Empty",
    }).id;
    assertThrows(
      () =>
        createRenderJob(ownerId, {
          project_id: projectId,
          timeline_id: empty,
        }),
      Error,
      "no renderable video items",
    );
    // Permissions.
    assertThrows(
      () => createRenderJob(otherId, { project_id: projectId, timeline_id: timelineId }),
      Error,
    );
  });

  it("renders end to end with the mock engine", async () => {
    const job = createRenderJob(ownerId, {
      project_id: projectId,
      timeline_id: timelineId,
      preset_id: "preset-final",
    });
    assertEquals(job.status, "queued");

    runner = startRenderRunner({ pollMs: 5 });
    await waitFor(() => TERMINAL_RENDER_STATUSES.includes(rawGetRenderJob(job.id)?.status ?? ""));

    const done = rawGetRenderJob(job.id);
    assert(done);
    assertEquals(done.status, "succeeded");
    assertEquals(done.engine, "mock");
    assertEquals(done.progress, 100);
    assert(done.validation_report);
    assertEquals(done.validation_report.ok, true);
    assert(done.output_path);

    // Export row + asset version provenance.
    const db = getDb();
    const exportRow = db.prepare(
      "SELECT * FROM exports WHERE render_job_id = ?",
    ).get(job.id) as Record<string, unknown> | undefined;
    assert(exportRow);
    assertEquals(exportRow.format, "mp4");
    assert(exportRow.asset_version_id);
    const version = db.prepare(
      "SELECT * FROM asset_versions WHERE id = ?",
    ).get(exportRow.asset_version_id as string) as Record<string, unknown>;
    const provenance = JSON.parse(version.technical_metadata_json as string) as {
      render: { render_job_id: string; engine: string; items: number };
    };
    assertEquals(provenance.render.render_job_id, job.id);
    assertEquals(provenance.render.engine, "mock");
    assertEquals(provenance.render.items, 1);

    const events = listRenderEvents(job.id, ownerId).map((e) => e.level);
    assert(events.includes("info"));

    // Cancel after terminal state -> conflict.
    assertThrows(() => cancelRenderJob(job.id), Error, "already succeeded");
  });

  it("cancels queued renders", () => {
    const job = createRenderJob(ownerId, {
      project_id: projectId,
      timeline_id: timelineId,
    });
    const cancelled = cancelRenderJob(job.id);
    assertEquals(cancelled?.status, "cancelled");
    assertEquals(getRenderJob(job.id, ownerId)?.status, "cancelled");
  });

  it("fails renders whose timeline becomes empty", async () => {
    const job = createRenderJob(ownerId, {
      project_id: projectId,
      timeline_id: timelineId,
    });
    // Remove the only item before the runner starts.
    const db = getDb();
    const item = db.prepare(
      "SELECT id FROM timeline_items WHERE timeline_id = ? LIMIT 1",
    ).get(timelineId) as { id: string };
    db.prepare("DELETE FROM timeline_items WHERE id = ?").run(item.id);

    runner = startRenderRunner({ pollMs: 5 });
    await waitFor(() => TERMINAL_RENDER_STATUSES.includes(rawGetRenderJob(job.id)?.status ?? ""));
    const done = rawGetRenderJob(job.id);
    assertEquals(done?.status, "failed");
    assert(done?.error_text?.includes("no renderable video items"));
  });

  it("lists renders with project scope", () => {
    createRenderJob(ownerId, {
      project_id: projectId,
      timeline_id: timelineId,
    });
    const mine = listRenderJobs(ownerId, { project_id: projectId });
    assertEquals(mine.length, 1);
    const others = listRenderJobs(otherId);
    assertEquals(others.length, 0);
    assertThrows(
      () => listRenderJobs(ownerId, { status: "bogus" }),
      Error,
      "status must be one of",
    );
  });
});

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}
