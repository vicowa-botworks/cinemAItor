-- 0014: text overlays (subtitles / text tracks)
-- Text-only timeline items carry their payload in item_text, so
-- asset_version_id becomes nullable (SQLite: rebuild the table).
CREATE TABLE IF NOT EXISTS timeline_items_new (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  asset_version_id TEXT,
  item_text TEXT,
  text_style_json TEXT,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  source_offset REAL NOT NULL DEFAULT 0,
  speed REAL NOT NULL DEFAULT 1,
  transform_json TEXT,
  fade_in REAL,
  fade_out REAL,
  transition TEXT,
  transition_duration REAL NOT NULL DEFAULT 0.5,
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

INSERT INTO timeline_items_new (
  id, timeline_id, track_id, asset_version_id, item_text, text_style_json,
  start_time, end_time, source_offset, speed, transform_json, fade_in,
  fade_out, transition, transition_duration, effect_chain_json,
  color_grade_json, audio_settings_json, notes, status, created_at, updated_at
)
SELECT
  id, timeline_id, track_id, asset_version_id, NULL, NULL,
  start_time, end_time, source_offset, speed, transform_json, fade_in,
  fade_out, transition, transition_duration, effect_chain_json,
  color_grade_json, audio_settings_json, notes, status, created_at, updated_at
FROM timeline_items;

DROP TABLE timeline_items;
ALTER TABLE timeline_items_new RENAME TO timeline_items;

CREATE INDEX IF NOT EXISTS idx_timeline_items_track
  ON timeline_items(track_id, start_time);
CREATE INDEX IF NOT EXISTS idx_timeline_items_timeline
  ON timeline_items(timeline_id);
