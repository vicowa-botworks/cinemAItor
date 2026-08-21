-- 0016: basic audio mixer (AUD-007 / Workstream 11 follow-up)
--
-- tracks.gain_db: per-track audio gain in dB, applied on top of each audio
-- item's version gain when rendering (and in the playback preview).
-- 0 is neutral; the UI and API accept -60..24, matching the version-level
-- audio adjustment limits.
ALTER TABLE tracks ADD COLUMN gain_db REAL NOT NULL DEFAULT 0;
