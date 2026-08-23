-- Migration 0019: skill system v1 (WS 14: skills, JSON workflows)
--
-- A skill is a named, versioned JSON workflow of generation steps. v1 steps
-- are audio generation (music / voiceover / sfx) and run against the job
-- queue. No arbitrary code is executed: the engine validates the definition,
-- resolves typed inputs, interpolates {{ input }} placeholders and enqueues
-- one generation job per step.
--
-- skills          - current definition per skill (id is a user-facing slug)
-- skill_versions  - immutable snapshot of every saved version
-- skill_runs      - one row per execution, links back to the jobs it queued

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  author TEXT,
  version TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skill_versions_skill
  ON skill_versions(skill_id, id);

CREATE TABLE IF NOT EXISTS skill_runs (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  inputs_json TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  error_text TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- status is 'running' until every queued job reaches a terminal state; reads
-- finalize lazily (succeeded when all jobs succeeded, failed otherwise).
CREATE INDEX IF NOT EXISTS idx_skill_runs_skill
  ON skill_runs(skill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_runs_project
  ON skill_runs(project_id, created_at);

-- The system skill starter set (sys-tense-score, sys-foley-pass) is seeded at
-- server bootstrap by seedSystemSkills() in src/db/skills.ts (idempotent),
-- so the definitions live in one place.
