-- Workstream 13 / Milestone 6: diagnostics and operations (DIA-001..DIA-005)

CREATE TABLE IF NOT EXISTS diagnostics (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_diagnostics_created_at ON diagnostics (created_at);
CREATE INDEX IF NOT EXISTS idx_diagnostics_category ON diagnostics (category);
CREATE INDEX IF NOT EXISTS idx_diagnostics_severity ON diagnostics (severity);
