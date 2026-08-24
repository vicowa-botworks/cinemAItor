import { getDb } from "./database.ts";
import { sha256Hex } from "@cinemaItor/services/jwt.ts";

export interface Invitation {
  id: number;
  email: string;
  display_name: string | null;
  token_hash: string;
  created_by: number | null;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface InvitationWithCreator extends Invitation {
  created_by_name: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function createInvitation(
  email: string,
  rawToken: string,
  createdById: number,
  expiresAt: string,
  displayName: string | null,
): Promise<number> {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO invitations (email, display_name, token_hash, created_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const row = stmt.get<{ id: number }>(
    email,
    displayName,
    await sha256Hex(rawToken),
    createdById,
    expiresAt,
    nowIso(),
  );
  if (!row) throw new Error("Failed to create invitation");
  return row.id;
}

export async function findInvitationByRawToken(
  rawToken: string,
): Promise<Invitation | undefined> {
  const db = getDb();
  return db
    .prepare("SELECT * FROM invitations WHERE token_hash = ?")
    .get(await sha256Hex(rawToken)) as Invitation | undefined;
}

export function findPendingInvitationByEmail(email: string): Invitation | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM invitations
       WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    )
    .get(email) as Invitation | undefined;
}

export function listInvitations(): InvitationWithCreator[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT i.*, u.display_name AS created_by_name
       FROM invitations i
       LEFT JOIN users u ON u.id = i.created_by
       ORDER BY i.created_at DESC, i.id DESC`,
    )
    .all() as unknown as InvitationWithCreator[];
  return rows;
}

export function getInvitationById(id: number): Invitation | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM invitations WHERE id = ?")
    .get(id) as Invitation | undefined;
}

export function revokeInvitationById(id: number): boolean {
  const db = getDb();
  const affected = db
    .prepare(
      "UPDATE invitations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND accepted_at IS NULL",
    )
    .run(nowIso(), id) as unknown as number;
  return affected > 0;
}

export function markInvitationAccepted(id: number): void {
  const db = getDb();
  db.prepare(
    "UPDATE invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL",
  ).run(nowIso(), id);
}
