-- 0027: saved ComfyUI workflows (treated as DATA, not LLM context).
-- A model's default_settings can reference one by id via 'workflow_ref'
-- instead of inlining the full prompt graph into the copilot's context.
-- content holds the ComfyUI API-format prompt graph (a node map of
-- {id: {class_type, inputs}}) as canonical JSON.
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  filename TEXT,
  content TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  node_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflows_created_at ON workflows (created_at DESC);
