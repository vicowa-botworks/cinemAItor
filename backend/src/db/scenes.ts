import { getDb } from "./database.ts";
import { badRequest, notFound } from "../errors.ts";
import { getProjectAccessible } from "./projects.ts";
import { getLatestPromptVersionFor, savePromptVersion } from "./prompt_versions.ts";
import { listReferencesForSource } from "./references.ts";

export const SCENE_STATUSES = [
  "draft",
  "in_production",
  "in_review",
  "approved",
  "archived",
] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

export const SHOT_STATUSES = ["draft", "planned", "queued", "generated", "locked"] as const;
export type ShotStatus = (typeof SHOT_STATUSES)[number];

export interface Scene {
  id: string;
  project_id: string;
  storyboard_id: string | null;
  name: string;
  description: string | null;
  prompt_version_id: string | null;
  status: string;
  target_duration: number | null;
  aspect_ratio_override: string | null;
  frame_rate_override: number | null;
  notes: string | null;
  audio_plan: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Shot {
  id: string;
  scene_id: string;
  shot_order: number;
  name: string | null;
  prompt_version_id: string | null;
  duration: number | null;
  camera_settings: Record<string, unknown> | null;
  status: string;
  generated_asset_version_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asStr(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function rowToScene(row: Record<string, unknown>): Scene {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    storyboard_id: asStr(row.storyboard_id),
    name: row.name as string,
    description: asStr(row.description),
    prompt_version_id: asStr(row.prompt_version_id),
    status: row.status as string,
    target_duration: asNum(row.target_duration),
    aspect_ratio_override: asStr(row.aspect_ratio_override),
    frame_rate_override: asNum(row.frame_rate_override),
    notes: asStr(row.notes),
    audio_plan: row.audio_plan_json === null ? null : JSON.parse(row.audio_plan_json as string),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function rowToShot(row: Record<string, unknown>): Shot {
  return {
    id: row.id as string,
    scene_id: row.scene_id as string,
    shot_order: row.shot_order as number,
    name: asStr(row.name),
    prompt_version_id: asStr(row.prompt_version_id),
    duration: asNum(row.duration),
    camera_settings: row.camera_settings_json === null
      ? null
      : JSON.parse(row.camera_settings_json as string),
    status: row.status as string,
    generated_asset_version_id: asStr(row.generated_asset_version_id),
    notes: asStr(row.notes),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function logAudit(
  userId: number,
  entityType: "scene" | "shot",
  action: string,
  entityId: string,
  data: Record<string, unknown>,
): void {
  const db = getDb();
  (db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    userId,
    action,
    entityType,
    entityId,
    JSON.stringify(data),
    nowIso(),
  );
}

export function getScene(
  id: string,
  userId: number,
  required: "read" | "write" = "read",
): Scene | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM scenes WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const scene = rowToScene(row);
  return getProjectAccessible(scene.project_id, userId, required) ? scene : undefined;
}

export function listScenes(
  userId: number,
  filter: { project_id?: string; storyboard_id?: string } = {},
): Scene[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.project_id) {
    clauses.push("project_id = ?");
    params.push(filter.project_id);
  }
  if (filter.storyboard_id) {
    clauses.push("storyboard_id = ?");
    params.push(filter.storyboard_id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (
    db.prepare(`SELECT * FROM scenes ${where} ORDER BY name`).all as (
      ...values: unknown[]
    ) => unknown[]
  )(...params) as Record<string, unknown>[];
  return rows
    .map(rowToScene)
    .filter((scene) => getProjectAccessible(scene.project_id, userId, "read") !== undefined);
}

export interface SceneInput {
  project_id: string;
  name: string;
  storyboard_id?: string;
  description?: string;
  prompt?: string;
  status?: string;
  target_duration?: number;
  aspect_ratio_override?: string;
  frame_rate_override?: number;
  notes?: string;
  audio_plan?: Record<string, unknown>;
}

export async function createScene(
  userId: number,
  input: SceneInput,
): Promise<Scene> {
  if (!input.name?.trim()) throw badRequest("name is required");
  if (input.status !== undefined && !SCENE_STATUSES.includes(input.status as SceneStatus)) {
    throw badRequest(`status must be one of: ${SCENE_STATUSES.join(", ")}`);
  }
  const project = getProjectAccessible(input.project_id, userId, "write");
  if (!project) throw notFound("Project not found");

  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  (db.prepare(
    `INSERT INTO scenes (
      id, project_id, storyboard_id, name, description, prompt_version_id,
      status, target_duration, aspect_ratio_override, frame_rate_override,
      notes, audio_plan_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    project.id,
    input.storyboard_id ?? null,
    input.name.trim(),
    input.description ?? null,
    input.status ?? "draft",
    input.target_duration ?? null,
    input.aspect_ratio_override ?? null,
    input.frame_rate_override ?? null,
    input.notes ?? null,
    input.audio_plan ? JSON.stringify(input.audio_plan) : null,
    now,
    now,
  );

  if (input.prompt !== undefined && input.prompt !== "") {
    await attachScenePrompt(userId, id, input.prompt);
  }
  logAudit(userId, "scene", "scene.create", id, { name: input.name });
  return getScene(id, userId) as Scene;
}

export async function attachScenePrompt(
  userId: number,
  sceneId: string,
  content: string,
): Promise<{ version_id: string; version_number: number; warnings: string[] }> {
  const saved = await savePromptVersion(userId, "scene", sceneId, content);
  (getDb().prepare(
    "UPDATE scenes SET prompt_version_id = ?, updated_at = ? WHERE id = ?",
  ).run as (...params: unknown[]) => unknown)(saved.version.id, nowIso(), sceneId);
  return {
    version_id: saved.version.id,
    version_number: saved.version.version_number,
    warnings: saved.warnings,
  };
}

export const MAX_SCENES_PER_SCRIPT_IMPORT = 200;

export interface ScriptSceneInput {
  name: string;
  description?: string;
  prompt?: string;
  notes?: string;
}

export async function bulkCreateScenes(
  userId: number,
  projectId: string,
  scenes: ScriptSceneInput[],
): Promise<Scene[]> {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw badRequest("scenes must be a non-empty array");
  }
  if (scenes.length > MAX_SCENES_PER_SCRIPT_IMPORT) {
    throw badRequest(`at most ${MAX_SCENES_PER_SCRIPT_IMPORT} scenes per import`);
  }
  scenes.forEach((scene, index) => {
    if (typeof scene !== "object" || scene === null) {
      throw badRequest(`scenes[${index}] must be an object`);
    }
    if (typeof scene.name !== "string" || !scene.name.trim()) {
      throw badRequest(`scenes[${index}].name is required`);
    }
    if (scene.description !== undefined && typeof scene.description !== "string") {
      throw badRequest(`scenes[${index}].description must be a string`);
    }
    if (scene.prompt !== undefined && typeof scene.prompt !== "string") {
      throw badRequest(`scenes[${index}].prompt must be a string`);
    }
    if (scene.notes !== undefined && typeof scene.notes !== "string") {
      throw badRequest(`scenes[${index}].notes must be a string`);
    }
  });
  const project = getProjectAccessible(projectId, userId, "write");
  if (!project) throw notFound("Project not found");

  const created: Scene[] = [];
  for (const scene of scenes) {
    created.push(
      await createScene(userId, {
        project_id: projectId,
        name: scene.name,
        description: scene.description,
        prompt: scene.prompt,
        notes: scene.notes,
        status: "draft",
      }),
    );
  }
  return created;
}

export async function updateScene(
  userId: number,
  id: string,
  patch: Partial<SceneInput> & { prompt?: string },
): Promise<Scene | undefined> {
  const scene = getScene(id, userId, "write");
  if (!scene) return undefined;
  if (
    patch.status !== undefined &&
    !SCENE_STATUSES.includes(patch.status as SceneStatus)
  ) {
    throw badRequest(`status must be one of: ${SCENE_STATUSES.join(", ")}`);
  }
  const db = getDb();
  const fields: Record<string, unknown> = {
    name: patch.name ?? scene.name,
    description: patch.description !== undefined ? patch.description : scene.description,
    status: patch.status ?? scene.status,
    target_duration: patch.target_duration !== undefined
      ? patch.target_duration
      : scene.target_duration,
    aspect_ratio_override: patch.aspect_ratio_override !== undefined
      ? patch.aspect_ratio_override
      : scene.aspect_ratio_override,
    frame_rate_override: patch.frame_rate_override !== undefined
      ? patch.frame_rate_override
      : scene.frame_rate_override,
    notes: patch.notes !== undefined ? patch.notes : scene.notes,
    audio_plan_json: JSON.stringify(
      patch.audio_plan !== undefined ? patch.audio_plan : scene.audio_plan,
    ),
    updated_at: nowIso(),
  };
  const keys = Object.keys(fields);
  (db.prepare(
    `UPDATE scenes SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(...Object.values(fields), id);

  if (patch.prompt !== undefined && patch.prompt !== "") {
    await attachScenePrompt(userId, id, patch.prompt);
  }
  return getScene(id, userId);
}

export function deleteScene(userId: number, id: string): boolean {
  const scene = getScene(id, userId, "write");
  if (!scene) return false;
  getDb().prepare("DELETE FROM scenes WHERE id = ?").run(id);
  logAudit(userId, "scene", "scene.delete", id, {});
  return true;
}

/** Prompt content + warnings for a scene/shot (via prompt_versions). */
export function creativePromptFor(
  scopeType: "scene" | "shot",
  scopeId: string,
  userId: number,
): { content: string; version_number: number; version_id: string; warnings: string[] } | null {
  const version = getLatestPromptVersionFor(scopeType, scopeId, userId);
  if (!version) return null;
  const refs = listReferencesForSource(scopeType, version.id);
  return {
    content: version.content,
    version_number: version.version_number,
    version_id: version.id,
    warnings: refs.flatMap((r) =>
      r.status === "resolved" ? [] : [r.notes ?? `@${r.raw_text} is not a known asset`]
    ),
  };
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

export interface ShotInput {
  shot_order: number;
  name?: string;
  prompt?: string;
  duration?: number;
  camera_settings?: Record<string, unknown>;
  status?: string;
  notes?: string;
}

export function getShot(
  shotId: string,
  userId: number,
  required: "read" | "write" = "read",
): Shot | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM shots WHERE id = ?")
    .get(shotId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const shot = rowToShot(row);
  const scene = getScene(shot.scene_id, userId, required);
  return scene ? shot : undefined;
}

export function listShots(sceneId: string, userId: number): Shot[] {
  const scene = getScene(sceneId, userId, "read");
  if (!scene) return [];
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM shots WHERE scene_id = ? ORDER BY shot_order",
  ).all(sceneId) as Record<string, unknown>[];
  return rows.map(rowToShot);
}

export async function createShot(
  userId: number,
  sceneId: string,
  input: ShotInput,
): Promise<Shot> {
  const scene = getScene(sceneId, userId, "write");
  if (!scene) throw notFound("Scene not found");
  if (!Number.isInteger(input.shot_order) || input.shot_order < 1) {
    throw badRequest("shot_order must be a positive integer");
  }
  if (input.status !== undefined && !SHOT_STATUSES.includes(input.status as ShotStatus)) {
    throw badRequest(`status must be one of: ${SHOT_STATUSES.join(", ")}`);
  }

  const db = getDb();
  const clash = db.prepare(
    "SELECT id FROM shots WHERE scene_id = ? AND shot_order = ?",
  ).get(sceneId, input.shot_order);
  if (clash) {
    throw badRequest(`A shot already exists at position ${input.shot_order}`);
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  (db.prepare(
    `INSERT INTO shots (
      id, scene_id, shot_order, name, prompt_version_id, duration,
      camera_settings_json, status, generated_asset_version_id, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    sceneId,
    input.shot_order,
    input.name ?? null,
    input.duration ?? null,
    input.camera_settings ? JSON.stringify(input.camera_settings) : null,
    input.status ?? "draft",
    input.notes ?? null,
    now,
    now,
  );

  if (input.prompt !== undefined && input.prompt !== "") {
    const saved = await savePromptVersion(userId, "shot", id, input.prompt);
    (db.prepare(
      "UPDATE shots SET prompt_version_id = ?, updated_at = ? WHERE id = ?",
    ).run as (...params: unknown[]) => unknown)(saved.version.id, nowIso(), id);
  }
  logAudit(userId, "shot", "shot.create", id, { scene_id: sceneId });
  return getShot(id, userId) as Shot;
}

export async function updateShot(
  userId: number,
  shotId: string,
  patch: Partial<ShotInput>,
): Promise<Shot | undefined> {
  const shot = getShot(shotId, userId, "write");
  if (!shot) return undefined;
  if (
    patch.status !== undefined &&
    !SHOT_STATUSES.includes(patch.status as ShotStatus)
  ) {
    throw badRequest(`status must be one of: ${SHOT_STATUSES.join(", ")}`);
  }
  const db = getDb();
  const fields: Record<string, unknown> = {
    name: patch.name !== undefined ? patch.name : shot.name,
    duration: patch.duration !== undefined ? patch.duration : shot.duration,
    camera_settings_json: JSON.stringify(
      patch.camera_settings !== undefined ? patch.camera_settings : shot.camera_settings,
    ),
    status: patch.status ?? shot.status,
    notes: patch.notes !== undefined ? patch.notes : shot.notes,
    updated_at: nowIso(),
  };
  const keys = Object.keys(fields);
  (db.prepare(
    `UPDATE shots SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(...Object.values(fields), shotId);

  if (patch.prompt !== undefined && patch.prompt !== "") {
    const saved = await savePromptVersion(userId, "shot", shotId, patch.prompt);
    (db.prepare(
      "UPDATE shots SET prompt_version_id = ?, updated_at = ? WHERE id = ?",
    ).run as (...params: unknown[]) => unknown)(saved.version.id, nowIso(), shotId);
  }
  return getShot(shotId, userId);
}

export function deleteShot(userId: number, shotId: string): boolean {
  const shot = getShot(shotId, userId, "write");
  if (!shot) return false;
  getDb().prepare("DELETE FROM shots WHERE id = ?").run(shotId);
  logAudit(userId, "shot", "shot.delete", shotId, {});
  return true;
}

/** Called by the job runner when a shot generation succeeds. */
export function setShotGenerated(shotId: string, versionId: string): void {
  const db = getDb();
  (db.prepare(
    `UPDATE shots
     SET generated_asset_version_id = ?, status = 'generated', updated_at = ?
     WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(versionId, nowIso(), shotId);
}
