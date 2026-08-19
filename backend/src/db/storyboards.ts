import { getDb } from "./database.ts";
import { badRequest, notFound } from "../errors.ts";
import { getProjectAccessible } from "./projects.ts";
import { getLatestPromptVersionFor, savePromptVersion } from "./prompt_versions.ts";
import { listReferencesForSource } from "./references.ts";

export const STORYBOARD_STATUSES = ["draft", "in_review", "approved", "archived"] as const;
export type StoryboardStatus = (typeof STORYBOARD_STATUSES)[number];

export const PANEL_STATUSES = [
  "draft",
  "generating",
  "preview_ready",
  "rendered",
  "locked",
] as const;
export type PanelStatus = (typeof PANEL_STATUSES)[number];

export interface Storyboard {
  id: string;
  project_id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface StoryboardPanel {
  id: string;
  storyboard_id: string;
  panel_order: number;
  shot_number: string | null;
  description: string | null;
  prompt_version_id: string | null;
  duration: number | null;
  camera_settings: Record<string, unknown> | null;
  mood: string | null;
  lighting: string | null;
  time_of_day: string | null;
  dialogue: string | null;
  voiceover: string | null;
  music_cue: string | null;
  sfx: string | null;
  transition: string | null;
  notes: string | null;
  status: string;
  preview_asset_version_id: string | null;
  generated_clip_asset_version_id: string | null;
  linked_scene_id: string | null;
  linked_shot_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreativePrompt {
  content: string;
  version_number: number;
  version_id: string;
  warnings: string[];
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

export function rowToStoryboard(row: Record<string, unknown>): Storyboard {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    status: row.status as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function rowToPanel(row: Record<string, unknown>): StoryboardPanel {
  return {
    id: row.id as string,
    storyboard_id: row.storyboard_id as string,
    panel_order: row.panel_order as number,
    shot_number: asStr(row.shot_number),
    description: asStr(row.description),
    prompt_version_id: asStr(row.prompt_version_id),
    duration: asNum(row.duration),
    camera_settings: row.camera_settings_json === null
      ? null
      : JSON.parse(row.camera_settings_json as string),
    mood: asStr(row.mood),
    lighting: asStr(row.lighting),
    time_of_day: asStr(row.time_of_day),
    dialogue: asStr(row.dialogue),
    voiceover: asStr(row.voiceover),
    music_cue: asStr(row.music_cue),
    sfx: asStr(row.sfx),
    transition: asStr(row.transition),
    notes: asStr(row.notes),
    status: row.status as string,
    preview_asset_version_id: asStr(row.preview_asset_version_id),
    generated_clip_asset_version_id: asStr(row.generated_clip_asset_version_id),
    linked_scene_id: asStr(row.linked_scene_id),
    linked_shot_id: asStr(row.linked_shot_id),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/** Prompt content + unresolved-reference warnings for a creative object. */
export function creativePrompt(
  scopeType: "storyboard_panel" | "scene" | "shot",
  scopeId: string,
  userId: number,
): CreativePrompt | null {
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

export function getStoryboard(
  id: string,
  userId: number,
  required: "read" | "write" = "read",
): Storyboard | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM storyboards WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const board = rowToStoryboard(row);
  if (board.status === "deleted") return undefined;
  return getProjectAccessible(board.project_id, userId, required) ? board : undefined;
}

export function listStoryboards(
  userId: number,
  filter: { project_id?: string } = {},
): Storyboard[] {
  const db = getDb();
  const clauses = ["status != 'deleted'"];
  const params: unknown[] = [];
  if (filter.project_id) {
    clauses.push("project_id = ?");
    params.push(filter.project_id);
  }
  const rows = (
    db.prepare(
      `SELECT * FROM storyboards WHERE ${clauses.join(" AND ")} ORDER BY name`,
    ).all as (...values: unknown[]) => unknown[]
  )(...params) as Record<string, unknown>[];
  return rows
    .map(rowToStoryboard)
    .filter((board) => getProjectAccessible(board.project_id, userId, "read") !== undefined);
}

export function createStoryboard(
  userId: number,
  input: { project_id: string; name: string; status?: string },
): Storyboard {
  if (!input.name?.trim()) throw badRequest("name is required");
  if (
    input.status !== undefined && !STORYBOARD_STATUSES.includes(input.status as StoryboardStatus)
  ) {
    throw badRequest(
      `status must be one of: ${STORYBOARD_STATUSES.join(", ")}`,
    );
  }
  const project = getProjectAccessible(input.project_id, userId, "write");
  if (!project) throw notFound("Project not found");

  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  (db.prepare(
    `INSERT INTO storyboards (id, project_id, name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    project.id,
    input.name.trim(),
    input.status ?? "draft",
    now,
    now,
  );
  logAudit(userId, "storyboard.create", id, { name: input.name });
  return getStoryboard(id, userId) as Storyboard;
}

export function updateStoryboard(
  userId: number,
  id: string,
  patch: { name?: string; status?: string },
): Storyboard | undefined {
  const board = getStoryboard(id, userId, "write");
  if (!board) return undefined;
  if (
    patch.status !== undefined &&
    !STORYBOARD_STATUSES.includes(patch.status as StoryboardStatus)
  ) {
    throw badRequest(`status must be one of: ${STORYBOARD_STATUSES.join(", ")}`);
  }
  const db = getDb();
  const fields: Record<string, unknown> = {
    name: patch.name ?? board.name,
    status: patch.status ?? board.status,
    updated_at: nowIso(),
  };
  const keys = Object.keys(fields);
  (db.prepare(
    `UPDATE storyboards SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(...Object.values(fields), id);
  logAudit(userId, "storyboard.update", id, { status: fields.status });
  return getStoryboard(id, userId);
}

/** Soft delete (keeps audit trail + panel FK history consistent). */
export function deleteStoryboard(userId: number, id: string): boolean {
  const board = getStoryboard(id, userId, "write");
  if (!board) return false;
  const db = getDb();
  db.prepare("UPDATE storyboards SET status = 'deleted', updated_at = ? WHERE id = ?")
    .run(nowIso(), id);
  logAudit(userId, "storyboard.delete", id, {});
  return true;
}

function logAudit(
  userId: number,
  action: string,
  entityId: string,
  data: Record<string, unknown>,
): void {
  const db = getDb();
  (db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, data_json, created_at)
     VALUES (?, ?, ?, 'storyboard', ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    userId,
    action,
    entityId,
    JSON.stringify(data),
    nowIso(),
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

export interface PanelInput {
  panel_order: number;
  shot_number?: string;
  description?: string;
  prompt?: string;
  duration?: number;
  camera_settings?: Record<string, unknown>;
  mood?: string;
  lighting?: string;
  time_of_day?: string;
  dialogue?: string;
  voiceover?: string;
  music_cue?: string;
  sfx?: string;
  transition?: string;
  notes?: string;
  status?: string;
}

export interface PanelWithPrompt extends Omit<StoryboardPanel, "prompt_version_id"> {
  prompt_version_id: string | null;
  prompt: CreativePrompt | null;
}

export async function createPanel(
  userId: number,
  storyboardId: string,
  input: PanelInput,
): Promise<StoryboardPanel> {
  const board = getStoryboard(storyboardId, userId, "write");
  if (!board) throw notFound("Storyboard not found");
  if (
    !Number.isInteger(input.panel_order) || input.panel_order < 1
  ) {
    throw badRequest("panel_order must be a positive integer");
  }
  if (input.status !== undefined && !PANEL_STATUSES.includes(input.status as PanelStatus)) {
    throw badRequest(`status must be one of: ${PANEL_STATUSES.join(", ")}`);
  }

  const db = getDb();
  const clash = db.prepare(
    "SELECT id FROM storyboard_panels WHERE storyboard_id = ? AND panel_order = ?",
  ).get(storyboardId, input.panel_order);
  if (clash) {
    throw badRequest(`A panel already exists at position ${input.panel_order}`);
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  (db.prepare(
    `INSERT INTO storyboard_panels (
      id, storyboard_id, panel_order, shot_number, description,
      prompt_version_id, duration, camera_settings_json, mood, lighting,
      time_of_day, dialogue, voiceover, music_cue, sfx, transition, notes,
      status, preview_asset_version_id, generated_clip_asset_version_id,
      linked_scene_id, linked_shot_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
      NULL, NULL, NULL, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    storyboardId,
    input.panel_order,
    input.shot_number ?? null,
    input.description ?? null,
    input.duration ?? null,
    input.camera_settings ? JSON.stringify(input.camera_settings) : null,
    input.mood ?? null,
    input.lighting ?? null,
    input.time_of_day ?? null,
    input.dialogue ?? null,
    input.voiceover ?? null,
    input.music_cue ?? null,
    input.sfx ?? null,
    input.transition ?? null,
    input.notes ?? null,
    input.status ?? "draft",
    now,
    now,
  );

  if (input.prompt !== undefined && input.prompt !== "") {
    await attachPanelPrompt(userId, id, input.prompt);
  }
  logAudit(userId, "panel.create", id, {
    storyboard_id: storyboardId,
    panel_order: input.panel_order,
  });
  return getPanel(id, userId) as StoryboardPanel;
}

export async function attachPanelPrompt(
  userId: number,
  panelId: string,
  content: string,
): Promise<CreativePrompt> {
  const saved = await savePromptVersion(userId, "storyboard_panel", panelId, content);
  (getDb().prepare(
    "UPDATE storyboard_panels SET prompt_version_id = ?, updated_at = ? WHERE id = ?",
  ).run as (...params: unknown[]) => unknown)(
    saved.version.id,
    nowIso(),
    panelId,
  );
  const prompt = creativePrompt("storyboard_panel", panelId, userId);
  if (!prompt) throw new Error("prompt version not found");
  prompt.warnings = saved.warnings;
  return prompt;
}

export function getPanel(
  panelId: string,
  userId: number,
  required: "read" | "write" = "read",
): StoryboardPanel | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM storyboard_panels WHERE id = ?")
    .get(panelId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const panel = rowToPanel(row);
  const board = getStoryboard(panel.storyboard_id, userId, required);
  return board ? panel : undefined;
}

export function getPanelRow(panelId: string): StoryboardPanel | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM storyboard_panels WHERE id = ?")
    .get(panelId) as Record<string, unknown> | undefined;
  return row ? rowToPanel(row) : undefined;
}

export function listPanels(
  storyboardId: string,
  userId: number,
): StoryboardPanel[] {
  const board = getStoryboard(storyboardId, userId, "read");
  if (!board) return [];
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM storyboard_panels WHERE storyboard_id = ? ORDER BY panel_order",
  ).all(storyboardId) as Record<string, unknown>[];
  return rows.map(rowToPanel);
}

export async function updatePanel(
  userId: number,
  panelId: string,
  patch: Partial<PanelInput> & {
    shot_number?: string;
    description?: string;
    linked_scene_id?: string;
    linked_shot_id?: string;
  },
): Promise<StoryboardPanel | undefined> {
  const panel = getPanel(panelId, userId, "write");
  if (!panel) return undefined;
  if (
    patch.status !== undefined &&
    !PANEL_STATUSES.includes(patch.status as PanelStatus)
  ) {
    throw badRequest(`status must be one of: ${PANEL_STATUSES.join(", ")}`);
  }
  const db = getDb();
  const fields: Record<string, unknown> = {
    shot_number: patch.shot_number !== undefined ? patch.shot_number : panel.shot_number,
    description: patch.description !== undefined ? patch.description : panel.description,
    duration: patch.duration !== undefined ? patch.duration : panel.duration,
    camera_settings_json: JSON.stringify(
      patch.camera_settings !== undefined ? patch.camera_settings : panel.camera_settings,
    ),
    mood: patch.mood !== undefined ? patch.mood : panel.mood,
    lighting: patch.lighting !== undefined ? patch.lighting : panel.lighting,
    time_of_day: patch.time_of_day !== undefined ? patch.time_of_day : panel.time_of_day,
    dialogue: patch.dialogue !== undefined ? patch.dialogue : panel.dialogue,
    voiceover: patch.voiceover !== undefined ? patch.voiceover : panel.voiceover,
    music_cue: patch.music_cue !== undefined ? patch.music_cue : panel.music_cue,
    sfx: patch.sfx !== undefined ? patch.sfx : panel.sfx,
    transition: patch.transition !== undefined ? patch.transition : panel.transition,
    notes: patch.notes !== undefined ? patch.notes : panel.notes,
    status: patch.status !== undefined ? patch.status : panel.status,
    linked_scene_id: patch.linked_scene_id !== undefined
      ? patch.linked_scene_id
      : panel.linked_scene_id,
    linked_shot_id: patch.linked_shot_id !== undefined
      ? patch.linked_shot_id
      : panel.linked_shot_id,
    updated_at: nowIso(),
  };
  const keys = Object.keys(fields);
  (db.prepare(
    `UPDATE storyboard_panels SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(...Object.values(fields), panelId);

  if (patch.prompt !== undefined && patch.prompt !== "") {
    await attachPanelPrompt(userId, panelId, patch.prompt);
  }
  return getPanel(panelId, userId);
}

export function deletePanel(userId: number, panelId: string): boolean {
  const panel = getPanel(panelId, userId, "write");
  if (!panel) return false;
  getDb().prepare("DELETE FROM storyboard_panels WHERE id = ?").run(panelId);
  logAudit(userId, "panel.delete", panelId, {});
  return true;
}

/** Called by the job runner when a preview generation succeeds. */
export function setPanelPreview(panelId: string, versionId: string): void {
  const db = getDb();
  (db.prepare(
    `UPDATE storyboard_panels
     SET preview_asset_version_id = ?, status = 'preview_ready', updated_at = ?
     WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(versionId, nowIso(), panelId);
}
