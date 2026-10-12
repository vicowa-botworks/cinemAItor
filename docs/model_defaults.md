# Default Models per Task Type

Implementation contract for: "I installed several text-to-image models — can I pick which one is
used by default?"

Before this feature, an omitted `model_id` resolved to `findModelsForTask(taskType)[0]` — the
**alphabetically first** enabled model that supports the task (`listModels` orders by
`name, version`). There was no way to influence that, and the dormant
`projects.default_model_preferences_json` column (migration 0001) was written by the API but read by
nothing.

## Concept

A **task-type default** is a registry-level choice: exactly one model is the default for a given
task type (`text_to_image`, `image_to_video`, `music`, …). Defaults are global (set by an admin),
and a project may override them for its own generations.

Resolution order when a generation request omits `model_id`:

```text
project override  >  global task-type default  >  first enabled model (alphabetical)
```

An explicit `model_id` in the request always wins and is validated exactly as before (400 when the
model is unknown, disabled, or does not support the task).

**Stale defaults degrade, never break.** A default that names a missing, disabled, or
task-incompatible model (because a model was removed, disabled, or had its task types edited) is
skipped silently and resolution falls through to the next tier. Generation must never fail because
of a bookkeeping row, and the choice self-heals when the model is re-enabled.

## Storage (migration 0032)

```sql
CREATE TABLE IF NOT EXISTS task_type_defaults (
  task_type TEXT PRIMARY KEY,      -- canonical task type, e.g. 'text_to_image'
  model_id TEXT NOT NULL,          -- models.id
  updated_at TEXT NOT NULL,
  updated_by_user_id INTEGER
);
```

One row per task type, so "set the default" is an UPSERT that naturally replaces the previous choice
— two models can never both claim to be the default for a task.

FK enforcement is off in this app (see `deleteModel`), so `deleteModel()` clears the model's default
rows explicitly. Disabling a model or editing its task types deliberately leaves the row in place
(resolution skips it; re-enabling restores the choice).

**Project overrides** reuse the existing `projects.default_model_preferences_json`, now given a real
contract: a JSON object mapping canonical task types to a model id, or `null` to clear one entry.

```json
{ "text_to_image": "flux_2_dev", "music": null }
```

Keys are normalized to the canonical underscore task types on write (the dashed HF aliases are
accepted, matching model registration). Malformed JSON or an unknown shape is a 400 at the route.

## Backend

### `db/model_defaults.ts` (new)

| Function                                                | Contract                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listTaskTypeDefaults()`                                | `{ [taskType]: modelId }` for every stored row                                                                                                                                                                                           |
| `getTaskTypeDefault(taskType)`                          | model id or `null`                                                                                                                                                                                                                       |
| `setTaskTypeDefault(userId, taskType, modelId \| null)` | validates the task type; when `modelId` is non-null the model must exist, be enabled and support the task (400 otherwise); `null` deletes the row; returns `{ task_type, model_id }`; audits `model.default.set` / `model.default.clear` |
| `clearTaskTypeDefaultsForModel(modelId)`                | called by `deleteModel`                                                                                                                                                                                                                  |
| `projectModelPreferences(project)`                      | parsed, canonical-keyed map from the project row; malformed JSON → `{}`                                                                                                                                                                  |
| `resolveDefaultModel(taskType, preferences?)`           | the default model the request would get: project entry → global row → `null`; validates each candidate (exists + enabled + supports the task) and skips invalid ones                                                                     |

### `pickModel(taskType, modelId, projectId?)`

`services/creative_generation.ts` — the single auto-pick choke point, now three-tiered. Every call
site passes the project it already has in hand:

| Call site                                            | Project source                                             |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| `asset_generation.ts` (asset generate / new version) | `target.project_id` (global assets pass none)              |
| `generatePanelPreview`                               | the panel's storyboard `project_id`                        |
| `generateScene` / `generateSceneBatch`               | `scene.project_id`                                         |
| `generateAudio` (music / voiceover / sfx)            | the resolved `projectId` (from `project_id` or `scene_id`) |
| timeline score                                       | via `generateAudio`                                        |
| `generateSubtitles`                                  | none (the source asset is global)                          |

`generateScene`'s t2v fallback branch (which used `findModelsForTask("text_to_video")[0]` directly)
now goes through the same resolution.

### API

- `GET /api/v1/models/defaults` (any authenticated user) →
  `{ defaults: { [taskType]: modelId }, models: { [modelId]: { id, name } }, task_types: [...] }` —
  the second map lets pickers label a default without a second round trip, and `task_types` is the
  canonical list in registry order (`MODEL_TASK_TYPES`), so no frontend surface hardcodes it.
- `PUT /api/v1/models/defaults/:taskType` (admin) `{ "model_id": "…" | null }` →
  `{ task_type, model_id }` — set or clear one task type. The path accepts the dashed HF aliases and
  reports the canonical `task_type` back.

Both are registered **before** `/api/v1/models/:id`, which would otherwise swallow `defaults` as a
model id.

`POST`/`PATCH /api/v1/projects[/:id]` now validate `default_model_preferences` against that shape
instead of accepting any JSON.

## Frontend

- **`frontend/src/model-defaults.js`** (new, pure + DOM-free, unit-tested):
  - `autoModelFor(models, defaults, taskType)` — the model the backend would pick from a picker's
    own candidate list (`defaults[taskType]` when that list contains it, else `models[0]`). Pickers
    still send **no** `model_id` for the auto choice, so the server stays the single authority —
    including for the project override, which the client cannot see.
  - `autoOptionLabel(model)` / `defaultTaskTypesFor(defaults, modelId)` — the picker's auto option
    text, and the badges on a model card.
  - `parseProjectPreferences(json)` / `projectPreferencesPayload(prefs)` — the project map read
    defensively and written back with cleared entries dropped.
  - `loadModelDefaults(api, { refresh })` — one module-level cache over `api.listModelDefaults()`,
    shared by every picker; concurrent callers share a request, a failed load is not cached and
    never throws, and `invalidateModelDefaults()` drops the cache after an admin edit.
- **Model manager:** a **Task defaults** panel with one row per task type that has an enabled model
  (or already has a default): a select over the enabled models supporting it, saving on change like
  the enable toggle, with "No default — first enabled" to clear. Non-admins see the same rows
  disabled with a note. Each default also shows as a `default · <task>` chip on its model card, and
  saving refreshes the panel, the model list and the shared cache.
- **Pickers** keep the empty "auto" sentinel (the server still decides) but now label and pre-check
  the _default_, so the VRAM guard and the enhance pre-select match what the backend will run:
  `asset-generate` (`Auto (default: <name>) · <task>`), `storyboard-detail` (panel picker and the
  VRAM-guard model), `scene-detail` (its VRAM gate narrows from every i2v/t2v candidate to the two
  defaults, and falls back to the whole set when no default is configured), `audio-dialog` and
  `timeline-detail` score (no picker at all — the gate model alone), `prompt-enhance` (the default
  is consulted before `models[0]`), and the `demo-content` preflight.
- **Project form** (create and edit): a **Default models for this project** section — one select per
  task type over the enabled models supporting it, blank meaning "use the global default" (labelled
  with that default's name). Written as `default_model_preferences`; the key is omitted entirely
  when the model list failed to load, so a save can never wipe the stored overrides.

## Non-goals (v1)

- Per-user defaults (defaults are a shared registry property; a personal override is the browser's
  existing per-surface enhance preference)
- Defaults for the LLM assistant (`llm.model` is a separate single-model setting) and for skill
  steps (a skill step names its own model or takes the same global default)
- Ranking / weighted fallback lists — one default per task type, with the existing first-enabled
  fallback
- Copying project defaults into backups beyond what already round-trips the project row (the column
  is already in the backup bundle)

## Tests

- `migrations.test.ts`: 0032 filename in both lists, `task_type_defaults` in the table list, and
  `schema_migrations` count 32
- `model_defaults.test.ts`
  - registry defaults: set / replace / clear one-per-task-type; dashed alias normalized; unknown
    task type rejected; a model that cannot serve the task rejected; `deleteModel` clears the row; a
    merely disabled model keeps its row and self-heals on re-enable; `listDefaultCandidates`
  - `resolveDefaultModel`: project override beats the global default; a default that stopped
    qualifying is skipped rather than failing; an entry for another task type or an unknown model is
    ignored
  - project preferences: defensive parsing of stored JSON; write payload normalized to canonical
    keys; a preference round-trips through the project row into model resolution
  - `pickModel`: an explicit `model_id` stays authoritative; nothing set → first enabled model
- `models_api.test.ts`: `GET /models/defaults` read/write, readable by non-admins but only writable
  by admins, auth required, a default that cannot serve the task rejected, dashed alias normalized,
  the default dropped when its model is removed
- projects API: `default_model_preferences` validated and normalized on write
- `asset_generation_api.test.ts`: with a default set and no `model_id` the queued job carries the
  default's id, and the project override beats it
- `frontend/tests/model-defaults.test.js`: `autoModelFor` (default present / for another task / not
  in the list / no default / empty list), `autoOptionLabel`, `defaultTaskTypesFor`, the cache
  (shared request, refresh, failure not cached, no rejected request left pending), the `task_types`
  list, and both project-preference helpers
