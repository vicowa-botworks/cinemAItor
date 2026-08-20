import { getDb } from "./database.ts";
import type { LogSink } from "@cinemaItor/logger.ts";

export const DIAGNOSTIC_CATEGORIES = [
  "log",
  "request",
  "job",
  "render",
  "storage",
  "model",
  "system",
] as const;

export type DiagnosticCategory = (typeof DIAGNOSTIC_CATEGORIES)[number];

export const DIAGNOSTIC_SEVERITIES = ["debug", "info", "warn", "error"] as const;

export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export interface Diagnostic {
  id: string;
  category: DiagnosticCategory;
  severity: DiagnosticSeverity;
  message: string;
  data: Record<string, unknown> | null;
  created_at: string;
}

interface DiagnosticRow {
  id: string;
  category: string;
  severity: string;
  message: string;
  data_json: string | null;
  created_at: string;
}

const MAX_ROWS = 2000;

export function addDiagnostic(
  category: string,
  severity: string,
  message: string,
  data?: Record<string, unknown>,
): Diagnostic | undefined {
  if (!DIAGNOSTIC_CATEGORIES.includes(category as DiagnosticCategory)) {
    throw new Error(`Unknown diagnostics category: ${category}`);
  }
  if (!DIAGNOSTIC_SEVERITIES.includes(severity as DiagnosticSeverity)) {
    throw new Error(`Unknown diagnostics severity: ${severity}`);
  }
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO diagnostics (id, category, severity, message, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    category,
    severity,
    message,
    data ? JSON.stringify(data) : null,
    now,
  );
  // Cap table growth: keep the newest MAX_ROWS entries.
  db.prepare(
    `DELETE FROM diagnostics WHERE id NOT IN (
       SELECT id FROM diagnostics ORDER BY created_at DESC, rowid DESC LIMIT ?
     )`,
  ).run(MAX_ROWS);
  return {
    id,
    category: category as DiagnosticCategory,
    severity: severity as DiagnosticSeverity,
    message,
    data: data ?? null,
    created_at: now,
  };
}

export interface ListDiagnosticsOptions {
  category?: string;
  severity?: string;
  sinceHours?: number;
  limit?: number;
}

/**
 * Build the logger sink that mirrors warn/error entries into the diagnostics
 * table (DIA-003/DIA-005). Never throws — logging must survive DB hiccups.
 */
export function createDiagnosticLogSink(): LogSink {
  return (level, entry) => {
    try {
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(entry)) {
        if (key !== "ts" && key !== "level" && key !== "msg") data[key] = value;
      }
      addDiagnostic(
        "log",
        level === "error" ? "error" : "warn",
        String(entry.msg ?? ""),
        data,
      );
    } catch {
      // DB may be unavailable (boot order, tests) — never break logging.
    }
  };
}

export function listDiagnostics(
  options: ListDiagnosticsOptions = {},
): Diagnostic[] {
  const limit = options.limit ?? 100;
  if (!Number.isFinite(limit) || limit < 1 || limit > 1000) {
    throw new Error("limit must be a number between 1 and 1000");
  }
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (options.category) {
    clauses.push("category = ?");
    values.push(options.category);
  }
  if (options.severity) {
    clauses.push("severity = ?");
    values.push(options.severity);
  }
  if (options.sinceHours !== undefined) {
    if (!Number.isFinite(options.sinceHours) || options.sinceHours < 0) {
      throw new Error("sinceHours must be a non-negative number");
    }
    clauses.push("created_at >= ?");
    values.push(
      new Date(Date.now() - options.sinceHours * 3600 * 1000).toISOString(),
    );
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (
    getDb()
      .prepare(
        `SELECT * FROM diagnostics ${where}
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all as (...values: unknown[]) => unknown[]
  )(...values, limit) as unknown as DiagnosticRow[];
  return rows.map(rowToDiagnostic);
}

function rowToDiagnostic(row: DiagnosticRow): Diagnostic {
  let data: Record<string, unknown> | null = null;
  if (row.data_json) {
    try {
      data = JSON.parse(row.data_json) as Record<string, unknown>;
    } catch {
      data = { raw: row.data_json };
    }
  }
  return {
    id: row.id,
    category: row.category as DiagnosticCategory,
    severity: row.severity as DiagnosticSeverity,
    message: row.message,
    data,
    created_at: row.created_at,
  };
}

/** Total rows currently stored (for the storage report). */
export function diagnosticCount(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM diagnostics")
    .get() as unknown as { n: number };
  return row.n;
}
