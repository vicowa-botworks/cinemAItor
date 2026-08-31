import { getDb } from "./database.ts";
import { notFound } from "../errors.ts";

export type LlmMessageRole = "user" | "assistant" | "event";

export interface LlmConversationSummary {
  id: string;
  user_id: number;
  title: string;
  model: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface LlmConversationMessage {
  id: number;
  role: LlmMessageRole;
  content: string;
  synthetic: boolean;
  steps: Array<Record<string, unknown>> | null;
  proposals: Array<Record<string, unknown>> | null;
  proposal_id: string | null;
  created_at: string;
}

export interface LlmConversation {
  id: string;
  user_id: number;
  title: string;
  model: string | null;
  created_at: string;
  updated_at: string;
  messages: LlmConversationMessage[];
}

interface ConversationRow {
  id: string;
  user_id: number;
  title: string;
  model: string | null;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function canAccess(
  owner: { user_id: number },
  userId: number,
  isAdmin: boolean,
): boolean {
  return isAdmin || owner.user_id === userId;
}

function requireConversation(
  id: string,
  userId: number,
  isAdmin: boolean,
): ConversationRow {
  const row = getDb()
    .prepare("SELECT * FROM llm_conversations WHERE id = ?")
    .get(id) as ConversationRow | undefined;
  if (!row || !canAccess(row, userId, isAdmin)) {
    throw notFound("Conversation not found");
  }
  return row;
}

/**
 * Ensure the conversation row exists before the agent loop runs. The row is
 * normally created by logAgentTurn AFTER the turn completes, but auto-approved
 * proposals log their outcome mid-loop — without this the first turn's event
 * rows would hit requireConversation's 404. An existing row is only access-
 * checked; the title is filled from the first user message and kept by
 * logAgentTurn (its empty-title CASE handles the pre-created row).
 */
export function touchConversation(
  conversationId: string,
  userId: number,
  isAdmin: boolean,
  title: string,
): void {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM llm_conversations WHERE id = ?")
    .get(conversationId) as ConversationRow | undefined;
  if (row) {
    if (!canAccess(row, userId, isAdmin)) throw notFound("Conversation not found");
    return;
  }
  db.prepare(
    `INSERT INTO llm_conversations (id, user_id, title, model, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
  ).run(conversationId, userId, title, nowIso(), nowIso());
}

function parseJsonList(raw: string | null): Array<Record<string, unknown>> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export interface AgentTurnLog {
  conversationId: string;
  userId: number;
  isAdmin: boolean;
  /** First user message of the conversation (already trimmed by the caller). */
  title: string;
  model: string | null;
  userMessage: { content: string; synthetic: boolean };
  assistantMessage: {
    content: string;
    steps: unknown[];
    proposals: unknown[];
  };
}

/**
 * Persist one copilot exchange (user message + assistant reply). The
 * conversation row is created on first sight — the client-chosen id starts a
 * new conversation, a known id appends to it. A conversation owned by
 * another user is invisible (404) to non-admins.
 */
export function logAgentTurn(turn: AgentTurnLog): void {
  const db = getDb();
  const now = nowIso();
  db.exec("BEGIN");
  try {
    const existing = db.prepare(
      "SELECT user_id FROM llm_conversations WHERE id = ?",
    ).get(turn.conversationId) as { user_id: number } | undefined;
    if (existing && !canAccess(existing, turn.userId, turn.isAdmin)) {
      throw notFound("Conversation not found");
    }
    if (existing) {
      // Keep the first turn's title; refresh recency + last model used.
      db.prepare(
        `UPDATE llm_conversations
         SET updated_at = ?,
             model = COALESCE(?, model),
             title = CASE WHEN title = '' THEN ? ELSE title END
         WHERE id = ?`,
      ).run(now, turn.model, turn.title, turn.conversationId);
    } else {
      db.prepare(
        `INSERT INTO llm_conversations (id, user_id, title, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        turn.conversationId,
        turn.userId,
        turn.title,
        turn.model,
        now,
        now,
      );
    }
    db.prepare(
      `INSERT INTO llm_messages (conversation_id, role, content, synthetic, created_at)
       VALUES (?, 'user', ?, ?, ?)`,
    ).run(
      turn.conversationId,
      turn.userMessage.content,
      turn.userMessage.synthetic ? 1 : 0,
      now,
    );
    db.prepare(
      `INSERT INTO llm_messages
         (conversation_id, role, content, synthetic, steps_json, proposals_json, created_at)
       VALUES (?, 'assistant', ?, 0, ?, ?, ?)`,
    ).run(
      turn.conversationId,
      turn.assistantMessage.content,
      JSON.stringify(turn.assistantMessage.steps),
      JSON.stringify(turn.assistantMessage.proposals),
      now,
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Append a proposal outcome (approved | rejected | auto_approved) as an
 * event row. "auto_approved" marks proposals executed immediately by the
 * agent loop under a model's agent_auto_approve flag (see docs/llm.md). */
export function logProposalEvent(
  conversationId: string,
  userId: number,
  isAdmin: boolean,
  proposalId: string,
  outcome: "approved" | "rejected" | "auto_approved",
): void {
  requireConversation(conversationId, userId, isAdmin);
  getDb()
    .prepare(
      `INSERT INTO llm_messages
         (conversation_id, role, content, synthetic, proposal_id, created_at)
       VALUES (?, 'event', ?, 0, ?, ?)`,
    )
    .run(conversationId, outcome, proposalId, nowIso());
}

/** The caller's own conversations, most recently updated first (all, for admins). */
export function listConversations(
  userId: number,
  isAdmin: boolean,
  limit = 50,
): LlmConversationSummary[] {
  const db = getDb();
  const rows = (
    isAdmin
      ? db.prepare(
        `SELECT c.*, COUNT(m.id) AS message_count
         FROM llm_conversations c
         LEFT JOIN llm_messages m ON m.conversation_id = c.id
         GROUP BY c.id
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ?`,
      ).all(limit)
      : db.prepare(
        `SELECT c.*, COUNT(m.id) AS message_count
         FROM llm_conversations c
         LEFT JOIN llm_messages m ON m.conversation_id = c.id
         WHERE c.user_id = ?
         GROUP BY c.id
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ?`,
      ).all(userId, limit)
  ) as Array<ConversationRow & { message_count: number }>;
  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    title: r.title,
    model: r.model,
    message_count: r.message_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

/** Full conversation (metadata + every message in order) or 404. */
export function getConversation(
  id: string,
  userId: number,
  isAdmin: boolean,
): LlmConversation {
  const db = getDb();
  const conv = requireConversation(id, userId, isAdmin);
  const rows = db
    .prepare(
      `SELECT * FROM llm_messages WHERE conversation_id = ? ORDER BY id ASC`,
    )
    .all(id) as Array<Record<string, unknown>>;
  const messages: LlmConversationMessage[] = rows.map((r) => ({
    id: r.id as number,
    role: r.role as LlmMessageRole,
    content: r.content as string,
    synthetic: (r.synthetic as number) === 1,
    steps: parseJsonList(r.steps_json as string | null),
    proposals: parseJsonList(r.proposals_json as string | null),
    proposal_id: (r.proposal_id as string | null) ?? null,
    created_at: r.created_at as string,
  }));
  return {
    id: conv.id,
    user_id: conv.user_id,
    title: conv.title,
    model: conv.model,
    created_at: conv.created_at,
    updated_at: conv.updated_at,
    messages,
  };
}

/** Remove a conversation and its messages. FK enforcement is off, so the
 *  message rows are deleted explicitly. */
export function deleteConversation(
  id: string,
  userId: number,
  isAdmin: boolean,
): void {
  requireConversation(id, userId, isAdmin);
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM llm_messages WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM llm_conversations WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
