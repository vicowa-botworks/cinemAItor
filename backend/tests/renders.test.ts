import { join } from "@std/path";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from "@std/assert";
import * as schema from "../src/db/schema.ts";
import { getDb, resetDb } from "../src/db/database.ts";
import { createProject } from "../src/db/projects.ts";
import { createAsset, createAssetVersion } from "../src/db/assets.ts";
import {
  createItem,
  createTimeline,
  createTrack,
  getItem,
  updateItem,
} from "../src/db/timelines.ts";
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
import {
  buildAtempoFilters,
  buildDrawTextFilter,
  buildFxArgs,
  consumeFfmpegProgressLine,
  FfmpegRenderEngine,
  mapFfmpegProgress,
  MockRenderEngine,
  newFfmpegProgressState,
  planNeedsFxPass,
  type RenderAudioItem,
  type RenderInputItem,
  type RenderPlan,
  type RenderTextOverlay,
  setRenderEngine,
} from "../src/services/render_engine.ts";
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

  it("applies per-item fx (transition / fades / color grade) at render time", async () => {
    const noopHooks = { onProgress: () => {}, isCancelled: () => false };
    const base = {
      file_path: "/tmp/media.mp4",
      start_time: 0,
      end_time: 2,
      duration: 2,
      transition: "cut" as string,
      transition_duration: 0.5,
      fade_in: 0,
      fade_out: 0,
      color_grade: null as Record<string, number> | null,
    };
    const planFor = (
      items: RenderInputItem[],
      text_overlays: RenderTextOverlay[] = [],
    ): RenderPlan => ({
      output_path: "/tmp/fx-out.mp4",
      filename: "fx-out.mp4",
      format: "mp4",
      preset: null,
      items,
      text_overlays,
      total_duration: items.reduce((s, i) => s + i.duration, 0),
    });
    const engine = new MockRenderEngine();

    const planNoFx = planFor([
      { ...base },
      { ...base, start_time: 2, end_time: 4 },
    ]);
    await engine.render(planNoFx, noopHooks);
    const noFx = await Deno.readFile("/tmp/fx-out.mp4");
    Deno.removeSync("/tmp/fx-out.mp4");

    const planFx = planFor([
      { ...base },
      {
        ...base,
        start_time: 2,
        end_time: 4,
        transition: "dissolve",
        fade_out: 0.25,
        color_grade: { brightness: 0.1, temperature: 0.3 },
      },
    ]);
    await engine.render(planFx, noopHooks);
    const withFx = await Deno.readFile("/tmp/fx-out.mp4");
    Deno.removeSync("/tmp/fx-out.mp4");
    assertNotEquals(noFx, withFx);

    // Same fx plan again: identical bytes (deterministic).
    await engine.render(planFx, noopHooks);
    assertEquals(await Deno.readFile("/tmp/fx-out.mp4"), withFx);
    Deno.removeSync("/tmp/fx-out.mp4");

    // ffmpeg fx command: xfade for transitions, eq/fade chain for the grade.
    const fxArgs = buildFxArgs(planFx.items, [], "/tmp/out.mp4");
    const fc = fxArgs[fxArgs.indexOf("-filter_complex") + 1];
    assert(fc.includes("xfade=transition=dissolve"));
    assert(fc.includes("eq=brightness=0.1"));
    assert(fc.includes("colortemperature=temperature=7250"));
    assert(fc.includes("fade=t=out:st=1.75:d=0.25"));
    const concatArgs = buildFxArgs(planNoFx.items, [], "/tmp/out.mp4");
    const fc2 = concatArgs[concatArgs.indexOf("-filter_complex") + 1];
    assert(fc2.includes("concat=n=2:v=1:a=0"));
    assert(!fc2.includes("xfade"));

    // Text overlays: deterministic output changes with them (mock engine).
    const overlay: RenderTextOverlay = {
      start_time: 0.5,
      end_time: 1.5,
      duration: 1,
      text: "Hello, world",
      style: { position: "bottom", font_size: 32 },
    };
    await engine.render(planFor(planFx.items, [overlay]), noopHooks);
    const withOverlay = await Deno.readFile("/tmp/fx-out.mp4");
    Deno.removeSync("/tmp/fx-out.mp4");
    assertNotEquals(withFx, withOverlay);

    // Draft/final source selection is part of the mock seed: the same items
    // rendered from proxies produce different bytes than from the masters.
    const itemsProxy = planFx.items.map((i) => ({ ...i, source: "proxy" as const }));
    await engine.render(planFor(itemsProxy), noopHooks);
    const fromProxy = await Deno.readFile("/tmp/fx-out.mp4");
    Deno.removeSync("/tmp/fx-out.mp4");
    assertNotEquals(withFx, fromProxy);

    // ffmpeg fx command draws text overlays in a final drawtext stage.
    const overlayArgs = buildFxArgs(planFx.items, [overlay], "/tmp/out.mp4");
    const fc3 = overlayArgs[overlayArgs.indexOf("-filter_complex") + 1];
    assert(fc3.includes("drawtext=text='Hello, world'"));
    assert(fc3.includes("enable='between(t,0.5,1.5)'"));
    assert(fc3.includes("fontsize=32"));
    assert(overlayArgs[overlayArgs.indexOf("-map") + 1] === "[out]");

    // drawtext details: quoting, defaults, positions.
    const quoted = buildDrawTextFilter({
      start_time: 0,
      end_time: 1,
      duration: 1,
      text: "it's a test",
      style: null,
    });
    assert(quoted.includes("text='it''s a test'"));
    assert(quoted.includes("fontsize=24"));
    assert(quoted.includes("fontcolor=white"));
    assert(quoted.includes("y=h-text_h-h*0.05"));
    const top = buildDrawTextFilter({
      start_time: 0,
      end_time: 1,
      duration: 1,
      text: "x",
      style: { position: "top", margin: 10 },
    });
    assert(top.includes("y=h*0.1"));
    const middle = buildDrawTextFilter({
      start_time: 0,
      end_time: 1,
      duration: 1,
      text: "x",
      style: { position: "middle" },
    });
    assert(middle.includes("y=(h-text_h)/2"));
  });

  it("renders timelines with fx items end to end", async () => {
    const db = getDb();
    const row = db.prepare(
      "SELECT asset_version_id, track_id FROM timeline_items ORDER BY start_time LIMIT 1",
    ).get() as { asset_version_id: string; track_id: string };
    const second = createItem(ownerId, timelineId, {
      track_id: row.track_id,
      asset_version_id: row.asset_version_id,
      start_time: 2,
      end_time: 4,
      transition: "dissolve",
      transition_duration: 0.5,
      fade_out: 0.25,
      color_grade: { brightness: 0.1, saturation: 1.2, temperature: 0.3 },
    });
    assertEquals(second.transition, "dissolve");
    assertEquals(second.transition_duration, 0.5);

    const job = createRenderJob(ownerId, {
      project_id: projectId,
      timeline_id: timelineId,
      preset_id: "preset-final",
    });
    runner = startRenderRunner({ pollMs: 5 });
    await waitFor(() => TERMINAL_RENDER_STATUSES.includes(rawGetRenderJob(job.id)?.status ?? ""));
    const done = rawGetRenderJob(job.id);
    assert(done?.status === "succeeded");
    assert(done?.validation_report?.ok === true);

    // Clearing the fx via null restores the plain render path.
    updateItem(ownerId, timelineId, second.id, {
      transition: "cut",
      fade_out: null,
      color_grade: null,
    });
    const cleared = getItem(timelineId, second.id, ownerId);
    assert(cleared);
    assertEquals(cleared.transition, "cut");
    assertEquals(cleared.fade_out, null);
    assertEquals(cleared.color_grade, null);
  });

  it("routes audio and source-edit plans to the fx pass", () => {
    const video: RenderInputItem = {
      file_path: "/tmp/v.mp4",
      start_time: 0,
      end_time: 4,
      duration: 4,
      transition: "cut",
      transition_duration: 0.5,
      fade_in: 0,
      fade_out: 0,
      color_grade: null,
    };
    const base: RenderPlan = {
      output_path: "/tmp/o.mp4",
      filename: "o.mp4",
      format: "mp4",
      preset: null,
      items: [video],
      text_overlays: [],
      total_duration: 4,
    };
    assert(!planNeedsFxPass(base));

    const audio: RenderAudioItem = {
      file_path: "/tmp/a.wav",
      start_time: 1,
      end_time: 3,
      duration: 2,
      source_offset: 0.5,
      source_duration: 2,
      speed: 2,
      gain: 0.5,
      fade_in: 0,
      fade_out: 0,
    };
    assert(planNeedsFxPass({ ...base, audio_items: [audio] }));
    assert(planNeedsFxPass({ ...base, items: [{ ...video, source_offset: 1 }] }));
    assert(planNeedsFxPass({ ...base, items: [{ ...video, speed: 2 }] }));
    const overlay: RenderTextOverlay = {
      start_time: 0,
      end_time: 1,
      duration: 1,
      text: "x",
      style: null,
    };
    assert(planNeedsFxPass({ ...base, text_overlays: [overlay] }));
  });

  it("builds atempo chains for extreme speeds", () => {
    assertEquals(buildAtempoFilters(1), []);
    assertEquals(buildAtempoFilters(0.5), ["atempo=0.5"]);
    assertEquals(buildAtempoFilters(4), ["atempo=4"]);
    assertEquals(buildAtempoFilters(0.25), ["atempo=0.5", "atempo=0.5"]);
    assertEquals(buildAtempoFilters(150), ["atempo=100", "atempo=1.5"]);
    assertEquals(buildAtempoFilters(0), []);
  });

  it("builds the ffmpeg mix for audio-track items", () => {
    const video: RenderInputItem = {
      file_path: "/tmp/v.mp4",
      start_time: 0,
      end_time: 4,
      duration: 4,
      transition: "cut",
      transition_duration: 0.5,
      fade_in: 0,
      fade_out: 0,
      color_grade: null,
    };
    const audio: RenderAudioItem = {
      file_path: "/tmp/a.wav",
      start_time: 1,
      end_time: 3,
      duration: 2,
      source_offset: 0.5,
      source_duration: 2,
      speed: 2,
      gain: 0.5,
      fade_in: 0.2,
      fade_out: 0.25,
    };
    const args = buildFxArgs([video], [], "/tmp/out.mp4", [audio]);

    // The audio file is an additional input, after the video inputs.
    assertEquals(args[args.indexOf("/tmp/a.wav") - 1], "-i");

    const fc = args[args.indexOf("-filter_complex") + 1];
    assert(fc.includes("atrim=start=0.5:end=2.5"));
    assert(fc.includes("asetpts=PTS-STARTPTS"));
    assert(fc.includes("atempo=2"));
    assert(fc.includes("volume=0.5"));
    assert(fc.includes("afade=t=in:st=0:d=0.2"));
    assert(fc.includes("afade=t=out:st=1.75:d=0.25"));
    assert(fc.includes("adelay=1000:all=1"));
    assert(fc.includes("amix=inputs=1:duration=longest:normalize=0"));
    assert(fc.includes("atrim=end=4"));

    // Audio is mapped as AAC; the silent path keeps -an and no audio map.
    assert(args.includes("-c:a"));
    assert(args.includes("[aout]"));
    const silent = buildFxArgs([video], [], "/tmp/out.mp4");
    assert(silent.includes("-an"));
    assert(!silent.includes("[aout]"));

    // Video items with source edits get a trim + setpts stage first;
    // items without them are left untouched.
    const trimmed = buildFxArgs([{ ...video, source_offset: 0.5, speed: 2 }], [], "/tmp/x.mp4");
    const fcTrimmed = trimmed[trimmed.indexOf("-filter_complex") + 1];
    assert(fcTrimmed.includes("trim=start=0.5:end=2.5"));
    assert(fcTrimmed.includes("setpts=(PTS-STARTPTS)/2"));
    const fcPlain = silent[silent.indexOf("-filter_complex") + 1];
    assert(!fcPlain.includes("trim="));
    assert(!fcPlain.includes("setpts="));
  });

  it("renders audio-track items end to end (deterministic mock mix)", async () => {
    const db = getDb();
    const firstRow = db
      .prepare(
        "SELECT id FROM asset_versions WHERE asset_id = ? ORDER BY version_number DESC LIMIT 1",
      )
      .get(mediaAssetId) as { id: string };
    const music = createTrack(ownerId, timelineId, { track_type: "music", name: "M1" });
    createItem(ownerId, timelineId, {
      track_id: music.id,
      asset_version_id: firstRow.id,
      start_time: 0,
      end_time: 2,
      source_offset: 0.25,
      speed: 0.5,
      fade_in: 0.1,
    });

    const job = createRenderJob(ownerId, {
      project_id: projectId,
      timeline_id: timelineId,
      preset_id: "preset-final",
    });
    runner = startRenderRunner({ pollMs: 5 });
    await waitFor(() => TERMINAL_RENDER_STATUSES.includes(rawGetRenderJob(job.id)?.status ?? ""));
    const done = rawGetRenderJob(job.id);
    assert(done?.status === "succeeded");
    const report = done.validation_report as { audio?: { items: number } } | null;
    assertEquals(report?.audio?.items, 1);

    // A re-render of the same timeline produces identical bytes.
    const bytesFor = (jobId: string): Uint8Array => {
      const exportRow = db
        .prepare("SELECT asset_version_id FROM exports WHERE render_job_id = ?")
        .get(jobId) as { asset_version_id: string };
      const version = db
        .prepare("SELECT file_path FROM asset_versions WHERE id = ?")
        .get(exportRow.asset_version_id) as { file_path: string };
      return Deno.readFileSync(version.file_path);
    };
    const first = bytesFor(job.id);

    const job2 = createRenderJob(ownerId, {
      project_id: projectId,
      timeline_id: timelineId,
      preset_id: "preset-final",
    });
    await waitFor(() => TERMINAL_RENDER_STATUSES.includes(rawGetRenderJob(job2.id)?.status ?? ""));
    assertEquals(rawGetRenderJob(job2.id)?.status, "succeeded");
    assertEquals(bytesFor(job2.id), first);

    // Changing the audio item's placement changes the output bytes.
    const audioItem = db
      .prepare("SELECT id FROM timeline_items WHERE track_id = ? LIMIT 1")
      .get(music.id) as { id: string };
    updateItem(ownerId, timelineId, audioItem.id, { fade_in: 0.4 });
    const job3 = createRenderJob(ownerId, {
      project_id: projectId,
      timeline_id: timelineId,
      preset_id: "preset-final",
    });
    await waitFor(() => TERMINAL_RENDER_STATUSES.includes(rawGetRenderJob(job3.id)?.status ?? ""));
    assertNotEquals(bytesFor(job3.id), first);
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

  describe("ffmpeg progress reporting", () => {
    function planFor(
      item: Partial<RenderInputItem> = {},
      overrides: Partial<RenderPlan> = {},
    ): RenderPlan {
      const base: RenderInputItem = {
        file_path: "/tmp/fake_in.mp4",
        start_time: 0,
        end_time: 5,
        duration: 5,
        transition: "cut",
        transition_duration: 0,
        fade_in: 0,
        fade_out: 0,
        color_grade: null,
      };
      return {
        output_path: join(appData, "out.mp4"),
        filename: "out.mp4",
        format: "mp4",
        preset: null,
        items: [{ ...base, ...item }],
        text_overlays: [],
        total_duration: 5,
        ...overrides,
      };
    }

    /** A stand-in ffmpeg: prints `-progress pipe:1` blocks, writes the output. */
    function writeFakeFfmpeg(body: string): string {
      const dir = Deno.makeTempDirSync({ prefix: "fake_ffmpeg_" });
      const path = join(dir, "ffmpeg");
      Deno.writeTextFileSync(path, `#!/bin/sh\n${body}\n`);
      Deno.chmodSync(path, 0o755);
      return path;
    }

    const progressScript = [
      "out=$1",
      'for a in "$@"; do out=$a; done',
      'printf "out_time_us=2500000\\nprogress=continue\\n"',
      'printf "out_time_us=5000000\\nprogress=end\\n"',
      'printf "fake-video-bytes\\n" > "$out"',
      "exit 0",
    ].join("\n");

    function flat(values: number[]): number[] {
      return values.filter((v, i) => i === 0 || v !== values[i - 1]);
    }

    it("parses -progress pipe:1 output (us preferred over ms)", () => {
      const state = newFfmpegProgressState();
      for (
        const line of [
          "frame=1",
          "out_time_us=2500000",
          "out_time=00:00:02.500000",
          "out_time_ms=2000",
          "progress=continue",
        ]
      ) {
        consumeFfmpegProgressLine(state, line);
      }
      assertEquals(state.out_time_sec, 2.5);
      assertEquals(state.done, false);
      consumeFfmpegProgressLine(state, "out_time_ms=4000");
      consumeFfmpegProgressLine(state, "progress=end");
      assertEquals(state.out_time_sec, 4);
      assertEquals(state.done, true);
    });

    it("maps out_time into the [base, 90] band", () => {
      assertEquals(mapFfmpegProgress(0, 5, 20), null);
      assertEquals(mapFfmpegProgress(2.5, 5, 20), 55);
      assertEquals(mapFfmpegProgress(5, 5, 20), 90);
      assertEquals(mapFfmpegProgress(7.5, 5, 20), 90);
      assertEquals(mapFfmpegProgress(1, 0, 20), null);
      assertEquals(mapFfmpegProgress(1, Number.NaN, 20), null);
    });

    it("reports ffmpeg progress on the concat path", async () => {
      const script = writeFakeFfmpeg(progressScript);
      const seen: number[] = [];
      const engine = new FfmpegRenderEngine(script);
      const result = await engine.render(planFor(), {
        onProgress: (p) => seen.push(p),
        isCancelled: () => false,
      });
      assertEquals(result.file_size, "fake-video-bytes\n".length);
      assertEquals(flat(seen), [5, 20, 55, 90, 100]);
    });

    it("reports ffmpeg progress on the fx path", async () => {
      const script = writeFakeFfmpeg(progressScript);
      const seen: number[] = [];
      const engine = new FfmpegRenderEngine(script);
      await engine.render(planFor({ fade_in: 0.5 }), {
        onProgress: (p) => seen.push(p),
        isCancelled: () => false,
      });
      assertEquals(flat(seen), [5, 10, 50, 90, 100]);
    });

    it("kills the ffmpeg process when the render is cancelled", async () => {
      // The sleeper detaches its stdio so killing the (single-process,
      // ffmpeg-like) script closes the pipe immediately — like a real ffmpeg.
      const script = writeFakeFfmpeg(
        [
          "out=$1",
          'for a in "$@"; do out=$a; done',
          'printf "out_time_us=100000\\nprogress=continue\\n"',
          "sleep 10 <&- 1>&- 2>&-",
          'printf "nope\\n" > "$out"',
          "exit 0",
        ].join("\n"),
      );
      let cancelled = false;
      const seen: number[] = [];
      const engine = new FfmpegRenderEngine(script);
      const start = performance.now();
      await assertRejects(
        () =>
          engine.render(planFor(), {
            onProgress: (p) => {
              seen.push(p);
              if (p > 20) cancelled = true;
            },
            isCancelled: () => cancelled,
          }),
        Error,
        "Render cancelled",
      );
      const elapsedMs = performance.now() - start;
      assert(elapsedMs < 5000, `cancellation took ${elapsedMs}ms`);
      assert(seen.length >= 1, "expected a progress reading before cancellation");
    });
  });
});

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}
