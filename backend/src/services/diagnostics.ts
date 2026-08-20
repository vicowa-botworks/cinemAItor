import { join } from "@std/path";
import { loadConfig } from "../config.ts";
import { ensureLayout, storageLayout } from "../storage/paths.ts";
import { getDb } from "../db/database.ts";
import { diagnosticCount, listDiagnostics } from "../db/diagnostics.ts";
import { listModels, type Model } from "../db/models.ts";
import { detectHardware, type HardwareInfo } from "./hardware.ts";
import { checkModelHealth, type HealthResult } from "./model_health.ts";

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

export async function storageReport(): Promise<StorageReport> {
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
