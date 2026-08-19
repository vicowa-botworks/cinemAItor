-- Migration 0003: asset library
-- Assets, aliases, tags, versions and the references table (used later by the
-- reference engine; needed now for broken-reference warnings on delete).

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  library_scope TEXT NOT NULL,
  project_id TEXT,
  unique_slug TEXT UNIQUE NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_assets_library_scope ON assets(library_scope);
CREATE INDEX IF NOT EXISTS idx_assets_project_id ON assets(project_id);
CREATE INDEX IF NOT EXISTS idx_assets_asset_type ON assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_slug ON assets(unique_slug);

CREATE TABLE IF NOT EXISTS asset_aliases (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  alias_slug TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_aliases_asset ON asset_aliases(asset_id);

CREATE TABLE IF NOT EXISTS asset_tags (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  UNIQUE (asset_id, tag),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_asset_tags_asset ON asset_tags(asset_id);

CREATE TABLE IF NOT EXISTS asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  content_hash TEXT,
  file_path TEXT,
  format TEXT,
  mime_type TEXT,
  file_size INTEGER,
  checksum_algorithm TEXT NOT NULL DEFAULT 'sha256',
  technical_metadata_json TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by_user_id INTEGER,
  UNIQUE (asset_id, version_number),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_asset_versions_asset ON asset_versions(asset_id);

CREATE TABLE IF NOT EXISTS asset_references (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_asset_references_source ON asset_references(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_asset_references_asset ON asset_references(asset_id);
