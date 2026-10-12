-- 0032: Default model per task type
--
-- Which model an auto-picked generation request gets. One row per task type, so
-- "set the default" is an UPSERT that replaces the previous choice — two models
-- can never both claim to be the default for a task.
--
-- Before this, an omitted model_id resolved to findModelsForTask(taskType)[0]:
-- the alphabetically first enabled model (listModels orders by name, version),
-- with no way to influence it.
--
-- Resolution order for a request without model_id:
--   project override (projects.default_model_preferences_json, migration 0001,
--   unused until now) > this table > first enabled model.
--
-- FK enforcement is off in this app (see deleteModel), so removing a model
-- clears its rows in db/model_defaults.ts rather than by cascade. Disabling a
-- model or editing its task types leaves the row in place: resolution validates
-- the candidate and skips it when it no longer qualifies, so the choice
-- self-heals when the model is re-enabled.
CREATE TABLE IF NOT EXISTS task_type_defaults (
  task_type TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id INTEGER
);
