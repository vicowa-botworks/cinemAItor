// The Timeline page demo (docs/demo.md) — drives timeline-detail's real
// handlers: `_addTrack()`, `_placeItem()`, `_loadScoreSuggestion()`,
// `_generateScore()`, and `_queueRender()`, plus the asset-generation API
// for the film's clips and score. Pure data -> functions; no DOM of its own.
//
// The demo works on the timeline that is already open (the route needs a
// timeline id). It lays a video track + a score track, generates one clip per
// film scene (text-to-video from each scene's shot prompt) and places them in
// order, generates the film's score and places it under the clips, then
// draft-renders the whole cut. The finished export is auto-saved by the page.
//
// With no enabled video model the clips are announced and skipped (and the
// render is skipped too — there'd be nothing to render); with no music model
// the score is skipped but the clips still render.
import { DEMO_FILM } from "./demo-content.js";

/**
 * Build the Timeline page demo steps.
 *
 * @param {object} host the <timeline-detail> element
 * @param {object} preflight demoPreflight() result
 */
export function buildTimelineDemoSteps(host, preflight) {
  const film = DEMO_FILM;
  const tl = film.timeline;
  const scenes = film.scenes;
  const clips = tl.clip_slugs;
  const tasks = Object.fromEntries((preflight?.tasks ?? []).map((t) => [t.key, t]));
  // The timeline clips are generated text-to-video (no references), so this
  // builder needs a t2v model specifically — gate on the `clips_text` task.
  // (The scene demo gates on i2v OR t2v because it picks the task type at run
  // time; this one is t2v-only.)
  const clipOk = (tasks.clips_text ?? {}).ok !== false;
  const musicOk = (tasks.music ?? {}).ok !== false;

  // Cumulative start + duration per clip, from the film scene target
  // durations. Clip N plays scene N's shot; the placed duration is the scene
  // target (deterministic, always present in demo-content).
  const shotFor = (i) =>
    film.shots.find((s) => s.scene_index === i) ??
      film.shots[i];
  const clipPlan = scenes.map((scene, i) => ({
    scene,
    shot: shotFor(i),
    slug: clips[i],
    start: scenes.slice(0, i).reduce((acc, s) => acc + s.target_duration, 0),
    duration: scene.target_duration,
  }));
  const totalDuration = scenes.reduce((acc, s) => acc + s.target_duration, 0);

  const findTrack = (h, name, type) =>
    (h.tracks ?? []).find((t) => t.name === name) ??
      (h.tracks ?? []).find((t) => t.track_type === type);

  // Place a version on a track through the page's own `_placeItem` handler,
  // skipping when that exact version is already on the track (re-runs).
  async function placeVersion(h, trackId, versionId, start, duration) {
    const track = h._trackById(trackId);
    if (!track) throw new Error("the target track disappeared");
    if ((track.items ?? []).some((it) => it.asset_version_id === versionId)) {
      return;
    }
    h.placeTrackId = trackId;
    h.placeStart = String(start);
    h.placeDuration = String(duration);
    h.placeVersionId = versionId;
    await h._placeItem();
    if (h.placeError) throw new Error(h.placeError);
  }

  // Resolve a finished asset's active version and place it. Returns the
  // version id or throws when the asset has no playable version.
  async function resolveAndPlace(ctx, work) {
    const h = ctx.host;
    const asset = (await ctx.api.getAsset(work.asset_id)) ?? {};
    const versionId = asset.active_version_id;
    if (!versionId) {
      throw new Error("the job finished but the asset has no playable version");
    }
    await placeVersion(h, work.trackId, versionId, work.start, work.duration);
    return versionId;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Poll one or more generation jobs to a terminal state, then place the
  // resulting version on the clip/score track.
  const pollJobs = async (ctx, work) => {
    let done = 0;
    let progressSum = 0;
    let progressN = 0;
    for (const id of work.job_ids) {
      const job = (await ctx.api.getJob(id)) ?? {};
      if (job.status === "failed") {
        return { failed: true, error: job.error_text || "a job failed" };
      }
      if (job.status === "cancelled") {
        return { failed: true, error: "a job was cancelled" };
      }
      if (job.status === "succeeded") {
        done += 1;
      } else if (typeof job.progress === "number") {
        progressSum += job.progress;
        progressN += 1;
      }
    }
    if (done === work.job_ids.length) {
      await resolveAndPlace(ctx, work);
      await ctx.host._load();
      const label = work.variant === "score" ? "score" : "clip";
      return {
        done: true,
        result: { job_ids: work.job_ids, asset_id: work.asset_id },
        note: `the ${label} is on its track — ${work.duration}s of the cut, placed in order.`,
      };
    }
    const pct = progressN ? ` (${Math.round(progressSum / progressN)}%)` : "";
    return {
      progress: progressN ? progressSum / progressN : null,
      note: `job${work.job_ids.length === 1 ? "" : "s"} running${pct}`,
    };
  };

  // Poll the draft render to a terminal status; the page auto-saves the
  // export when it succeeds.
  const pollRender = async (ctx, work) => {
    const job = (await ctx.api.getRenderJob(work.render_id)) ?? {};
    if (job.status === "failed") {
      return { failed: true, error: job.error_text || "the render failed" };
    }
    if (job.status === "cancelled") {
      return { failed: true, error: "the render was cancelled" };
    }
    if (job.status === "succeeded") {
      await ctx.host._load();
      return {
        done: true,
        result: { render_id: work.render_id },
        note:
          "the draft render finished and its export is saved on the project — the film exists, end to end.",
      };
    }
    const pct = typeof job.progress === "number" ? ` (${Math.round(job.progress)}%)` : "";
    return {
      progress: typeof job.progress === "number" ? job.progress : null,
      note: `rendering the cut${pct}`,
    };
  };

  void sleep; // (kept for a possible future dwell; unused for now)

  return [
    {
      id: "timeline-intro",
      title: "The timeline",
      async describe(ctx) {
        const h = ctx.host;
        const nTracks = h.tracks?.length ?? 0;
        return (
          "A timeline is the cut: tracks stacked over time, clips placed on them, and a render that bakes the whole thing into a single playable file. " +
          `This timeline ("${h.timeline?.name ?? "Untitled"}") currently holds ${nTracks} track${
            nTracks === 1 ? "" : "s"
          }. ` +
          "The demo builds the film's cut: a video track with one clip per scene, a score track with the film's music under them, then a draft render of the whole movie."
        );
      },
    },
    {
      id: "tracks-add",
      title: "Lay the tracks",
      async prepare(ctx) {
        ctx.scratch.videoTrack = findTrack(
          ctx.host,
          tl.video_track,
          "video",
        );
        ctx.scratch.audioTrack = findTrack(
          ctx.host,
          tl.audio_track,
          "music",
        );
      },
      async describe(ctx) {
        const vKept = Boolean(ctx.scratch.videoTrack);
        const aKept = Boolean(ctx.scratch.audioTrack);
        return (
          (vKept
            ? `The "${tl.video_track}" video track already exists, so I kept it. `
            : `I'll add the "${tl.video_track}" video track through the page's Add track handler — `) +
          (aKept
            ? `and the "${tl.audio_track}" score track is already there too. `
            : `and the "${tl.audio_track}" music track for the score under the clips. `) +
          "The same track you'd add by hand: a type (video, music) and a name."
        );
      },
      async execute(ctx) {
        const h = ctx.host;
        if (!ctx.scratch.videoTrack) {
          h.newTrackType = "video";
          h.newTrackName = tl.video_track;
          await h._addTrack();
          if (h.error) throw new Error(h.error);
        }
        if (!ctx.scratch.audioTrack) {
          h.newTrackType = "music";
          h.newTrackName = tl.audio_track;
          await h._addTrack();
          if (h.error) throw new Error(h.error);
        }
        // `_addTrack` reloaded the timeline; refresh the track refs.
        ctx.scratch.videoTrack = findTrack(h, tl.video_track, "video");
        ctx.scratch.audioTrack = findTrack(h, tl.audio_track, "music");
        if (!ctx.scratch.videoTrack) {
          throw new Error("the video track was not created");
        }
        ctx.scratch.videoTrackId = ctx.scratch.videoTrack.id;
        ctx.scratch.audioTrackId = ctx.scratch.audioTrack?.id ?? null;
        return { kind: "none" };
      },
    },
    ...clipPlan.map((plan, i) => ({
      id: `clip-${i + 1}`,
      title: clipOk
        ? `Generate + place clip ${i + 1} of ${clipPlan.length}`
        : `Generate + place clip ${i + 1} (no video model — skipped)`,
      async describe() {
        if (!clipOk) {
          return (
            "Your setup has no text-to-video model enabled, so the backend would reject this clip. " +
            "The track and the scene's prompt show exactly what a real run would send; I'll skip the generation. " +
            "Enable a text-to-video model in the Model Manager (or ask the Model Copilot) and re-run the demo to make this step real."
          );
        }
        return (
          `I'll generate scene ${
            i + 1
          }'s clip through the asset-generation API — a text-to-video job from its shot prompt, ` +
          `"${
            plan.shot?.prompt ?? ""
          }" — sized to the scene's ${plan.duration}-second target, then place it on the "${tl.video_track}" track at ${plan.start}s. ` +
          "One clip per scene, placed in order, is the film's spine."
        );
      },
      async execute(ctx) {
        const h = ctx.host;
        if (!clipOk) {
          ctx.scratch.clips = ctx.scratch.clips ?? [];
          ctx.scratch.clips.push({ skipped: true });
          return { kind: "none", skipped: true };
        }
        const trackId = ctx.scratch.videoTrackId;
        if (!trackId) throw new Error("the video track is missing");
        // Reuse the clip if a prior run already produced a version for it.
        const existing = (h.assets ?? []).find(
          (a) => a.unique_slug === plan.slug || a.slug === plan.slug,
        );
        if (existing?.active_version_id) {
          await placeVersion(
            h,
            trackId,
            existing.active_version_id,
            plan.start,
            plan.duration,
          );
          ctx.scratch.clips = ctx.scratch.clips ?? [];
          ctx.scratch.clips.push({ reused: true });
          return {
            kind: "none",
            note: "the clip already existed — placed its current version.",
          };
        }
        const res = await ctx.api.generateAsset({
          kind: "video",
          prompt: plan.shot?.prompt ?? plan.scene.prompt,
          unique_slug: plan.slug,
          display_name: `Lighthouse clip ${i + 1}`,
          asset_type: "video",
          library_scope: "project",
          project_id: h.timeline.project_id,
          candidates: 1,
        });
        if (!res?.job_id) throw new Error("the clip job was not queued");
        ctx.scratch.clips = ctx.scratch.clips ?? [];
        ctx.scratch.clips.push({ job_id: res.job_id });
        return {
          kind: "jobs",
          job_ids: [res.job_id],
          asset_id: res.asset_id,
          trackId,
          start: plan.start,
          duration: plan.duration,
          variant: "clip",
        };
      },
      async poll(ctx, work) {
        return pollJobs(ctx, work);
      },
    })),
    {
      id: "score-generate",
      title: musicOk ? "Generate the score" : "Generate the score (no music model — skipped)",
      async prepare(ctx) {
        // A score on the audio track from a prior run means we already have it.
        ctx.scratch.scoreKept = (ctx.scratch.audioTrack?.items ?? []).length > 0;
      },
      async describe(ctx) {
        if (!musicOk) {
          return (
            "No music model is enabled, so the score generation would be rejected. " +
            "The cut's analysis (length, mood) still shows what a real score prompt would be; I'll skip the generation."
          );
        }
        if (ctx.scratch.scoreKept) {
          return "The score is already on the track from a previous run, so I kept it.";
        }
        return (
          `I'll generate the film's score through the page's score handler — the page first analyzes the cut and the storyboard to synthesize a music prompt, then I set the film's score prompt ` +
          `"${
            film.music?.prompt ?? ""
          }" and generate. The music lands on a fresh score asset for review, and I place it under the clips.`
        );
      },
      async execute(ctx) {
        const h = ctx.host;
        if (!musicOk) {
          return { kind: "none", skipped: true };
        }
        if (ctx.scratch.scoreKept) {
          return { kind: "none", note: "the score is already placed." };
        }
        const trackId = ctx.scratch.audioTrackId;
        if (!trackId) throw new Error("the score track is missing");
        // Exercise the real "Suggest score" handler (populates the panel),
        // then set the film's authored score prompt so the generation is the
        // film's music, not the auto-synthesized suggestion.
        await h._loadScoreSuggestion();
        h.scorePrompt = film.music?.prompt ?? h.scorePrompt;
        await h._generateScore();
        if (h.scoreError) throw new Error(h.scoreError);
        const job = h.scoreResult;
        if (!job?.job_id) throw new Error("the score job was not queued");
        return {
          kind: "jobs",
          job_ids: [job.job_id],
          asset_id: job.asset_id,
          trackId,
          start: 0,
          duration: totalDuration,
          variant: "score",
        };
      },
      async poll(ctx, work) {
        return pollJobs(ctx, work);
      },
    },
    {
      id: "timeline-render",
      title: "Draft-render the movie",
      async prepare(ctx) {
        ctx.scratch.renderKept = (ctx.host.exports ?? []).length > 0;
      },
      async describe(ctx) {
        const placed = (ctx.scratch.clips ?? []).filter((c) => !c.skipped).length;
        if (!placed) {
          return (
            "No clips were placed (no video model), so there's nothing to render. " +
            "The tracks and the score prompt show the full cut; enable a video model and re-run to make the render real."
          );
        }
        if (ctx.scratch.renderKept) {
          return "A render export already exists on the project, so I kept it.";
        }
        return (
          `I'll draft-render the whole cut through the page's render button using the "${tl.render_preset}" preset — ` +
          `${placed} clip${placed === 1 ? "" : "s"} on the video track${
            musicOk ? " plus the score" : ""
          }, baked into one playable file. The draft preset targets 720p, so it runs fast; the page saves the finished export on the project.`
        );
      },
      async execute(ctx) {
        const h = ctx.host;
        const placed = (ctx.scratch.clips ?? []).filter((c) => !c.skipped).length;
        if (!placed) {
          return { kind: "none", skipped: true };
        }
        if (ctx.scratch.renderKept) {
          return { kind: "none", note: "a render export already exists." };
        }
        h.renderPresetId = tl.render_preset;
        await h._queueRender();
        if (h.renderError) throw new Error(h.renderError);
        const job = h.renderJob;
        if (!job?.id) throw new Error("the render job was not queued");
        return { kind: "render", render_id: job.id };
      },
      async poll(ctx, work) {
        return pollRender(ctx, work);
      },
    },
    {
      id: "timeline-done",
      title: "The movie is rendered",
      async prepare(ctx) {
        await ctx.host._load();
      },
      async describe(ctx) {
        const h = ctx.host;
        const placed = (ctx.scratch.clips ?? []).filter((c) => !c.skipped).length;
        const reused = (ctx.scratch.clips ?? []).filter((c) => c.reused).length;
        const hasExport = (h.exports ?? []).length > 0;
        return (
          `The cut is complete: the "${tl.video_track}" track holds ${placed} scene clip${
            placed === 1 ? "" : "s"
          }${
            reused ? ` (${reused} reused from a prior run)` : ""
          }, the "${tl.audio_track}" track holds the film's score, and the draft render ${
            hasExport ? "is saved as an export on the project" : "finished"
          } — the film plays start to finish. ` +
          "This is the last stop in the pipeline: the movie the earlier demos planned, boarded, shot, and scored now exists as a rendered file."
        );
      },
    },
  ];
}
