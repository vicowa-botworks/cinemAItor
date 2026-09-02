import { getDb } from "./database.ts";
import { badRequest, notFound } from "../errors.ts";
import { getProjectAccessible } from "./projects.ts";
import {
  getLatestPromptVersionFor,
  getPromptVersion,
  listPromptVersions,
  type PromptVersion,
  restorePromptVersion,
  savePromptVersion,
} from "./prompt_versions.ts";
import { listReferencesForSource } from "./references.ts";

export interface MovieScript {
  id: string;
  project_id: string;
  name: string;
  prompt_version_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export const SCRIPT_STATUSES = ["draft", "active", "archived"] as const;
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];

function nowIso(): string {
  return new Date().toISOString();
}

function asStr(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function rowToMovieScript(row: Record<string, unknown>): MovieScript {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    prompt_version_id: asStr(row.prompt_version_id),
    status: row.status as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function getMovieScript(
  id: string,
  userId: number,
  required: "read" | "write" = "read",
): MovieScript | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM movie_scripts WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const script = rowToMovieScript(row);
  if (script.status === "deleted") return undefined;
  return getProjectAccessible(script.project_id, userId, required) ? script : undefined;
}

export function listMovieScripts(
  userId: number,
  filter: { project_id?: string } = {},
): MovieScript[] {
  const db = getDb();
  const clauses = ["status != 'deleted'"];
  const params: unknown[] = [];
  if (filter.project_id) {
    clauses.push("project_id = ?");
    params.push(filter.project_id);
  }
  const rows = (
    db.prepare(
      `SELECT * FROM movie_scripts WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, name`,
    ).all as (...values: unknown[]) => unknown[]
  )(...params) as Record<string, unknown>[];
  return rows
    .map(rowToMovieScript)
    .filter((script) => getProjectAccessible(script.project_id, userId, "read") !== undefined);
}

export function createMovieScript(
  userId: number,
  input: { project_id: string; name: string },
): MovieScript {
  if (!input.name?.trim()) throw badRequest("name is required");
  const project = getProjectAccessible(input.project_id, userId, "write");
  if (!project) throw notFound("Project not found");
  const id = crypto.randomUUID();
  const now = nowIso();
  (getDb().prepare(
    `INSERT INTO movie_scripts (id, project_id, name, status, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    project.id,
    input.name.trim(),
    now,
    now,
  );
  logAudit(userId, "script.create", id, { name: input.name });
  return getMovieScript(id, userId) as MovieScript;
}

export function updateMovieScript(
  userId: number,
  id: string,
  patch: { name?: string; status?: string },
): MovieScript | undefined {
  const script = getMovieScript(id, userId, "write");
  if (!script) return undefined;
  if (
    patch.status !== undefined && !SCRIPT_STATUSES.includes(patch.status as ScriptStatus)
  ) {
    throw badRequest(`status must be one of: ${SCRIPT_STATUSES.join(", ")}`);
  }
  const fields: Record<string, unknown> = {
    name: patch.name ?? script.name,
    status: patch.status ?? script.status,
    updated_at: nowIso(),
  };
  const keys = Object.keys(fields);
  (getDb().prepare(
    `UPDATE movie_scripts SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(...Object.values(fields), id);
  logAudit(userId, "script.update", id, { status: fields.status });
  return getMovieScript(id, userId);
}

/** Soft delete (keeps prompt-version history + audit trail intact). */
export function deleteMovieScript(userId: number, id: string): boolean {
  const script = getMovieScript(id, userId, "write");
  if (!script) return false;
  getDb().prepare("UPDATE movie_scripts SET status = 'deleted', updated_at = ? WHERE id = ?")
    .run(nowIso(), id);
  logAudit(userId, "script.delete", id, {});
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
     VALUES (?, ?, ?, 'movie_script', ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    userId,
    action,
    entityId,
    JSON.stringify(data),
    nowIso(),
  );
}

/**
 * Persist the script's text as a new prompt version (scope movie_script) and
 * repoint the script's prompt_version_id. Identical content is not re-stored
 * (duplicate detection) but the reference set is refreshed.
 */
export async function attachScriptPrompt(
  userId: number,
  scriptId: string,
  content: string,
): Promise<{ version_id: string; version_number: number; duplicate: boolean; warnings: string[] }> {
  const script = getMovieScript(scriptId, userId, "write");
  if (!script) throw notFound("Script not found");
  const saved = await savePromptVersion(userId, "movie_script", scriptId, content);
  (getDb().prepare(
    "UPDATE movie_scripts SET prompt_version_id = ?, updated_at = ? WHERE id = ?",
  ).run as (...params: unknown[]) => unknown)(saved.version.id, nowIso(), scriptId);
  logAudit(userId, "script.prompt", scriptId, {
    version: saved.version.id,
    duplicate: saved.duplicate,
  });
  return {
    version_id: saved.version.id,
    version_number: saved.version.version_number,
    duplicate: saved.duplicate,
    warnings: saved.warnings,
  };
}

/** The script's latest prompt version (if any) plus unresolved-reference warnings. */
export function scriptPrompt(
  scriptId: string,
  userId: number,
): { content: string; version_number: number; version_id: string; warnings: string[] } | null {
  const script = getMovieScript(scriptId, userId, "read");
  if (!script) throw notFound("Script not found");
  const version = getLatestPromptVersionFor("movie_script", scriptId, userId);
  if (!version) return null;
  const refs = listReferencesForSource("movie_script", version.id);
  return {
    content: version.content,
    version_number: version.version_number,
    version_id: version.id,
    warnings: refs.flatMap((r) =>
      r.status === "resolved" ? [] : [r.notes ?? `@${r.raw_text} is not a known asset`]
    ),
  };
}

/** Every version of the script's text, newest first (edit + generation history). */
export function listScriptVersions(
  scriptId: string,
  userId: number,
): PromptVersion[] {
  const script = getMovieScript(scriptId, userId, "read");
  if (!script) throw notFound("Script not found");
  return listPromptVersions("movie_script", scriptId, userId);
}

/** Restore a historical version by appending it as a new version. */
export function restoreScriptVersion(
  userId: number,
  scriptId: string,
  versionId: string,
): { version_id: string; version_number: number; duplicate: boolean } {
  const script = getMovieScript(scriptId, userId, "write");
  if (!script) throw notFound("Script not found");
  const source = getPromptVersion(versionId, userId);
  if (!source || source.scope_type !== "movie_script" || source.scope_id !== scriptId) {
    throw notFound("Version not found");
  }
  const saved = restorePromptVersion(userId, versionId);
  (getDb().prepare(
    "UPDATE movie_scripts SET prompt_version_id = ?, updated_at = ? WHERE id = ?",
  ).run as (...params: unknown[]) => unknown)(saved.version.id, nowIso(), scriptId);
  logAudit(userId, "script.restore", scriptId, {
    version: saved.version.id,
    duplicate: saved.duplicate,
  });
  return {
    version_id: saved.version.id,
    version_number: saved.version.version_number,
    duplicate: saved.duplicate,
  };
}
