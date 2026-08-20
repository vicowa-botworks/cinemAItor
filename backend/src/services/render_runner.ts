import { join } from "@std/path";
import { loadConfig } from "../config.ts";
import { getDb } from "../db/database.ts";
import {
  addRenderEvent,
  cancelRenderJob,
  claimRenderJob,
  finishRenderJob,
  getPreset,
  listRenderEvents,
  rawGetRenderJob,
  recoverStaleRenderJobs,
  type RenderJob,
  type RenderPreset,
  updateRenderProgress,
} from "../db/renders.ts";
import { listItems, listTracks } from "../db/timelines.ts";
import { createAsset, createAssetVersion, getAssetBySlug, getAssetVersion } from "../db/assets.ts";
import { getContentStore } from "../storage/content_store.ts";
import {
  getRenderEngine,
  RenderCancelledError,
  RenderFailedError,
  type RenderPlan,
} from "./render_engine.ts";

export interface RenderRunnerOptions {
  pollMs?: number;
  leaseSeconds?: number;
}

export interface RenderRunner {
  readonly owner: string;
  stop(): Promise<void>;
}

export function startRenderRunner(
  options: RenderRunnerOptions = {},
): RenderRunner {
  const pollMs = options.pollMs ?? 250;
  const leaseSeconds = options.leaseSeconds ?? 300;
  const owner = `render-${Deno.pid}-${Math.random().toString(36).slice(2, 8)}`;
  let stopping = false;
  const executing: Promise<void>[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule(): void {
    if (stopping) return;
    timer = setTimeout(() => {
      poll();
    }, pollMs);
    (timer as { unref?: () => void }).unref?.();
  }

  function poll(): void {
    if (stopping) return;
    recoverStaleRenderJobs(owner);
    const job = claimRenderJob(owner, leaseSeconds);
    if (job) {
      addRenderEvent(job.id, "info", "Render started");
      const task = executeJob(job).catch(() => undefined);
      executing.push(task);
      task.finally(() => {
        const i = executing.indexOf(task);
        if (i >= 0) executing.splice(i, 1);
      });
    }
    schedule();
  }

  async function executeJob(job: RenderJob): Promise<void> {
    try {
      const preset = (job.preset_id ? getPreset(job.preset_id) : defaultPreset()) ?? null;
      const plan = await buildPlan(job, preset);
      const engine = getRenderEngine();

      // Real engine: verify the timeline's media files exist first.
      if (engine.name !== "mock") {
        for (const item of plan.items) {
          try {
            await Deno.stat(item.file_path);
          } catch {
            throw new RenderFailedError(`Media file not found: ${item.file_path}`);
          }
        }
      }

      updateRenderProgress(job.id, 0);
      const result = await engine.render(plan, {
        onProgress: (p) => updateRenderProgress(job.id, p),
        isCancelled: () => rawGetRenderJob(job.id)?.status === "cancelling",
      });

      const report = validateOutput(plan, result.output_path);
      const exportRow = await recordExport(job, preset, plan, result);
      finishRenderJob(job.id, "succeeded", {
        outputPath: result.output_path,
        validationReport: report,
        engine: engine.name,
      });
      addRenderEvent(
        job.id,
        "info",
        `Export ${exportRow.id} (${plan.format}, ${result.file_size} bytes)`,
      );
    } catch (err) {
      if (err instanceof RenderCancelledError) {
        finishRenderJob(job.id, "cancelled");
        addRenderEvent(job.id, "info", "Render cancelled");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        finishRenderJob(job.id, "failed", {
          errorText: message,
          engine: getRenderEngine().name,
        });
        addRenderEvent(job.id, "error", message);
      }
    }
  }

  schedule();

  return {
    owner,
    stop(): Promise<void> {
      stopping = true;
      if (timer) clearTimeout(timer);
      return Promise.allSettled(executing).then(() => undefined);
    },
  };
}

function defaultPreset(): RenderPreset | null {
  return getPreset("preset-final") ?? getPreset("preset-draft") ?? null;
}

async function buildPlan(
  job: RenderJob,
  preset: RenderPreset | null,
): Promise<RenderPlan> {
  const tracks = listTracks(job.timeline_id, job.created_by_user_id);
  const items = listItems(job.timeline_id, job.created_by_user_id);
  const renderableTrackIds = tracks
    .filter((t) => (t.track_type === "video" || t.track_type === "overlay") && !t.locked)
    .map((t) => t.id);

  const planItems = items
    .filter((i) => i.status !== "archived" && renderableTrackIds.includes(i.track_id))
    .sort((a, b) => a.start_time - b.start_time || a.id.localeCompare(b.id))
    .map((i) => {
      const version = getAssetVersion(i.asset_version_id);
      if (!version?.file_path) {
        throw new RenderFailedError(
          `No file for asset version ${i.asset_version_id}`,
        );
      }
      return {
        file_path: version.file_path,
        start_time: i.start_time,
        end_time: i.end_time,
        duration: Math.max(0.01, i.end_time - i.start_time),
        transition: i.transition ?? "cut",
        transition_duration: i.transition_duration,
        fade_in: i.fade_in ?? 0,
        fade_out: i.fade_out ?? 0,
        color_grade: i.color_grade as Record<string, number> | null,
      };
    });
  if (planItems.length === 0) {
    throw new RenderFailedError("Timeline has no renderable video items");
  }

  const config = loadConfig();
  const outDir = join(config.appDataDir, "projects", job.project_id, "output");
  await Deno.mkdir(outDir, { recursive: true });
  const filename = `render-${job.id.slice(0, 8)}.${preset?.output_format ?? "mp4"}`;
  return {
    output_path: join(outDir, filename),
    filename,
    format: preset?.output_format ?? "mp4",
    preset,
    items: planItems,
    total_duration: planItems.reduce((sum, i) => sum + i.duration, 0),
  };
}

function validateOutput(
  plan: RenderPlan,
  outputPath: string,
): Record<string, unknown> {
  const checks: Record<string, boolean> = {};
  let stat;
  try {
    stat = Deno.statSync(outputPath);
  } catch (err) {
    throw new RenderFailedError(
      `Validation failed: output missing (${err instanceof Error ? err.message : err})`,
    );
  }
  checks.exists = true;
  checks.non_empty = stat.size > 0;
  checks.format_match = plan.filename.endsWith(`.${plan.format}`);
  if (!checks.non_empty || !checks.format_match) {
    throw new RenderFailedError("Validation failed: output file is empty or mismatched");
  }
  const report: Record<string, unknown> = {
    ok: true,
    format: plan.format,
    items: plan.items.length,
    file_size: stat.size,
    checks,
  };
  return report;
}

async function recordExport(
  job: RenderJob,
  preset: RenderPreset | null,
  plan: RenderPlan,
  result: { output_path: string; file_size: number },
): Promise<{ id: string; format: string }> {
  const now = new Date().toISOString();
  const store = getContentStore();
  const stored = await store.put(result.output_path, plan.filename);

  // One asset per render job; re-renders append a version to it.
  const slug = `render_${job.id.slice(0, 8)}`;
  const asset = getAssetBySlug(slug) ?? createAsset(
    {
      unique_slug: slug,
      display_name: `Render ${job.id.slice(0, 8)}`,
      asset_type: plan.format === "wav" ? "audio" : "video",
      library_scope: "project",
      project_id: job.project_id,
    },
    job.created_by_user_id,
  );
  const provenance = {
    render: {
      render_job_id: job.id,
      timeline_id: job.timeline_id,
      preset: preset ? { id: preset.id, name: preset.name, kind: preset.kind } : null,
      engine: getRenderEngine().name,
      format: plan.format,
      items: plan.items.length,
      total_duration: plan.total_duration,
      file_sha256: stored.hash,
      exported_at: now,
    },
  };
  const version = createAssetVersion(asset.id, job.created_by_user_id, {
    content_hash: stored.hash,
    file_path: stored.path,
    format: plan.format,
    mime_type: plan.format === "wav" ? "audio/wav" : "video/mp4",
    file_size: stored.size,
    technical_metadata_json: JSON.stringify(provenance),
    make_active: true,
  });

  const exportId = crypto.randomUUID();
  const db = getDb();
  db.prepare(
    `INSERT INTO exports (id, project_id, render_job_id, asset_id, asset_version_id, file_path, format, settings_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    exportId,
    job.project_id,
    job.id,
    asset.id,
    version.id,
    stored.path,
    plan.format,
    JSON.stringify({ preset: preset?.id ?? null, engine: getRenderEngine().name }),
    now,
  );
  return { id: exportId, format: plan.format };
}

export { cancelRenderJob, listRenderEvents };
