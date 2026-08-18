import type { Database } from "@db/sqlite";

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export function runMigrations(db: Database): MigrationResult {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  );

  const rows = db.prepare("SELECT name FROM schema_migrations")
    .all() as unknown as { name: string }[];
  const alreadyApplied = new Set(rows.map((r) => r.name));

  const files: string[] = [];
  for (const entry of Deno.readDirSync(MIGRATIONS_DIR.pathname)) {
    if (entry.isFile && entry.name.endsWith(".sql")) {
      files.push(entry.name);
    }
  }
  files.sort();

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const file of files) {
    if (alreadyApplied.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = Deno.readTextFileSync(new URL(file, MIGRATIONS_DIR));
    db.exec("BEGIN");
    try {
      db.exec(sql);
      const insert = db.prepare(
        "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
      );
      (insert.run as unknown as (...params: unknown[]) => unknown)(
        file,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
      result.applied.push(file);
    } catch (err) {
      db.exec("ROLLBACK");
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Migration ${file} failed: ${message}`);
    }
  }
  return result;
}
