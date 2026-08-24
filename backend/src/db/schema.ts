import { getDb } from "./database.ts";

export interface User {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  is_active: number;
  must_change_password: number;
  created_at: string;
  updated_at: string;
}

export function createUser(
  email: string,
  passwordHash: string,
  displayName: string,
  role = "user",
  mustChangePassword = false,
): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO users (email, password_hash, display_name, role, must_change_password)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
  );
  const row = stmt.get<{ id: number }>(
    email,
    passwordHash,
    displayName,
    role,
    mustChangePassword ? 1 : 0,
  );
  if (!row) throw new Error("Failed to create user");
  return row.id;
}

export function countUsers(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS n FROM users")
    .get() as unknown as { n: number };
  return row.n;
}

export function getUserById(id: number): User | undefined {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
  return stmt.get(id) as User | undefined;
}

export function getUserByEmail(email: string): User | undefined {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM users WHERE email = ?");
  return stmt.get(email) as User | undefined;
}

export function listUsers(): User[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM users ORDER BY created_at, id")
    .all() as unknown as User[];
  return rows;
}

export function countActiveAdmins(): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1",
  ).get() as unknown as { n: number };
  return row.n;
}

export function setUserRole(id: number, role: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE users SET role = ?, updated_at = ? WHERE id = ?",
  ).run(role, new Date().toISOString(), id);
}

export function setUserActive(id: number, isActive: boolean): void {
  const db = getDb();
  db.prepare(
    "UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?",
  ).run(isActive ? 1 : 0, new Date().toISOString(), id);
}

export function setUserMustChangePassword(id: number, flag: boolean): void {
  const db = getDb();
  db.prepare(
    "UPDATE users SET must_change_password = ?, updated_at = ? WHERE id = ?",
  ).run(flag ? 1 : 0, new Date().toISOString(), id);
}

export function setUserPassword(id: number, passwordHash: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
  ).run(passwordHash, new Date().toISOString(), id);
}

export function updateDisplayName(id: number, displayName: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
  ).run(displayName, new Date().toISOString(), id);
}
