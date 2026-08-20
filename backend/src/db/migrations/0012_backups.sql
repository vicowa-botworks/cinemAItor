-- Migration 0012: project backups (Workstream 13 / DIA-006 + DIA-007)
--
-- Backups are point-in-time JSON snapshots of one project's asset and
-- timeline subtrees, written into <app_data>/backups/. Media binaries are
-- not copied; they are addressed by content hash so a restore can report
-- which files are already in the content store and which are missing.

CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_user_id INTEGER,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_backups_project ON backups(project_id);
CREATE INDEX IF NOT EXISTS idx_backups_created_by ON backups(created_by_user_id);
