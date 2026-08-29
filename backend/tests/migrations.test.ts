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
        "models",
        "generation_jobs",
        "job_events",
        "storyboards",
        "storyboard_panels",
        "scenes",
        "shots",
        "review_decisions",
        "timelines",
        "tracks",
        "timeline_items",
        "timeline_markers",
        "timeline_snapshots",
        "render_presets",
        "render_jobs",
        "render_events",
        "exports",
        "diagnostics",
        "backups",
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
        "0005_models.sql",
        "0006_generation.sql",
        "0007_storyboard.sql",
        "0008_review.sql",
        "0009_timeline.sql",
        "0010_render.sql",
        "0011_diagnostics.sql",
        "0012_backups.sql",
        "0013_timeline_fx.sql",
        "0014_text_overlays.sql",
        "0015_proxy_workflow.sql",
        "0016_track_gain.sql",
        "0017_track_ducking.sql",
        "0018_project_templates.sql",
        "0019_skill_system.sql",
        "0020_model_benchmarks.sql",
        "0021_user_management.sql",
        "0022_advanced_presets.sql",
        "0023_sessions_jti.sql",
        "0024_email_system.sql",
        "0025_llm_conversations.sql",
      ]);
      assertEquals(first.skipped, []);
      const second = runMigrations(db);
      assertEquals(second.applied, []);
      assertEquals(second.skipped, [
        "0001_init.sql",
        "0002_sessions.sql",
        "0003_assets.sql",
        "0004_reference_engine.sql",
        "0005_models.sql",
        "0006_generation.sql",
        "0007_storyboard.sql",
        "0008_review.sql",
        "0009_timeline.sql",
        "0010_render.sql",
        "0011_diagnostics.sql",
        "0012_backups.sql",
        "0013_timeline_fx.sql",
        "0014_text_overlays.sql",
        "0015_proxy_workflow.sql",
        "0016_track_gain.sql",
        "0017_track_ducking.sql",
        "0018_project_templates.sql",
        "0019_skill_system.sql",
        "0020_model_benchmarks.sql",
        "0021_user_management.sql",
        "0022_advanced_presets.sql",
        "0023_sessions_jti.sql",
        "0024_email_system.sql",
        "0025_llm_conversations.sql",
      ]);
      assertEquals(
        (db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as {
          n: number;
        }).n,
        25,
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
      "0005_models.sql",
      "0006_generation.sql",
      "0007_storyboard.sql",
      "0008_review.sql",
      "0009_timeline.sql",
      "0010_render.sql",
      "0011_diagnostics.sql",
      "0012_backups.sql",
      "0013_timeline_fx.sql",
      "0014_text_overlays.sql",
      "0015_proxy_workflow.sql",
      "0016_track_gain.sql",
      "0017_track_ducking.sql",
      "0018_project_templates.sql",
      "0019_skill_system.sql",
      "0020_model_benchmarks.sql",
      "0021_user_management.sql",
      "0022_advanced_presets.sql",
      "0023_sessions_jti.sql",
      "0024_email_system.sql",
      "0025_llm_conversations.sql",
    ]);
  });

  it("adds is_active to legacy users tables", () => {
    const db = getDb(":memory:");
    const cols = db.prepare("PRAGMA table_info(users)").all() as unknown as {
      name: string;
    }[];
    assert(cols.some((c) => c.name === "is_active"));
  });

  it("upgrades databases created before the jti column existed (0023)", () => {
    const db = new Database(":memory:");
    try {
      // Simulate a dev database created before 0002 was revised: 0001 + the
      // original 0002 (no jti column) already applied, with a live session row.
      db.exec(
        Deno.readTextFileSync(
          new URL("../src/db/migrations/0001_init.sql", import.meta.url),
        ),
      );
      db.exec(
        Deno.readTextFileSync(
          new URL("../src/db/migrations/0002_sessions.sql", import.meta.url),
        ),
      );
      db.exec(
        `CREATE TABLE schema_migrations (
           name TEXT PRIMARY KEY,
           applied_at TEXT NOT NULL
         )`,
      );
      db.exec(
        `INSERT INTO schema_migrations (name, applied_at) VALUES
         ('0001_init.sql', '2026-01-01T00:00:00.000Z'),
         ('0002_sessions.sql', '2026-01-01T00:00:00.000Z')`,
      );
      db.exec(
        `INSERT INTO users (email, password_hash, display_name, role, created_at, updated_at)
         VALUES ('old@example.com', 'salt:hash', 'Old User', 'admin',
                 '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      );
      db.exec(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, revoked_at)
         VALUES ('sess-old', 1, 'token-hash-1', '2026-01-01T00:00:00.000Z',
                 '2026-01-08T00:00:00.000Z', NULL)`,
      );

      const result = runMigrations(db);
      assert(result.skipped.includes("0001_init.sql"));
      assert(result.skipped.includes("0002_sessions.sql"));
      assert(result.applied.includes("0023_sessions_jti.sql"));

      // The old session row survived with jti backfilled from the session id.
      const row = db.prepare(
        "SELECT id, user_id, jti, token_hash, created_at, expires_at, revoked_at FROM sessions WHERE id = 'sess-old'",
      ).get() as {
        id: string;
        user_id: number;
        jti: string;
        token_hash: string;
        created_at: string;
        expires_at: string;
        revoked_at: string | null;
      };
      assertEquals(row.user_id, 1);
      assertEquals(row.jti, "sess-old");
      assertEquals(row.token_hash, "token-hash-1");
      assertEquals(row.created_at, "2026-01-01T00:00:00.000Z");
      assertEquals(row.expires_at, "2026-01-08T00:00:00.000Z");
      assertEquals(row.revoked_at, null);

      // jti is now a unique column with its own index.
      const indexes = db.prepare("PRAGMA index_list(sessions)").all() as unknown as {
        name: string;
        "unique": number;
      }[];
      const jtiIndex = indexes.find((i) => {
        const cols = db.prepare(`PRAGMA index_info(${i.name})`)
          .all() as unknown as { name: string | null }[];
        return i["unique"] === 1 && cols.some((c) => c.name === "jti");
      });
      assert(jtiIndex, "expected a unique index over sessions.jti");

      // token_hash is no longer unique: duplicate hashes must be accepted.
      db.exec(
        `INSERT INTO sessions (id, user_id, jti, token_hash, created_at, expires_at)
         VALUES ('sess-new', 1, 'sess-new', 'token-hash-1',
                 '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z')`,
      );
    } finally {
      db.close();
    }
  });
});
