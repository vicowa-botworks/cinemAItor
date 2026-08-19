-- Migration 0006: generation pipeline
--
-- Job queue (Workstream 7 / Milestone 3). One row per generation request,
-- event log per job. Provenance is stored on the asset versions produced
-- (asset_versions.technical_metadata_json), not here.

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  asset_id TEXT,
  scene_id TEXT,
  shot_id TEXT,
  storyboard_panel_id TEXT,
  job_type TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT,
  prompt_version_id TEXT,
  prompt_text TEXT,
  negative_prompt TEXT,
  seed TEXT,
  settings_json TEXT NOT NULL,
  input_asset_versions_json TEXT,
  reference_roles_json TEXT,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  error_text TEXT,
  output_asset_version_id TEXT,
  candidate_count INTEGER,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_project ON generation_jobs(project_id);

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  data_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES generation_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, created_at);
