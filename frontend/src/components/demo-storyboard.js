// The Storyboard page demo (docs/demo.md) — drives storyboard-detail's real
// handlers: `_addPanel()`, `_toggleExpand()` + `_setDraftField()` +
// `_savePanel()`, `_savePrompt()`, and `_generatePreview()`. Pure data →
// functions; no DOM of its own.
import { DEMO_FILM } from "./demo-content.js";

/**
 * Build the Storyboard page demo steps.
 *
 * The demo works on the board that is already open (the route needs a board
 * id). It adds the film's four panels through the page's real create/edit
 * handlers, then previews each one through the page's own preview path —
 * which resolves each prompt's @reference tokens to the referenced assets'
 * active versions, auto-enhances the prompt first when the page's
 * auto-enhance settings are on, and links the finished image back to the
 * panel.
 *
 * With no enabled text-to-image model the panels are still created and
 * filled; the previews are announced and skipped.
 *
 * @param {object} host the <storyboard-detail> element
 * @param {object} preflight demoPreflight() result
 */
export function buildStoryboardDemoSteps(host, preflight) {
  const film = DEMO_FILM;
  const tasks = Object.fromEntries(
    (preflight?.tasks ?? []).map((t) => [t.key, t]),
  );
  const previewOk = (tasks.assets ?? {}).ok !== false;

  const steps = [
    {
      id: "board-intro",
      title: "The storyboard",
      async describe(ctx) {
        const h = ctx.host;
        const n = h.panels?.length ?? 0;
        return (
          "A storyboard is the film's visual plan: one image panel per moment the camera will cover. " +
          `This board ("${h.board?.name ?? "Untitled"}") currently holds ${n} panel${
            n === 1 ? "" : "s"
          }; ` +
          `I'll add the ${film.panels.length} panels the demo screenplay calls for, in order. ` +
          "Each panel carries a prompt — and those prompts use @reference tokens to the Assets demo's " +
          "@lighthouse, @keeper and @boat. At run time each token resolves to that asset's active version, " +
          "so the same lighthouse in every panel comes from the same image. " +
          "If a referenced asset doesn't exist yet (the Assets demo hasn't run on this install), the " +
          "reference is flagged broken and the panel simply generates without it. " +
          "When a panel's preview is ready, it becomes the first frame the Scenes page animates " +
          "(image-to-video) — that link is what makes the whole pipeline cohere."
        );
      },
    },
  ];

  film.panels.forEach((panel, i) => {
    const n = i + 1;
    steps.push(
      {
        id: `panel-${n}`,
        title: `Add panel ${n}: ${panel.name}`,
        async describe(ctx) {
          const has = (ctx.scratch.panels ?? []).some((p) => !p.skipped);
          return (
            `Panel ${n} of ${film.panels.length} — "${panel.name}" (scene ${panel.scene_index} of the screenplay). ` +
            `I'll create it with the page's Add panel handler, fill its description, and save its prompt: ` +
            `"${panel.prompt}" ` +
            "Both saves go through the panel's real edit handlers — the same validation and prompt-versioning you'd get by hand. " +
            (has
              ? ""
              : "Watch the panel card expand, get filled, and collapse again — that's the normal edit flow, driven for you.")
          );
        },
        async execute(ctx) {
          const h = ctx.host;
          const before = h.panels?.length ?? 0;
          await h._addPanel();
          if (h.error) throw new Error(h.error);
          const created = [...(h.panels ?? [])].sort((a, b) => b.panel_order - a.panel_order)[0];
          if (!created || h.panels.length <= before) {
            throw new Error("the panel was not created");
          }
          ctx.scratch.panels = ctx.scratch.panels ?? [];
          ctx.scratch.panels.push({ film: panel, id: created.id });
          await h._toggleExpand(created);
          h._setDraftField("description", panel.name);
          await h._savePanel(created);
          if (h.error) {
            throw new Error(h.error);
          }
          const saved = (h.panels ?? []).find((p) => p.id === created.id) ??
            created;
          await h._savePrompt(saved, panel.prompt);
          if (h.error) throw new Error(h.error);
          return { kind: "none", panel_id: created.id };
        },
      },
      {
        id: `panel-preview-${n}`,
        title: previewOk
          ? `Preview panel ${n} (text-to-image)`
          : `Preview panel ${n} (no model — skipped)`,
        async prepare(ctx) {
          const h = ctx.host;
          // Demo mode skips the interactive VRAM dialog; the runner's own
          // live GPU/CPU auto-fallback still applies to the job.
          h.vramBypass = true;
          if (preflight?.llm_configured) {
            // Show the page's own auto-enhance settings doing their job:
            // the preview path rewrites the panel prompt through the LLM
            // with the picked model's skills before queueing.
            h._setEnhancePref("autoEnhance", true);
            h._setEnhancePref("autoSkill", true);
          }
        },
        async describe(ctx) {
          if (!previewOk) {
            return (
              "Your setup has no enabled text-to-image model, so this submit would be rejected by the backend. " +
              "The filled panel above shows exactly what a real run would send; I'll skip the generation. " +
              "Enable a model in the Model Manager (or ask the Model Copilot) and re-run the demo to make this step real."
            );
          }
          const entry = (ctx.scratch.panels ?? [])[i];
          const refs = (entry?.film.prompt.match(/@[a-z0-9_]+/gi) ?? []).join(
            ", ",
          );
          return (
            "The preview is the panel's text-to-image job: the page resolves the prompt's @references" +
            (refs ? ` (${refs}) ` : " ") +
            "to asset versions, and — because I switched on this page's auto-enhance settings" +
            (preflight?.llm_configured ? "" : " when your LLM assistant is configured") +
            " — it first rewrites the prompt with the chosen model's skills, then queues one job. " +
            "When it succeeds, the runner links the produced image back to the panel: the card shows the preview, " +
            "and the Scenes page can animate it. Demo mode skips the interactive VRAM dialog; the job itself " +
            "still gets the runner's live GPU/CPU fallback."
          );
        },
        async execute(ctx) {
          const h = ctx.host;
          const entry = (ctx.scratch.panels ?? [])[i];
          if (!previewOk) {
            ctx.scratch.previews = ctx.scratch.previews ?? [];
            ctx.scratch.previews.push({ skipped: true });
            return { kind: "none", skipped: true };
          }
          if (!entry) {
            throw new Error(
              "the panel was not created by the previous step",
            );
          }
          const panel = (h.panels ?? []).find((p) => p.id === entry.id);
          if (!panel) throw new Error("the panel disappeared from the board");
          const result = await h._generatePreview(panel);
          if (h.error) throw new Error(h.error);
          if (!result?.job_id) {
            throw new Error(
              "the preview job was not queued",
            );
          }
          ctx.scratch.previews = ctx.scratch.previews ?? [];
          ctx.scratch.previews.push({
            panel_id: entry.id,
            job_id: result.job_id,
          });
          return { kind: "jobs", job_ids: [result.job_id] };
        },
        async poll(ctx, work) {
          const job = (await ctx.api.getJob(work.job_ids[0])) ?? {};
          if (job.status === "failed") {
            return {
              failed: true,
              error: job.error_text || "preview job failed",
            };
          }
          if (job.status === "cancelled") {
            return { failed: true, error: "the preview job was cancelled" };
          }
          if (job.status === "succeeded") {
            return {
              done: true,
              result: {
                panel_id: work.panel_id ?? null,
                job_id: work.job_ids[0],
              },
              note:
                "The preview is now the panel's image. It doubles as the first frame for this panel's " +
                "scene clip — the Scenes demo animates it image-to-video.",
            };
          }
          const pct = typeof job.progress === "number" ? ` (${Math.round(job.progress)}%)` : "";
          return {
            progress: job.progress ?? null,
            note: `preview job ${job.status}${pct}`,
          };
        },
      },
    );
  });

  steps.push({
    id: "board-done",
    title: "The board is ready",
    async prepare(ctx) {
      await ctx.host._load();
    },
    async describe(ctx) {
      const made = (ctx.scratch.panels ?? []).length;
      const previewed = (ctx.scratch.previews ?? []).filter((p) => !p.skipped).length;
      const skipped = (ctx.scratch.previews ?? []).filter((p) => p.skipped).length;
      return (
        `The board now holds ${made} demo panel${made === 1 ? "" : "s"}` +
        ` — ${previewed} with previews` +
        (skipped > 0 ? ` (${skipped} skipped, no text-to-image model)` : "") +
        ". Open a panel to see its full edit form (shot number, description, mood, lighting, time of day) " +
        "and its prompt history — every save is a new version, like the script's. " +
        "Click a preview to compare versions side by side; the A/B compare even diffs the generation " +
        "provenance (prompt, model, seed). " +
        "Next stop in the pipeline: the Scenes page — it turns each of these panels into a moving clip."
      );
    },
  });

  return steps;
}
