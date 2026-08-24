import { getDb } from "@cinemaItor/db/database.ts";
import { generateToken, sha256Hex, TOKEN_EXPIRY_MS } from "@cinemaItor/services/jwt.ts";

export interface Session {
  id: string;
  user_id: number;
  jti: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function issueSession(userId: number): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  const token = await generateToken(userId, id);
  const tokenHash = await sha256Hex(token);
  const insert = db.prepare(
    `INSERT INTO sessions (id, user_id, jti, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  (insert.run as unknown as (...params: unknown[]) => unknown)(
    id,
    userId,
    id,
    tokenHash,
    nowIso(),
    new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString(),
  );
  return token;
}

export function isSessionValid(jti: string): boolean {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, expires_at, revoked_at FROM sessions WHERE jti = ?",
  ).get(jti) as
    | { id: string; expires_at: string; revoked_at: string | null }
    | undefined;
  if (!row) return false;
  if (row.revoked_at) return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

export function revokeSession(jti: string): boolean {
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE jti = ? AND revoked_at IS NULL",
  );
  const affected = (
    stmt.run as unknown as (...params: unknown[]) => number
  )(nowIso(), jti);
  return affected > 0;
}

export function revokeAllUserSessions(userId: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
  ).run(nowIso(), userId);
}
