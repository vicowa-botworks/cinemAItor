import { afterEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { Database } from "@db/sqlite";
import { closeDb, getDb } from "../src/db/database.ts";
import { runMigrations } from "../src/db/migrate.ts";

function tableNames(db: Database): string[] {
  return ((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()) as unknown as { name: string }[]).map((r) => r.name);
}

describe("migrations", () => {
  afterEach(() => {
    closeDb();
  });

  it("creates the base schema", () => {
    const db = getDb(":memory:");
    const tables = tableNames(db);
    for (
      const expected of [
        "schema_migrations",
        "users",
        "movies",
        "scenes",
        "prompts",
        "projects",
        "project_permissions",
        "asset_permissions",
        "audit_logs",
        "sessions",
        "assets",
        "asset_aliases",
        "asset_tags",
        "asset_versions",
        "asset_references",
        "prompt_versions",
      ]
    ) {
      assert(tables.includes(expected), `expected table ${expected} to exist`);
    }
  });

  it("applies pending migrations exactly once", () => {
    const db = new Database(":memory:");
    try {
      const first = runMigrations(db);
      assertEquals(first.applied, [
        "0001_init.sql",
        "0002_sessions.sql",
        "0003_assets.sql",
        "0004_reference_engine.sql",
      ]);
      assertEquals(first.skipped, []);
      const second = runMigrations(db);
      assertEquals(second.applied, []);
      assertEquals(second.skipped, [
        "0001_init.sql",
        "0002_sessions.sql",
        "0003_assets.sql",
        "0004_reference_engine.sql",
      ]);
      assertEquals(
        (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as {
          n: number;
        }).n,
        4,
      );
    } finally {
      db.close();
    }
  });

  it("tracks applied migrations", () => {
    const db = getDb(":memory:");
    const rows = db.prepare("SELECT name FROM schema_migrations")
      .all() as unknown as { name: string }[];
    assertEquals(rows.map((r) => r.name), [
      "0001_init.sql",
      "0002_sessions.sql",
      "0003_assets.sql",
      "0004_reference_engine.sql",
    ]);
  });

  it("adds is_active to legacy users tables", () => {
    const db = getDb(":memory:");
    const cols = db.prepare("PRAGMA table_info(users)").all() as unknown as {
      name: string;
    }[];
    assert(cols.some((c) => c.name === "is_active"));
  });
});
