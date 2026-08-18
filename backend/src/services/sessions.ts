import { getDb } from "@cinemaItor/db/database.ts";
import { generateToken, sha256Hex, TOKEN_EXPIRY_MS } from "@cinemaItor/services/jwt.ts";

export interface Session {
  id: string;
  user_id: number;
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
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  (insert.run as unknown as (...params: unknown[]) => unknown)(
    id,
    userId,
    tokenHash,
    nowIso(),
    new Date(Date.now() + TOKEN_EXPIRY_MS).toISOString(),
  );
  return token;
}

export async function isSessionValid(token: string): Promise<boolean> {
  const db = getDb();
  const row = db.prepare(
    "SELECT id, expires_at, revoked_at FROM sessions WHERE token_hash = ?",
  ).get(await sha256Hex(token)) as
    | { id: string; expires_at: string; revoked_at: string | null }
    | undefined;
  if (!row) return false;
  if (row.revoked_at) return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

export async function revokeSession(token: string): Promise<boolean> {
  const db = getDb();
  const tokenHash = await sha256Hex(token);
  const stmt = db.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
  );
  const affected = (
    stmt.run as unknown as (...params: unknown[]) => number
  )(nowIso(), tokenHash);
  return affected > 0;
}
