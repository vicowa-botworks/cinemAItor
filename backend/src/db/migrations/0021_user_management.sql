-- 0021: user management (admin provisioning of accounts)
--
-- users.must_change_password: set on admin-provisioned accounts when the
-- admin wants the user to change the assigned password at first login.
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

-- app_settings: small key/value store for instance-wide toggles.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Self-registration (POST /api/auth/register) is on by default.
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('registration_enabled', '1');
