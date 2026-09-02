-- 0028: movie scripts (versioned screenplay text).
-- A movie script is a per-project creative document holding Fountain-lite
-- screenplay text. The text itself lives in prompt_versions (scope_type
-- 'movie_script') so every edit and every LLM generation becomes a version;
-- the row stores the pointer to the active prompt version plus metadata.
CREATE TABLE IF NOT EXISTS movie_scripts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prompt_version_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_movie_scripts_project ON movie_scripts(project_id);
