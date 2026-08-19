-- Migration 0010: render/export (Workstream 12 / Milestone 6)
--
-- Render presets, the render job queue (leased, recoverable like
-- generation jobs), render log events, and export records tied to produced
-- asset versions (export provenance).

CREATE TABLE IF NOT EXISTS render_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  output_format TEXT NOT NULL,
  resolution TEXT,
  frame_rate REAL,
  codec TEXT,
  audio_codec TEXT,
  bitrate TEXT,
  settings_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO render_presets (id, name, kind, output_format, resolution, frame_rate, codec, audio_codec, bitrate, settings_json, created_at, updated_at) VALUES
  ('preset-draft', 'Draft 720p30', 'draft', 'mp4', '1280x720', 30, 'h264', 'aac', '5000k', NULL, datetime('now'), datetime('now')),
  ('preset-final', 'Final 1080p60', 'final', 'mp4', '1920x1080', 60, 'h264', 'aac', '12000k', NULL, datetime('now'), datetime('now')),
  ('preset-audio', 'Audio WAV', 'final', 'wav', NULL, NULL, NULL, 'pcm_s16le', NULL, NULL, datetime('now'), datetime('now'));

CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  timeline_id TEXT NOT NULL,
  preset_id TEXT,
  engine TEXT,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  error_text TEXT,
  output_path TEXT,
  validation_report_json TEXT,
  created_by_user_id INTEGER NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (timeline_id) REFERENCES timelines(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_render_jobs_status ON render_jobs(status);
CREATE INDEX IF NOT EXISTS idx_render_jobs_project ON render_jobs(project_id);

CREATE TABLE IF NOT EXISTS render_events (
  id TEXT PRIMARY KEY,
  render_job_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (render_job_id) REFERENCES render_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_render_events_job ON render_events(render_job_id, created_at);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  render_job_id TEXT NOT NULL,
  asset_id TEXT,
  asset_version_id TEXT,
  file_path TEXT NOT NULL,
  format TEXT NOT NULL,
  settings_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (render_job_id) REFERENCES render_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exports_project ON exports(project_id);
CREATE INDEX IF NOT EXISTS idx_exports_render ON exports(render_job_id);
