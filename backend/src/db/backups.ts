import { getDb } from "./database.ts";

export interface Backup {
  id: string;
  project_id: string;
  project_name: string;
  file_path: string;
  counts: Record<string, number>;
  created_at: string;
  created_by_user_id: number | null;
}

interface BackupRow {
  id: string;
  project_id: string;
  project_name: string;
  file_path: string;
  counts_json: string | null;
  created_at: string;
  created_by_user_id: number | null;
}

function toBackup(row: BackupRow): Backup {
  let counts: Record<string, number> = {};
  if (row.counts_json) {
    try {
      const parsed = JSON.parse(row.counts_json) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "number") counts[key] = value;
      }
    } catch {
      counts = {};
    }
  }
  return {
    id: row.id,
    project_id: row.project_id,
    project_name: row.project_name,
    file_path: row.file_path,
    counts,
    created_at: row.created_at,
    created_by_user_id: row.created_by_user_id,
  };
}

export function createBackupRecord(input: {
  id: string;
  project_id: string;
  project_name: string;
  file_path: string;
  counts: Record<string, number>;
  created_by_user_id: number | null;
}): Backup {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO backups (
      id, project_id, project_name, file_path, counts_json, created_at,
      created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.project_id,
    input.project_name,
    input.file_path,
    JSON.stringify(input.counts),
    now,
    input.created_by_user_id,
  );
  const backup = getBackup(input.id);
  if (!backup) throw new Error("Failed to create backup record");
  return backup;
}

export function getBackup(id: string): Backup | undefined {
  const row = getDb()
    .prepare("SELECT * FROM backups WHERE id = ?")
    .get(id) as unknown as BackupRow | undefined;
  return row ? toBackup(row) : undefined;
}

/** Backups the caller owns; admins see all of them. */
export function listBackups(userId: number, isAdmin: boolean): Backup[] {
  const rows: unknown[] = isAdmin
    ? (
      getDb()
        .prepare(
          "SELECT * FROM backups ORDER BY created_at DESC, rowid DESC LIMIT 200",
        )
        .all() as unknown[]
    )
    : (
      getDb()
        .prepare(
          `SELECT * FROM backups WHERE created_by_user_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT 200`,
        )
        .all(userId) as unknown[]
    );
  return (rows as unknown as BackupRow[]).map(toBackup);
}

export function deleteBackup(id: string): boolean {
  const changed = Number(
    getDb().prepare("DELETE FROM backups WHERE id = ?").run(id),
  );
  return changed > 0;
}
