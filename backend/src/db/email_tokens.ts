import { getDb } from "./database.ts";
import { sha256Hex } from "@cinemaItor/services/jwt.ts";

export type EmailTokenKind = "password_reset" | "email_confirmation";

export interface EmailToken {
  id: number;
  kind: EmailTokenKind;
  user_id: number;
  token_hash: string;
  expires_at: string;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function newRawToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function createEmailToken(
  kind: EmailTokenKind,
  userId: number,
  rawToken: string,
  expiresAt: string,
): Promise<void> {
  const db = getDb();
  db.prepare(
    `INSERT INTO email_tokens (kind, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(kind, userId, await sha256Hex(rawToken), expiresAt, nowIso());
}

export async function findEmailTokenByRawToken(
  kind: EmailTokenKind,
  rawToken: string,
): Promise<EmailToken | undefined> {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM email_tokens WHERE kind = ? AND token_hash = ?",
  ).get(kind, await sha256Hex(rawToken)) as EmailToken | undefined;
  if (!row) return undefined;
  if (row.used_at || row.revoked_at) return undefined;
  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return row;
}

export function markEmailTokenUsed(id: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE email_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL",
  ).run(nowIso(), id);
}

// Invalidate a user's outstanding tokens of a kind (e.g. on re-issue) so
// only the latest link works.
export function revokeUserEmailTokens(userId: number, kind: EmailTokenKind): void {
  const db = getDb();
  db.prepare(
    `UPDATE email_tokens SET revoked_at = ?
     WHERE user_id = ? AND kind = ? AND revoked_at IS NULL AND used_at IS NULL`,
  ).run(nowIso(), userId, kind);
}
