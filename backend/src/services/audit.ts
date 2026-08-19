import { getDb } from "@cinemaItor/db/database.ts";

export interface AuditEntry {
  id: string;
  user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: string;
  data_json: string | null;
  created_at: string;
}

export function logAudit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId: string,
  data?: Record<string, unknown>,
): void {
  const db = getDb();
  const id = crypto.randomUUID();
  const insert = db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  (insert.run as unknown as (...params: unknown[]) => unknown)(
    id,
    userId,
    action,
    entityType,
    entityId,
    data ? JSON.stringify(data) : null,
    new Date().toISOString(),
  );
}

export function getAuditLogs(limit = 100): AuditEntry[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .all(limit);
  return rows as unknown as AuditEntry[];
}
