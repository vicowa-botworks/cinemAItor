-- Workstream 18 (issue #155): per-model generation profiles.
--
-- draft_settings / production_settings are free-form JSON objects of the same shape as
-- default_settings (model/runner-specific override keys). Precedence when the runner builds
-- the adapter settings: default_settings <- profile <- job settings. Empty {} = no overrides.

ALTER TABLE models ADD COLUMN draft_settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE models ADD COLUMN production_settings_json TEXT NOT NULL DEFAULT '{}';
