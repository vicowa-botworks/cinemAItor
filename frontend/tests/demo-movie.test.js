import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import {
  buildMovieDemoSteps,
  movieDemoSegments,
  movieDemoStepsForPage,
} from "../src/components/demo-movie.js";
import { DEMO_FILM } from "../src/components/demo-content.js";
import { MOVIE_PAGES } from "../src/components/demo-movie-state.js";

// ---- buildMovieDemoSteps --------------------------------------------------

function makePreflight(overrides = {}) {
  const row = (key, model_id) => ({
    key,
    task_type: key,
    label: key,
    ok: true,
    model_id: model_id ?? `${key}-model`,
    error: null,
  });
  const base = {
    assets: row("assets", "t2i-model"),
    clips: row("clips", "i2v-model"),
    clips_text: row("clips_text", "t2v-model"),
    music: row("music", "music-model"),
  };
  const tasks = Object.entries(base).map(([k, r]) => overrides[k] ?? r);
  return { ok: tasks.every((t) => t.ok), llm_configured: true, tasks };
}

/**
 * A mock API mirroring the backend response shapes the builder relies on.
 * `listAssets` honours the project_id filter so the global-scoped scene clips
 * (created by generateScene with project_id null) are only visible to an
 * unfiltered lookup — which is exactly what the clip step's reuse check does.
 * Created objects are recorded on `api.created` for assertions.
 */
function makeApi(overrides = {}) {
  const created = {
    projects: [],
    assets: [],
    storyboards: [],
    panels: [],
    scenes: [],
    shots: [],
    timelines: [],
    tracks: [],
    items: [],
    panelUpdates: [],
    assetGenerations: [],
    clipGenerations: [],
    scoreJobs: [],
    renders: [],
  };
  let seq = 0;
  const id = (p) => `${p}-${++seq}`;
  const api = {
    created,
    // Non-local_cli model so demoVramDevice returns early (device: null)
    // without touching the real module-level api / hardware probes.
    async getModel() {
      return { id: 10, backend: "mock", vram_requirement_mb: null };
    },
    async listProjects() {
      return created.projects;
    },
    async createProject(p) {
      const proj = { id: id("proj"), name: p.name, ...p };
      created.projects.push(proj);
      return proj;
    },
    async listAssets(filter = {}) {
      if (filter.project_id) {
        return created.assets.filter((a) => a.project_id === filter.project_id);
      }
      return created.assets;
    },
    async generateAsset(p) {
      created.assetGenerations.push(p);
      const asset = {
        id: id("asset"),
        unique_slug: p.unique_slug,
        active_version_id: id("ver"),
        project_id: p.project_id ?? null,
      };
      created.assets.push(asset);
      return { job_id: id("job"), asset_id: asset.id, model_id: "t2i-model" };
    },
    async getAsset(assetId) {
      return created.assets.find((a) => a.id === assetId) ?? null;
    },
    async listStoryboards() {
      return created.storyboards;
    },
    async createStoryboard(p) {
      const b = { id: id("board"), name: p.name, ...p };
      created.storyboards.push(b);
      return b;
    },
    async listPanels(boardId) {
      return created.panels.filter((p) => p.board_id === boardId);
    },
    async createPanel(boardId, p) {
      const panel = {
        id: id("panel"),
        board_id: boardId,
        description: p.description,
        preview_asset_version_id: null,
        ...p,
      };
      created.panels.push(panel);
      return panel;
    },
    async updatePanel(boardId, panelId, p) {
      const panel = created.panels.find((x) => x.id === panelId) ?? null;
      if (panel) Object.assign(panel, p);
      created.panelUpdates.push({ boardId, panelId, ...p });
      return panel;
    },
    async generatePanelPreview(boardId, panelId) {
      const panel = created.panels.find((x) => x.id === panelId);
      if (panel) panel.preview_asset_version_id = id("prev");
      return { job_id: id("pjob") };
    },
    async listScenes() {
      return created.scenes;
    },
    async getScene(sceneId) {
      return {
        id: sceneId,
        shots: created.shots.filter((sh) => sh.scene_id === sceneId),
      };
    },
    async createScene(p) {
      const sc = { id: id("scene"), name: p.name, ...p };
      created.scenes.push(sc);
      return sc;
    },
    async createShot(sceneId, p) {
      const shot = { id: id("shot"), scene_id: sceneId, ...p };
      created.shots.push(shot);
      return shot;
    },
    async generateScene(sceneId) {
      const slug = `scene_${sceneId.slice(0, 8)}`;
      // The scene-generate path creates the clip as a GLOBAL asset.
      const asset = {
        id: id("clipasset"),
        unique_slug: slug,
        active_version_id: id("clipver"),
        project_id: null,
      };
      created.assets.push(asset);
      created.clipGenerations.push({ sceneId, slug, asset_id: asset.id });
      return { job_id: id("sjob"), asset_id: asset.id };
    },
    async listTimelines() {
      return created.timelines;
    },
    async createTimeline(p) {
      const tl = { id: id("tl"), name: p.name, ...p };
      created.timelines.push(tl);
      return tl;
    },
    async getTimeline(tlId) {
      const tl = created.timelines.find((t) => t.id === tlId);
      const tracks = created.tracks
        .filter((t) => t.timeline_id === tlId)
        .map((t) => ({
          ...t,
          items: created.items.filter((it) => it.track_id === t.id),
        }));
      return { id: tlId, name: tl?.name, tracks };
    },
    async createTimelineTrack(tlId, p) {
      const track = { id: id("trk"), timeline_id: tlId, items: [], ...p };
      created.tracks.push(track);
      return track;
    },
    async createTimelineItem(tlId, p) {
      const item = { id: id("item"), timeline_id: tlId, ...p };
      created.items.push(item);
      return item;
    },
    async generateScore() {
      const job = {
        job_id: id("scorejob"),
        asset_id: id("scoreasset"),
        status: "succeeded",
        output_asset_version_id: id("scorever"),
      };
      created.scoreJobs.push(job);
      return { job };
    },
    async queueRender(p) {
      const render = { id: id("render"), ...p };
      created.renders.push(render);
      return render;
    },
    async getRenderJob(renderId) {
      return { id: renderId, status: "succeeded", progress: 100 };
    },
    async getJob(jobId) {
      const score = created.scoreJobs.find((j) => j.job_id === jobId);
      return {
        id: jobId,
        status: "succeeded",
        progress: 100,
        output_asset_version_id: score?.output_asset_version_id ?? id("ver"),
      };
    },
    ...overrides,
  };
  return api;
}

const step = (steps, id) => steps.find((s) => s.id === id);

describe("buildMovieDemoSteps", () => {
  it("returns the full pipeline in order with unique ids and titles", () => {
    const steps = buildMovieDemoSteps({}, makePreflight());
    const expected = [
      "movie-intro",
      "movie-project",
      ...DEMO_FILM.assets.map((a) => `assets-${a.slug}`),
      "movie-storyboard",
      "movie-panels",
      "movie-panels-preview",
      "movie-scenes",
      "movie-clips-link",
      ...DEMO_FILM.scenes.map((_, i) => `movie-clip-${i + 1}`),
      "movie-timeline",
      "movie-tracks",
      "movie-clips-place",
      "movie-score",
      "movie-score-place",
      "movie-render",
      "movie-done",
    ];
    assertEquals(steps.map((s) => s.id), expected);
    const ids = steps.map((s) => s.id);
    assertEquals(new Set(ids).size, ids.length, "ids must be unique");
    for (const s of steps) {
      assert(typeof s.id === "string" && s.id.length > 0);
      assert(typeof s.title === "string" && s.title.length > 0);
      assert(typeof s.describe === "function");
    }
    // Every step that queues work carries an execute + poll pair.
    const pollers = [
      ...DEMO_FILM.assets.map((a) => `assets-${a.slug}`),
      "movie-panels-preview",
      ...DEMO_FILM.scenes.map((_, i) => `movie-clip-${i + 1}`),
      "movie-score",
      "movie-render",
    ];
    for (const id of pollers) {
      const s = step(steps, id);
      assert(typeof s.execute === "function", `${id} needs execute`);
      assert(typeof s.poll === "function", `${id} needs poll`);
    }
  });

  it("the project step reuses an existing project and creates one only when absent", async () => {
    // Existing → no create, scratch.project set from the match.
    let api = makeApi();
    api.created.projects.push({
      id: "p-existing",
      name: DEMO_FILM.project.name,
    });
    let steps = buildMovieDemoSteps({}, makePreflight());
    let ctx = { host: {}, api, scratch: {} };
    let s = step(steps, "movie-project");
    await s.prepare(ctx);
    const kept = await s.execute(ctx);
    assertEquals(kept.kind, "none");
    assertEquals(api.created.projects.length, 1, "no new project created");
    assertEquals(ctx.scratch.project.id, "p-existing");

    // Absent → a project is created.
    api = makeApi();
    steps = buildMovieDemoSteps({}, makePreflight());
    ctx = { host: {}, api, scratch: {} };
    s = step(steps, "movie-project");
    await s.prepare(ctx);
    const made = await s.execute(ctx);
    assertEquals(made.kind, "none");
    assertEquals(api.created.projects.length, 1);
    assertEquals(ctx.scratch.project.id, api.created.projects[0].id);
  });

  it("an asset step reuses an existing project-scoped image, else generates one", async () => {
    const slug = DEMO_FILM.assets[0].slug;
    const assetStepId = `assets-${slug}`;

    // Existing project-scoped asset with a version → reused, no generation.
    let api = makeApi();
    api.created.assets.push({
      id: "a-existing",
      unique_slug: slug,
      active_version_id: "v-existing",
      project_id: "p1",
    });
    let steps = buildMovieDemoSteps({}, makePreflight());
    let ctx = {
      host: {},
      api,
      scratch: { project: { id: "p1", name: "x" } },
    };
    let s = step(steps, assetStepId);
    await s.prepare(ctx);
    const kept = await s.execute(ctx);
    assertEquals(kept.kind, "none");
    assertEquals(api.created.assetGenerations.length, 0, "no regeneration");
    assertEquals(ctx.scratch.assets[slug].version_id, "v-existing");

    // Absent → a project-scoped generation is queued.
    api = makeApi();
    steps = buildMovieDemoSteps({}, makePreflight());
    ctx = { host: {}, api, scratch: { project: { id: "p1", name: "x" } } };
    s = step(steps, assetStepId);
    await s.prepare(ctx);
    const made = await s.execute(ctx);
    assertEquals(made.kind, "jobs");
    assertEquals(made.job_ids.length, 1);
    const payload = api.created.assetGenerations[0];
    assertEquals(payload.unique_slug, slug);
    assertEquals(payload.library_scope, "project");
    assertEquals(payload.project_id, "p1");
  });

  it("an asset step is skipped when no text-to-image model is enabled", async () => {
    const slug = DEMO_FILM.assets[0].slug;
    const api = makeApi();
    const steps = buildMovieDemoSteps(
      {},
      makePreflight({
        assets: { key: "assets", ok: false, model_id: null, error: "none" },
      }),
    );
    const ctx = {
      host: {},
      api,
      scratch: { project: { id: "p1", name: "x" } },
    };
    const s = step(steps, `assets-${slug}`);
    await s.prepare(ctx);
    const work = await s.execute(ctx);
    assertEquals(work.kind, "none");
    assert(work.skipped === true);
    assertEquals(api.created.assetGenerations.length, 0);
  });

  it("a clip step reuses an existing GLOBAL clip (no project filter), else generates", async () => {
    // The scene-generate path creates clips as global assets (project_id null),
    // so the reuse lookup must NOT pass a project_id or it would never match.
    const sceneId = "f47ac10b58cc4372a5670e02b2c3d479";
    const clipSlug = `scene_${sceneId.slice(0, 8)}`;

    // Existing global clip with a version → reused, no new generation.
    let api = makeApi();
    api.created.assets.push({
      id: "clip-existing",
      unique_slug: clipSlug,
      active_version_id: "cv-existing",
      project_id: null,
    });
    let steps = buildMovieDemoSteps({}, makePreflight());
    let ctx = {
      host: {},
      api,
      scratch: {
        project: { id: "p1", name: "x" },
        scenes: [
          {
            film: { name: "S1", target_duration: 12 },
            index: 0,
            scene: { id: sceneId },
            shot: null,
          },
        ],
      },
    };
    let s = step(steps, "movie-clip-1");
    await s.prepare(ctx);
    const kept = await s.execute(ctx);
    assertEquals(kept.kind, "none");
    assertEquals(api.created.clipGenerations.length, 0, "no regeneration");
    assertEquals(ctx.scratch.clips[0].version_id, "cv-existing");
    assertEquals(ctx.scratch.clips[0].asset_id, "clip-existing");

    // Absent → generateScene queues a job (and the clip starts unversioned).
    api = makeApi();
    steps = buildMovieDemoSteps({}, makePreflight());
    ctx = {
      host: {},
      api,
      scratch: {
        project: { id: "p1", name: "x" },
        scenes: [
          {
            film: { name: "S1", target_duration: 12 },
            index: 0,
            scene: { id: sceneId },
            shot: null,
          },
        ],
      },
    };
    s = step(steps, "movie-clip-1");
    await s.prepare(ctx);
    const made = await s.execute(ctx);
    assertEquals(made.kind, "jobs");
    assertEquals(made.job_ids.length, 1);
    assertEquals(api.created.clipGenerations.length, 1);
    assertEquals(api.created.clipGenerations[0].slug, clipSlug);
    assertEquals(ctx.scratch.clips[0].version_id, null);
  });

  it("the render step skips when no clips are placed, else queues a draft render", async () => {
    const seed = async (withClips) => {
      const api = makeApi();
      const tl = await api.createTimeline({
        name: "The Lighthouse — timeline",
        project_id: "p1",
      });
      const video = await api.createTimelineTrack(tl.id, {
        track_type: "video",
        name: "Scenes",
      });
      if (withClips) {
        await api.createTimelineItem(tl.id, {
          track_id: video.id,
          asset_version_id: "cv1",
          start_time: 0,
          end_time: 12,
        });
      }
      const steps = buildMovieDemoSteps({}, makePreflight());
      const ctx = {
        host: {},
        api,
        scratch: {
          project: { id: "p1", name: "x" },
          timeline: { id: tl.id },
          videoTrack: { id: video.id },
          audioTrack: { id: "audio-1" },
        },
      };
      return { api, steps, ctx };
    };

    // No clips → nothing to render.
    const a = await seed(false);
    const skipStep = step(a.steps, "movie-render");
    await skipStep.prepare(a.ctx);
    const skipped = await skipStep.execute(a.ctx);
    assertEquals(skipped.kind, "none");
    assert(skipped.skipped === true);
    assertEquals(a.api.created.renders.length, 0);

    // Clips present → a draft render is queued.
    const b = await seed(true);
    const renderStep = step(b.steps, "movie-render");
    await renderStep.prepare(b.ctx);
    const queued = await renderStep.execute(b.ctx);
    assertEquals(queued.kind, "render");
    assertEquals(queued.render_id, b.api.created.renders[0].id);
    assertEquals(
      b.api.created.renders[0].preset_id,
      DEMO_FILM.timeline.render_preset,
    );
  });
});

// ---- guided-movie page segmentation ---------------------------------------

describe("movie demo page segmentation", () => {
  const preflight = makePreflight();

  it("splits the full pipeline into exactly one segment per guided-movie page", () => {
    const segments = movieDemoSegments({}, preflight);
    assertEquals(segments.map((s) => s.page), MOVIE_PAGES.map((p) => p.page));
    // Each page owns at least one step.
    for (const seg of segments) {
      assert(seg.steps.length > 0, `${seg.page} hosts steps`);
    }
  });

  it("concatenating the page segments in order reproduces the full pipeline", () => {
    const full = buildMovieDemoSteps({}, preflight);
    const concatenated = movieDemoSegments({}, preflight).flatMap(
      (seg) => seg.steps,
    );
    assertEquals(
      concatenated.map((s) => s.id),
      full.map((s) => s.id),
      "segments must be a partition of the pipeline, in order",
    );
  });

  it("each page's segment carries only that page's steps", () => {
    const expected = {
      projects: ["movie-intro", "movie-project"],
      assets: DEMO_FILM.assets.map((a) => `assets-${a.slug}`),
      storyboard: ["movie-storyboard", "movie-panels", "movie-panels-preview"],
      scenes: [
        "movie-scenes",
        "movie-clips-link",
        ...DEMO_FILM.scenes.map((_, i) => `movie-clip-${i + 1}`),
      ],
      timeline: [
        "movie-timeline",
        "movie-tracks",
        "movie-clips-place",
        "movie-score",
        "movie-score-place",
        "movie-render",
        "movie-done",
      ],
    };
    for (const page of Object.keys(expected)) {
      const steps = movieDemoStepsForPage({}, preflight, page);
      assertEquals(
        steps.map((s) => s.id),
        expected[page],
        `${page} hosts its own steps`,
      );
    }
  });
});
