// The Scenes page demo (docs/demo.md) — drives scene-detail's real
// handlers: `_saveSceneFields()` + `_savePrompt()`, `_addShot()` +
// `_toggleShot()` + `_setShotField()` + `_saveShotDraft()`, and
// `_generate()`. Pure data → functions; no DOM of its own.
import { DEMO_FILM } from "./demo-content.js";

// The demo scene's clip prompt opening — marks "the scene already holds the
// demo content" (or the user's own text containing it).
const DEMO_MARKER = "Slow aerial push-in on the lighthouse";

/**
 * Build the Scenes page demo steps.
 *
 * The demo works on the scene that is already open (the route needs a scene
 * id) and treats it as the film's first scene. It fills the scene through
 * the page's real edit handlers, adds the film's first shot, links that shot
 * to a previewed storyboard panel (so clip generation runs image-to-video
 * when an image-to-video model is enabled), then generates one single clip
 * and one batch of shot clips through the page's own generate handlers.
 *
 * With no enabled video model the scene + shot are still filled; the clip
 * generations are announced and skipped.
 *
 * @param {object} host the <scene-detail> element
 * @param {object} preflight demoPreflight() result
 */
export function buildSceneDemoSteps(host, preflight) {
  const film = DEMO_FILM;
  const scene = film.scenes[0];
  const shot = film.shots[0];
  const tasks = Object.fromEntries(
    (preflight?.tasks ?? []).map((t) => [t.key, t]),
  );
  const i2vOk = (tasks.clips ?? {}).ok !== false;
  const clipOk = i2vOk || (tasks.clips_text ?? {}).ok !== false;

  // Shared job polling for the single + batch clip steps: the job rows are
  // the source of truth, and the host's own `_watchJobs` loop links the
  // clips back to the shots/scene in parallel.
  const pollJobs = async (ctx, work) => {
    let done = 0;
    let progressSum = 0;
    let progressN = 0;
    for (const id of work.job_ids) {
      const job = (await ctx.api.getJob(id)) ?? {};
      if (job.status === "failed") {
        return { failed: true, error: job.error_text || "clip job failed" };
      }
      if (job.status === "cancelled") {
        return { failed: true, error: "a clip job was cancelled" };
      }
      if (job.status === "succeeded") {
        done += 1;
      } else if (typeof job.progress === "number") {
        progressSum += job.progress;
        progressN += 1;
      }
    }
    if (done === work.job_ids.length) {
      return {
        done: true,
        result: { job_ids: work.job_ids },
        note: "The clip is linked back to the shot (and the scene) — play it on the shot card. " +
          "This is the moving piece the Timeline places on its video track.",
      };
    }
    const pct = progressN ? ` (${Math.round(progressSum / progressN)}%)` : "";
    const plural = work.job_ids.length === 1 ? "" : "s";
    return {
      progress: progressN ? progressSum / progressN : null,
      note: `clip job${plural} running${pct}`,
    };
  };

  return [
    {
      id: "scene-intro",
      title: "The scene",
      async describe(ctx) {
        const h = ctx.host;
        const n = h.shots?.length ?? 0;
        return (
          "A scene is one stretch of time the camera covers: a name (the script's heading), a description, a target duration, and a generation prompt — motion and lens language, not an image prompt. " +
          `This scene ("${h.scene?.name ?? "Untitled"}") holds ${n} shot${n === 1 ? "" : "s"}. ` +
          "Shots cut the scene into its moments: each carries its own prompt, and each generated shot becomes its own clip. " +
          "The single button generates one clip for the whole scene; the batch button queues one clip per shot. " +
          "When the scene is linked to a storyboard panel with a preview, the jobs run image-to-video off that preview — the picture the Storyboard demo made becomes the clip's first frame."
        );
      },
    },
    {
      id: "scene-fill",
      title: "Fill the scene",
      async prepare(ctx) {
        ctx.scratch.sceneKept = (ctx.host.scene?.prompt?.content ?? "")
          .includes(
            DEMO_MARKER,
          );
      },
      async describe(ctx) {
        return (
          (ctx.scratch.sceneKept
            ? "The scene already holds the demo clip prompt, so I kept it as-is. "
            : `I'll fill the film's first scene through the page's real handlers: the description, a ${scene.target_duration}-second target duration, and the clip prompt — ` +
              `"${scene.prompt}" `) +
          "Both saves version the scene's prompt the same way your own edits do."
        );
      },
      async execute(ctx) {
        const h = ctx.host;
        if (ctx.scratch.sceneKept) return { kind: "none", skipped: true };
        await h._saveSceneFields({
          description: scene.description,
          target_duration: scene.target_duration,
        });
        if (h.error) throw new Error(h.error);
        await h._savePrompt(scene.prompt);
        if (h.error) throw new Error(h.error);
        return { kind: "none" };
      },
    },
    {
      id: "shot-add",
      title: `Add a shot: ${shot.name}`,
      async prepare(ctx) {
        ctx.scratch.shotKept = (ctx.host.shots ?? []).some((s) => s.name === shot.name);
      },
      async describe(ctx) {
        return (
          (ctx.scratch.shotKept
            ? `The shot "${shot.name}" already exists, so I kept it. `
            : `I'll add the scene's first shot through the page's Add shot handler — "${shot.name}" with the prompt ` +
              `"${shot.prompt}" — the same expand, type, save flow you'd use by hand. `) +
          (i2vOk
            ? "I'll also link that shot to a previewed panel on the scene's storyboard (when one exists): the link is what turns clip generation image-to-video, so the clip starts from the panel's picture."
            : "No image-to-video model is enabled, so the shot stays unlinked and the clips will generate text-to-video from the prompts alone.")
        );
      },
      async execute(ctx) {
        const h = ctx.host;
        ctx.scratch.linked = null;
        let shotId = (h.shots ?? []).find((s) => s.name === shot.name)?.id ??
          null;
        if (!shotId) {
          const before = h.shots?.length ?? 0;
          await h._addShot();
          if (h.error) throw new Error(h.error);
          const created = [...(h.shots ?? [])].sort((a, b) => b.shot_order - a.shot_order)[0];
          if (!created || h.shots.length <= before) {
            throw new Error("the shot was not created");
          }
          shotId = created.id;
          await h._toggleShot(created);
          h._setShotField("name", shot.name);
          h._setShotField("prompt", shot.prompt);
          await h._saveShotDraft(created);
          if (h.error) throw new Error(h.error);
        }
        // Link the shot to a previewed panel on the scene's board so the clip
        // jobs can run image-to-video off that preview.
        if (i2vOk && h.scene?.storyboard_id) {
          const board = (await ctx.api.getStoryboard(h.scene.storyboard_id)) ??
            {};
          const panels = [...(board.panels ?? [])].sort(
            (a, b) => a.panel_order - b.panel_order,
          );
          const candidate = panels.find(
            (p) =>
              p.preview_asset_version_id &&
              (p.linked_scene_id == null || p.linked_scene_id === h.scene.id),
          );
          if (candidate) {
            ctx.scratch.linked = {
              panel_id: candidate.id,
              panel_name: candidate.description ||
                `panel ${candidate.panel_order}`,
            };
            if (
              candidate.linked_scene_id !== h.scene.id ||
              candidate.linked_shot_id !== shotId
            ) {
              await ctx.api.updatePanel(h.scene.storyboard_id, candidate.id, {
                linked_scene_id: h.scene.id,
                linked_shot_id: shotId,
              });
            }
          }
        }
        return {
          kind: "none",
          shot_id: shotId,
          linked: Boolean(ctx.scratch.linked),
        };
      },
    },
    {
      id: "clip-single",
      title: clipOk ? "Generate one scene clip" : "Generate one scene clip (no model — skipped)",
      async prepare(ctx) {
        const h = ctx.host;
        // Demo mode skips the interactive VRAM dialog; the runner's own
        // live GPU/CPU auto-fallback still applies to the job.
        h.vramBypass = true;
        if (preflight?.llm_configured) {
          h._setEnhancePref("autoEnhance", true);
          h._setEnhancePref("autoSkill", true);
        }
      },
      async describe(ctx) {
        const h = ctx.host;
        if (!clipOk) {
          return (
            "Your setup has neither an image-to-video nor a text-to-video model enabled, so the backend would reject this submit. " +
            "The filled scene and shot above show exactly what a real run would send; I'll skip the generation. " +
            "Enable a model in the Model Manager (or ask the Model Copilot) and re-run the demo to make this step real."
          );
        }
        const i2v = (await h._sceneTaskType()) === "image_to_video";
        return (
          "The single button queues one clip job for the whole scene. " +
          (i2v
            ? "Because the scene is linked to a storyboard panel with a preview, it runs image-to-video: the panel's picture is the first frame, and the scene prompt drives the motion on top of it. "
            : "With no linked preview, it falls back to text-to-video: the scene prompt alone drives the clip. ") +
          (preflight?.llm_configured
            ? "The page's auto-enhance settings are switched on, so the prompt is first rewritten with the chosen model's skills. "
            : "") +
          "Demo mode skips the interactive VRAM dialog; the job still gets the runner's live GPU/CPU fallback."
        );
      },
      async execute(ctx) {
        const h = ctx.host;
        if (!clipOk) {
          ctx.scratch.clips = ctx.scratch.clips ?? [];
          ctx.scratch.clips.push({ kind: "single", skipped: true });
          return { kind: "none", skipped: true };
        }
        const result = await h._generate(false);
        if (h.error) throw new Error(h.error);
        if (!result?.job_id) throw new Error("the clip job was not queued");
        ctx.scratch.clips = ctx.scratch.clips ?? [];
        ctx.scratch.clips.push({ kind: "single", job_ids: [result.job_id] });
        return { kind: "jobs", job_ids: [result.job_id] };
      },
      async poll(ctx, work) {
        return pollJobs(ctx, work);
      },
    },
    {
      id: "clip-batch",
      title: clipOk ? "Batch-generate the shots" : "Batch-generate the shots (no model — skipped)",
      async describe(ctx) {
        const h = ctx.host;
        if (!clipOk) {
          return (
            "No video model is enabled, so the batch submit would be rejected as well. " +
            "I'll skip it — the scene and shot above already show what a real batch run would send."
          );
        }
        const n = h.shots?.length ?? 0;
        return (
          `The batch button queues one clip job per shot — ${n} shot${
            n === 1 ? "" : "s"
          } on this scene — ` +
          "each using its own prompt where it has one, falling back to the scene's prompt otherwise. " +
          "Shots that can't run (no prompt, no model) come back listed as skipped, not silently dropped."
        );
      },
      async execute(ctx) {
        const h = ctx.host;
        if (!clipOk) {
          ctx.scratch.clips = ctx.scratch.clips ?? [];
          ctx.scratch.clips.push({ kind: "batch", skipped: true });
          return { kind: "none", skipped: true };
        }
        const result = await h._generate(true);
        if (h.error) throw new Error(h.error);
        const jobIds = (result?.jobs ?? []).map((j) => j.job_id);
        if (!jobIds.length) throw new Error("no batch clip jobs were queued");
        ctx.scratch.clips = ctx.scratch.clips ?? [];
        ctx.scratch.clips.push({
          kind: "batch",
          job_ids: jobIds,
          skipped: result.skipped?.length ?? 0,
        });
        return { kind: "jobs", job_ids: jobIds };
      },
      async poll(ctx, work) {
        return pollJobs(ctx, work);
      },
    },
    {
      id: "scene-done",
      title: "The scene is alive",
      async prepare(ctx) {
        await ctx.host._load();
      },
      async describe(ctx) {
        const clips = (ctx.scratch.clips ?? []).filter((c) => !c.skipped);
        const queued = clips.reduce((n, c) => n + (c.job_ids?.length ?? 0), 0);
        const skippedRuns = (ctx.scratch.clips ?? []).filter((c) => c.skipped).length;
        const skippedJobs = clips.reduce((n, c) => n + (c.skipped ?? 0), 0);
        return (
          `The scene now has the film's description, duration and clip prompt saved as versions, and the shot "${shot.name}" with its own prompt` +
          (ctx.scratch.linked
            ? ` — linked to the storyboard panel "${ctx.scratch.linked.panel_name}", whose preview is the clip's first frame`
            : "") +
          `. ${queued} clip job${queued === 1 ? "" : "s"} ran${
            skippedJobs
              ? ` (${skippedJobs} shot${skippedJobs === 1 ? "" : "s"} skipped by the batch)`
              : ""
          }${
            skippedRuns
              ? ` (${skippedRuns} generation${
                skippedRuns === 1 ? "" : "s"
              } skipped, no video model)`
              : ""
          }. ` +
          "Play the finished clips on the shot cards; the scene keeps its own clip for quick playback. " +
          "Next stop in the pipeline: the Timeline demo places these clips on video tracks, adds the score under them, and renders the movie."
        );
      },
    },
  ];
}
