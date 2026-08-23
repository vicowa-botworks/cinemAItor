-- Migration 0020: model benchmark results (WS 14: model benchmark)
--
-- model_benchmarks - one row per benchmarked (model, task type). A benchmark
-- job runs a fixed benchmark generation for every benchmarkable task type the
-- model supports and records wall-clock duration, candidate count, and
-- output size. Results are measurement metadata only - no assets are stored.

CREATE TABLE IF NOT EXISTS model_benchmarks (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  benchmarked_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  candidate_count INTEGER NOT NULL,
  output_bytes INTEGER NOT NULL,
  seed TEXT,
  job_id TEXT,
  FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_model_benchmarks_model
  ON model_benchmarks (model_id, benchmarked_at DESC);
