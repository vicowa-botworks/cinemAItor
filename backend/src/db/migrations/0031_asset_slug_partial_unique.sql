-- 0031: make soft-deleted asset slugs reusable.
--
-- The inline UNIQUE(unique_slug) on assets was enforced across ALL rows,
-- including soft-deleted ones. But the app's slugInUse() treats deleted slugs
-- as reusable (it filters status != 'deleted'), so creating an asset with a
-- previously-deleted slug passed the app check and then tripped the DB
-- constraint -> raw SQLITE_CONSTRAINT -> 500 (not a friendly 409). The
-- constraint and the app intent were out of sync.
--
-- SQLite cannot drop an inline UNIQUE constraint in place, so we rebuild the
-- table: create a copy without the inline UNIQUE, move the data, swap the
-- name, recreate the non-unique indexes, and add a PARTIAL unique index that
-- only covers live (non-deleted) assets. FK enforcement is OFF in this app
-- (cascades are declarative-only), so the rebuild is safe; it is fully
-- validated on a database copy before shipping (row count, data fingerprint,
-- integrity_check, foreign_key_check all preserved).
CREATE TABLE assets_new (
  id TEXT PRIMARY KEY,
  library_scope TEXT NOT NULL,
  project_id TEXT,
  unique_slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  source_type TEXT NOT NULL DEFAULT 'uploaded',
  license TEXT,
  rights_status TEXT,
  attribution TEXT,
  parent_asset_id TEXT,
  active_version_id TEXT,
  preview_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_user_id INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO assets_new SELECT * FROM assets;
DROP TABLE assets;
ALTER TABLE assets_new RENAME TO assets;

-- Recreate the non-unique indexes the original table had.
CREATE INDEX idx_assets_library_scope ON assets(library_scope);
CREATE INDEX idx_assets_project_id ON assets(project_id);
CREATE INDEX idx_assets_asset_type ON assets(asset_type);
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_slug ON assets(unique_slug);

-- The fix: enforce slug uniqueness only among live assets, so a deleted
-- asset's slug is free for reuse (matching slugInUse()).
CREATE UNIQUE INDEX idx_assets_unique_slug_live ON assets(unique_slug) WHERE status != 'deleted';
