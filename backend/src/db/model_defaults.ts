/**
 * Default model per task type (docs/model_defaults.md).
 *
 * One row per task type in `task_type_defaults` (migration 0032): the model an
 * auto-picked generation request gets when it omits `model_id`. Resolution
 * order is project override > global default > first enabled model, and a
 * default that no longer qualifies (model removed, disabled, or its task types
 * edited) is skipped rather than failing the request.
 */
import { getDb } from "./database.ts";
import { badRequest } from "../errors.ts";
import { logAudit } from "../services/audit.ts";
import {
  canonicalTaskType,
  findModelsForTask,
  getModel,
  type Model,
  MODEL_TASK_TYPES,
} from "./models.ts";

export interface TaskTypeDefault {
  task_type: string;
  model_id: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

interface TaskTypeDefaultRow {
  task_type: string;
  model_id: string;
}

/** A stored default row, or undefined when the task type has none. */
function defaultRow(taskType: string): TaskTypeDefaultRow | undefined {
  const db = getDb();
  return db.prepare("SELECT task_type, model_id FROM task_type_defaults WHERE task_type = ?")
    .get(taskType) as TaskTypeDefaultRow | undefined;
}

/** `{ [taskType]: modelId }` for every stored default. */
export function listTaskTypeDefaults(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare(
    "SELECT task_type, model_id FROM task_type_defaults ORDER BY task_type",
  ).all() as unknown as TaskTypeDefaultRow[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.task_type] = row.model_id;
  return out;
}

/** The model id set as the default for a task type, or null. */
export function getTaskTypeDefault(taskType: string): string | null {
  return defaultRow(taskType)?.model_id ?? null;
}

/**
 * Set (or, with a null `modelId`, clear) the default for one task type.
 *
 * A non-null default must actually be usable for the task: an unknown,
 * disabled, or task-incompatible model is rejected here so the registry can
 * never hold a default that would silently fall through.
 */
export function setTaskTypeDefault(
  userId: number,
  taskType: string,
  modelId: string | null,
): TaskTypeDefault {
  const canonical = canonicalTaskType(taskType);
  if (!canonical) {
    throw badRequest(
      `Unknown task type: ${taskType}. Allowed task types are listed in the model registry.`,
      "task_type",
    );
  }
  const db = getDb();
  if (modelId === null) {
    db.prepare("DELETE FROM task_type_defaults WHERE task_type = ?").run(canonical);
    logAudit(userId, "model.default.clear", "model", canonical, { task_type: canonical });
    return { task_type: canonical, model_id: null };
  }
  const model = getModel(modelId);
  if (!model) throw badRequest(`Model not found: ${modelId}`, "model_id");
  if (!model.enabled) {
    throw badRequest(`Model '${model.name}' is disabled`, "model_id");
  }
  if (!model.task_types.includes(canonical)) {
    throw badRequest(
      `Model '${model.name}' does not support task '${canonical}'`,
      "model_id",
    );
  }
  db.prepare(
    `INSERT INTO task_type_defaults (task_type, model_id, updated_at, updated_by_user_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(task_type) DO UPDATE SET
       model_id = excluded.model_id,
       updated_at = excluded.updated_at,
       updated_by_user_id = excluded.updated_by_user_id`,
  ).run(canonical, model.id, nowIso(), userId);
  logAudit(userId, "model.default.set", "model", model.id, {
    task_type: canonical,
    model_id: model.id,
  });
  return { task_type: canonical, model_id: model.id };
}

/** Drop every default held by a model being removed (FKs are off in this app). */
export function clearTaskTypeDefaultsForModel(modelId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM task_type_defaults WHERE model_id = ?").run(modelId);
}

/**
 * Parse a project's `default_model_preferences_json` into a canonical-keyed
 * `{ [taskType]: modelId }` map. Null entries (explicit clears) and malformed
 * input drop out: a broken preference must never block generation.
 */
export function parseModelPreferences(
  raw: string | null | undefined,
): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string" || value === "") continue;
    const canonical = canonicalTaskType(key) ?? key;
    out[canonical] = value;
  }
  return out;
}

/** A default candidate is only honoured when it can actually run the task. */
function usableModel(modelId: string | null | undefined, taskType: string): Model | null {
  if (!modelId) return null;
  const model = getModel(modelId);
  if (!model || !model.enabled) return null;
  if (!model.task_types.includes(taskType)) return null;
  return model;
}

/**
 * The model an auto-picked request should get, or null when no default applies
 * (the caller then falls back to the first enabled model for the task).
 *
 * `preferences` is the project's parsed override map (see
 * `parseModelPreferences`); a project entry beats the global default, and an
 * entry that no longer qualifies falls through instead of failing.
 */
export function resolveDefaultModel(
  taskType: string,
  preferences?: Record<string, string>,
): Model | null {
  return usableModel(preferences?.[taskType], taskType) ??
    usableModel(getTaskTypeDefault(taskType), taskType);
}

/** Every enabled model that can serve a task type, for the defaults UI. */
export function modelsForTaskType(taskType: string): Model[] {
  const canonical = canonicalTaskType(taskType);
  if (!canonical) return [];
  return findModelsForTask(canonical);
}

/**
 * Validate and normalize a `default_model_preferences` payload (an object, or
 * a JSON string of one) into the canonical JSON stored on the project: keys
 * are canonical task types (dashed HF aliases accepted, as everywhere task
 * types are validated), values a model id or `null` for an explicit clear.
 *
 * Existence of the referenced model is deliberately not checked here — a
 * project may be written before its model is installed, and a stale entry is
 * skipped at resolution rather than breaking generation.
 */
export function normalizeModelPreferences(value: unknown): string {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw badRequest("default_model_preferences must be valid JSON");
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badRequest(
      "default_model_preferences must be an object of task type -> model id",
    );
  }
  const out: Record<string, string | null> = {};
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const canonical = canonicalTaskType(key);
    if (!canonical) {
      throw badRequest(
        `default_model_preferences contains unknown task type: ${key}. ` +
          `Allowed: ${MODEL_TASK_TYPES.join(", ")}`,
      );
    }
    if (raw === null) {
      out[canonical] = null;
      continue;
    }
    if (typeof raw !== "string" || raw === "") {
      throw badRequest(`default_model_preferences.${key} must be a model id or null`);
    }
    out[canonical] = raw;
  }
  return JSON.stringify(out);
}
