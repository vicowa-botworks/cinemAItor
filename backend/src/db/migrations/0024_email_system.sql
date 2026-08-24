-- 0023: email system (SMTP delivery, password reset, email confirmation, invitations)
--
-- users.email_confirmed: self-registered accounts start unconfirmed and must
-- open the confirmation link before signing in. Bootstrap and admin-created
-- accounts are confirmed (backfill below, and at creation time for new rows).
ALTER TABLE users ADD COLUMN email_confirmed INTEGER NOT NULL DEFAULT 0;
UPDATE users SET email_confirmed = 1;

-- email_tokens: one-time links for password reset and email confirmation.
-- Only the SHA-256 hash of the raw token is stored; the raw value exists
-- only in the email link itself.
CREATE TABLE IF NOT EXISTS email_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('password_reset', 'email_confirmation')),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, kind);

-- invitations: admin-issued account invitations. The raw token appears only
-- in the email link; the DB stores its hash. While pending, an invitation is
-- unique per email (case-insensitive); accepted or revoked rows do not block
-- re-invitation of the same address.
CREATE TABLE IF NOT EXISTS invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_pending_email
  ON invitations(email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
