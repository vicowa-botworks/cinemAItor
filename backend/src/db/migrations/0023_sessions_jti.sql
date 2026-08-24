-- Rebuild sessions to add the jti column (session id carried in the JWT) and
-- drop the UNIQUE constraint on token_hash that the original 0002 shape had.
-- Databases created before 0002 was revised still have the old shape; this
-- migration upgrades them in place, backfilling jti from the session id
-- (issueSession stores the same UUID in both id and jti, so the backfill
-- matches the current invariant exactly).

CREATE TABLE _sessions_new (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  jti TEXT UNIQUE NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO _sessions_new (id, user_id, jti, token_hash, created_at, expires_at, revoked_at)
SELECT id, user_id, id, token_hash, created_at, expires_at, revoked_at
FROM sessions;

CREATE INDEX idx_sessions_new_user_id ON _sessions_new(user_id);
CREATE INDEX idx_sessions_new_jti ON _sessions_new(jti);

DROP TABLE sessions;

ALTER TABLE _sessions_new RENAME TO sessions;
