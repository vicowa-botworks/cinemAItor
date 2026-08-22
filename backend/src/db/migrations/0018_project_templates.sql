-- Migration 0018: project templates (Milestone 7)
--
-- Global, system-seeded starting structures applied at project creation
-- time (projects.template_id records which one was used). Structure is a
-- JSON object: { timeline_name: string|null, tracks: [{ name, track_type }] }.

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  structure_json TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO templates (id, name, description, structure_json, is_system, created_at, updated_at) VALUES
  (
    'tpl-blank',
    'Blank',
    'No default timeline - start from a completely empty project.',
    '{"timeline_name": null, "tracks": []}',
    1,
    datetime('now'),
    datetime('now')
  ),
  (
    'tpl-short-film',
    'Short film',
    'One "Main" timeline with a video picture track, dialogue, music and a text overlay track.',
    '{"timeline_name": "Main", "tracks": [{"name": "Picture", "track_type": "video"}, {"name": "Dialogue", "track_type": "dialogue"}, {"name": "Music", "track_type": "music"}, {"name": "Captions", "track_type": "text"}]}',
    1,
    datetime('now'),
    datetime('now')
  ),
  (
    'tpl-podcast',
    'Podcast / audio',
    'One "Main" timeline with dialogue, a music bed, ambience and a subtitle track.',
    '{"timeline_name": "Main", "tracks": [{"name": "Dialogue", "track_type": "dialogue"}, {"name": "Music", "track_type": "music"}, {"name": "Ambience", "track_type": "ambience"}, {"name": "Subtitles", "track_type": "subtitle"}]}',
    1,
    datetime('now'),
    datetime('now')
  );
