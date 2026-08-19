import { Database } from "@db/sqlite";
import { runMigrations } from "./migrate.ts";

let db: Database | null = null;

export function getDb(path?: string): Database {
  if (!db) {
    const dbPath = path ?? Deno.env.get("DB_PATH") ?? "./cinemaItor.db";
    db = new Database(dbPath);
    migrateLegacy(db);
    runMigrations(db);
  }
  return db;
}

function migrateLegacy(database: Database): void {
  // One-time compatibility for dev databases created before 0001_init.sql:
  // the legacy users table may exist without the is_active column.
  const cols = database.prepare("PRAGMA table_info(users)")
    .all() as unknown as { name: string }[];
  if (cols.length > 0 && !cols.some((c) => c.name === "is_active")) {
    database.exec(
      "ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
    );
  }
}

const ALL_TABLES = [
  "prompts",
  "scenes",
  "movies",
  "asset_permissions",
  "project_permissions",
  "asset_versions",
  "asset_tags",
  "asset_aliases",
  "asset_references",
  "assets",
  "models",
  "generation_jobs",
  "job_events",
  "storyboards",
  "storyboard_panels",
  "scenes",
  "shots",
  "prompt_versions",
  "sessions",
  "audit_logs",
  "projects",
  "users",
];

export function resetDb(): void {
  if (!db) return;
  for (const table of ALL_TABLES) {
    db.exec(`DELETE FROM ${table}`);
  }
  db.exec("DELETE FROM sqlite_sequence");
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
