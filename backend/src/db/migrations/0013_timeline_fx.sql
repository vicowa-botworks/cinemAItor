-- Migration 0013: timeline item transition duration (Workstream 14 - transitions / color grading)
--
-- transition selects the blend between an item and the item that precedes it;
-- transition_duration (seconds) is the blend length. 0.5s is the default.

ALTER TABLE timeline_items ADD COLUMN transition_duration REAL NOT NULL DEFAULT 0.5;
