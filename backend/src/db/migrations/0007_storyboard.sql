-- Migration 0007: storyboards, scenes, shots
--
-- Creative objects (Workstream 8 / Milestone 4). Panel/scene/shot prompts live
-- in prompt_versions (scope_type storyboard_panel/scene/shot) and their
-- resolved references in asset_references; these rows store pointers to the
-- prompt versions and to generated outputs.
--
-- The legacy demo API's `scenes` table (movies demo, 0001) is renamed to
-- legacy_scenes so the product scene model can use the natural name.

ALTER TABLE scenes RENAME TO legacy_scenes;

CREATE TABLE IF NOT EXISTS storyboards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_storyboards_project ON storyboards(project_id);

CREATE TABLE IF NOT EXISTS storyboard_panels (
  id TEXT PRIMARY KEY,
  storyboard_id TEXT NOT NULL,
  panel_order INTEGER NOT NULL,
  shot_number TEXT,
  description TEXT,
  prompt_version_id TEXT,
  duration REAL,
  camera_settings_json TEXT,
  mood TEXT,
  lighting TEXT,
  time_of_day TEXT,
  dialogue TEXT,
  voiceover TEXT,
  music_cue TEXT,
  sfx TEXT,
  transition TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  preview_asset_version_id TEXT,
  generated_clip_asset_version_id TEXT,
  linked_scene_id TEXT,
  linked_shot_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (storyboard_id, panel_order),
  FOREIGN KEY (storyboard_id) REFERENCES storyboards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_storyboard_panels_board
  ON storyboard_panels(storyboard_id, panel_order);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  storyboard_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  prompt_version_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  target_duration REAL,
  aspect_ratio_override TEXT,
  frame_rate_override REAL,
  notes TEXT,
  audio_plan_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (storyboard_id) REFERENCES storyboards(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id);
CREATE INDEX IF NOT EXISTS idx_scenes_storyboard ON scenes(storyboard_id);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  shot_order INTEGER NOT NULL,
  name TEXT,
  prompt_version_id TEXT,
  duration REAL,
  camera_settings_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  generated_asset_version_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (scene_id, shot_order),
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shots_scene ON shots(scene_id, shot_order);
