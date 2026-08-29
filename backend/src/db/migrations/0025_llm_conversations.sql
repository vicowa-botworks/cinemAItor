-- 0025: Model Copilot conversation logging
--
-- The copilot chat used to live only in browser memory: each turn sent the
-- full history, the backend kept no state, and a refresh lost the
-- conversation. These tables persist every copilot exchange (user message +
-- assistant reply with its tool steps and proposals) plus one event row per
-- proposal approval/rejection, so the workflow can be reviewed and improved
-- after the fact.
--
-- llm_conversations.id is a client-chosen UUID (the browser keeps it in
-- component memory for the live chat); a conversation is created on first
-- sight by logAgentTurn(). Ownership is per user; admins may read and
-- delete any conversation.
CREATE TABLE IF NOT EXISTS llm_conversations (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL DEFAULT '',
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_conversations_user
  ON llm_conversations(user_id, updated_at DESC);

-- llm_messages: append-only log. role is 'user' or 'assistant' (one row per
-- side of an exchange) or 'event' (a proposal outcome: content holds
-- 'approved' | 'rejected', proposal_id points at the proposal from the
-- assistant row's proposals_json). FK enforcement is off, so
-- deleteConversation() removes the message rows explicitly.
CREATE TABLE IF NOT EXISTS llm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES llm_conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'event')),
  content TEXT NOT NULL DEFAULT '',
  synthetic INTEGER NOT NULL DEFAULT 0,
  steps_json TEXT,
  proposals_json TEXT,
  proposal_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_messages_conversation
  ON llm_messages(conversation_id, id);
