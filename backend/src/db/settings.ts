import { getDb } from "./database.ts";

function nowIso(): string {
  return new Date().toISOString();
}

export function getSetting(key: string, fallback: string): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key) as unknown as { value: string } | undefined;
  return row ? String(row.value) : fallback;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, nowIso());
}
