-- 0015: proxy workflow (Workstream 14 polish)
--
-- 1) asset_versions.proxy_path: stored path of the version's proxy media
--    (low-bitrate H.264 / MP3 / JPG, see docs/assets.md). Nullable — versions
--    without a generated proxy fall back to their master file.
ALTER TABLE asset_versions ADD COLUMN proxy_path TEXT;

-- 2) generation_jobs.model_id becomes nullable. Proxy jobs (job_type 'proxy')
--    run the ffmpeg proxy engine directly and have no model. SQLite cannot
--    drop NOT NULL in place, so rebuild the table.
CREATE TABLE IF NOT EXISTS generation_jobs_new (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  asset_id TEXT,
  scene_id TEXT,
  shot_id TEXT,
  storyboard_panel_id TEXT,
  job_type TEXT NOT NULL,
  model_id TEXT,
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
  candidate_version_ids TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO generation_jobs_new (
  id, project_id, asset_id, scene_id, shot_id, storyboard_panel_id, job_type,
  model_id, model_version, prompt_version_id, prompt_text, negative_prompt,
  seed, settings_json, input_asset_versions_json, reference_roles_json, status,
  progress, error_text, output_asset_version_id, candidate_count,
  candidate_version_ids, lease_owner, lease_expires_at,
  created_by_user_id, created_at, started_at, finished_at
)
SELECT
  id, project_id, asset_id, scene_id, shot_id, storyboard_panel_id, job_type,
  model_id, model_version, prompt_version_id, prompt_text, negative_prompt,
  seed, settings_json, input_asset_versions_json, reference_roles_json, status,
  progress, error_text, output_asset_version_id, candidate_count,
  candidate_version_ids, lease_owner, lease_expires_at,
  created_by_user_id, created_at, started_at, finished_at
FROM generation_jobs;

DROP TABLE generation_jobs;
ALTER TABLE generation_jobs_new RENAME TO generation_jobs;

CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_project ON generation_jobs(project_id);
