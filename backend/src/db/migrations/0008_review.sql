-- Migration 0008: review workflow (Workstream 9 / Milestone 4)
--
-- Per-candidate (asset version) review decisions: approve / reject /
-- shortlist with notes. Approving a candidate promotes it to the asset's
-- active version (handled in the data layer).

CREATE TABLE IF NOT EXISTS review_decisions (
  id TEXT PRIMARY KEY,
  asset_version_id TEXT NOT NULL UNIQUE,
  job_id TEXT,
  decision TEXT NOT NULL,
  notes TEXT,
  decided_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_review_decisions_job ON review_decisions(job_id);

-- Jobs remember every candidate version id they produced (JSON array), so
-- the review board can list candidates without scanning provenance.
ALTER TABLE generation_jobs ADD COLUMN candidate_version_ids TEXT;
