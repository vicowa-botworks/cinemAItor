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

| Method       | Endpoint                                                   | Description                                             |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------- |
| GET          | `/api/v1/storyboards`                                      | List (filter `project_id`)                              |
| POST         | `/api/v1/storyboards`                                      | Create `{project_id, name}`                             |
| GET          | `/api/v1/storyboards/:id`                                  | Board + panels (with prompts)                           |
| PATCH        | `/api/v1/storyboards/:id`                                  | Update name/status                                      |
| DELETE       | `/api/v1/storyboards/:id`                                  | Soft delete                                             |
| GET          | `/api/v1/storyboards/:id/panels`                           | List panels (ordered, with prompts)                     |
| POST         | `/api/v1/storyboards/:id/panels`                           | Create panel (`panel_order` unique)                     |
| PATCH        | `/api/v1/storyboards/:id/panels/:panelId`                  | Update fields / prompt / links                          |
| DELETE       | `/api/v1/storyboards/:id/panels/:panelId`                  | Delete panel                                            |
| POST         | `/api/v1/storyboards/:id/panels/:panelId/generate-preview` | t2i job; body `{model_id?, seed?, settings?}`           |
| GET          | `/api/v1/scenes`                                           | List (filters `project_id`, `storyboard_id`)            |
| POST         | `/api/v1/scenes`                                           | Create scene                                            |
| GET          | `/api/v1/scenes/:id`                                       | Scene (with prompt) + shots                             |
| PATCH/DELETE | `/api/v1/scenes/:id`                                       | Update / delete                                         |
| GET/POST     | `/api/v1/scenes/:id/shots`                                 | List/create shots (`shot_order` unique)                 |
| PATCH/DELETE | `/api/v1/scenes/:id/shots/:shotId`                         | Update / delete shot                                    |
| POST         | `/api/v1/scenes/:id/generate`                              | Scene generation job                                    |
| POST         | `/api/v1/scenes/:id/batch-generate`                        | One generation job per shot of the scene                |
| POST         | `/api/v1/projects/:id/scenes/from-script`                  | Bulk-create draft scenes from a parsed script (SCN-015) |

All endpoints require authentication; write access follows project permissions.

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

## Notes

- The legacy demo API's integer-id `scenes` table (movies demo) was renamed to `legacy_scenes` in
  migration 0007 so the product scene model owns the name.
