-- 0017: basic ducking (AUD-013)
--
-- tracks.duck_db: how many dB this track is lowered while a dialogue track
-- is sounding. Only meaningful on `music` tracks (the render engine ducks
-- music under dialogue); 0 means ducking is off. The UI and API accept
-- 0..60.
ALTER TABLE tracks ADD COLUMN duck_db REAL NOT NULL DEFAULT 0;
