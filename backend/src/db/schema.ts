import { getDb } from "./database.ts";

export interface User {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function createUser(
  email: string,
  passwordHash: string,
  displayName: string,
  role = "user",
): number {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?) RETURNING id",
  );
  const row = stmt.get<{ id: number }>(email, passwordHash, displayName, role);
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
