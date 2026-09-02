-- 0029: MCP (Model Context Protocol) tool server registry (Workstream 17).
-- Admins register external MCP tool servers (stdio child processes or
-- Streamable HTTP endpoints); the Model Copilot exposes their tools alongside
-- the built-in ones (qualified names mcp__<server>__<tool>). Header values
-- (potential secrets) are masked in API views.
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
  command TEXT,
  args_json TEXT,
  env_json TEXT,
  url TEXT,
  headers_json TEXT,
  timeout_seconds INTEGER NOT NULL DEFAULT 120,
  enabled INTEGER NOT NULL DEFAULT 1,
  auto_approve INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_created_at ON mcp_servers (created_at DESC);
