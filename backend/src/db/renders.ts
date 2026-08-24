import { getDb } from "./database.ts";
import { badRequest, conflict, notFound } from "../errors.ts";
import { getProjectAccessible } from "./projects.ts";
import { getTimeline } from "./timelines.ts";
import { hasAssetPermission } from "./assets.ts";
import { emitRenderProgress, emitRenderStatus } from "../services/job_events.ts";

export const RENDER_STATUSES = [
  "queued",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type RenderStatus = (typeof RENDER_STATUSES)[number];

export const TERMINAL_RENDER_STATUSES = ["succeeded", "failed", "cancelled"];

export interface RenderPreset {
  id: string;
  name: string;
  kind: string;
  output_format: string;
  resolution: string | null;
  frame_rate: number | null;
  codec: string | null;
  audio_codec: string | null;
  bitrate: string | null;
  settings: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface RenderJob {
  id: string;
  project_id: string;
  timeline_id: string;
  preset_id: string | null;
  engine: string | null;
  status: RenderStatus;
  progress: number;
  error_text: string | null;
  output_path: string | null;
  validation_report: Record<string, unknown> | null;
  created_by_user_id: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface RenderEvent {
  id: string;
  render_job_id: string;
  level: string;
  message: string;
  created_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value as string);
  } catch {
    return null;
  }
}

export function rowToPreset(row: Record<string, unknown>): RenderPreset {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as string,
    output_format: row.output_format as string,
    resolution: (row.resolution as string | null) ?? null,
    frame_rate: asNum(row.frame_rate),
    codec: (row.codec as string | null) ?? null,
    audio_codec: (row.audio_codec as string | null) ?? null,
    bitrate: (row.bitrate as string | null) ?? null,
    settings: parseJson(row.settings_json),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function rowToRenderJob(row: Record<string, unknown>): RenderJob {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    timeline_id: row.timeline_id as string,
    preset_id: (row.preset_id as string | null) ?? null,
    engine: (row.engine as string | null) ?? null,
    status: row.status as RenderStatus,
    progress: asNum(row.progress) ?? 0,
    error_text: (row.error_text as string | null) ?? null,
    output_path: (row.output_path as string | null) ?? null,
    validation_report: parseJson(row.validation_report_json),
    created_by_user_id: Number(row.created_by_user_id),
    created_at: row.created_at as string,
    started_at: (row.started_at as string | null) ?? null,
    finished_at: (row.finished_at as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Idempotently (re-)insert the default presets. Migration 0010 seeds new
 * databases, but test setups that wipe rows via resetDb() need this to
 * restore the seed data.
 */
export function ensureDefaultPresets(): void {
  const db = getDb();
  db.exec(
    `INSERT OR IGNORE INTO render_presets
     (id, name, kind, output_format, resolution, frame_rate, codec, audio_codec, bitrate, settings_json, created_at, updated_at)
     VALUES
     ('preset-draft', 'Draft 720p30', 'draft', 'mp4', '1280x720', 30, 'h264', 'aac', '5000k', NULL, datetime('now'), datetime('now')),
     ('preset-final', 'Final 1080p60', 'final', 'mp4', '1920x1080', 60, 'h264', 'aac', '12000k', NULL, datetime('now'), datetime('now')),
     ('preset-audio', 'Audio WAV', 'final', 'wav', NULL, NULL, NULL, NULL, NULL, NULL, datetime('now'), datetime('now')),
     ('preset-master', 'Master 1080p60 (HQ)', 'final', 'mp4', '1920x1080', 60, 'h264', 'aac', '25000k', '{"crf":17,"preset":"slow","pix_fmt":"yuv420p"}', datetime('now'), datetime('now')),
     ('preset-hdr', 'HDR 1080p60 (HEVC HLG)', 'final', 'mp4', '1920x1080', 60, 'hevc', 'aac', '25000k', '{"crf":20,"preset":"slow","pix_fmt":"yuv420p10le","color":{"primaries":"bt2020","transfer":"arib-std-b67","space":"bt2020nc"}}', datetime('now'), datetime('now'))`,
  );
}

export const PRESET_OUTPUT_FORMATS = ["mp4", "mov", "wav"];
export const PRESET_VIDEO_CODECS = ["h264", "hevc"];
const RESOLUTION_RE = /^\d{2,5}x\d{2,5}$/;

/**
 * Validate the field values of a (new) preset before it can be stored.
 * The engine understands exactly these formats/codecs, so anything else
 * would queue a render that can never produce the promised output —
 * reject it at creation time instead.
 */
export function validatePresetFields(input: PresetInput): void {
  const format = input.output_format.trim().toLowerCase();
  if (!PRESET_OUTPUT_FORMATS.includes(format)) {
    throw badRequest(
      `output_format must be one of: ${PRESET_OUTPUT_FORMATS.join(", ")}`,
    );
  }
  if (
    input.codec &&
    !PRESET_VIDEO_CODECS.includes(input.codec.trim().toLowerCase())
  ) {
    throw badRequest(
      `codec must be one of: ${PRESET_VIDEO_CODECS.join(", ")}`,
    );
  }
  if (input.resolution !== undefined && input.resolution !== null) {
    if (!RESOLUTION_RE.test(input.resolution.trim())) {
      throw badRequest("resolution must look like '1920x1080'");
    }
  }
  if (
    input.frame_rate !== undefined && input.frame_rate !== null &&
    (!Number.isFinite(input.frame_rate) || input.frame_rate <= 0 ||
      input.frame_rate > 240)
  ) {
    throw badRequest("frame_rate must be a number between 0 and 240");
  }
}

export function listPresets(): RenderPreset[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM render_presets ORDER BY kind, name",
  ).all() as Record<string, unknown>[];
  return rows.map(rowToPreset);
}

export function getPreset(id: string): RenderPreset | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM render_presets WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToPreset(row) : undefined;
}

export interface PresetInput {
  name: string;
  kind: "draft" | "final";
  output_format: string;
  resolution?: string;
  frame_rate?: number;
  codec?: string;
  audio_codec?: string;
  bitrate?: string;
  settings?: Record<string, unknown>;
}

export function createPreset(adminUserId: number, input: PresetInput): RenderPreset {
  if (!input.name?.trim()) throw badRequest("name is required");
  if (input.kind !== "draft" && input.kind !== "final") {
    throw badRequest("kind must be 'draft' or 'final'");
  }
  if (!input.output_format?.trim()) throw badRequest("output_format is required");
  validatePresetFields(input);
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO render_presets (
      id, name, kind, output_format, resolution, frame_rate, codec,
      audio_codec, bitrate, settings_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name.trim(),
    input.kind,
    input.output_format.trim().toLowerCase(),
    input.resolution ?? null,
    input.frame_rate ?? null,
    input.codec ?? null,
    input.audio_codec ?? null,
    input.bitrate ?? null,
    input.settings ? JSON.stringify(input.settings) : null,
    now,
    now,
  );
  logAudit(adminUserId, "render.preset.create", id, { name: input.name });
  return getPreset(id) as RenderPreset;
}

// ---------------------------------------------------------------------------
// Render jobs
// ---------------------------------------------------------------------------

export function getRenderJob(
  id: string,
  userId: number,
): RenderJob | undefined {
  const job = rawGetRenderJob(id);
  if (!job) return undefined;
  if (!getProjectAccessible(job.project_id, userId, "read")) return undefined;
  return job;
}

export function rawGetRenderJob(id: string): RenderJob | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM render_jobs WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToRenderJob(row) : undefined;
}

export function listRenderJobs(
  userId: number,
  filter: { project_id?: string; status?: string; limit?: number } = {},
): RenderJob[] {
  const db = getDb();
  if (filter.status && !RENDER_STATUSES.includes(filter.status as RenderStatus)) {
    throw badRequest(`status must be one of: ${RENDER_STATUSES.join(", ")}`);
  }
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.project_id) {
    clauses.push("project_id = ?");
    params.push(filter.project_id);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const rows = (
    db.prepare(
      `SELECT * FROM render_jobs ${where} ORDER BY created_at DESC LIMIT ?`,
    ).all as (...values: unknown[]) => unknown[]
  )(...params, limit) as Record<string, unknown>[];
  return rows
    .map(rowToRenderJob)
    .filter((j) => getProjectAccessible(j.project_id, userId, "read") !== undefined);
}

export function addRenderEvent(
  jobId: string,
  level: "info" | "warn" | "error",
  message: string,
): void {
  const db = getDb();
  db.prepare(
    "INSERT INTO render_events (id, render_job_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(crypto.randomUUID(), jobId, level, message, nowIso());
}

export function listRenderEvents(
  jobId: string,
  userId: number,
): RenderEvent[] {
  if (!rawGetRenderJob(jobId)) throw notFound("Render job not found");
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM render_events WHERE render_job_id = ? ORDER BY created_at, id",
  ).all(jobId) as Record<string, unknown>[];
  void userId;
  return rows.map((row) => ({
    id: row.id as string,
    render_job_id: row.render_job_id as string,
    level: row.level as string,
    message: row.message as string,
    created_at: row.created_at as string,
  }));
}

export interface RenderInput {
  project_id: string;
  timeline_id: string;
  preset_id?: string;
}

export function createRenderJob(
  userId: number,
  input: RenderInput,
): RenderJob {
  if (!input.timeline_id) throw badRequest("timeline_id is required");
  const timeline = getTimeline(input.timeline_id, userId, "write");
  if (!timeline) throw notFound("Timeline not found");
  if (timeline.project_id !== input.project_id) {
    throw conflict("timeline belongs to a different project");
  }
  if (input.preset_id) {
    if (!getPreset(input.preset_id)) throw notFound("Preset not found");
  }
  // At least one renderable video item is required.
  const db = getDb();
  const itemRow = db.prepare(
    `SELECT COUNT(*) AS n FROM timeline_items i
       JOIN tracks t ON t.id = i.track_id
       WHERE i.timeline_id = ? AND i.status != 'archived'
         AND (t.track_type = 'video' OR t.track_type = 'overlay')`,
  ).get(input.timeline_id) as unknown as { n: number };
  if (itemRow.n < 1) {
    throw badRequest("Timeline has no renderable video items");
  }
  // The producing user must be able to read at least the first item's file.
  const firstVersion = db.prepare(
    `SELECT i.asset_version_id FROM timeline_items i
       JOIN tracks t ON t.id = i.track_id
       WHERE i.timeline_id = ? AND i.status != 'archived'
         AND (t.track_type = 'video' OR t.track_type = 'overlay')
       ORDER BY i.start_time LIMIT 1`,
  ).get(input.timeline_id) as unknown as { asset_version_id: string };
  const versionAsset = db.prepare(
    "SELECT asset_id FROM asset_versions WHERE id = ?",
  ).get(firstVersion.asset_version_id) as { asset_id: string };
  if (!hasAssetPermission(userId, versionAsset.asset_id, "read")) {
    throw badRequest("You do not have permission to read the timeline media");
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO render_jobs (
      id, project_id, timeline_id, preset_id, engine, status, progress,
      error_text, output_path, validation_report_json, created_by_user_id,
      created_at, started_at, finished_at
    ) VALUES (?, ?, ?, ?, NULL, 'queued', 0, NULL, NULL, NULL, ?, ?, NULL, NULL)`,
  ).run(
    id,
    timeline.project_id,
    timeline.id,
    input.preset_id ?? null,
    userId,
    now,
  );
  addRenderEvent(id, "info", "Render job created");
  logAudit(userId, "render.create", id, { timeline_id: timeline.id });
  emitRenderStatus(id, "queued");
  return rawGetRenderJob(id) as RenderJob;
}

/** Claim the oldest queued job for this owner (lease guard prevents races). */
export function claimRenderJob(
  owner: string,
  leaseSeconds: number,
): RenderJob | undefined {
  const db = getDb();
  const row = db.prepare(
    `SELECT id FROM render_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1`,
  ).get() as unknown as { id: string } | undefined;
  if (!row) return undefined;
  const now = nowIso();
  const expires = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  db.prepare(
    `UPDATE render_jobs
      SET status = 'running', started_at = ?, lease_owner = ?, lease_expires_at = ?
      WHERE id = ? AND status = 'queued'`,
  ).run(now, owner, expires, row.id);
  const job = rawGetRenderJob(row.id);
  if (job && job.status === "running") emitRenderStatus(job.id, "running");
  return job;
}

export function updateRenderProgress(jobId: string, progress: number): void {
  const clamped = Math.max(0, Math.min(100, progress));
  const db = getDb();
  db.prepare(
    `UPDATE render_jobs SET progress = ? WHERE id = ? AND status = 'running'`,
  ).run(clamped, jobId);
  emitRenderProgress(jobId, clamped);
}

export function finishRenderJob(
  id: string,
  status: "succeeded" | "failed" | "cancelled" | "cancelling",
  fields: {
    errorText?: string;
    outputPath?: string;
    validationReport?: Record<string, unknown>;
    engine?: string;
    progress?: number;
  } = {},
): RenderJob | undefined {
  const db = getDb();
  const now = nowIso();
  if (status === "cancelling") {
    db.prepare(
      "UPDATE render_jobs SET status = 'cancelling' WHERE id = ? AND status = 'running'",
    ).run(id);
  } else {
    // Guarded so a late finish/cancel cannot clobber a terminal state.
    db.prepare(
      `UPDATE render_jobs
       SET status = ?, progress = ?, error_text = ?, output_path = ?,
           validation_report_json = ?, engine = COALESCE(?, engine),
           finished_at = ?
       WHERE id = ? AND status IN ('queued', 'running', 'cancelling')`,
    ).run(
      status,
      status === "succeeded" ? 100 : (fields.progress ?? 0),
      fields.errorText ?? null,
      fields.outputPath ?? null,
      fields.validationReport ? JSON.stringify(fields.validationReport) : null,
      fields.engine ?? null,
      now,
      id,
    );
  }
  const job = rawGetRenderJob(id);
  if (job && job.status === status) {
    addRenderEvent(
      id,
      status === "succeeded" ? "info" : "error",
      status === "succeeded"
        ? "Render completed"
        : `Render ${status}${fields.errorText ? `: ${fields.errorText}` : ""}`,
    );
    emitRenderStatus(id, status);
  }
  return job;
}

export function cancelRenderJob(id: string): RenderJob | undefined {
  const job = rawGetRenderJob(id);
  if (!job) return undefined;
  if (TERMINAL_RENDER_STATUSES.includes(job.status)) {
    throw conflict(`Render is already ${job.status}`);
  }
  if (job.status === "queued") {
    return finishRenderJob(id, "cancelled", { progress: 0 });
  }
  return finishRenderJob(id, "cancelling");
}

/** Re-queue running jobs whose lease expired (crash/restart recovery). */
export function recoverStaleRenderJobs(owner: string): number {
  const db = getDb();
  const now = nowIso();
  const stale = db.prepare(
    `SELECT id FROM render_jobs
     WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`,
  ).all(now) as unknown as { id: string }[];
  for (const row of stale) {
    db.prepare(
      `UPDATE render_jobs
       SET status = 'queued', started_at = NULL, lease_owner = NULL,
           lease_expires_at = NULL
       WHERE id = ? AND status = 'running'`,
    ).run(row.id);
    addRenderEvent(row.id, "warn", "Lease expired; job recovered to queue");
    emitRenderStatus(row.id, "queued");
  }
  void owner;
  return stale.length;
}

function logAudit(
  userId: number,
  action: string,
  id: string,
  data: Record<string, unknown> = {},
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, data_json, created_at)
     VALUES (?, ?, ?, 'render', ?, ?, ?)`,
  ).run(crypto.randomUUID(), userId, action, id, JSON.stringify(data), nowIso());
}
