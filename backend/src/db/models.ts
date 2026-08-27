import { getDb } from "./database.ts";
import { badRequest, conflict } from "../errors.ts";

export const MODEL_BACKENDS = ["mock", "local_cli", "comfyui", "local_http"] as const;
export type ModelBackend = (typeof MODEL_BACKENDS)[number];

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
export type ModelTaskType = (typeof MODEL_TASK_TYPES)[number];

// HuggingFace pipeline tags use dashes for the image/video family (e.g.
// "image-to-image"). The Model Copilot (and manual API calls) may echo those
// names, so the validation boundaries accept them and normalize to the
// canonical underscore forms stored in the database.
export const TASK_TYPE_ALIASES: Record<string, ModelTaskType> = {
  "text-to-image": "text_to_image",
  "image-to-image": "image_to_image",
  "image-to-video": "image_to_video",
  "text-to-video": "text_to_video",
};

export function canonicalTaskType(task: string): ModelTaskType | null {
  if (MODEL_TASK_TYPES.includes(task as ModelTaskType)) return task as ModelTaskType;
  return TASK_TYPE_ALIASES[task] ?? null;
}

export const MODEL_SOURCES = ["local", "url", "mock"] as const;
export type ModelSource = (typeof MODEL_SOURCES)[number];

export interface Model {
  id: string;
  name: string;
  version: string;
  source: string | null;
  repository_url: string | null;
  source_path: string | null;
  file_hash: string | null;
  license: string | null;
  backend: ModelBackend;
  task_types: string[];
  input_types: string[];
  output_types: string[];
  supported_resolutions: string[] | null;
  supported_frame_rates: number[] | null;
  supported_duration: number[] | null;
  vram_requirement_mb: number | null;
  ram_requirement_mb: number | null;
  dependencies: string[];
  default_settings: Record<string, unknown>;
  known_limitations: string[] | null;
  enabled: boolean;
  installed_at: string | null;
  last_used_at: string | null;
  health_status: string | null;
  health_error: string | null;
  health_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegisterModelInput {
  name: string;
  version: string;
  backend: ModelBackend;
  /** Explicit model id (defaults to a UUID). */
  id?: string;
  source?: ModelSource;
  repository_url?: string;
  source_path?: string;
  license?: string;
  task_types?: string[];
  input_types?: string[];
  output_types?: string[];
  supported_resolutions?: string[];
  supported_frame_rates?: number[];
  supported_duration?: number[];
  vram_requirement_mb?: number;
  ram_requirement_mb?: number;
  dependencies?: string[];
  default_settings?: Record<string, unknown>;
  known_limitations?: string[];
  enabled?: boolean;
}

export interface UpdateModelInput {
  name?: string;
  version?: string;
  license?: string;
  backend?: ModelBackend;
  repository_url?: string;
  source_path?: string;
  task_types?: string[];
  input_types?: string[];
  output_types?: string[];
  supported_resolutions?: string[];
  supported_frame_rates?: number[];
  supported_duration?: number[];
  vram_requirement_mb?: number;
  ram_requirement_mb?: number;
  dependencies?: string[];
  default_settings?: Record<string, unknown>;
  known_limitations?: string[];
  enabled?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (value === null || value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    return fallback;
  }
  return value as string[];
}

function asNumberArray(value: unknown): number[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "number")) {
    return null;
  }
  return value as number[];
}

export function rowToModel(row: Record<string, unknown>): Model {
  return {
    id: row.id as string,
    name: row.name as string,
    version: row.version as string,
    source: asNullableString(row.source),
    repository_url: asNullableString(row.repository_url),
    source_path: asNullableString(row.source_path),
    file_hash: asNullableString(row.file_hash),
    license: asNullableString(row.license),
    backend: row.backend as ModelBackend,
    task_types: JSON.parse((row.task_types_json as string) ?? "[]"),
    input_types: JSON.parse((row.input_types_json as string) ?? "[]"),
    output_types: JSON.parse((row.output_types_json as string) ?? "[]"),
    supported_resolutions: asStringArray(
      row.supported_resolutions_json === null
        ? null
        : JSON.parse(row.supported_resolutions_json as string),
      [],
    ),
    supported_frame_rates: asNumberArray(
      row.supported_frame_rates_json === null
        ? null
        : JSON.parse(row.supported_frame_rates_json as string),
    ),
    supported_duration: asNumberArray(
      row.supported_duration_json === null
        ? null
        : JSON.parse(row.supported_duration_json as string),
    ),
    vram_requirement_mb: asNullableNumber(row.vram_requirement_mb),
    ram_requirement_mb: asNullableNumber(row.ram_requirement_mb),
    dependencies: JSON.parse((row.dependencies_json as string) ?? "[]"),
    default_settings: JSON.parse((row.default_settings_json as string) ?? "{}"),
    known_limitations: asStringArray(
      row.known_limitations_json === null ? null : JSON.parse(row.known_limitations_json as string),
      [],
    ),
    enabled: row.enabled === 1,
    installed_at: asNullableString(row.installed_at),
    last_used_at: asNullableString(row.last_used_at),
    health_status: asNullableString(row.health_status),
    health_error: asNullableString(row.health_error),
    health_checked_at: asNullableString(row.health_checked_at),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function validateTaskTypes(value: string[] | undefined, field: string): string[] {
  if (value === undefined) return [];
  const canonical: string[] = [];
  for (const task of value) {
    const mapped = canonicalTaskType(task);
    if (!mapped) {
      throw badRequest(
        `${field} contains unknown task type: ${task}. Allowed: ${MODEL_TASK_TYPES.join(", ")}`,
      );
    }
    if (!canonical.includes(mapped)) canonical.push(mapped);
  }
  return canonical;
}

/** Fail fast on backends whose adapter cannot run without required
 * default_settings (mirrors the runtime checks in services/adapters.ts). */
function validateBackendSettings(
  backend: string,
  settings: Record<string, unknown>,
): void {
  if (backend === "local_cli") {
    const command = settings.command;
    if (typeof command !== "string" || command.trim() === "") {
      throw badRequest(
        "local_cli models require a 'command' string in default_settings " +
          "(the executable run per candidate; use 'args' for {prompt}/{seed}/{output} placeholders)",
      );
    }
  } else if (backend === "comfyui") {
    const endpoint = settings.endpoint;
    if (typeof endpoint !== "string" || !/^https?:\/\/.+/i.test(endpoint)) {
      throw badRequest(
        "comfyui models require an 'endpoint' http(s) URL in default_settings " +
          "(the ComfyUI server address)",
      );
    }
    const workflow = settings.workflow;
    if (
      typeof workflow !== "object" || workflow === null ||
      Array.isArray(workflow) || Object.keys(workflow).length === 0
    ) {
      throw badRequest(
        "comfyui models require a non-empty 'workflow' object in default_settings",
      );
    }
  }
}

function logAudit(
  userId: number,
  action: string,
  entityId: string,
  data: Record<string, unknown>,
): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, data_json, created_at)
     VALUES (?, ?, ?, 'model', ?, ?, ?)`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    userId,
    action,
    entityId,
    JSON.stringify(data),
    nowIso(),
  );
}

export function getModel(id: string): Model | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM models WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToModel(row) : undefined;
}

export interface ListModelsFilter {
  enabled?: boolean;
  task_type?: string;
  query?: string;
}

export function listModels(filter: ListModelsFilter = {}): Model[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.enabled !== undefined) {
    clauses.push("enabled = ?");
    params.push(filter.enabled ? 1 : 0);
  }
  if (filter.query) {
    clauses.push("(name LIKE ? OR version LIKE ? OR license LIKE ?)");
    const like = `%${filter.query}%`;
    params.push(like, like, like);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (
    db.prepare(`SELECT * FROM models ${where} ORDER BY name, version`)
      .all as (...values: unknown[]) => unknown[]
  )(...params) as Record<string, unknown>[];
  let models = rows.map(rowToModel);
  if (filter.task_type) {
    models = models.filter((m) => m.task_types.includes(filter.task_type as string));
  }
  return models;
}

/** Task mapping (MOD-008): models that can run a given task. */
export function findModelsForTask(taskType: string, enabledOnly = true): Model[] {
  return listModels(enabledOnly ? { enabled: true } : {}).filter((m) =>
    m.task_types.includes(taskType)
  );
}

export function registerModel(
  userId: number,
  input: RegisterModelInput,
): Model {
  if (!input.name?.trim()) throw badRequest("name is required");
  if (!input.version?.trim()) throw badRequest("version is required");
  if (!MODEL_BACKENDS.includes(input.backend)) {
    throw badRequest(
      `backend must be one of: ${MODEL_BACKENDS.join(", ")}`,
    );
  }
  if (input.source !== undefined && !MODEL_SOURCES.includes(input.source)) {
    throw badRequest(`source must be one of: ${MODEL_SOURCES.join(", ")}`);
  }
  const taskTypes = validateTaskTypes(input.task_types, "task_types");
  validateBackendSettings(input.backend, input.default_settings ?? {});

  const db = getDb();
  let id: string;
  if (input.id !== undefined) {
    if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(input.id)) {
      throw badRequest(
        "id must be 1-100 chars of lowercase letters, digits, '_' or '-' " +
          "and start alphanumeric",
        "id",
      );
    }
    if (getModel(input.id)) {
      throw conflict(`A model with id '${input.id}' is already registered`, "id");
    }
    id = input.id;
  } else {
    id = crypto.randomUUID();
  }
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO models (
      id, name, version, source, repository_url, source_path, file_hash,
      license, backend, task_types_json, input_types_json, output_types_json,
      supported_resolutions_json, supported_frame_rates_json,
      supported_duration_json, vram_requirement_mb, ram_requirement_mb,
      dependencies_json, default_settings_json, known_limitations_json,
      enabled, installed_at, last_used_at, health_status, health_error,
      health_checked_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
      NULL, NULL, NULL, NULL, ?, ?)`,
  );
  (insert.run as (...params: unknown[]) => unknown)(
    id,
    input.name.trim(),
    input.version.trim(),
    input.source ?? null,
    input.repository_url ?? null,
    input.source_path ?? null,
    input.license ?? null,
    input.backend,
    JSON.stringify(taskTypes),
    JSON.stringify(input.input_types ?? []),
    JSON.stringify(input.output_types ?? []),
    JSON.stringify(input.supported_resolutions ?? null),
    JSON.stringify(input.supported_frame_rates ?? null),
    JSON.stringify(input.supported_duration ?? null),
    input.vram_requirement_mb ?? null,
    input.ram_requirement_mb ?? null,
    JSON.stringify(input.dependencies ?? []),
    JSON.stringify(input.default_settings ?? {}),
    JSON.stringify(input.known_limitations ?? null),
    input.enabled === false ? 0 : 1,
    now,
    now,
  );
  logAudit(userId, "model.register", id, {
    name: input.name,
    version: input.version,
    backend: input.backend,
    task_types: taskTypes,
  });
  return getModel(id) as Model;
}

export function updateModel(
  userId: number,
  id: string,
  patch: UpdateModelInput,
): Model | undefined {
  const existing = getModel(id);
  if (!existing) return undefined;

  if (patch.backend !== undefined && !MODEL_BACKENDS.includes(patch.backend)) {
    throw badRequest(`backend must be one of: ${MODEL_BACKENDS.join(", ")}`);
  }
  // Only re-validate the adapter contract when the caller actually touches the
  // settings or the backend — otherwise an unrelated edit (e.g. task types) on
  // an already-misconfigured model would be blocked by its existing settings.
  if (patch.default_settings !== undefined || patch.backend !== undefined) {
    validateBackendSettings(
      patch.backend ?? existing.backend,
      patch.default_settings ?? existing.default_settings,
    );
  }
  const taskTypes = patch.task_types !== undefined
    ? validateTaskTypes(patch.task_types, "task_types")
    : existing.task_types;

  const fields: Record<string, unknown> = {
    name: patch.name ?? existing.name,
    version: patch.version ?? existing.version,
    license: patch.license !== undefined ? patch.license : existing.license,
    backend: patch.backend ?? existing.backend,
    repository_url: patch.repository_url !== undefined
      ? patch.repository_url
      : existing.repository_url,
    source_path: patch.source_path !== undefined ? patch.source_path : existing.source_path,
    task_types_json: JSON.stringify(taskTypes),
    input_types_json: JSON.stringify(patch.input_types ?? existing.input_types),
    output_types_json: JSON.stringify(patch.output_types ?? existing.output_types),
    supported_resolutions_json: JSON.stringify(
      patch.supported_resolutions !== undefined
        ? patch.supported_resolutions
        : existing.supported_resolutions,
    ),
    supported_frame_rates_json: JSON.stringify(
      patch.supported_frame_rates !== undefined
        ? patch.supported_frame_rates
        : existing.supported_frame_rates,
    ),
    supported_duration_json: JSON.stringify(
      patch.supported_duration !== undefined
        ? patch.supported_duration
        : existing.supported_duration,
    ),
    vram_requirement_mb: patch.vram_requirement_mb !== undefined
      ? patch.vram_requirement_mb
      : existing.vram_requirement_mb,
    ram_requirement_mb: patch.ram_requirement_mb !== undefined
      ? patch.ram_requirement_mb
      : existing.ram_requirement_mb,
    dependencies_json: JSON.stringify(patch.dependencies ?? existing.dependencies),
    default_settings_json: JSON.stringify(
      patch.default_settings ?? existing.default_settings,
    ),
    known_limitations_json: JSON.stringify(
      patch.known_limitations !== undefined ? patch.known_limitations : existing.known_limitations,
    ),
    enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
    updated_at: nowIso(),
  };

  const db = getDb();
  const keys = Object.keys(fields);
  const setSql = keys.map((k) => `${k} = ?`).join(", ");
  const stmt = db.prepare(`UPDATE models SET ${setSql} WHERE id = ?`);
  (stmt.run as (...params: unknown[]) => unknown)(
    ...Object.values(fields),
    id,
  );

  const set: Record<string, unknown> = {
    id,
    task_types: patch.task_types,
    enabled: patch.enabled,
  };
  logAudit(userId, patch.enabled === false ? "model.disable" : "model.update", id, set);
  return getModel(id);
}

export function deleteModel(userId: number, id: string): boolean {
  const existing = getModel(id);
  if (!existing) return false;
  const db = getDb();
  // SQLite FK enforcement is off in this app, so remove benchmark rows
  // explicitly (the migration's ON DELETE CASCADE is declarative only).
  deleteBenchmarkResults(id);
  db.prepare("DELETE FROM models WHERE id = ?").run(id);
  logAudit(userId, "model.remove", id, { name: existing.name });
  return true;
}

export function setModelInstalled(
  id: string,
  fileHash: string,
): Model | undefined {
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE models SET file_hash = ?, installed_at = ?, updated_at = ? WHERE id = ?",
  );
  (stmt.run as (...params: unknown[]) => unknown)(fileHash, nowIso(), nowIso(), id);
  return getModel(id);
}

export function setModelHealth(
  id: string,
  status: "ok" | "error",
  error: string | null,
): Model | undefined {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE models SET health_status = ?, health_error = ?, health_checked_at = ?,
     updated_at = ? WHERE id = ?`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(
    status,
    error,
    nowIso(),
    nowIso(),
    id,
  );
  return getModel(id);
}

export function touchModelLastUsed(id: string): void {
  const db = getDb();
  db.prepare("UPDATE models SET last_used_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), id);
}

/* ------------------------------------------------------------------ *
 * Model benchmarks (WS 14: model benchmark)
 * ------------------------------------------------------------------ */

export interface ModelBenchmarkResult {
  id: string;
  model_id: string;
  task_type: string;
  benchmarked_at: string;
  duration_ms: number;
  candidate_count: number;
  output_bytes: number;
  seed: string | null;
  job_id: string | null;
}

export interface CreateBenchmarkInput {
  model_id: string;
  task_type: string;
  duration_ms: number;
  candidate_count: number;
  output_bytes: number;
  seed?: string | null;
  job_id?: string | null;
}

function rowToBenchmarkRow(row: Record<string, unknown>): ModelBenchmarkResult {
  return {
    id: row.id as string,
    model_id: row.model_id as string,
    task_type: row.task_type as string,
    benchmarked_at: row.benchmarked_at as string,
    duration_ms: row.duration_ms as number,
    candidate_count: row.candidate_count as number,
    output_bytes: row.output_bytes as number,
    seed: asNullableString(row.seed),
    job_id: asNullableString(row.job_id),
  };
}

export function createBenchmarkResult(input: CreateBenchmarkInput): ModelBenchmarkResult {
  const db = getDb();
  const result: ModelBenchmarkResult = {
    id: crypto.randomUUID(),
    model_id: input.model_id,
    task_type: input.task_type,
    benchmarked_at: nowIso(),
    duration_ms: input.duration_ms,
    candidate_count: input.candidate_count,
    output_bytes: input.output_bytes,
    seed: input.seed ?? null,
    job_id: input.job_id ?? null,
  };
  (db.prepare(
    `INSERT INTO model_benchmarks (
      id, model_id, task_type, benchmarked_at, duration_ms,
      candidate_count, output_bytes, seed, job_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    result.id,
    result.model_id,
    result.task_type,
    result.benchmarked_at,
    result.duration_ms,
    result.candidate_count,
    result.output_bytes,
    result.seed,
    result.job_id,
  );
  return result;
}

export function listBenchmarkResults(
  modelId: string,
  limit = 20,
): ModelBenchmarkResult[] {
  const db = getDb();
  const rows = (db.prepare(
    `SELECT * FROM model_benchmarks
      WHERE model_id = ?
      ORDER BY benchmarked_at DESC, rowid DESC
      LIMIT ?`,
  ).all(modelId, limit)) as Record<string, unknown>[];
  return rows.map(rowToBenchmarkRow);
}

export function deleteBenchmarkResults(modelId: string): void {
  getDb().prepare("DELETE FROM model_benchmarks WHERE model_id = ?").run(modelId);
}
