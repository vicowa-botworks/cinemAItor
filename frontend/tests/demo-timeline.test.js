import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import { buildTimelineDemoSteps } from "../src/components/demo-timeline.js";

// ---- buildTimelineDemoSteps --------------------------------------------------

function makePreflight(overrides = {}) {
  const row = (key, model_id) => ({
    key,
    ok: true,
    model_id: model_id ?? `${key}-model`,
    error: null,
  });
  const base = {
    clips: row("clips", "i2v-model"),
    clips_text: row("clips_text", "t2v-model"),
    music: row("music", "music-model"),
    llm: row("llm", null),
  };
  const tasks = Object.entries(base).map(([k, r]) => overrides[k] ?? r);
  return { ok: tasks.every((t) => t.ok), llm_configured: true, tasks };
}

const videoTrack = (over = {}) => ({
  id: "t-video",
  track_type: "video",
  name: "Scenes",
  items: [],
  ...over,
});
const musicTrack = (over = {}) => ({
  id: "t-music",
  track_type: "music",
  name: "Score",
  items: [],
  ...over,
});

function makeHost({ tracks = [], assets = [], exports = [] } = {}) {
  return {
    _timelineId: "tl-1",
    _projectId: "p-1",
    timeline: { name: "The Lighthouse", project_id: "p-1" },
    tracks,
    assets,
    exports,
    renderJob: null,
    scoreResult: null,
    scorePrompt: "",
    renderPresetId: "",
    error: null,
    scoreError: null,
    renderError: null,
    placeError: null,
    addedTracks: [],
    queuedRenders: 0,
    async _addTrack() {
      this.addedTracks.push({ type: this.newTrackType, name: this.newTrackName });
      // Simulate the handler's reload: the new track shows up in h.tracks.
      this.tracks.push({
        id: `trk-${this.addedTracks.length}`,
        track_type: this.newTrackType,
        name: this.newTrackName,
        items: [],
      });
    },
    _trackById(id) {
      return this.tracks.find((t) => t.id === id) ?? null;
    },
    async _placeItem() {
      const track = this._trackById(this.placeTrackId);
      if (track) track.items.push({ asset_version_id: this.placeVersionId });
    },
    async _loadScoreSuggestion() {
      this.scorePrompt = "auto-suggested";
    },
    async _generateScore() {
      this.scoreResult = {
        job_id: "mj",
        asset_id: "ma",
        model_id: "music-model",
      };
    },
    async _queueRender() {
      this.queuedRenders += 1;
      this.renderJob = { id: "r1", status: "queued", progress: 0 };
    },
    async _load() {},
  };
}

describe("buildTimelineDemoSteps", () => {
  it("returns the eight-step cut in order with unique ids and titles", () => {
    const host = makeHost();
    const steps = buildTimelineDemoSteps(host, makePreflight());
    assertEquals(
      steps.map((s) => s.id),
      [
        "timeline-intro",
        "tracks-add",
        "clip-1",
        "clip-2",
        "clip-3",
        "score-generate",
        "timeline-render",
        "timeline-done",
      ],
    );
    for (const s of steps) {
      assert(typeof s.id === "string" && s.id.length > 0);
      assert(typeof s.title === "string" && s.title.length > 0);
      assert(typeof s.describe === "function");
    }
    // The job/render steps that need polling all carry a poll handler.
    for (const id of ["clip-1", "score-generate", "timeline-render"]) {
      const s = steps.find((x) => x.id === id);
      assert(typeof s.execute === "function", `${id} needs execute`);
      assert(typeof s.poll === "function", `${id} needs poll`);
    }
  });

  it("tracks-add keeps existing tracks and adds only the missing one", async () => {
    // Both present → nothing is created, both ids resolved.
    let host = makeHost({ tracks: [videoTrack(), musicTrack()] });
    let steps = buildTimelineDemoSteps(host, makePreflight());
    let ctx = { host, api: {}, scratch: {} };
    let trackStep = steps.find((s) => s.id === "tracks-add");
    await trackStep.prepare(ctx);
    const both = await trackStep.execute(ctx);
    assertEquals(both.kind, "none");
    assertEquals(host.addedTracks.length, 0);
    assertEquals(ctx.scratch.videoTrackId, "t-video");
    assertEquals(ctx.scratch.audioTrackId, "t-music");

    // Only the video track present → just the music track is added.
    host = makeHost({ tracks: [videoTrack()] });
    steps = buildTimelineDemoSteps(host, makePreflight());
    ctx = { host, api: {}, scratch: {} };
    trackStep = steps.find((s) => s.id === "tracks-add");
    await trackStep.prepare(ctx);
    const partial = await trackStep.execute(ctx);
    assertEquals(partial.kind, "none");
    assertEquals(host.addedTracks.length, 1);
    assertEquals(host.addedTracks[0].type, "music");
    assertEquals(host.addedTracks[0].name, "Score");
    assert(ctx.scratch.audioTrackId, "the new music track is resolved");
  });

  it("a clip step reuses an existing clip's version instead of regenerating", async () => {
    const tracks = [videoTrack(), musicTrack()];
    const host = makeHost({
      tracks,
      assets: [
        {
          id: "a1",
          slug: "lighthouse_clip_1",
          active_version_id: "v1",
        },
      ],
    });
    const steps = buildTimelineDemoSteps(host, makePreflight());
    const ctx = { host, api: {}, scratch: {} };
    const trackStep = steps.find((s) => s.id === "tracks-add");
    await trackStep.prepare(ctx);
    await trackStep.execute(ctx);

    const clip = steps.find((s) => s.id === "clip-1");
    const work = await clip.execute(ctx);
    assertEquals(work.kind, "none");
    // The existing version was placed on the video track via _placeItem.
    assertEquals(tracks[0].items.length, 1);
    assertEquals(tracks[0].items[0].asset_version_id, "v1");
  });

  it("a clip step queues a text-to-video job when no version exists yet", async () => {
    const host = makeHost({
      tracks: [videoTrack(), musicTrack()],
      assets: [],
    });
    const generated = [];
    const api = {
      generateAsset: async (payload) => {
        generated.push(payload);
        return { job_id: "j1", asset_id: "a1", model_id: "t2v-model" };
      },
    };
    const steps = buildTimelineDemoSteps(host, makePreflight());
    const ctx = { host, api, scratch: {} };
    const trackStep = steps.find((s) => s.id === "tracks-add");
    await trackStep.prepare(ctx);
    await trackStep.execute(ctx);

    const clip = steps.find((s) => s.id === "clip-1");
    const work = await clip.execute(ctx);
    assertEquals(work.kind, "jobs");
    assertEquals(work.job_ids, ["j1"]);
    assertEquals(generated.length, 1);
    assertEquals(generated[0].unique_slug, "lighthouse_clip_1");
    assertEquals(generated[0].library_scope, "project");
    assertEquals(generated[0].project_id, "p-1");
    assertEquals(generated[0].asset_type, "video");
  });

  it("timeline-render skips when an export already exists, queues a draft render otherwise", async () => {
    // An export is already on the project → keep it, no render queued.
    let host = makeHost({
      tracks: [videoTrack(), musicTrack()],
      exports: [{ id: "e1" }],
    });
    let steps = buildTimelineDemoSteps(host, makePreflight());
    let ctx = { host, api: {}, scratch: { clips: [{ job_id: "j" }] } };
    let render = steps.find((s) => s.id === "timeline-render");
    await render.prepare(ctx);
    const kept = await render.execute(ctx);
    assertEquals(kept.kind, "none");
    assertEquals(host.queuedRenders, 0);

    // Fresh project → a draft render is queued.
    host = makeHost({ tracks: [videoTrack(), musicTrack()] });
    steps = buildTimelineDemoSteps(host, makePreflight());
    ctx = { host, api: {}, scratch: { clips: [{ job_id: "j" }] } };
    render = steps.find((s) => s.id === "timeline-render");
    await render.prepare(ctx);
    const queued = await render.execute(ctx);
    assertEquals(queued.kind, "render");
    assertEquals(host.queuedRenders, 1);
    assertEquals(host.renderPresetId, "preset-draft");
  });

  it("the render is skipped when no clips were placed (no video model)", async () => {
    const host = makeHost({ tracks: [videoTrack(), musicTrack()] });
    const steps = buildTimelineDemoSteps(
      host,
      makePreflight({
        clips: { key: "clips", ok: false, model_id: null, error: "none" },
        clips_text: { key: "clips_text", ok: false, model_id: null, error: "none" },
      }),
    );
    const ctx = { host, api: {}, scratch: { clips: [{ skipped: true }] } };
    const render = steps.find((s) => s.id === "timeline-render");
    await render.prepare(ctx);
    const work = await render.execute(ctx);
    assertEquals(work.kind, "none");
    assertEquals(host.queuedRenders, 0);
  });
});
