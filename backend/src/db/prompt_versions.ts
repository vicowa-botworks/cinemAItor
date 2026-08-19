import { getDb } from "./database.ts";
import { getUserById } from "./schema.ts";
import {
  type ReferenceRow,
  referenceWarningText,
  type ResolvedReference,
  resolveReferenceText,
  saveResolvedReferences,
} from "./references.ts";
import { badRequest } from "../errors.ts";

export const PROMPT_SCOPE_TYPES = [
  "generic",
  "prompt",
  "scene",
  "shot",
  "storyboard_panel",
] as const;
export type PromptScopeType = (typeof PROMPT_SCOPE_TYPES)[number];

export interface PromptVersion {
  id: string;
  scope_type: string;
  scope_id: string;
  version_number: number;
  content: string;
  content_hash: string;
  parent_prompt_id: string | null;
  created_at: string;
  created_by_user_id: number | null;
}

export interface SavedPrompt {
  version: PromptVersion;
  duplicate: boolean;
  references: ReferenceRow[];
  warnings: string[];
}

interface ResolvedWithRows {
  resolved: ResolvedReference[];
  references: ReferenceRow[];
  warnings: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function rowToPromptVersion(row: Record<string, unknown>): PromptVersion {
  return {
    id: row.id as string,
    scope_type: row.scope_type as string,
    scope_id: row.scope_id as string,
    version_number: row.version_number as number,
    content: row.content as string,
    content_hash: row.content_hash as string,
    parent_prompt_id: asNullableString(row.parent_prompt_id),
    created_at: row.created_at as string,
    created_by_user_id: asNullableNumber(row.created_by_user_id),
  };
}

export function canAccessPromptVersion(
  version: PromptVersion,
  userId: number,
): boolean {
  const user = getUserById(userId);
  if (!user) return false;
  if (user.role === "admin") return true;
  return version.created_by_user_id === userId;
}

export function getPromptVersion(
  id: string,
  userId: number,
): PromptVersion | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM prompt_versions WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const version = rowToPromptVersion(row);
  return canAccessPromptVersion(version, userId) ? version : undefined;
}

function getLatestPromptVersion(
  scopeType: string,
  scopeId: string,
): PromptVersion | undefined {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM prompt_versions
     WHERE scope_type = ? AND scope_id = ?
     ORDER BY version_number DESC LIMIT 1`,
  ).get(scopeType, scopeId) as Record<string, unknown> | undefined;
  return row ? rowToPromptVersion(row) : undefined;
}

export function listPromptVersions(
  scopeType: string,
  scopeId: string,
  userId: number,
): PromptVersion[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM prompt_versions
     WHERE scope_type = ? AND scope_id = ?
     ORDER BY version_number DESC`,
  ).all(scopeType, scopeId) as Record<string, unknown>[];
  return rows
    .map(rowToPromptVersion)
    .filter((v) => canAccessPromptVersion(v, userId));
}

export function getLatestPromptVersionFor(
  scopeType: string,
  scopeId: string,
  userId: number,
): PromptVersion | undefined {
  const latest = getLatestPromptVersion(scopeType, scopeId);
  return latest && canAccessPromptVersion(latest, userId) ? latest : undefined;
}

/**
 * Store a new prompt version for a scope. Identical content to the latest
 * version is not stored again (duplicate detection) but references are
 * still re-resolved in case assets moved.
 */
export async function savePromptVersion(
  userId: number,
  scopeType: string,
  scopeId: string,
  content: string,
  roles: Record<string, string> = {},
): Promise<SavedPrompt> {
  if (!PROMPT_SCOPE_TYPES.includes(scopeType as PromptScopeType)) {
    throw badRequest(
      `scope_type must be one of: ${PROMPT_SCOPE_TYPES.join(", ")}`,
    );
  }
  if (!content) throw badRequest("content is required");

  const contentHash = await sha256Hex(content);
  const latest = getLatestPromptVersion(scopeType, scopeId);
  const resolved = resolveReferenceText(userId, content, roles);
  const warnings = resolved
    .map(referenceWarningText)
    .filter((w): w is string => w !== null);

  let version: PromptVersion;
  let duplicate = false;
  if (latest && latest.content_hash === contentHash) {
    version = latest;
    duplicate = true;
  } else {
    version = insertPromptVersion(
      userId,
      scopeType,
      scopeId,
      content,
      contentHash,
      latest?.id ?? null,
      (latest?.version_number ?? 0) + 1,
    );
  }

  const references = saveResolvedReferences(
    userId,
    scopeType,
    version.id,
    resolved,
  );
  return { version, duplicate, references, warnings };
}

function insertPromptVersion(
  userId: number,
  scopeType: string,
  scopeId: string,
  content: string,
  contentHash: string,
  parentPromptId: string | null,
  versionNumber: number,
): PromptVersion {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO prompt_versions (
      id, scope_type, scope_id, version_number, content, content_hash,
      parent_prompt_id, created_at, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  (insert.run as (...params: unknown[]) => unknown)(
    id,
    scopeType,
    scopeId,
    versionNumber,
    content,
    contentHash,
    parentPromptId,
    now,
    userId,
  );
  return getPromptVersion(id, userId) as PromptVersion;
}

/** Re-point a scope at an older version by appending it as a new version. */
export function restorePromptVersion(userId: number, versionId: string): SavedPrompt {
  const db = getDb();
  const row = db.prepare("SELECT * FROM prompt_versions WHERE id = ?")
    .get(versionId) as Record<string, unknown> | undefined;
  if (!row) throw badRequest("Prompt version not found");
  const source = rowToPromptVersion(row);
  if (!canAccessPromptVersion(source, userId)) throw badRequest("Prompt version not found");

  const latest = getLatestPromptVersion(source.scope_type, source.scope_id);
  if (latest && latest.content_hash === source.content_hash) {
    const references = saveResolvedReferences(
      userId,
      source.scope_type,
      latest.id,
      resolveReferenceText(userId, source.content),
    );
    return {
      version: latest,
      duplicate: true,
      references,
      warnings: [],
    };
  }

  const version = insertPromptVersion(
    userId,
    source.scope_type,
    source.scope_id,
    source.content,
    source.content_hash,
    latest?.id ?? null,
    (latest?.version_number ?? 0) + 1,
  );
  const resolved = resolveReferenceText(userId, source.content);
  const warnings = resolved
    .map(referenceWarningText)
    .filter((w): w is string => w !== null);
  const references = saveResolvedReferences(
    userId,
    source.scope_type,
    version.id,
    resolved,
  );
  return { version, duplicate: false, references, warnings };
}
