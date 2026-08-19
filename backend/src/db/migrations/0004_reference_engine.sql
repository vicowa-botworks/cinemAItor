-- Migration 0004: reference engine and prompt versioning

-- Prompts are versioned per scope. Edits create new rows; content hash
-- enables duplicate detection. parent_prompt_id links to the previous version.
CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  parent_prompt_id TEXT,
  created_at TEXT NOT NULL,
  created_by_user_id INTEGER,
  UNIQUE (scope_type, scope_id, version_number),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_scope
  ON prompt_versions(scope_type, scope_id, version_number);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_hash ON prompt_versions(content_hash);

-- asset_references gains a nullable asset_id so unresolved @tokens
-- (status 'missing') can be stored and listed in audits. SQLite cannot
-- alter column nullability, so the table is recreated with data preserved.
CREATE TABLE asset_references_next (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  asset_id TEXT,
  asset_version_id TEXT,
  role TEXT,
  raw_text TEXT NOT NULL,
  start_index INTEGER,
  end_index INTEGER,
  status TEXT NOT NULL DEFAULT 'resolved',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

INSERT INTO asset_references_next SELECT * FROM asset_references;
DROP TABLE asset_references;
ALTER TABLE asset_references_next RENAME TO asset_references;

CREATE INDEX IF NOT EXISTS idx_asset_references_source
  ON asset_references(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_asset_references_asset ON asset_references(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_references_status ON asset_references(status);
