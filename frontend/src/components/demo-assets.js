// The Assets page demo (docs/demo.md) — drives asset-list's real handlers:
// `_openPanel()` + the nested <asset-generate> form's `_submit()`. Pure data →
// functions; no DOM of its own.
import { DEMO_FILM } from "./demo-content.js";

const GEN_WAIT_MS = 4000;
const GEN_POLL_MS = 50;

/** Resolve the nested <asset-generate> element once it has rendered. */
async function genElement(ctx) {
  const start = Date.now();
  for (;;) {
    const el = ctx.host.renderRoot?.querySelector?.("asset-generate");
    if (el) return el;
    if (Date.now() - start > GEN_WAIT_MS) {
      throw new Error("the Generate panel did not render in time");
    }
    await new Promise((r) => setTimeout(r, GEN_POLL_MS));
  }
}

/**
 * Build the Assets page demo steps.
 *
 * For each demo asset the demo fills the real Generate form (kind, asset
 * type, name, slug, scope, prompt, candidate count — model left on auto) and
 * submits through the form's own handler, then follows the job to success.
 * With no enabled text-to-image model the forms are still filled and shown;
 * the submit is announced and skipped.
 *
 * @param {object} host the <asset-list> element
 * @param {object} preflight demoPreflight() result
 */
export function buildAssetDemoSteps(host, preflight) {
  const assets = DEMO_FILM.assets;
  const tasks = Object.fromEntries((preflight?.tasks ?? []).map((t) => [t.key, t]));
  const genTask = tasks.assets ?? {};
  const modelOk = genTask.ok !== false;

  const steps = [
    {
      id: "assets-intro",
      title: "The asset library",
      async describe(ctx) {
        const inProject = Boolean(ctx.host.projectId);
        return (
          "Assets are the building blocks a movie is assembled from — characters, locations, props, images, video, audio. " +
          "Each asset is a named, versioned container: the active version is the one everything renders, and the grid below shows it with a thumbnail. " +
          (inProject
            ? "Because you're inside a project, assets can be scoped to this project or kept in the global library. "
            : "Assets can be global (this library) or project-scoped (open a project's Assets page). ") +
          "Any prompt in the app can mention an asset as @slug — the reference resolves to its active version at run time. " +
          "That's how the storyboard demo composes its panels."
        );
      },
    },
    {
      id: "assets-panel",
      title: "Open the Generate panel",
      async prepare(ctx) {
        const h = ctx.host;
        if (h.panel !== "generate") h._openPanel("generate");
        ctx.scratch.gen = await genElement(ctx);
      },
      async describe() {
        return (
          "The Generate panel is the prompt-to-asset path: a prompt plus a model (and optionally references, candidate count, seed, quality profile) " +
          "creates a new asset and queues a generation job — the job monitor up top follows it live. " +
          "Opening an existing asset's detail page switches this same form into edit mode, which makes new versions of that asset. " +
          "Now I'll fill it in for the first reference asset, the lighthouse."
        );
      },
    },
  ];

  for (const a of assets) {
    steps.push(
      {
        id: `assets-fill-${a.slug}`,
        title: `Fill in the ${a.display_name} form`,
        async prepare(ctx) {
          const gen = ctx.scratch.gen;
          // Demo mode skips the interactive VRAM dialog; the runner's own
          // live GPU/CPU auto-fallback still applies to the job.
          gen.vramBypass = true;
          gen.kind = a.kind;
          gen.assetType = a.asset_type;
          gen.displayName = a.display_name;
          gen.prompt = a.prompt;
          gen.slug = a.slug;
          gen.slugTouched = true; // the slug is the @reference handle — keep it
          gen.scope = ctx.host.projectId ? "project" : "global";
          gen.selectedProject = String(ctx.host.projectId ?? "");
          gen.modelId = ""; // auto: the backend's first enabled model for the task
          gen.seed = "";
          gen.candidates = 1;
          gen.profile = "";
          gen.references = [];
          gen.includeCurrent = false;
        },
        async describe(ctx) {
          return (
            `The real form's fields: kind "image", asset type "${a.asset_type}", display name "${a.display_name}", and the unique slug ` +
            `@${a.slug} — that slug is the handle every other prompt uses to reference this asset. ` +
            `Scope is ${
              ctx.host.projectId
                ? "project, so it lives under this project"
                : "global, so it lives in this library"
            }. ` +
            "Model is left on auto (the backend picks the first enabled text-to-image model); I asked for 1 candidate — " +
            "with 2 or more, the review board would let you approve the best of them. " +
            `Prompt: "${a.prompt}"`
          );
        },
      },
      {
        id: `assets-gen-${a.slug}`,
        title: modelOk
          ? `Generate the ${a.display_name}`
          : `The ${a.display_name} (no model — skipped)`,
        async describe() {
          if (!modelOk) {
            return (
              "Your setup has no enabled text-to-image model, so this submit would be rejected by the backend. " +
              "The filled form above shows exactly what a real run would send; I'll skip the generation. " +
              "Enable a model in the Model Manager (or ask the Model Copilot) and re-run the demo to make this step real."
            );
          }
          return (
            "Submitting through the form's real handler — the same validation you'd get by hand — then the asset row is created and a generation job is queued. " +
            "The progress line here is the job's; the job monitor shows it too."
          );
        },
        async execute(ctx) {
          if (!modelOk) {
            ctx.scratch.generated = ctx.scratch.generated ?? {};
            ctx.scratch.generated[a.slug] = { skipped: true };
            return { kind: "none", skipped: true };
          }
          const gen = ctx.scratch.gen;
          await gen._submit();
          if (gen.error) throw new Error(gen.error);
          const queued = gen.queuedResult;
          if (!queued?.job_id) throw new Error("the generation job was not queued");
          ctx.scratch.generated = ctx.scratch.generated ?? {};
          ctx.scratch.generated[a.slug] = { asset_id: queued.asset_id, job_id: queued.job_id };
          return { kind: "jobs", job_ids: [queued.job_id] };
        },
        async poll(ctx, work) {
          const job = await ctx.api.getJob(work.job_ids[0]);
          if (job.status === "failed") {
            return { failed: true, error: job.error_text || "generation job failed" };
          }
          if (job.status === "cancelled") {
            return { failed: true, error: "the generation job was cancelled" };
          }
          if (job.status === "succeeded") {
            const meta = ctx.scratch.generated[a.slug];
            let detail = "";
            try {
              const asset = await ctx.api.getAsset(meta.asset_id);
              if (asset?.active_version_id) {
                detail =
                  " A new version was created and set active — that's what the grid shows and what @references resolve to.";
              }
            } catch {
              // The asset read is a nicety; the job's success is the fact.
            }
            return { done: true, result: { asset_id: meta.asset_id }, note: detail };
          }
          const pct = typeof job.progress === "number" ? ` (${Math.round(job.progress)}%)` : "";
          return { progress: job.progress ?? null, note: `job ${job.status}${pct}` };
        },
      },
    );
  }

  steps.push({
    id: "assets-done",
    title: "Reference assets ready",
    async prepare(ctx) {
      await ctx.host._load(true); // silent refresh — the new cards appear now
    },
    async describe(ctx) {
      const made = Object.values(ctx.scratch.generated ?? {}).filter((g) => !g.skipped).length;
      const skipped = assets.length - made;
      return (
        "The grid re-fetched itself as the jobs settled (this page subscribes to job events). " +
        `That leaves ${made} ${made === 1 ? "asset" : "assets"} ready` +
        (skipped > 0 ? ` (${skipped} skipped — no model enabled)` : "") +
        ". Any prompt in the app can now mention @lighthouse, @keeper, @boat; the reference resolves to the asset's active version at run time. " +
        "Open one of the new assets to see its detail page — versions, the generation's provenance (prompt / model / seed), A/B compare, and Used in. " +
        "Next stop in the pipeline: the storyboard, which turns the script's scenes into image panels using exactly these references."
      );
    },
  });

  return steps;
}
