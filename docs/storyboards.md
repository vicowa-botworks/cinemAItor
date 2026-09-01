# Storyboards, Scenes & Shots

Creative objects sit between the asset library/prompts and the generation pipeline.

## Storyboards & panels

A **storyboard** belongs to a project and contains ordered **panels**. Each panel carries
screenwriting fields (shot number, description, duration, camera settings, mood, lighting, time of
day, dialogue, voiceover, music cue, SFX, transition, notes) plus a **prompt** and status.

Panels link into the rest of the pipeline:

- `prompt` → stored in `prompt_versions` (scope `storyboard_panel`) with `@token` reference
  resolution and unresolved-reference warnings (see references.md).
- `preview_asset_version_id` → image produced by `generate-preview`.
- `generated_clip_asset_version_id` → clip produced from the panel (WS9+).
- `linked_scene_id` / `linked_shot_id` → downstream creative objects.

## Scenes & shots

A **scene** belongs to a project (optionally a storyboard) and contains ordered **shots**. Scene and
shot prompts use the same prompt-versioning engine (scopes `scene` / `shot`).
`shots.generated_asset_version_id` tracks the produced clip.

## Endpoints

| Method       | Endpoint                                                   | Description                                                                 |
| ------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| GET          | `/api/v1/storyboards`                                      | List (filter `project_id`)                                                  |
| POST         | `/api/v1/storyboards`                                      | Create `{project_id, name}`                                                 |
| GET          | `/api/v1/storyboards/:id`                                  | Board + panels (with prompts)                                               |
| PATCH        | `/api/v1/storyboards/:id`                                  | Update name/status                                                          |
| DELETE       | `/api/v1/storyboards/:id`                                  | Soft delete                                                                 |
| GET          | `/api/v1/storyboards/:id/panels`                           | List panels (ordered, with prompts)                                         |
| POST         | `/api/v1/storyboards/:id/panels`                           | Create panel (`panel_order` unique)                                         |
| PATCH        | `/api/v1/storyboards/:id/panels/:panelId`                  | Update fields / prompt / links                                              |
| DELETE       | `/api/v1/storyboards/:id/panels/:panelId`                  | Delete panel                                                                |
| POST         | `/api/v1/storyboards/:id/panels/:panelId/generate-preview` | t2i job; body `{model_id?, seed?, device?, settings?}`                      |
| GET          | `/api/v1/scenes`                                           | List (filters `project_id`, `storyboard_id`)                                |
| POST         | `/api/v1/scenes`                                           | Create scene                                                                |
| GET          | `/api/v1/scenes/:id`                                       | Scene (with prompt) + shots                                                 |
| PATCH/DELETE | `/api/v1/scenes/:id`                                       | Update / delete                                                             |
| GET/POST     | `/api/v1/scenes/:id/shots`                                 | List/create shots (`shot_order` unique)                                     |
| PATCH/DELETE | `/api/v1/scenes/:id/shots/:shotId`                         | Update / delete shot                                                        |
| POST         | `/api/v1/scenes/:id/generate`                              | Scene generation job (body `{model_id?, seed?, device?, settings?}`)        |
| POST         | `/api/v1/scenes/:id/batch-generate`                        | One generation job per shot (body `{model_id?, seed?, device?, settings?}`) |
| POST         | `/api/v1/projects/:id/scenes/from-script`                  | Bulk-create draft scenes from a parsed script (SCN-015)                     |
| GET          | `/api/v1/projects/:id/continuity`                          | Deterministic continuity report for the project (MS-8)                      |

All endpoints require authentication; the continuity report needs project **read** access and is
read-only (it never mutates creative objects).

## Generation

- **Panel preview** → `text_to_image` job. Resolved panel references become the job's input asset
  versions; output lands on a per-panel `panel_*` asset and the job runner links
  `preview_asset_version_id` + status `preview_ready` on success.
- **Scene** → `image_to_video` when a linked panel already has a preview (the panel's image is the
  video input), otherwise `text_to_video`. With no image input and no enabled `text_to_video` model
  the request is rejected with a clear message. Output lands on a per-scene `scene_*` asset.
- **Batch** (`batch-generate`) → one job per shot, all sharing the scene's input (i2v when a linked
  panel has a preview, otherwise t2v). Each shot uses its own prompt when present, otherwise the
  scene prompt; shots without any prompt are skipped with a reason. On success the runner links each
  shot's `generated_asset_version_id` and status. 202 returns
  `{job_type, model_id, jobs: [{shot_id, job_id, asset_id}], skipped: [{shot_id, reason}]}`.
- Model selection: explicit `model_id` must be enabled and support the task; otherwise the first
  enabled model for the task is used. A 202 response returns the job id for polling (jobs API).
- **Device / VRAM gate**: the preview, scene, and batch endpoints accept `device` (`cpu` | `cuda`).
  Without it a `local_cli` runner decides for itself (GPU when enough VRAM is free, CPU otherwise).
  The UI runs the same pre-generation VRAM check as asset generation (free VRAM vs the model's
  `vram_requirement_mb`) and sends `cpu` when the user accepts the slow path; it re-checks — sending
  no `device` — once enough VRAM is free. `device` and the model's `vram_requirement_mb` reach the
  runner as `RUNNER_DEVICE` / `RUNNER_MIN_FREE_VRAM_MB` so the runner's fallback threshold matches
  the UI check (see `docs/assets.md`).

## Script import (SCN-015)

The scene list offers **Import script**: paste a screenplay (or load a `.fountain`/`.txt` file),
preview the parsed scenes, and create them all in one project as draft scenes.

- **Parser** — `frontend/src/script-parse.js` (pure, unit-tested). A deterministic Fountain-lite
  subset:
  - `INT.` / `EXT.` / `I/E.` lines (case-insensitive, ≤ 120 chars) start a new scene; the line is
    the scene name (heading).
  - A short all-caps line (≤ 32 chars, no trailing sentence punctuation, preceded by a blank line or
    the heading) starts a dialogue block for that character; continuation lines belong to it until a
    blank line. `(...)` lines are parentheticals folded into the next spoken line.
  - Everything else is scene action. Bare `FADE IN`/`FADE OUT` is skipped.
  - Content with no heading lands in a synthetic `Scene N` (with a warning); empty scenes are
    dropped.
- **Endpoint** — `POST /api/v1/projects/:id/scenes/from-script` with
  `{ scenes: [{ name, description?, prompt?, notes? }] }` (max `MAX_SCENES_PER_SCRIPT_IMPORT` = 200,
  project write permission, per-entry validation). Returns `201 { created: [scene + prompt] }` in
  input order. The client maps each parsed scene: `name` = heading, `description` = action
  (fallback: dialogue transcript, capped 500 chars), `notes` = dialogue transcript, `prompt` =
  deterministic "Film scene draft (imported from script)" prompt (capped 4000 chars) the user can
  refine in Prompt Studio.
- **UI** — `scene-list.js`: project picker + file loader + textarea, live preview list (heading +
  action excerpt + dialogue block count), parser warnings, then one bulk create.

## Continuity check (MS-8)

`GET /api/v1/projects/:id/continuity` runs a **deterministic, read-only** analysis over the
project's panels, scenes, and shots (`loadContinuityInput` + `analyzeContinuity` in
`backend/src/services/continuity.ts`) and returns
`{ project_id, generated_at, issue_count, issues: [...] }`. Each issue carries `rule`, `severity`
(`error` / `warning` / `info`), the offending `object_type` / `object_id` / `object_label`, and a
human-readable `message`.

Rules:

| Rule                  | Severity | What it flags                                                                                                                                       |
| --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `panel-link-mismatch` | error    | A panel's `linked_scene_id` / `linked_shot_id` points at a shot/scene that does not exist in this project, or the shot belongs to a different scene |
| `time-of-day-jump`    | warning  | The panels linked to one scene declare more than one time of day                                                                                    |
| `lighting-conflict`   | warning  | The panels linked to one scene declare more than one lighting value                                                                                 |
| `stale-clip`          | warning  | A panel/shot's generated clip predates the latest prompt version (ISO-timestamp compare)                                                            |
| `duration-mismatch`   | warning  | A scene's `target_duration` deviates from the sum of its shot durations by more than the tolerance (max(0.5s, 10% of target))                       |
| `unlinked-panel`      | info     | A panel is linked to a scene but not to one of that scene's shots                                                                                   |

Missing/empty fields are skipped rather than flagged (nulls never count as mismatches).

**UI** — `scene-list.js`: a **Continuity** button opens a panel with a project picker and a **Run
check** action; issues render as severity-chipped rows (`object_label · rule — message`), or a "No
continuity issues found." confirmation for a clean project.

## Notes

- The legacy demo API's integer-id `scenes` table (movies demo) was renamed to `legacy_scenes` in
  migration 0007 so the product scene model owns the name.
