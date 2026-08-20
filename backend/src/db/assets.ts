import { getDb } from "./database.ts";
import { getUserById } from "./schema.ts";
import {
  hasProjectPermission,
  PERMISSION_RANK,
  type ProjectPermission,
  projectPermissionRank,
} from "./projects.ts";
import { badRequest, conflict, forbidden, notFound } from "../errors.ts";

export type AssetScope = "global" | "project";
export type AssetPermission = keyof typeof PERMISSION_RANK;

export interface Asset {
  id: string;
  library_scope: AssetScope;
  project_id: string | null;
  unique_slug: string;
  display_name: string;
  asset_type: string;
  description: string | null;
  status: string;
  source_type: string;
  license: string | null;
  rights_status: string | null;
  attribution: string | null;
  parent_asset_id: string | null;
  active_version_id: string | null;
  preview_version_id: string | null;
  created_at: string;
  updated_at: string;
  created_by_user_id: number | null;
}

export interface AssetInput {
  unique_slug: string;
  display_name: string;
  asset_type: string;
  library_scope: AssetScope;
  project_id?: string | null;
  description?: string | null;
  license?: string | null;
  rights_status?: string | null;
  attribution?: string | null;
}

export type AssetUpdates = {
  display_name?: string;
  asset_type?: string;
  description?: string | null;
  status?: string;
  license?: string | null;
  rights_status?: string | null;
  attribution?: string | null;
};

export interface AssetVersion {
  id: string;
  asset_id: string;
  version_number: number;
  status: string;
  content_hash: string | null;
  file_path: string | null;
  proxy_path: string | null;
  format: string | null;
  mime_type: string | null;
  file_size: number | null;
  checksum_algorithm: string;
  technical_metadata_json: string | null;
  notes: string | null;
  created_at: string;
  created_by_user_id: number | null;
}

export interface AssetVersionInput {
  content_hash: string | null;
  file_path: string | null;
  format: string | null;
  mime_type: string | null;
  file_size: number | null;
  technical_metadata_json?: string | null;
  notes?: string | null;
  make_active?: boolean;
}

export interface AssetFilter {
  project_id?: string;
  library_scope?: AssetScope;
  asset_type?: string;
  status?: string;
  tag?: string;
  q?: string;
}

export const ASSET_STATUSES = [
  "draft",
  "approved",
  "rejected",
  "archived",
  "deleted",
] as const;

export const ASSET_SOURCE_TYPES = [
  "uploaded",
  "generated",
  "imported",
  "derived",
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function rowToAsset(row: Record<string, unknown>): Asset {
  return {
    id: row.id as string,
    library_scope: row.library_scope as AssetScope,
    project_id: asNullableString(row.project_id),
    unique_slug: row.unique_slug as string,
    display_name: row.display_name as string,
    asset_type: row.asset_type as string,
    description: asNullableString(row.description),
    status: row.status as string,
    source_type: row.source_type as string,
    license: asNullableString(row.license),
    rights_status: asNullableString(row.rights_status),
    attribution: asNullableString(row.attribution),
    parent_asset_id: asNullableString(row.parent_asset_id),
    active_version_id: asNullableString(row.active_version_id),
    preview_version_id: asNullableString(row.preview_version_id),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    created_by_user_id: asNullableNumber(row.created_by_user_id),
  };
}

function rowToAssetVersion(row: Record<string, unknown>): AssetVersion {
  return {
    id: row.id as string,
    asset_id: row.asset_id as string,
    version_number: row.version_number as number,
    status: row.status as string,
    content_hash: asNullableString(row.content_hash),
    file_path: asNullableString(row.file_path),
    proxy_path: asNullableString(row.proxy_path),
    format: asNullableString(row.format),
    mime_type: asNullableString(row.mime_type),
    file_size: asNullableNumber(row.file_size),
    checksum_algorithm: row.checksum_algorithm as string,
    technical_metadata_json: asNullableString(row.technical_metadata_json),
    notes: asNullableString(row.notes),
    created_at: row.created_at as string,
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
     VALUES (?, ?, ?, 'asset', ?, ?, ?)`,
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

/** @names are globally unique across primary slugs and aliases. */
function slugInUse(slug: string): boolean {
  const db = getDb();
  const asset = db.prepare(
    "SELECT 1 AS x FROM assets WHERE unique_slug = ? AND status != 'deleted'",
  ).get(slug) as { x: number } | undefined;
  if (asset) return true;
  const alias = db.prepare(
    "SELECT 1 AS x FROM asset_aliases WHERE alias_slug = ?",
  ).get(slug) as { x: number } | undefined;
  return alias !== undefined;
}

export function createAsset(input: AssetInput, userId: number): Asset {
  if (input.library_scope !== "global" && input.library_scope !== "project") {
    throw badRequest("library_scope must be 'global' or 'project'");
  }
  if (slugInUse(input.unique_slug)) {
    throw conflict(`Slug '@${input.unique_slug}' is already taken`, "unique_slug");
  }

  const db = getDb();
  const now = nowIso();
  const id = crypto.randomUUID();

  let projectId: string | null = null;
  if (input.library_scope === "project") {
    if (!input.project_id) {
      throw badRequest("project_id is required for project-scoped assets");
    }
    const project = db.prepare(
      "SELECT id, status FROM projects WHERE id = ?",
    ).get(input.project_id) as { id: string; status: string } | undefined;
    if (!project || project.status === "deleted") {
      throw notFound("Project not found");
    }
    if (!hasProjectPermission(userId, project.id, "write")) {
      throw forbidden();
    }
    projectId = project.id;
  }

  const insert = db.prepare(
    `INSERT INTO assets (
      id, library_scope, project_id, unique_slug, display_name, asset_type,
      description, status, source_type, license, rights_status, attribution,
      created_at, updated_at, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 'uploaded', ?, ?, ?, ?, ?, ?)`,
  );
  (insert.run as (...params: unknown[]) => unknown)(
    id,
    input.library_scope,
    projectId,
    input.unique_slug,
    input.display_name,
    input.asset_type,
    input.description ?? null,
    input.license ?? null,
    input.rights_status ?? null,
    input.attribution ?? null,
    now,
    now,
    userId,
  );

  logAudit(userId, "asset.create", id, {
    slug: input.unique_slug,
    library_scope: input.library_scope,
    project_id: projectId,
  });
  return getAssetById(id) as Asset;
}

export function getAssetById(id: string): Asset | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM assets WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToAsset(row) : undefined;
}

/** Resolve an @name (primary slug or alias) to a live asset. */
export function getAssetBySlug(slug: string): Asset | undefined {
  const db = getDb();
  const row = db.prepare(
    `SELECT a.* FROM assets a
     WHERE (a.unique_slug = ? OR EXISTS (
        SELECT 1 FROM asset_aliases al
        WHERE al.asset_id = a.id AND al.alias_slug = ?
      )) AND a.status != 'deleted'
     LIMIT 1`,
  ).get(slug, slug) as Record<string, unknown> | undefined;
  return row ? rowToAsset(row) : undefined;
}

export function hasAssetPermission(
  userId: number,
  assetId: string,
  required: AssetPermission = "read",
): boolean {
  const user = getUserById(userId);
  if (!user) return false;
  if (user.role === "admin") return true;

  const asset = getAssetById(assetId);
  if (!asset) return false;
  if (asset.created_by_user_id === userId) return true;

  let bestRank = 0;
  if (asset.library_scope === "project" && asset.project_id) {
    bestRank = Math.max(bestRank, projectPermissionRank(userId, asset.project_id));
  }
  const rows = getDb().prepare(
    "SELECT permission FROM asset_permissions WHERE asset_id = ? AND user_id = ?",
  ).all(assetId, userId) as unknown as { permission: string }[];
  for (const row of rows) {
    bestRank = Math.max(bestRank, PERMISSION_RANK[row.permission as ProjectPermission] ?? 0);
  }
  return bestRank >= PERMISSION_RANK[required];
}

export function getAssetAccessible(
  id: string,
  userId: number,
  required: AssetPermission = "read",
): Asset | undefined {
  const asset = getAssetById(id);
  if (!asset || asset.status === "deleted") return undefined;
  return hasAssetPermission(userId, id, required) ? asset : undefined;
}

export function listAssets(userId: number, filter: AssetFilter = {}): Asset[] {
  const db = getDb();
  const user = getUserById(userId);
  const isAdmin = user?.role === "admin";

  const clauses: string[] = [
    "a.status != 'deleted'",
    `(a.created_by_user_id = ? OR ? = 1 OR EXISTS (
       SELECT 1 FROM asset_permissions ap
       WHERE ap.asset_id = a.id AND ap.user_id = ?
     ))`,
  ];
  const params: unknown[] = [userId, isAdmin ? 1 : 0, userId];

  if (filter.project_id) {
    clauses.push("a.project_id = ?");
    params.push(filter.project_id);
  }
  if (filter.library_scope) {
    clauses.push("a.library_scope = ?");
    params.push(filter.library_scope);
  }
  if (filter.asset_type) {
    clauses.push("a.asset_type = ?");
    params.push(filter.asset_type);
  }
  if (filter.status) {
    clauses.push("a.status = ?");
    params.push(filter.status);
  }
  if (filter.tag) {
    clauses.push(
      `EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND t.tag = ?)`,
    );
    params.push(filter.tag);
  }
  if (filter.q) {
    clauses.push(
      "(a.unique_slug LIKE ? OR a.display_name LIKE ? OR a.description LIKE ?)",
    );
    const like = `%${filter.q}%`;
    params.push(like, like, like);
  }

  const rows = (
    db.prepare(
      `SELECT a.* FROM assets a WHERE ${clauses.join(" AND ")}
       ORDER BY a.updated_at DESC`,
    ).all as (...values: unknown[]) => unknown[]
  )(...params) as Record<string, unknown>[];
  return rows.map(rowToAsset);
}

export function updateAsset(
  id: string,
  userId: number,
  updates: AssetUpdates,
): Asset | undefined {
  if (!hasAssetPermission(userId, id, "write")) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];
  const allowed: Record<keyof AssetUpdates, string> = {
    display_name: "display_name",
    asset_type: "asset_type",
    description: "description",
    status: "status",
    license: "license",
    rights_status: "rights_status",
    attribution: "attribution",
  };
  for (
    const [key, column] of Object.entries(allowed) as [keyof AssetUpdates, string][]
  ) {
    const value = updates[key];
    if (value !== undefined) {
      fields.push(`${column} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return getAssetAccessible(id, userId, "write");

  fields.push("updated_at = ?");
  values.push(nowIso(), id);

  const db = getDb();
  const stmt = db.prepare(`UPDATE assets SET ${fields.join(", ")} WHERE id = ?`);
  (stmt.run as (...params: unknown[]) => unknown)(...values);
  logAudit(userId, "asset.update", id, { fields: Object.keys(updates) });
  return getAssetAccessible(id, userId, "write");
}

export interface AssetDeleteResult {
  id: string;
  referenced_by: number;
}

/** Soft-delete an asset. Returns how many references now dangle. */
export function deleteAsset(
  id: string,
  userId: number,
): AssetDeleteResult | undefined {
  if (!hasAssetPermission(userId, id, "admin")) return undefined;
  const db = getDb();

  const refCount = db.prepare(
    "SELECT COUNT(*) AS n FROM asset_references WHERE asset_id = ?",
  ).get(id) as unknown as { n: number };

  const stmt = db.prepare(
    "UPDATE assets SET status = 'deleted', updated_at = ? WHERE id = ?",
  );
  (stmt.run as (...params: unknown[]) => unknown)(nowIso(), id);
  logAudit(userId, "asset.delete", id, {
    status: "deleted",
    referenced_by: refCount.n,
  });
  return { id, referenced_by: refCount.n };
}

export function addAlias(assetId: string, userId: number, aliasSlug: string): void {
  if (!hasAssetPermission(userId, assetId, "write")) throw forbidden();
  if (slugInUse(aliasSlug)) {
    throw conflict(`Slug '@${aliasSlug}' is already taken`, "alias_slug");
  }
  const db = getDb();
  (db.prepare(
    `INSERT INTO asset_aliases (id, asset_id, alias_slug, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    assetId,
    aliasSlug,
    nowIso(),
  );
  logAudit(userId, "asset.alias.add", assetId, { alias: aliasSlug });
}

export function removeAlias(
  assetId: string,
  userId: number,
  aliasSlug: string,
): boolean {
  if (!hasAssetPermission(userId, assetId, "write")) return false;
  const db = getDb();
  const stmt = db.prepare(
    "DELETE FROM asset_aliases WHERE asset_id = ? AND alias_slug = ?",
  );
  return (stmt.run as (...params: unknown[]) => number)(assetId, aliasSlug) > 0;
}

export function listAliases(assetId: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT alias_slug FROM asset_aliases WHERE asset_id = ? ORDER BY created_at",
  ).all(assetId) as unknown as { alias_slug: string }[];
  return rows.map((r) => r.alias_slug);
}

export function addTag(assetId: string, userId: number, tag: string): void {
  if (!hasAssetPermission(userId, assetId, "write")) throw forbidden();
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO asset_tags (id, asset_id, tag) VALUES (?, ?, ?)`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(crypto.randomUUID(), assetId, tag);
  logAudit(userId, "asset.tag.add", assetId, { tag });
}

export function removeTag(assetId: string, userId: number, tag: string): boolean {
  if (!hasAssetPermission(userId, assetId, "write")) return false;
  const db = getDb();
  const stmt = db.prepare("DELETE FROM asset_tags WHERE asset_id = ? AND tag = ?");
  return (stmt.run as (...params: unknown[]) => number)(assetId, tag) > 0;
}

export function listTags(assetId: string): string[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag",
  ).all(assetId) as unknown as { tag: string }[];
  return rows.map((r) => r.tag);
}

export function createAssetVersion(
  assetId: string,
  userId: number,
  input: AssetVersionInput,
): AssetVersion {
  if (!hasAssetPermission(userId, assetId, "write")) throw forbidden();
  const db = getDb();
  const maxRow = db.prepare(
    "SELECT COALESCE(MAX(version_number), 0) AS n FROM asset_versions WHERE asset_id = ?",
  ).get(assetId) as unknown as { n: number };

  const id = crypto.randomUUID();
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO asset_versions (
      id, asset_id, version_number, status, content_hash, file_path, format,
      mime_type, file_size, technical_metadata_json, notes, created_at,
      created_by_user_id
    ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  (insert.run as (...params: unknown[]) => unknown)(
    id,
    assetId,
    maxRow.n + 1,
    input.content_hash,
    input.file_path,
    input.format,
    input.mime_type,
    input.file_size,
    input.technical_metadata_json ?? null,
    input.notes ?? null,
    now,
    userId,
  );

  if (input.make_active !== false) {
    db.prepare(
      "UPDATE assets SET active_version_id = ?, preview_version_id = ?, updated_at = ? WHERE id = ?",
    ).run(id, id, now, assetId);
  }
  logAudit(userId, "asset.version.create", assetId, { version_id: id });
  return getAssetVersion(id) as AssetVersion;
}

export function getAssetVersion(id: string): AssetVersion | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM asset_versions WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToAssetVersion(row) : undefined;
}

export function getAssetVersionByNumber(
  assetId: string,
  versionNumber: number,
): AssetVersion | undefined {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM asset_versions WHERE asset_id = ? AND version_number = ?",
  ).get(assetId, versionNumber) as Record<string, unknown> | undefined;
  return row ? rowToAssetVersion(row) : undefined;
}

export function listAssetVersions(assetId: string): AssetVersion[] {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY version_number DESC",
  ).all(assetId) as Record<string, unknown>[];
  return rows.map(rowToAssetVersion);
}

/** Store (or clear with `null`) the proxy media path for a version. */
export function setVersionProxy(
  versionId: string,
  proxyPath: string | null,
): AssetVersion | undefined {
  const db = getDb();
  db.prepare(
    "UPDATE asset_versions SET proxy_path = ? WHERE id = ?",
  ).run(proxyPath, versionId);
  return getAssetVersion(versionId);
}

/** Point the active/preview version pointers back at an older version. */
export function restoreAssetVersion(
  assetId: string,
  userId: number,
  versionId: string,
): AssetVersion | undefined {
  if (!hasAssetPermission(userId, assetId, "write")) return undefined;
  const version = getAssetVersion(versionId);
  if (!version || version.asset_id !== assetId) return undefined;

  const db = getDb();
  db.prepare(
    "UPDATE assets SET active_version_id = ?, preview_version_id = ?, updated_at = ? WHERE id = ?",
  ).run(versionId, versionId, nowIso(), assetId);
  logAudit(userId, "asset.version.restore", assetId, {
    version_id: versionId,
    version_number: version.version_number,
  });
  return version;
}
