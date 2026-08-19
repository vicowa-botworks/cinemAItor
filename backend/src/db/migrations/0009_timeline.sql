-- Migration 0009: timeline editor (Workstream 10 / Milestone 5)
--
-- Timelines hold ordered tracks of timeline items (placed asset versions).
-- Markers annotate the timeline; snapshots store a full restorable state.

CREATE TABLE IF NOT EXISTS timelines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  duration REAL NOT NULL DEFAULT 0,
  settings_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timelines_project ON timelines(project_id);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  track_type TEXT NOT NULL,
  name TEXT NOT NULL,
  track_order INTEGER NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  UNIQUE (timeline_id, track_order),
  FOREIGN KEY (timeline_id) REFERENCES timelines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS timeline_items (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  asset_version_id TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  source_offset REAL NOT NULL DEFAULT 0,
  speed REAL NOT NULL DEFAULT 1,
  transform_json TEXT,
  fade_in REAL,
  fade_out REAL,
  transition TEXT,
  effect_chain_json TEXT,
  color_grade_json TEXT,
  audio_settings_json TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (timeline_id) REFERENCES timelines(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timeline_items_track
  ON timeline_items(track_id, start_time);
CREATE INDEX IF NOT EXISTS idx_timeline_items_timeline
  ON timeline_items(timeline_id);

CREATE TABLE IF NOT EXISTS timeline_markers (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  time REAL NOT NULL,
  label TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (timeline_id) REFERENCES timelines(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timeline_markers_timeline
  ON timeline_markers(timeline_id, time);

CREATE TABLE IF NOT EXISTS timeline_snapshots (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  name TEXT NOT NULL,
  snapshot_data_json TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by_user_id INTEGER,
  FOREIGN KEY (timeline_id) REFERENCES timelines(id) ON DELETE CASCADE
);
