import { getDb } from "./database.ts";

export const PERMISSION_RANK = { read: 1, write: 2, admin: 3 } as const;
export type ProjectPermission = keyof typeof PERMISSION_RANK;

export interface Project {
  id: string;
  name: string;
  description: string | null;
  media_directory: string | null;
  output_directory: string | null;
  aspect_ratio: string | null;
  frame_rate: number | null;
  resolution_width: number | null;
  resolution_height: number | null;
  color_space: string | null;
  audio_sample_rate: number | null;
  default_export_preset_id: string | null;
  default_model_preferences_json: string | null;
  template_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  created_by_user_id: number | null;
}

export interface ProjectInput {
  name: string;
  description?: string | null;
  aspect_ratio?: string;
  frame_rate?: number;
  resolution_width?: number;
  resolution_height?: number;
  color_space?: string;
  audio_sample_rate?: number;
  default_export_preset_id?: string | null;
  default_model_preferences_json?: string | null;
  template_id?: string | null;
}

export type ProjectUpdates = {
  name?: string;
  description?: string | null;
  aspect_ratio?: string;
  frame_rate?: number;
  resolution_width?: number;
  resolution_height?: number;
  color_space?: string;
  audio_sample_rate?: number;
  default_export_preset_id?: string | null;
  default_model_preferences_json?: string | null;
  template_id?: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    description: asNullableString(row.description),
    media_directory: asNullableString(row.media_directory),
    output_directory: asNullableString(row.output_directory),
    aspect_ratio: asNullableString(row.aspect_ratio),
    frame_rate: asNullableNumber(row.frame_rate),
    resolution_width: asNullableNumber(row.resolution_width),
    resolution_height: asNullableNumber(row.resolution_height),
    color_space: asNullableString(row.color_space),
    audio_sample_rate: asNullableNumber(row.audio_sample_rate),
    default_export_preset_id: asNullableString(row.default_export_preset_id),
    default_model_preferences_json: asNullableString(
      row.default_model_preferences_json,
    ),
    template_id: asNullableString(row.template_id),
    status: row.status as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    created_by_user_id: asNullableNumber(row.created_by_user_id),
  };
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
     VALUES (?, ?, ?, 'project', ?, ?, ?)`,
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

export function createProject(input: ProjectInput, userId: number): Project {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();

  const project: Project = {
    id,
    name: input.name,
    description: input.description ?? null,
    media_directory: `projects/${id}/media`,
    output_directory: `projects/${id}/output`,
    aspect_ratio: input.aspect_ratio ?? "16:9",
    frame_rate: input.frame_rate ?? 24,
    resolution_width: input.resolution_width ?? 1920,
    resolution_height: input.resolution_height ?? 1080,
    color_space: input.color_space ?? "sRGB",
    audio_sample_rate: input.audio_sample_rate ?? 48000,
    default_export_preset_id: input.default_export_preset_id ?? null,
    default_model_preferences_json: input.default_model_preferences_json ?? null,
    template_id: input.template_id ?? null,
    status: "active",
    created_at: now,
    updated_at: now,
    created_by_user_id: userId,
  };

  const insert = db.prepare(
    `INSERT INTO projects (
      id, name, description, media_directory, output_directory, aspect_ratio,
      frame_rate, resolution_width, resolution_height, color_space,
      audio_sample_rate, default_export_preset_id, default_model_preferences_json,
      template_id, status, created_at, updated_at, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  (insert.run as (...params: unknown[]) => unknown)(
    project.id,
    project.name,
    project.description,
    project.media_directory,
    project.output_directory,
    project.aspect_ratio,
    project.frame_rate,
    project.resolution_width,
    project.resolution_height,
    project.color_space,
    project.audio_sample_rate,
    project.default_export_preset_id,
    project.default_model_preferences_json,
    project.template_id,
    project.status,
    project.created_at,
    project.updated_at,
    project.created_by_user_id,
  );

  const permissionInsert = db.prepare(
    `INSERT INTO project_permissions (id, project_id, user_id, permission, created_at)
     VALUES (?, ?, ?, 'admin', ?)`,
  );
  (permissionInsert.run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    id,
    userId,
    now,
  );

  logAudit(userId, "project.create", id, { name: project.name });
  return getProjectById(id) as Project;
}

export function getProjectById(id: string): Project | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM projects WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToProject(row) : undefined;
}

export function hasProjectPermission(
  userId: number,
  projectId: string,
  required: ProjectPermission = "read",
): boolean {
  const db = getDb();
  const project = db.prepare(
    "SELECT created_by_user_id FROM projects WHERE id = ?",
  ).get(projectId) as { created_by_user_id: number | null } | undefined;
  if (!project) return false;
  if (project.created_by_user_id === userId) return true;

  const permission = db.prepare(
    "SELECT permission FROM project_permissions WHERE project_id = ? AND user_id = ?",
  ).get(projectId, userId) as { permission: string } | undefined;
  if (!permission) return false;

  const requiredRank = PERMISSION_RANK[required];
  const actualRank = PERMISSION_RANK[
    permission.permission as ProjectPermission
  ];
  return actualRank !== undefined && actualRank >= requiredRank;
}

export function getProjectAccessible(
  id: string,
  userId: number,
  required: ProjectPermission = "read",
): Project | undefined {
  const project = getProjectById(id);
  if (!project || project.status === "deleted") return undefined;
  return hasProjectPermission(userId, id, required) ? project : undefined;
}

export function listProjects(userId: number): Project[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT p.*
     FROM projects p
     WHERE p.status != 'deleted'
       AND (
         p.created_by_user_id = ?
         OR EXISTS (
           SELECT 1
           FROM project_permissions pp
           WHERE pp.project_id = p.id AND pp.user_id = ?
         )
       )
     ORDER BY p.updated_at DESC`,
  ).all(userId, userId) as Record<string, unknown>[];
  return rows.map(rowToProject);
}

export function updateProject(
  id: string,
  userId: number,
  updates: ProjectUpdates,
): Project | undefined {
  if (!hasProjectPermission(userId, id, "write")) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];
  const allowed: Record<keyof ProjectUpdates, string> = {
    name: "name",
    description: "description",
    aspect_ratio: "aspect_ratio",
    frame_rate: "frame_rate",
    resolution_width: "resolution_width",
    resolution_height: "resolution_height",
    color_space: "color_space",
    audio_sample_rate: "audio_sample_rate",
    default_export_preset_id: "default_export_preset_id",
    default_model_preferences_json: "default_model_preferences_json",
    template_id: "template_id",
  };

  for (
    const [key, column] of Object.entries(allowed) as [
      keyof ProjectUpdates,
      string,
    ][]
  ) {
    const value = updates[key];
    if (value !== undefined) {
      fields.push(`${column} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return getProjectAccessible(id, userId, "write");

  fields.push("updated_at = ?");
  values.push(nowIso(), id);

  const db = getDb();
  const stmt = db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`);
  (stmt.run as (...params: unknown[]) => unknown)(...values);
  logAudit(userId, "project.update", id, { fields: Object.keys(updates) });
  return getProjectAccessible(id, userId, "write");
}

export function deleteProject(id: string, userId: number): boolean {
  if (!hasProjectPermission(userId, id, "admin")) return false;
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE projects SET status = 'deleted', updated_at = ? WHERE id = ?",
  );
  (stmt.run as (...params: unknown[]) => unknown)(nowIso(), id);
  logAudit(userId, "project.delete", id, { status: "deleted" });
  return true;
}
