import { getDb } from "./database.ts";
import {
  type Asset,
  type AssetVersion,
  getAssetBySlug,
  getAssetVersion,
  getAssetVersionByNumber,
  hasAssetPermission,
} from "./assets.ts";
import { parseReferenceTokens, type ReferenceToken } from "../services/reference_parser.ts";
import { badRequest, forbidden } from "../errors.ts";

export type ReferenceStatus = "resolved" | "missing" | "ambiguous";

export const REFERENCE_STATUSES: ReferenceStatus[] = [
  "resolved",
  "missing",
  "ambiguous",
];

export const REFERENCE_SOURCE_TYPES = [
  "prompt",
  "scene",
  "shot",
  "storyboard_panel",
] as const;
export type ReferenceSourceType = (typeof REFERENCE_SOURCE_TYPES)[number];

export interface ReferenceRow {
  id: string;
  source_type: string;
  source_id: string;
  asset_id: string | null;
  asset_version_id: string | null;
  role: string | null;
  raw_text: string;
  start_index: number | null;
  end_index: number | null;
  status: ReferenceStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResolvedReference {
  token: ReferenceToken;
  status: ReferenceStatus;
  asset: Asset | null;
  asset_version: AssetVersion | null;
  role: string | null;
  notes: string | null;
}

export interface ReferenceAuditEntry {
  reference: ReferenceRow;
  asset_slug: string | null;
  asset_status: string | null;
  asset_display_name: string | null;
  broken: boolean;
}

export interface ReferenceAuditFilter {
  source_type?: string;
  source_id?: string;
  asset_id?: string;
  status?: ReferenceStatus;
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

function rowToReference(row: Record<string, unknown>): ReferenceRow {
  return {
    id: row.id as string,
    source_type: row.source_type as string,
    source_id: row.source_id as string,
    asset_id: asNullableString(row.asset_id),
    asset_version_id: asNullableString(row.asset_version_id),
    role: asNullableString(row.role),
    raw_text: row.raw_text as string,
    start_index: asNullableNumber(row.start_index),
    end_index: asNullableNumber(row.end_index),
    status: row.status as ReferenceStatus,
    notes: asNullableString(row.notes),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
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
     VALUES (?, ?, ?, 'reference', ?, ?, ?)`,
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

/**
 * Resolve a single token against live assets. A token resolves when the slug
 * exists, the caller may read the asset, and (for versioned tokens) the
 * requested version exists.
 */
export function resolveReferenceToken(
  userId: number,
  token: ReferenceToken,
  role: string | null = null,
): ResolvedReference {
  const asset = getAssetBySlug(token.slug);
  if (!asset) {
    return {
      token,
      status: "missing",
      asset: null,
      asset_version: null,
      role,
      notes: `No asset named '@${token.slug}' exists`,
    };
  }
  if (!hasAssetPermission(userId, asset.id, "read")) {
    return {
      token,
      status: "missing",
      asset: null,
      asset_version: null,
      role,
      notes: `No read access to asset '@${token.slug}'`,
    };
  }

  let assetVersion: AssetVersion | null = null;
  if (token.version !== null) {
    assetVersion = getAssetVersionByNumber(asset.id, token.version) ?? null;
    if (!assetVersion) {
      return {
        token,
        status: "missing",
        asset,
        asset_version: null,
        role,
        notes: `@${token.slug}:v${token.version} - version ${token.version} does not exist`,
      };
    }
  } else {
    assetVersion = asset.active_version_id
      ? (getAssetVersion(asset.active_version_id) ?? null)
      : null;
  }

  return {
    token,
    status: "resolved",
    asset,
    asset_version: assetVersion,
    role,
    notes: null,
  };
}

/** Parse text and resolve every @token for a user, with optional roles map. */
export function resolveReferenceText(
  userId: number,
  text: string,
  roles: Record<string, string> = {},
): ResolvedReference[] {
  return parseReferenceTokens(text).map((token) =>
    resolveReferenceToken(userId, token, roles[token.slug] ?? null)
  );
}

/** Replace the stored references of a source with freshly resolved rows. */
export function saveResolvedReferences(
  userId: number,
  sourceType: string,
  sourceId: string,
  resolved: ResolvedReference[],
): ReferenceRow[] {
  const db = getDb();
  const now = nowIso();

  const del = db.prepare(
    "DELETE FROM asset_references WHERE source_type = ? AND source_id = ?",
  );
  (del.run as (...params: unknown[]) => unknown)(sourceType, sourceId);

  const insert = db.prepare(
    `INSERT INTO asset_references (
      id, source_type, source_id, asset_id, asset_version_id, role, raw_text,
      start_index, end_index, status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const rows: ReferenceRow[] = resolved.map((r) => {
    const row: ReferenceRow = {
      id: crypto.randomUUID(),
      source_type: sourceType,
      source_id: sourceId,
      asset_id: r.asset?.id ?? null,
      asset_version_id: r.asset_version?.id ?? null,
      role: r.role,
      raw_text: r.token.raw,
      start_index: r.token.start,
      end_index: r.token.end,
      status: r.status,
      notes: r.notes,
      created_at: now,
      updated_at: now,
    };
    (insert.run as (...params: unknown[]) => unknown)(
      row.id,
      row.source_type,
      row.source_id,
      row.asset_id,
      row.asset_version_id,
      row.role,
      row.raw_text,
      row.start_index,
      row.end_index,
      row.status,
      row.notes,
      row.created_at,
      row.updated_at,
    );
    return row;
  });

  logAudit(userId, "reference.save", sourceId, {
    source_type: sourceType,
    count: rows.length,
    missing: rows.filter((r) => r.status === "missing").length,
  });
  return rows;
}

export function getReference(id: string): ReferenceRow | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM asset_references WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToReference(row) : undefined;
}

export function listReferencesForSource(
  sourceType: string,
  sourceId: string,
): ReferenceRow[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM asset_references
     WHERE source_type = ? AND source_id = ?
     ORDER BY start_index`,
  ).all(sourceType, sourceId) as Record<string, unknown>[];
  return rows.map(rowToReference);
}

/** Audit list with asset context and a computed broken flag. */
export function auditReferences(
  filter: ReferenceAuditFilter = {},
): ReferenceAuditEntry[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.source_type) {
    clauses.push("r.source_type = ?");
    params.push(filter.source_type);
  }
  if (filter.source_id) {
    clauses.push("r.source_id = ?");
    params.push(filter.source_id);
  }
  if (filter.asset_id) {
    clauses.push("r.asset_id = ?");
    params.push(filter.asset_id);
  }
  if (filter.status) {
    clauses.push("r.status = ?");
    params.push(filter.status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (
    db.prepare(
      `SELECT r.*, a.unique_slug AS asset_slug, a.status AS asset_status,
              a.display_name AS asset_display_name
       FROM asset_references r
       LEFT JOIN assets a ON a.id = r.asset_id
       ${where}
       ORDER BY r.created_at DESC, r.source_type, r.source_id, r.start_index`,
    ).all as (...values: unknown[]) => unknown[]
  )(...params) as Record<string, unknown>[];

  return rows.map((row) => {
    const reference = rowToReference(row);
    const assetStatus = asNullableString(row.asset_status);
    const broken = reference.status === "missing" ||
      reference.status === "ambiguous" ||
      (reference.asset_id !== null &&
        (assetStatus === null || assetStatus === "deleted"));
    return {
      reference,
      asset_slug: asNullableString(row.asset_slug),
      asset_status: assetStatus,
      asset_display_name: asNullableString(row.asset_display_name),
      broken,
    };
  });
}

export interface ReplaceReferenceInput {
  slug: string;
  version?: number;
}

/** Remap a reference (typically a broken one) to a different asset. */
export function replaceReference(
  userId: number,
  referenceId: string,
  input: ReplaceReferenceInput,
): ReferenceRow | undefined {
  const reference = getReference(referenceId);
  if (!reference) return undefined;

  const asset = getAssetBySlug(input.slug);
  if (!asset || asset.status === "deleted") {
    throw badRequest("Replacement asset does not exist", input.slug);
  }
  if (!hasAssetPermission(userId, asset.id, "read")) {
    throw forbidden();
  }

  let version: AssetVersion | null = null;
  if (input.version !== undefined) {
    version = getAssetVersionByNumber(asset.id, input.version) ?? null;
    if (!version) {
      throw badRequest(
        `@${input.slug}:v${input.version} - version does not exist`,
        "version",
      );
    }
  } else if (asset.active_version_id) {
    version = getAssetVersion(asset.active_version_id) ?? null;
  }

  const db = getDb();
  const stmt = db.prepare(
    `UPDATE asset_references
     SET asset_id = ?, asset_version_id = ?, status = 'resolved',
         notes = NULL, updated_at = ?
     WHERE id = ?`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(
    asset.id,
    version?.id ?? null,
    nowIso(),
    referenceId,
  );
  logAudit(userId, "reference.replace", referenceId, {
    source: `${reference.source_type}:${reference.source_id}`,
    new_asset: asset.unique_slug,
    new_version: version?.version_number ?? null,
  });
  return getReference(referenceId);
}

/** Human-readable warning for an unresolved reference, if any. */
export function referenceWarningText(resolved: ResolvedReference): string | null {
  if (resolved.status === "resolved") return null;
  return resolved.notes ?? `@${resolved.token.slug} is not a known asset`;
}
