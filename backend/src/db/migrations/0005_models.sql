-- Migration 0005: model manager
--
-- Registry of local generation models (Workstream 6 / Milestone 3).
-- Metadata + install state + task mapping + requirements + presets.

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT,
  repository_url TEXT,
  source_path TEXT,
  file_hash TEXT,
  license TEXT,
  backend TEXT NOT NULL,
  task_types_json TEXT NOT NULL DEFAULT '[]',
  input_types_json TEXT NOT NULL DEFAULT '[]',
  output_types_json TEXT NOT NULL DEFAULT '[]',
  supported_resolutions_json TEXT,
  supported_frame_rates_json TEXT,
  supported_duration_json TEXT,
  vram_requirement_mb INTEGER,
  ram_requirement_mb INTEGER,
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  default_settings_json TEXT NOT NULL DEFAULT '{}',
  known_limitations_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT,
  last_used_at TEXT,
  health_status TEXT,
  health_error TEXT,
  health_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_models_enabled ON models(enabled);
