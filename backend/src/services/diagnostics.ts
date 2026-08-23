import { join } from "@std/path";
import { loadConfig } from "../config.ts";
import { ensureLayout, storageLayout } from "../storage/paths.ts";
import { getDb } from "../db/database.ts";
import { diagnosticCount, listDiagnostics } from "../db/diagnostics.ts";
import { listModels, type Model } from "../db/models.ts";
import { detectHardware, type HardwareInfo } from "./hardware.ts";
import { checkModelHealth, type HealthResult } from "./model_health.ts";
import { sha256File } from "../storage/checksums.ts";

// ---------------------------------------------------------------------------
// DIA-001: hardware report
// ---------------------------------------------------------------------------

export interface HardwareReport {
  platform: string;
  arch: string;
  deno: string;
  uptime_sec: number;
  hardware: HardwareInfo;
}

const startedAt = Date.now();

export async function hardwareReport(): Promise<HardwareReport> {
  const hardware = await detectHardware();
  return {
    platform: Deno.build.os,
    arch: Deno.build.arch,
    deno: Deno.version.deno,
    uptime_sec: Math.floor((Date.now() - startedAt) / 1000),
    hardware,
  };
}

// ---------------------------------------------------------------------------
// DIA-002: model health report
// ---------------------------------------------------------------------------

export interface ModelReport {
  id: string;
  name: string;
  backend: Model["backend"];
  enabled: boolean;
  installed_at: string | null;
  health_status: string | null;
  health_error: string | null;
  check: HealthResult;
}

export interface ModelsReport {
  total: number;
  enabled: number;
  unhealthy: number;
  models: ModelReport[];
}

export async function modelsReport(): Promise<ModelsReport> {
  const layout = storageLayout(loadConfig().appDataDir);
  const models = listModels();
  const reports: ModelReport[] = [];
  for (const model of models) {
    const check = await checkModelHealth(layout, model);
    reports.push({
      id: model.id,
      name: model.name,
      backend: model.backend,
      enabled: model.enabled,
      installed_at: model.installed_at,
      health_status: model.health_status,
      health_error: model.health_error,
      check,
    });
  }
  return {
    total: reports.length,
    enabled: reports.filter((m) => m.enabled).length,
    unhealthy: reports.filter((m) => m.check.status === "error").length,
    models: reports,
  };
}

// ---------------------------------------------------------------------------
// DIA-003: storage report (usage, orphans, missing media)
// ---------------------------------------------------------------------------

export interface DirUsage {
  path: string;
  files: number;
  bytes: number;
}

// STO-011: usage broken down by owning project / asset (a content-addressed
// file shared by assets in several projects is counted for each of them).
export interface ProjectUsage {
  project_id: string | null;
  name: string | null;
  files: number;
  bytes: number;
}

export interface AssetUsage {
  asset_id: string;
  display_name: string;
  project_id: string | null;
  files: number;
  bytes: number;
}

// STO-010: integrity of the content store — each media file is re-hashed and
// compared against the hash encoded in its content-addressed name. Only
// produced when the report is requested with verify.
export interface IntegrityReport {
  verified: number;
  corrupted: { file_path: string; content_hash: string }[];
}

export interface StorageReport {
  app_data_dir: string;
  database_file: string;
  database_bytes: number | null;
  directories: DirUsage[];
  content_store: {
    files: number;
    bytes: number;
    orphaned: string[];
  };
  missing_versions: { asset_version_id: string; file_path: string }[];
  projects: ProjectUsage[];
  top_assets: AssetUsage[];
  integrity: IntegrityReport | null;
}

// STO-012: what a cache cleanup removed. Only regenerable files (previews,
// proxies, thumbnails) are ever removed automatically; orphaned media only
// when explicitly requested.
export interface CleanupReport {
  directories: DirUsage[];
  orphaned_media: { files: number; bytes: number };
  total_files: number;
  bytes_freed: number;
}

interface WalkResult {
  files: string[];
  bytes: number;
}

async function walk(dir: string): Promise<WalkResult> {
  const result: WalkResult = { files: [], bytes: 0 };
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        const sub = await walk(path);
        result.files.push(...sub.files);
        result.bytes += sub.bytes;
      } else if (entry.isFile) {
        try {
          const stat = await Deno.stat(path);
          result.files.push(path);
          result.bytes += stat.size;
        } catch {
          // File vanished mid-walk; ignore.
        }
      }
    }
  } catch {
    // Directory missing — report what we walked so far.
  }
  return result;
}

function fileHashOf(path: string): string {
  const fileName = path.split("/").pop() ?? "";
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export async function storageReport(
  opts: { verify?: boolean } = {},
): Promise<StorageReport> {
  const config = loadConfig();
  const layout = storageLayout(config.appDataDir);
  const directories: DirUsage[] = [];
  let mediaUsage: WalkResult = { files: [], bytes: 0 };
  for (
    const dir of [
      layout.media,
      layout.previews,
      layout.proxies,
      layout.thumbnails,
      layout.models,
      layout.renders,
      layout.logs,
      layout.cache,
    ]
  ) {
    const usage = await walk(dir);
    if (dir === layout.media) mediaUsage = usage;
    directories.push({
      path: dir === layout.root ? "." : dir.replace(`${layout.root}/`, ""),
      files: usage.files.length,
      bytes: usage.bytes,
    });
  }

  let databaseBytes: number | null = null;
  try {
    databaseBytes = (await Deno.stat(config.dbPath)).size;
  } catch {
    databaseBytes = null;
  }

  // Orphans: content-addressed files not referenced by any asset version.
  const referenced = new Set<string>();
  const missing: { asset_version_id: string; file_path: string }[] = [];
  const rows = getDb()
    .prepare(
      "SELECT id, content_hash, file_path FROM asset_versions WHERE file_path IS NOT NULL",
    )
    .all() as unknown as {
      id: string;
      content_hash: string | null;
      file_path: string;
    }[];
  for (const row of rows) {
    if (row.content_hash) referenced.add(row.content_hash);
    try {
      await Deno.stat(row.file_path);
    } catch {
      missing.push({ asset_version_id: row.id, file_path: row.file_path });
    }
  }
  const orphaned = mediaUsage.files
    .map(fileHashOf)
    .filter((hash) => !referenced.has(hash))
    .sort();

  // STO-011: group content-store usage by owning project and asset. A file
  // shared by assets in several projects counts for each of them.
  const versionRows = getDb()
    .prepare(
      "SELECT asset_id, content_hash FROM asset_versions WHERE content_hash IS NOT NULL",
    )
    .all() as unknown as { asset_id: string; content_hash: string }[];
  const assetRows = getDb()
    .prepare("SELECT id, display_name, project_id FROM assets")
    .all() as unknown as {
      id: string;
      display_name: string;
      project_id: string | null;
    }[];
  const projectRows = getDb()
    .prepare("SELECT id, name FROM projects")
    .all() as unknown as { id: string; name: string }[];
  const projectNames = new Map(projectRows.map((r) => [r.id, r.name]));
  const assetById = new Map(assetRows.map((a) => [a.id, a]));
  const hashToAssets = new Map<string, string[]>();
  for (const v of versionRows) {
    const list = hashToAssets.get(v.content_hash) ?? [];
    list.push(v.asset_id);
    hashToAssets.set(v.content_hash, list);
  }

  interface Agg {
    hashes: Set<string>;
    bytes: number;
  }
  const projectUsage = new Map<string | null, Agg & { name: string | null }>();
  const assetUsage = new Map<string, Agg>();
  for (const file of mediaUsage.files) {
    const hash = fileHashOf(file);
    let size = 0;
    try {
      size = (await Deno.stat(file)).size;
    } catch {
      // File vanished mid-walk; count it with zero bytes.
    }
    for (const assetId of hashToAssets.get(hash) ?? []) {
      const asset = assetById.get(assetId);
      if (!asset) continue;
      const key = asset.project_id;
      const p = projectUsage.get(key) ?? {
        name: asset.project_id ? projectNames.get(asset.project_id) ?? null : null,
        hashes: new Set<string>(),
        bytes: 0,
      };
      if (!p.hashes.has(hash)) {
        p.hashes.add(hash);
        p.bytes += size;
      }
      projectUsage.set(key, p);
      const a = assetUsage.get(assetId) ?? { hashes: new Set<string>(), bytes: 0 };
      if (!a.hashes.has(hash)) {
        a.hashes.add(hash);
        a.bytes += size;
      }
      assetUsage.set(assetId, a);
    }
  }
  const projects: ProjectUsage[] = [...projectUsage.entries()]
    .map(([project_id, u]) => ({
      project_id,
      name: u.name,
      files: u.hashes.size,
      bytes: u.bytes,
    }))
    .sort(
      (a, b) =>
        b.bytes - a.bytes ||
        String(a.project_id ?? "~").localeCompare(String(b.project_id ?? "~")),
    );
  const topAssets: AssetUsage[] = [...assetUsage.entries()]
    .map(([assetId, u]) => {
      const asset = assetById.get(assetId);
      return {
        asset_id: assetId,
        display_name: asset?.display_name ?? "",
        project_id: asset?.project_id ?? null,
        files: u.hashes.size,
        bytes: u.bytes,
      };
    })
    .sort((a, b) => b.bytes - a.bytes || a.asset_id.localeCompare(b.asset_id))
    .slice(0, 10);

  // STO-010: re-hash every content-store file against its name.
  let integrity: IntegrityReport | null = null;
  if (opts.verify) {
    const corrupted: { file_path: string; content_hash: string }[] = [];
    let verified = 0;
    for (const file of mediaUsage.files) {
      let actual: string;
      try {
        actual = await sha256File(file);
      } catch {
        // File vanished mid-walk; missing_versions covers it.
        continue;
      }
      verified++;
      const expected = fileHashOf(file);
      if (actual !== expected) {
        corrupted.push({ file_path: file, content_hash: expected });
      }
    }
    integrity = { verified, corrupted };
  }

  return {
    app_data_dir: layout.root,
    database_file: config.dbPath,
    database_bytes: databaseBytes,
    directories,
    content_store: {
      files: mediaUsage.files.length,
      bytes: mediaUsage.bytes,
      orphaned,
    },
    missing_versions: missing,
    projects,
    top_assets: topAssets,
    integrity,
  };
}

// STO-012: safe cleanup of regenerable files. Previews, proxies and
// thumbnails are always regenerable; orphaned content-store media (no
// asset version references it) only when explicitly requested. Referenced
// media, model files, renders, logs, backups and the database are never
// touched.
export async function cleanupStorageCache(
  opts: { includeOrphanedMedia: boolean } = { includeOrphanedMedia: false },
): Promise<CleanupReport> {
  const layout = storageLayout(loadConfig().appDataDir);
  const directories: DirUsage[] = [];
  let totalFiles = 0;
  let bytesFreed = 0;

  const cacheDirs: [string, string][] = [
    [layout.previews, "previews"],
    [layout.proxies, "proxies"],
    [layout.thumbnails, "thumbnails"],
  ];
  for (const [dir, label] of cacheDirs) {
    let files = 0;
    let bytes = 0;
    for (const file of (await walk(dir)).files) {
      try {
        bytes += (await Deno.stat(file)).size;
        await Deno.remove(file);
        files++;
      } catch {
        // File vanished mid-walk; ignore.
      }
    }
    directories.push({ path: label, files, bytes });
    totalFiles += files;
    bytesFreed += bytes;
  }

  let orphanFiles = 0;
  let orphanBytes = 0;
  if (opts.includeOrphanedMedia) {
    const rows = getDb()
      .prepare(
        "SELECT content_hash FROM asset_versions WHERE content_hash IS NOT NULL",
      )
      .all() as unknown as { content_hash: string }[];
    const referenced = new Set(rows.map((r) => r.content_hash));
    for (const file of (await walk(layout.media)).files) {
      if (referenced.has(fileHashOf(file))) continue;
      try {
        orphanBytes += (await Deno.stat(file)).size;
        await Deno.remove(file);
        orphanFiles++;
      } catch {
        // File vanished mid-walk; ignore.
      }
    }
  }
  totalFiles += orphanFiles;
  bytesFreed += orphanBytes;

  return {
    directories,
    orphaned_media: { files: orphanFiles, bytes: orphanBytes },
    total_files: totalFiles,
    bytes_freed: bytesFreed,
  };
}

// ---------------------------------------------------------------------------
// DIA-005: logs (via the diagnostics table)
// ---------------------------------------------------------------------------

export interface LogsReport {
  count: number;
  entries: ReturnType<typeof listDiagnostics>;
}

export function logsReport(options: {
  category?: string;
  severity?: string;
  sinceHours?: number;
  limit?: number;
} = {}): LogsReport {
  return {
    count: diagnosticCount(),
    entries: listDiagnostics(options),
  };
}

// ---------------------------------------------------------------------------
// DIA-004: redacted diagnostics export
// ---------------------------------------------------------------------------

export interface DiagnosticsExport {
  path: string;
  generated_at: string;
  size: number;
}

/**
 * Builds and writes a redacted diagnostics bundle (JSON). Secrets
 * (JWT secret, session tokens) are never included; the bundle is intended
 * to be shared with support.
 */
export async function exportDiagnostics(): Promise<DiagnosticsExport> {
  const config = loadConfig();
  const layout = ensureLayout(config.appDataDir);
  const [hardware, models, storage] = await Promise.all([
    hardwareReport(),
    modelsReport(),
    storageReport(),
  ]);
  const bundle = {
    generated_at: new Date().toISOString(),
    app: {
      deno: Deno.version.deno,
      platform: Deno.build.os,
      arch: Deno.build.arch,
      port: config.port,
      log_level: config.logLevel,
      app_data_dir: config.appDataDir,
      db_path: config.dbPath,
    },
    hardware,
    models,
    storage,
    diagnostics: listDiagnostics({ limit: 500 }),
  };
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(layout.logs, `diagnostics-${ts}.json`);
  const json = JSON.stringify(bundle, null, 2);
  await Deno.writeTextFile(path, json);
  return {
    path,
    generated_at: bundle.generated_at,
    size: bufferByteLength(json),
  };
}

function bufferByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
