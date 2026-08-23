import { getDb } from "./database.ts";
import { badRequest } from "../errors.ts";
import { emitJobProgress, emitJobStatus } from "../services/job_events.ts";

export const JOB_STATUSES = [
  "queued",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_JOB_STATUSES: JobStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

export const MODEL_TASK_TYPES = [
  "text_to_image",
  "image_to_image",
  "image_to_video",
  "text_to_video",
  "audio",
  "music",
  "voice",
  "transcribe",
] as const;

export interface GenerationJob {
  id: string;
  project_id: string | null;
  asset_id: string | null;
  scene_id: string | null;
  shot_id: string | null;
  storyboard_panel_id: string | null;
  job_type: string;
  model_id: string | null;
  model_version: string | null;
  prompt_version_id: string | null;
  prompt_text: string | null;
  negative_prompt: string | null;
  seed: string | null;
  settings: Record<string, unknown>;
  input_asset_versions: { asset_id: string; version_number: number }[];
  reference_roles: Record<string, string> | null;
  status: JobStatus;
  progress: number;
  error_text: string | null;
  output_asset_version_id: string | null;
  candidate_count: number | null;
  candidate_version_ids: string[] | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_by_user_id: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobEvent {
  id: string;
  job_id: string;
  event_type: string;
  message: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

/** Job type for queued proxy/media processing (no model involved). */
export const PROXY_JOB_TYPE = "proxy";

/** Job type for audio cleanup passes (denoise/normalize; no model involved). */
export const AUDIO_CLEANUP_JOB_TYPE = "audio_cleanup";

export interface CreateJobInput {
  project_id?: string;
  asset_id?: string;
  scene_id?: string;
  shot_id?: string;
  storyboard_panel_id?: string;
  job_type: string;
  model_id?: string;
  model_version?: string;
  prompt_version_id?: string;
  prompt_text?: string;
  negative_prompt?: string;
  seed?: string;
  settings?: Record<string, unknown>;
  input_asset_versions?: { asset_id: string; version_number: number }[];
  reference_roles?: Record<string, string>;
}

export interface ListJobsFilter {
  status?: JobStatus;
  project_id?: string;
  model_id?: string;
  job_type?: string;
  limit?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function rowToJob(row: Record<string, unknown>): GenerationJob {
  return {
    id: row.id as string,
    project_id: asNullableString(row.project_id),
    asset_id: asNullableString(row.asset_id),
    scene_id: asNullableString(row.scene_id),
    shot_id: asNullableString(row.shot_id),
    storyboard_panel_id: asNullableString(row.storyboard_panel_id),
    job_type: row.job_type as string,
    model_id: asNullableString(row.model_id),
    model_version: asNullableString(row.model_version),
    prompt_version_id: asNullableString(row.prompt_version_id),
    prompt_text: asNullableString(row.prompt_text),
    negative_prompt: asNullableString(row.negative_prompt),
    seed: asNullableString(row.seed),
    settings: JSON.parse((row.settings_json as string) ?? "{}"),
    input_asset_versions: JSON.parse(
      (row.input_asset_versions_json as string) ?? "[]",
    ),
    reference_roles: row.reference_roles_json === null
      ? null
      : JSON.parse(row.reference_roles_json as string),
    status: row.status as JobStatus,
    progress: typeof row.progress === "number" ? row.progress : 0,
    error_text: asNullableString(row.error_text),
    output_asset_version_id: asNullableString(row.output_asset_version_id),
    candidate_count: row.candidate_count === null ? null : Number(row.candidate_count),
    candidate_version_ids: row.candidate_version_ids === null
      ? null
      : JSON.parse(row.candidate_version_ids as string),
    lease_owner: asNullableString(row.lease_owner),
    lease_expires_at: asNullableString(row.lease_expires_at),
    created_by_user_id: row.created_by_user_id === null ? null : Number(row.created_by_user_id),
    created_at: row.created_at as string,
    started_at: asNullableString(row.started_at),
    finished_at: asNullableString(row.finished_at),
  };
}

export function getJob(id: string): GenerationJob | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM generation_jobs WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToJob(row) : undefined;
}

export function listJobs(filter: ListJobsFilter = {}): GenerationJob[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  if (filter.project_id) {
    clauses.push("project_id = ?");
    params.push(filter.project_id);
  }
  if (filter.model_id) {
    clauses.push("model_id = ?");
    params.push(filter.model_id);
  }
  if (filter.job_type) {
    clauses.push("job_type = ?");
    params.push(filter.job_type);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const rows = (
    db.prepare(
      `SELECT * FROM generation_jobs ${where}
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    ).all as (...values: unknown[]) => unknown[]
  )(...params, limit) as Record<string, unknown>[];
  return rows.map(rowToJob);
}

export function addJobEvent(
  jobId: string,
  eventType: string,
  message: string | null = null,
  data: Record<string, unknown> | null = null,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO job_events (id, job_id, event_type, message, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    jobId,
    eventType,
    message,
    data ? JSON.stringify(data) : null,
    nowIso(),
  );
}

export function listJobEvents(jobId: string): JobEvent[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at, rowid",
  ).all(jobId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    job_id: row.job_id as string,
    event_type: row.event_type as string,
    message: asNullableString(row.message),
    data: row.data_json === null ? null : JSON.parse(row.data_json as string),
    created_at: row.created_at as string,
  }));
}

export function createJob(userId: number, input: CreateJobInput): GenerationJob {
  if (input.job_type === PROXY_JOB_TYPE || input.job_type === AUDIO_CLEANUP_JOB_TYPE) {
    // Media-engine jobs run ffmpeg directly; no model involved.
  } else {
    if (
      !MODEL_TASK_TYPES.includes(
        input.job_type as (typeof MODEL_TASK_TYPES)[number],
      )
    ) {
      throw badRequest(
        `job_type must be one of: ${
          MODEL_TASK_TYPES.join(", ")
        } or ${PROXY_JOB_TYPE} or ${AUDIO_CLEANUP_JOB_TYPE}`,
      );
    }
    if (!input.model_id) throw badRequest("model_id is required");
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO generation_jobs (
      id, project_id, asset_id, scene_id, shot_id, storyboard_panel_id,
      job_type, model_id, model_version, prompt_version_id, prompt_text,
      negative_prompt, seed, settings_json, input_asset_versions_json,
      reference_roles_json, status, progress, error_text,
      output_asset_version_id, candidate_count, lease_owner, lease_expires_at,
      created_by_user_id, created_at, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0,
      NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL)`,
  );
  (insert.run as (...params: unknown[]) => unknown)(
    id,
    input.project_id ?? null,
    input.asset_id ?? null,
    input.scene_id ?? null,
    input.shot_id ?? null,
    input.storyboard_panel_id ?? null,
    input.job_type,
    input.model_id ?? null,
    input.model_version ?? null,
    input.prompt_version_id ?? null,
    input.prompt_text ?? null,
    input.negative_prompt ?? null,
    input.seed ?? null,
    JSON.stringify(input.settings ?? {}),
    JSON.stringify(input.input_asset_versions ?? []),
    input.reference_roles ? JSON.stringify(input.reference_roles) : null,
    userId,
    now,
  );
  addJobEvent(id, "created", "Job created", { user_id: userId, job_type: input.job_type });
  emitJobStatus(id, "queued");
  return getJob(id) as GenerationJob;
}

/** Claim the oldest queued job with a lease. Returns undefined when idle. */
export function claimJob(
  owner: string,
  leaseSeconds: number,
): GenerationJob | undefined {
  const db = getDb();
  const now = nowIso();
  const expires = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const candidate = db.prepare(
    `SELECT id FROM generation_jobs
       WHERE status = 'queued'
       ORDER BY created_at, rowid
       LIMIT 1`,
  ).get() as { id: string } | undefined;
  if (!candidate) return undefined;
  // status guard makes the claim safe against double-claims.
  const updated = db.prepare(
    `UPDATE generation_jobs
     SET status = 'running', progress = 0, lease_owner = ?, lease_expires_at = ?,
         started_at = ?
     WHERE id = ? AND status = 'queued'`,
  );
  (updated.run as (...params: unknown[]) => unknown)(
    owner,
    expires,
    now,
    candidate.id,
  );
  const job = statusOf(candidate.id) === "running" ? getJob(candidate.id) : undefined;
  if (job) {
    addJobEvent(job.id, "started", "Job started", { owner });
    emitJobStatus(job.id, "running");
  }
  return job;
}

function statusOf(id: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT status FROM generation_jobs WHERE id = ?")
    .get(id) as { status: string } | undefined;
  return row?.status ?? null;
}

export function updateJobProgress(id: string, progress: number): void {
  const db = getDb();
  const clamped = Math.min(Math.max(progress, 0), 100);
  db.prepare(
    "UPDATE generation_jobs SET progress = ? WHERE id = ? AND status = 'running'",
  ).run(clamped, id);
  emitJobProgress(id, clamped);
}

export function finishJob(
  id: string,
  status: "succeeded" | "failed" | "cancelled" | "cancelling",
  fields: {
    errorText?: string;
    outputAssetVersionId?: string;
    candidateCount?: number;
    candidateVersionIds?: string[];
    progress?: number;
  } = {},
): GenerationJob | undefined {
  const db = getDb();
  const now = nowIso();
  if (status === "cancelling") {
    db.prepare(
      `UPDATE generation_jobs SET status = 'cancelling' WHERE id = ?
       AND status = 'running'`,
    ).run(id);
  } else {
    // Guarded so a late cancel/finish cannot clobber a terminal state (and
    // vice versa); the event below only fires if the transition happened.
    db.prepare(
      `UPDATE generation_jobs
       SET status = ?, progress = ?, error_text = ?, output_asset_version_id = ?,
           candidate_count = ?, finished_at = ?, lease_owner = NULL,
           lease_expires_at = NULL, candidate_version_ids = ?
       WHERE id = ? AND status IN ('queued', 'running', 'cancelling')`,
    ).run(
      status,
      status === "succeeded" ? 100 : (fields.progress ?? 0),
      fields.errorText ?? null,
      fields.outputAssetVersionId ?? null,
      fields.candidateCount ?? null,
      now,
      fields.candidateVersionIds ? JSON.stringify(fields.candidateVersionIds) : null,
      id,
    );
  }
  const job = getJob(id);
  if (job && job.status === status) {
    addJobEvent(
      id,
      status,
      status === "succeeded"
        ? "Job completed"
        : status === "failed"
        ? (fields.errorText ?? "Job failed")
        : status === "cancelling"
        ? "Cancellation requested"
        : "Job cancelled",
    );
    emitJobStatus(id, status);
  }
  return job;
}

/** Failed/cancelled jobs keep their input state and can be re-queued. */
export function retryJob(id: string): GenerationJob | undefined {
  const job = getJob(id);
  if (!job) return undefined;
  if (!TERMINAL_JOB_STATUSES.includes(job.status)) {
    throw badRequest(
      `Only finished jobs can be retried (current status: ${job.status})`,
    );
  }
  const db = getDb();
  db.prepare(
    `UPDATE generation_jobs
     SET status = 'queued', progress = 0, error_text = NULL,
         lease_owner = NULL, lease_expires_at = NULL,
          output_asset_version_id = NULL, candidate_count = NULL,
          candidate_version_ids = NULL,
          started_at = NULL, finished_at = NULL
      WHERE id = ?
       AND status IN ('succeeded', 'failed', 'cancelled')`,
  ).run(id);
  const updated = getJob(id);
  if (updated && updated.status === "queued") {
    addJobEvent(id, "retried", "Job re-queued for retry");
    emitJobStatus(id, "queued");
  }
  return updated;
}

export function countRunningJobs(): { gpu: number; cpu: number } {
  const db = getDb();
  // Proxy jobs have no model; they run on the CPU lane (ffmpeg transcode).
  const rows = db.prepare(
    `SELECT COALESCE(m.backend, 'mock') AS backend FROM generation_jobs j
       LEFT JOIN models m ON m.id = j.model_id
       WHERE j.status IN ('running', 'cancelling')`,
  ).all() as unknown as { backend: string }[];
  return {
    gpu: rows.filter((r) => r.backend !== "mock").length,
    cpu: rows.filter((r) => r.backend === "mock").length,
  };
}

/**
 * Job recovery (GEN-017): after a restart, running jobs whose lease expired
 * are queued again. Returns the recovered job ids.
 */
export function recoverStaleJobs(leaseGraceSeconds = 5): string[] {
  const db = getDb();
  const now = new Date(Date.now() - leaseGraceSeconds * 1000).toISOString();
  const rows = db.prepare(
    `SELECT id FROM generation_jobs
       WHERE status = 'running' AND lease_expires_at IS NOT NULL
         AND lease_expires_at < ?`,
  ).all(now) as unknown as { id: string }[];
  for (const row of rows) {
    db.prepare(
      `UPDATE generation_jobs
       SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
           started_at = NULL
       WHERE id = ?`,
    ).run(row.id);
    addJobEvent(row.id, "recovered", "Lease expired; job re-queued");
    emitJobStatus(row.id, "queued");
  }
  return rows.map((r) => r.id);
}
