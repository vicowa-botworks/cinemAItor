// The Projects page full-movie demo (docs/demo.md) — a fully-automatic run of
// the whole CinemAItor pipeline against the real backend API: create the demo
// project, generate its image assets, build the storyboard + panels, create the
// scenes + shots, generate the scene clips (image-to-video off the panel
// previews when an i2v model is enabled, text-to-video otherwise), lay the
// clips and a generated music score on a timeline, and run a draft render.
//
// Unlike the page demos (which drive their host's handlers), this builder calls
// the API directly — its host (project-list) is the page the whole film lives
// under, not a page with a handler for each pipeline step. Every step is
// idempotent: on a re-run it reuses the project / assets / storyboard / scenes
// / clips / timeline it already created, so the film can be run twice without
// duplicating objects. Pure functions over (api, preflight); no DOM, no Lit.

import { DEMO_FILM } from "./demo-content.js";
import { MOVIE_PAGES, pageForStage } from "./demo-movie-state.js";
import { demoVramDevice } from "./vram-guard.js";

const TERMINAL_OK = "succeeded";
const TERMINAL_BAD = new Set(["failed", "cancelled"]);

/** Find a project by exact display name (null when absent). */
async function findProjectByName(api, name) {
  const projects = await api.listProjects();
  return projects.find((p) => p.name === name) ?? null;
}

/**
 * Find an asset by its unique slug (null when absent). When a projectId is
 * given, search only that project's assets (the image assets, which the demo
 * creates project-scoped); otherwise search every scope — the scene clips are
 * created global by the scene-generate path, so a project filter would never
 * find them and their reuse check on a re-run would go dead.
 */
async function findAssetBySlug(api, slug, projectId) {
  const assets = await api.listAssets(
    projectId ? { project_id: projectId } : {},
  );
  return assets.find((a) => a.unique_slug === slug) ?? null;
}

/**
 * Poll generation jobs to a terminal status. Returns {failed, error} when any
 * job failed/cancelled, {progress} while any is still running, and {done,
 * result} once all have succeeded.
 */
async function pollJobs(api, jobIds) {
  let ok = 0;
  let progressSum = 0;
  let progressN = 0;
  for (const id of jobIds) {
    const job = await api.getJob(id);
    if (job.status === TERMINAL_OK) {
      ok += 1;
    } else if (TERMINAL_BAD.has(job.status)) {
      return { failed: true, error: job.error_text || `job ${job.status}` };
    } else if (typeof job.progress === "number") {
      progressSum += job.progress;
      progressN += 1;
    }
  }
  if (ok < jobIds.length) {
    return { progress: progressN ? progressSum / progressN : null };
  }
  return { done: true, result: { job_ids: [...jobIds] } };
}

function introStep() {
  return {
    id: "movie-intro",
    stage: "Overview",
    title: "The Lighthouse, end to end",
    describe: () =>
      `Here is the whole pipeline in one go — no hand-holding. I'll create a ` +
      `project, generate the film's images, storyboard it, turn the panels into ` +
      `video clips, lay it on a timeline with a music score, and render a draft ` +
      `you can watch. Missing model types are announced and skipped.`,
    execute: () => ({ kind: "none" }),
  };
}

function projectStep(film) {
  return {
    id: "movie-project",
    stage: "Project",
    title: "Create the project",
    async prepare(ctx) {
      const existing = await findProjectByName(ctx.api, film.project.name);
      ctx.scratch.project = existing ? { id: existing.id, name: existing.name } : null;
    },
    async describe(ctx) {
      return ctx.scratch.project
        ? `A project named "${film.project.name}" already exists from a previous run — I'll build on it.`
        : `Creating the project, "${film.project.name}" — the home for every object this film uses.`;
    },
    async execute(ctx) {
      const s = ctx.scratch;
      if (s.project) return { kind: "none", result: s.project };
      const project = await ctx.api.createProject({
        name: film.project.name,
        description: film.project.description,
        aspect_ratio: film.project.aspect_ratio,
      });
      s.project = { id: project.id, name: project.name };
      return { kind: "none", result: s.project };
    },
  };
}

function assetStep(asset, assetsOk, modelId) {
  return {
    id: `assets-${asset.slug}`,
    stage: "Assets",
    title: `${asset.display_name} image`,
    async prepare(ctx) {
      if (!assetsOk) return;
      ctx.scratch._assetFound = await findAssetBySlug(
        ctx.api,
        asset.slug,
        ctx.scratch.project.id,
      );
    },
    async describe(ctx) {
      if (!assetsOk) {
        return "No text-to-image model is enabled, so this image is skipped.";
      }
      return ctx.scratch._assetFound?.active_version_id
        ? `"${asset.display_name}" already has an image — reusing it.`
        : `Generating "${asset.display_name}" — a still the storyboard panels will @reference.`;
    },
    async execute(ctx) {
      const s = ctx.scratch;
      if (!assetsOk) return { kind: "none", skipped: true };
      if (s._assetFound?.active_version_id) {
        s.assets ??= {};
        s.assets[asset.slug] = {
          asset_id: s._assetFound.id,
          version_id: s._assetFound.active_version_id,
        };
        return { kind: "none", result: s.assets[asset.slug] };
      }
      const vram = await demoVramDevice(
        modelId ? await ctx.api.getModel(modelId) : null,
      );
      const res = await ctx.api.generateAsset({
        kind: asset.kind,
        prompt: asset.prompt,
        unique_slug: asset.slug,
        display_name: asset.display_name,
        asset_type: asset.asset_type,
        library_scope: "project",
        project_id: s.project.id,
        candidates: 1,
        device: vram.device,
      });
      return {
        kind: "jobs",
        job_ids: [res.job_id],
        asset_id: res.asset_id,
        slug: asset.slug,
        _vramNote: vram.note,
      };
    },
    async poll(ctx, work) {
      const state = await pollJobs(ctx.api, work.job_ids);
      if (work._vramNote) {
        state.note = work._vramNote;
        delete work._vramNote;
      }
      if (state.failed || !state.done) return state;
      const s = ctx.scratch;
      const detail = (await ctx.api.getAsset(work.asset_id)) ?? {};
      s.assets ??= {};
      s.assets[work.slug] = {
        asset_id: work.asset_id,
        version_id: detail.active_version_id,
      };
      return { done: true, result: s.assets[work.slug] };
    },
  };
}

function storyboardStep(film, boardName) {
  return {
    id: "movie-storyboard",
    stage: "Storyboard",
    title: "Create the storyboard",
    async prepare(ctx) {
      const list = await ctx.api.listStoryboards({
        project_id: ctx.scratch.project.id,
      });
      ctx.scratch._boardFound = list.find((b) => b.name === boardName) ?? null;
    },
    async describe(ctx) {
      return ctx.scratch._boardFound
        ? `The storyboard already exists — reusing it.`
        : `Creating the storyboard — ${film.panels.length} panels that frame each scene before it's animated.`;
    },
    async execute(ctx) {
      const s = ctx.scratch;
      if (s._boardFound) {
        s.storyboard = { id: s._boardFound.id };
        return { kind: "none", result: s.storyboard };
      }
      const board = await ctx.api.createStoryboard({
        name: boardName,
        project_id: s.project.id,
      });
      s.storyboard = { id: board.id };
      return { kind: "none", result: s.storyboard };
    },
  };
}

function panelsStep(film) {
  return {
    id: "movie-panels",
    stage: "Storyboard",
    title: "Add the panels",
    async prepare(ctx) {
      const s = ctx.scratch;
      const existing = await ctx.api.listPanels(s.storyboard.id);
      s.panels = film.panels.map((p, i) => ({
        film: p,
        index: i,
        panel: existing.find((e) => e.description === p.name) ?? null,
      }));
    },
    async describe(ctx) {
      const fresh = ctx.scratch.panels.filter((p) => !p.panel).length;
      return fresh === 0
        ? `All ${film.panels.length} panels already exist — reusing them.`
        : `Adding ${fresh} panel${
          fresh === 1 ? "" : "s"
        } — each prompt @references the images generated above, so the panel stays bound to those assets.`;
    },
    async execute(ctx) {
      const s = ctx.scratch;
      for (const entry of s.panels) {
        if (entry.panel) continue;
        entry.panel = await ctx.api.createPanel(s.storyboard.id, {
          panel_order: entry.index + 1,
          description: entry.film.name,
          prompt: entry.film.prompt,
        });
      }
      return { kind: "none", result: { panels: s.panels.length } };
    },
  };
}

function panelPreviewsStep(film, assetsOk, modelId) {
  return {
    id: "movie-panels-preview",
    stage: "Storyboard",
    title: "Preview every panel",
    async prepare(ctx) {
      if (!assetsOk) return;
      ctx.scratch._toPreview = ctx.scratch.panels.filter(
        (e) => !e.panel.preview_asset_version_id,
      );
    },
    async describe(ctx) {
      if (!assetsOk) {
        return "No text-to-image model is enabled, so panel previews are skipped.";
      }
      const n = ctx.scratch._toPreview?.length ?? 0;
      return n === 0
        ? "Every panel already has a preview."
        : `Rendering ${n} panel preview${
          n === 1 ? "" : "s"
        } with the text-to-image model — the video clips will start from these frames.`;
    },
    async execute(ctx) {
      const toPreview = ctx.scratch._toPreview ?? [];
      if (!assetsOk || toPreview.length === 0) {
        return { kind: "none", skipped: toPreview.length === 0 };
      }
      const vram = await demoVramDevice(
        modelId ? await ctx.api.getModel(modelId) : null,
      );
      const jobIds = [];
      for (const entry of toPreview) {
        const res = await ctx.api.generatePanelPreview(
          ctx.scratch.storyboard.id,
          entry.panel.id,
          { device: vram.device },
        );
        jobIds.push(res.job_id);
      }
      return { kind: "jobs", job_ids: jobIds, _vramNote: vram.note };
    },
    async poll(ctx, work) {
      const state = await pollJobs(ctx.api, work.job_ids);
      if (work._vramNote) {
        state.note = work._vramNote;
        delete work._vramNote;
      }
      if (state.failed) return state;
      if (state.done) {
        return { done: true, result: { previews: work.job_ids.length } };
      }
      return state;
    },
  };
}

function scenesStep(film) {
  return {
    id: "movie-scenes",
    stage: "Scenes",
    title: "Create the scenes and shots",
    async prepare(ctx) {
      const s = ctx.scratch;
      const existing = await ctx.api.listScenes({ project_id: s.project.id });
      s.scenes = film.scenes.map((sc, i) => ({
        film: sc,
        index: i,
        shotFilm: film.shots[i],
        scene: existing.find((e) => e.name === sc.name) ?? null,
        shot: null,
      }));
      for (const entry of s.scenes) {
        if (!entry.scene) continue;
        const detail = (await ctx.api.getScene(entry.scene.id)) ?? {};
        entry.shot = (detail.shots ?? [])[0] ?? null;
      }
    },
    async describe(ctx) {
      const fresh = ctx.scratch.scenes.filter((e) => !e.scene).length;
      return fresh === 0
        ? `All ${film.scenes.length} scenes (and their shots) already exist — reusing them.`
        : `Creating ${film.scenes.length} scenes, one shot each — the scene carries the clip's motion prompt, the shot describes the camera move.`;
    },
    async execute(ctx) {
      const s = ctx.scratch;
      for (const entry of s.scenes) {
        if (!entry.scene) {
          entry.scene = await ctx.api.createScene({
            name: entry.film.name,
            description: entry.film.description,
            target_duration: entry.film.target_duration,
            prompt: entry.film.prompt,
            project_id: s.project.id,
          });
        }
        if (!entry.shot) {
          entry.shot = await ctx.api.createShot(entry.scene.id, {
            shot_order: 1,
            name: entry.shotFilm.name,
            prompt: entry.shotFilm.prompt,
          });
        }
      }
      return { kind: "none", result: { scenes: s.scenes.length } };
    },
  };
}

function linkStep(film, i2vPossible) {
  return {
    id: "movie-clips-link",
    stage: "Clips",
    title: "Link panels to scenes",
    async prepare(ctx) {
      if (!i2vPossible) return;
      const s = ctx.scratch;
      s._links = s.scenes.map((entry) => {
        const panelEntry = s.panels.find(
          (p) => p.film.scene_index === entry.index + 1,
        );
        return {
          panel: panelEntry?.panel ?? null,
          scene: entry.scene,
          shot: entry.shot,
        };
      });
    },
    async describe() {
      if (!i2vPossible) {
        return "No image-to-video model is enabled, so the clips will be text-to-video — no panel linking needed.";
      }
      return "Linking each scene to its first storyboard panel — with that panel's preview in place, the clip is generated image-to-video from the frame.";
    },
    async execute(ctx) {
      if (!i2vPossible) return { kind: "none", skipped: true };
      const s = ctx.scratch;
      for (const link of s._links) {
        if (!link.panel) continue;
        await ctx.api.updatePanel(s.storyboard.id, link.panel.id, {
          linked_scene_id: link.scene.id,
          // Only send linked_shot_id when a shot exists — the PATCH route
          // rejects null, and the scene link alone is what enables i2v.
          ...(link.shot?.id ? { linked_shot_id: link.shot.id } : {}),
        });
      }
      return { kind: "none", result: { links: s._links.length } };
    },
  };
}

function clipStep(index, film, clipsAnyOk, i2vPossible, modelId) {
  const scene = film.scenes[index];
  return {
    id: `movie-clip-${index + 1}`,
    stage: "Clips",
    title: `Scene ${index + 1} clip`,
    async prepare(ctx) {
      if (!clipsAnyOk) return;
      const s = ctx.scratch;
      const entry = s.scenes[index];
      ctx.scratch._clipFound = await findAssetBySlug(
        ctx.api,
        `scene_${entry.scene.id.slice(0, 8)}`,
      );
    },
    async describe(ctx) {
      if (!clipsAnyOk) {
        return "No video model is enabled, so this clip is skipped.";
      }
      const reuse = ctx.scratch._clipFound?.active_version_id;
      if (reuse) {
        return `Scene ${index + 1} already has a clip — reusing it.`;
      }
      const how = i2vPossible ? "image-to-video from its panel preview" : "text-to-video";
      return `Generating the clip for "${scene.name}" — ${how}, driven by the scene's motion prompt.`;
    },
    async execute(ctx) {
      const s = ctx.scratch;
      if (!clipsAnyOk) return { kind: "none", skipped: true };
      const entry = s.scenes[index];
      s.clips ??= {};
      if (s._clipFound?.active_version_id) {
        s.clips[index] = {
          scene_id: entry.scene.id,
          asset_id: s._clipFound.id,
          version_id: s._clipFound.active_version_id,
        };
        return { kind: "none", result: s.clips[index] };
      }
      const vram = await demoVramDevice(
        modelId ? await ctx.api.getModel(modelId) : null,
      );
      const res = await ctx.api.generateScene(entry.scene.id, {
        device: vram.device,
      });
      s.clips[index] = {
        scene_id: entry.scene.id,
        asset_id: res.asset_id,
        version_id: null,
      };
      return {
        kind: "jobs",
        job_ids: [res.job_id],
        index,
        _vramNote: vram.note,
      };
    },
    async poll(ctx, work) {
      const state = await pollJobs(ctx.api, work.job_ids);
      if (work._vramNote) {
        state.note = work._vramNote;
        delete work._vramNote;
      }
      if (state.failed || !state.done) return state;
      const s = ctx.scratch;
      const clip = s.clips[work.index];
      const detail = (await ctx.api.getAsset(clip.asset_id)) ?? {};
      clip.version_id = detail.active_version_id;
      return { done: true, result: clip };
    },
  };
}

function timelineStep(film, timelineName) {
  return {
    id: "movie-timeline",
    stage: "Timeline",
    title: "Create the timeline",
    async prepare(ctx) {
      const list = await ctx.api.listTimelines({
        project_id: ctx.scratch.project.id,
      });
      ctx.scratch._timelineFound = list.find((t) => t.name === timelineName) ??
        null;
    },
    async describe(ctx) {
      return ctx.scratch._timelineFound
        ? "The timeline already exists — reusing it."
        : "Creating the timeline — the canvas where the clips and score are cut together.";
    },
    async execute(ctx) {
      const s = ctx.scratch;
      if (s._timelineFound) {
        s.timeline = { id: s._timelineFound.id };
        return { kind: "none", result: s.timeline };
      }
      const tl = await ctx.api.createTimeline({
        name: timelineName,
        project_id: s.project.id,
      });
      s.timeline = { id: tl.id };
      return { kind: "none", result: s.timeline };
    },
  };
}

function tracksStep(film) {
  return {
    id: "movie-tracks",
    stage: "Timeline",
    title: "Add the video and score tracks",
    async prepare(ctx) {
      const s = ctx.scratch;
      const detail = (await ctx.api.getTimeline(s.timeline.id)) ?? {};
      const byName = (name) => (detail.tracks ?? []).find((t) => t.name === name);
      s._videoTrackFound = byName(film.timeline.video_track) ?? null;
      s._audioTrackFound = byName(film.timeline.audio_track) ?? null;
    },
    async describe(ctx) {
      const s = ctx.scratch;
      if (s._videoTrackFound && s._audioTrackFound) {
        return "The video and score tracks already exist — reusing them.";
      }
      return "Adding a video track for the scene clips and a music track for the score.";
    },
    async execute(ctx) {
      const s = ctx.scratch;
      if (!s._videoTrackFound) {
        s._videoTrackFound = await ctx.api.createTimelineTrack(s.timeline.id, {
          track_type: "video",
          name: film.timeline.video_track,
        });
      }
      if (!s._audioTrackFound) {
        s._audioTrackFound = await ctx.api.createTimelineTrack(s.timeline.id, {
          track_type: "music",
          name: film.timeline.audio_track,
        });
      }
      s.videoTrack = { id: s._videoTrackFound.id };
      s.audioTrack = { id: s._audioTrackFound.id };
      return { kind: "none", result: s.videoTrack, audio: s.audioTrack };
    },
  };
}

function placeStep() {
  return {
    id: "movie-clips-place",
    stage: "Timeline",
    title: "Lay the clips on the track",
    async prepare(ctx) {
      const s = ctx.scratch;
      const detail = (await ctx.api.getTimeline(s.timeline.id)) ?? {};
      const videoTrack = (detail.tracks ?? []).find(
        (t) => t.id === s.videoTrack.id,
      );
      const placed = new Set(
        (videoTrack?.items ?? []).map((it) => it.asset_version_id),
      );
      s._placements = s.scenes.map((entry, i) => {
        const clip = s.clips?.[i];
        const versionId = clip?.version_id ?? null;
        return {
          index: i,
          name: entry.film.name,
          duration: entry.film.target_duration,
          versionId,
          placed: versionId ? placed.has(versionId) : false,
        };
      });
    },
    async describe(ctx) {
      const s = ctx.scratch;
      const pending = s._placements.filter(
        (p) => p.versionId && !p.placed,
      ).length;
      if (pending === 0) {
        return s._placements.some((p) => !p.versionId)
          ? "No new clips to lay out — the rest were skipped or already placed."
          : "All clips are already laid out on the video track.";
      }
      return `Laying ${pending} clip${
        pending === 1 ? "" : "s"
      } back-to-back on the video track, each sized to its scene's target duration.`;
    },
    async execute(ctx) {
      const s = ctx.scratch;
      const detail = (await ctx.api.getTimeline(s.timeline.id)) ?? {};
      const videoTrack = (detail.tracks ?? []).find(
        (t) => t.id === s.videoTrack.id,
      );
      const items = (videoTrack?.items ?? []).slice().sort(
        (a, b) => a.start_time - b.start_time,
      );
      let cursor = items.length ? items[items.length - 1].end_time : 0;
      let placed = 0;
      for (const p of s._placements) {
        if (!p.versionId || p.placed) continue;
        await ctx.api.createTimelineItem(s.timeline.id, {
          track_id: s.videoTrack.id,
          asset_version_id: p.versionId,
          start_time: cursor,
          end_time: cursor + p.duration,
        });
        cursor += p.duration;
        placed += 1;
      }
      return { kind: "none", result: { placed } };
    },
  };
}

function scoreStep(film, musicOk, modelId) {
  return {
    id: "movie-score",
    stage: "Score",
    title: "Generate the music score",
    async prepare(ctx) {
      if (!musicOk) return;
      const s = ctx.scratch;
      const detail = (await ctx.api.getTimeline(s.timeline.id)) ?? {};
      const videoTrack = (detail.tracks ?? []).find(
        (t) => t.id === s.videoTrack.id,
      );
      const musicTrack = (detail.tracks ?? []).find(
        (t) => t.id === s.audioTrack.id,
      );
      s._hasVideo = (videoTrack?.items ?? []).length > 0;
      s._scorePlaced = (musicTrack?.items ?? []).length > 0;
      if (s._scorePlaced) {
        s.score = {
          version_id: (musicTrack?.items ?? [])[0]?.asset_version_id ?? null,
        };
      }
    },
    async describe(ctx) {
      if (!musicOk) {
        return "No music model is enabled, so the score is skipped.";
      }
      const s = ctx.scratch;
      if (!s._hasVideo) {
        return "No clips were generated, so there is nothing to score.";
      }
      return s._scorePlaced
        ? "A score is already on the music track — reusing it."
        : `Generating the film's score — ${film.music.prompt.slice(0, 64)}…`;
    },
    async execute(ctx) {
      const s = ctx.scratch;
      if (!musicOk || !s._hasVideo) return { kind: "none", skipped: true };
      if (s._scorePlaced) return { kind: "none", result: s.score };
      const vram = await demoVramDevice(
        modelId ? await ctx.api.getModel(modelId) : null,
      );
      const res = await ctx.api.generateScore(s.timeline.id, {
        prompt: film.music.prompt,
        device: vram.device,
      });
      s.score = {
        job_id: res.job.job_id,
        asset_id: res.job.asset_id,
        version_id: null,
      };
      return { kind: "jobs", job_ids: [res.job.job_id], _vramNote: vram.note };
    },
    async poll(ctx, work) {
      const state = await pollJobs(ctx.api, work.job_ids);
      if (work._vramNote) {
        state.note = work._vramNote;
        delete work._vramNote;
      }
      if (state.failed || !state.done) return state;
      const s = ctx.scratch;
      const job = await ctx.api.getJob(work.job_ids[0]);
      s.score.version_id = job.output_asset_version_id ?? null;
      return { done: true, result: s.score };
    },
  };
}

function scorePlaceStep() {
  return {
    id: "movie-score-place",
    stage: "Score",
    title: "Lay the score on the track",
    async prepare(ctx) {
      const s = ctx.scratch;
      const detail = (await ctx.api.getTimeline(s.timeline.id)) ?? {};
      const musicTrack = (detail.tracks ?? []).find(
        (t) => t.id === s.audioTrack.id,
      );
      s._scoreItem = (musicTrack?.items ?? [])[0] ?? null;
    },
    async describe(ctx) {
      const s = ctx.scratch;
      if (!s.score?.version_id) return "No score to lay out.";
      return s._scoreItem
        ? "The score is already on the music track."
        : "Laying the score under the clips, spanning the full length of the film.";
    },
    async execute(ctx) {
      const s = ctx.scratch;
      if (!s.score?.version_id || s._scoreItem) {
        return { kind: "none", skipped: true };
      }
      const detail = (await ctx.api.getTimeline(s.timeline.id)) ?? {};
      const videoTrack = (detail.tracks ?? []).find(
        (t) => t.id === s.videoTrack.id,
      );
      const videoItems = (videoTrack?.items ?? []).filter(
        (it) => it.asset_version_id,
      );
      const total = videoItems.length ? Math.max(...videoItems.map((it) => it.end_time)) : 0;
      if (total <= 0) return { kind: "none", skipped: true };
      await ctx.api.createTimelineItem(s.timeline.id, {
        track_id: s.audioTrack.id,
        asset_version_id: s.score.version_id,
        start_time: 0,
        end_time: total,
      });
      return { kind: "none", result: { placed: true } };
    },
  };
}

function renderStep(film) {
  return {
    id: "movie-render",
    stage: "Render",
    title: "Render the draft",
    async prepare(ctx) {
      const s = ctx.scratch;
      const detail = (await ctx.api.getTimeline(s.timeline.id)) ?? {};
      const videoTrack = (detail.tracks ?? []).find(
        (t) => t.id === s.videoTrack.id,
      );
      s._renderable = (videoTrack?.items ?? []).filter(
        (it) => it.asset_version_id,
      ).length;
    },
    async describe(ctx) {
      if (ctx.scratch._renderable === 0) {
        return "No clips were generated, so there is nothing to render.";
      }
      return `Cutting the clips and score together in a draft render (${film.timeline.render_preset}) — one video file, ready to watch.`;
    },
    async execute(ctx) {
      const s = ctx.scratch;
      if (s._renderable === 0) return { kind: "none", skipped: true };
      const res = await ctx.api.queueRender({
        project_id: s.project.id,
        timeline_id: s.timeline.id,
        preset_id: film.timeline.render_preset,
      });
      if (!res?.id) throw new Error("the render job was not queued");
      return { kind: "render", render_id: res.id };
    },
    async poll(ctx, work) {
      const job = (await ctx.api.getRenderJob(work.render_id)) ?? {};
      if (job.status === "failed") {
        return { failed: true, error: job.error_text || "render failed" };
      }
      if (job.status === "cancelled") {
        return { failed: true, error: "render cancelled" };
      }
      if (job.status === TERMINAL_OK) {
        return { done: true, result: { render_id: work.render_id } };
      }
      return {
        progress: typeof job.progress === "number" ? job.progress : null,
      };
    },
  };
}

function doneStep(film) {
  return {
    id: "movie-done",
    stage: "Render",
    title: "The film is done",
    describe: () =>
      `"${film.title}" is complete — a project with generated images, a ` +
      `storyboard, scenes, video clips, a music score, and a draft render. Open ` +
      `the project to explore every object the pipeline built.`,
    execute: () => ({ kind: "none" }),
  };
}

/**
 * The ordered engine steps for the full-movie demo. Runs the entire pipeline
 * against the real API; each step is idempotent so a second run reuses the
 * objects the first created. `host` is the page (project-list) the demo runs
 * on — kept for parity with the page builders, though this one drives the API
 * directly rather than host handlers.
 */
export function buildMovieDemoSteps(host, preflight) {
  const film = DEMO_FILM;
  const task = (key) => (preflight?.tasks ?? []).find((t) => t.key === key) ?? {};
  const assetsOk = task("assets").ok === true;
  const clipsOk = task("clips").ok === true;
  const clipsTextOk = task("clips_text").ok === true;
  const musicOk = task("music").ok === true;
  // The preflight's enabled model per generation task — its vram_requirement
  // drives the demo's live VRAM device choice + warning (docs/demo.md).
  const modelId = (key) => task(key).model_id ?? null;
  // i2v clips need both a clip model (i2v) and panel previews (t2i).
  const i2vPossible = clipsOk && assetsOk;
  // A clip is generatable only via a real path: i2v (needs previews) or the t2v
  // fallback. A bare i2v model with no t2i (hence no previews) and no t2v model
  // has no path, so don't queue clips that would fail.
  const clipsAnyOk = i2vPossible || clipsTextOk;

  const boardName = `${film.title} — storyboard`;
  const timelineName = `${film.title} — timeline`;

  const steps = [introStep(), projectStep(film)];
  for (const asset of film.assets) {
    steps.push(assetStep(asset, assetsOk, modelId("assets")));
  }
  steps.push(storyboardStep(film, boardName));
  steps.push(panelsStep(film));
  steps.push(panelPreviewsStep(film, assetsOk, modelId("assets")));
  steps.push(scenesStep(film));
  steps.push(linkStep(film, i2vPossible));
  for (let i = 0; i < film.scenes.length; i += 1) {
    steps.push(
      clipStep(
        i,
        film,
        clipsAnyOk,
        i2vPossible,
        clipsOk ? modelId("clips") : modelId("clips_text"),
      ),
    );
  }
  steps.push(timelineStep(film, timelineName));
  steps.push(tracksStep(film));
  steps.push(placeStep());
  steps.push(scoreStep(film, musicOk, modelId("music")));
  steps.push(scorePlaceStep());
  steps.push(renderStep(film));
  steps.push(doneStep(film));
  return steps;
}

/**
 * The subset of the movie demo's steps that the given guided-movie page hosts,
 * in pipeline order. Each page runs only its own segment — the cross-page
 * object ids (project, assets, storyboard, …) flow through the persisted
 * scratch, not through step results, so a page's segment can run against the
 * ids the previous pages already created.
 */
export function movieDemoStepsForPage(host, preflight, page) {
  return buildMovieDemoSteps(host, preflight).filter(
    (step) => pageForStage(step.stage) === page,
  );
}

/**
 * The guided-movie pages in order, each annotated with the step ids it hosts
 * — the seam the host mixin uses to run one segment per page and to know which
 * steps are "done" when it re-homes the run on the next page.
 */
export function movieDemoSegments(host, preflight) {
  return MOVIE_PAGES.map((page) => ({
    page: page.page,
    steps: movieDemoStepsForPage(host, preflight, page.page),
  }));
}
