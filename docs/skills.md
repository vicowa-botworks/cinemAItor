# Skills

Skill System v1 (Workstream 14): named, versioned JSON workflows that chain media-generation jobs
(SKL-001/002/003/005/006/007/008). A skill carries no code — the engine validates the definition,
resolves typed inputs, interpolates `{{ input }}` placeholders, enqueues one generation job per step
and tracks the run.

## Skill format

A skill has a stable user-facing slug id and a JSON definition:

```json
{
  "name": "Tense Score",
  "version": "1.0.0",
  "author": "cinemAItor",
  "license": "MIT",
  "description": "Generates a tense cinematic music track for a project.",
  "inputs": {
    "mood": { "type": "string", "default": "tense" },
    "length": { "type": "string", "default": "30s" }
  },
  "steps": [
    { "type": "music", "prompt": "Cinematic score in a {{ mood }} mood, {{ length }}" },
    {
      "type": "sfx",
      "prompt": "Heartbeat under the {{ mood }} score",
      "model_id": "optional pin",
      "seed": "optional pin"
    }
  ],
  "assistant": {
    "model_task_types": ["text_to_video"],
    "guidance": "How to write prompts for this model family…",
    "examples": [{ "prompt": "…", "notes": "why this works" }]
  }
}
```

Validation (400 with a precise message on any violation):

- `name` (≤120) and `version` (≤32) are required; `author` (≤120), `license` (≤64) and `description`
  (≤500) are optional.
- `inputs` is an object keyed by identifier; each spec has `type` ∈ `string | number | boolean`,
  optional `required` (boolean) and optional `default` (must match the type). A spec cannot be both
  `required` and carry a `default`.
- `steps` is an array of ≤16; each step has `type` ∈ `music | voiceover | sfx` (v1 is
  audio-generation only), a `prompt` (≤2000) whose `{{ name }}` placeholders must all reference
  declared inputs, and optional per-step `model_id` / `seed` pins. `steps` must be non-empty
  **unless** the definition carries an `assistant` block (prompt-creation skills are knowledge, not
  generation steps).
- `assistant` is optional and makes the skill a "prompt-creation skill" for the LLM assistant (see
  `docs/llm.md`): `model_task_types` (non-empty subset of the known model task types when present),
  `guidance` (≤4000 chars) and `examples` (≤8, each `prompt` ≤2000, optional `notes` ≤500). At least
  one of `guidance` / `examples` is required. `GET /api/v1/skills?assistant=1` lists only these
  skills (the assist dialog's picker).

Skill ids are 1–64 chars of `a-z 0-9 - _` starting with a letter or digit; the `sys-` prefix is
reserved for system skills.

## Endpoints

| Method | Endpoint                         | Description                                                                                                                             |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/skills`                 | List skills (filter: `q` over id/name/description)                                                                                      |
| POST   | `/api/v1/skills`                 | Create: `{id, definition}` → `201` (400 if the id already exists)                                                                       |
| GET    | `/api/v1/skills/:id`             | Skill detail (404 if unknown or soft-deleted)                                                                                           |
| PUT    | `/api/v1/skills/:id`             | Replace the definition: `{definition}` (full definition object); snapshots a new version (bump `definition.version` to force a new row) |
| POST   | `/api/v1/skills/:id/toggle`      | `{enabled: boolean}` → toggles the skill (creator or admin; system skills: admin only)                                                  |
| DELETE | `/api/v1/skills/:id`             | Delete (creator or admin); 403 for system skills even for admins ("System skills cannot be deleted")                                    |
| GET    | `/api/v1/skills/:id/versions`    | Immutable version history, newest first                                                                                                 |
| POST   | `/api/v1/skills/:id/run`         | `{project_id, inputs?}` → `202 {run, jobs}` after resolving inputs and enqueuing one job per step                                       |
| GET    | `/api/v1/skills/:id/runs`        | Run list (filter: `project_id`), newest first                                                                                           |
| GET    | `/api/v1/skills/:id/runs/:runId` | Run detail with per-step job/asset/model links                                                                                          |

All endpoints require authentication. A run requires project write access to `project_id`.

## Run semantics

- **Pre-flight (all-or-nothing):** inputs are resolved against the definition (defaults applied,
  required enforced, types checked, unknown inputs rejected) and every step's model is resolved (a
  `step.model_id` pin must exist and be enabled, otherwise an enabled model with the step's task
  type is picked: `music` → `music`, `voiceover` → `voice`, `sfx` → `audio`) before any job is
  queued; failure returns 400 with no jobs on the queue. An assistant-only skill (no steps) is
  rejected up front with 400 — it exists to feed the LLM assistant, not to run.
- **Jobs:** each step enqueues one generation job via the shared audio-generation path — the step's
  expanded prompt seeds a fresh audio asset (`<kind>_<hex>` slug) under the project, so outputs
  remain reviewable in the job monitor and review board like any other generation.
- **Settling is lazy:** the run row starts `running` and is finalized on read — `succeeded` when
  every step job succeeded, otherwise `failed` with the first error text. No background watcher is
  needed; the WebSocket job feed (`/ws/v1/jobs`) surfaces each step job's progress and status live,
  and the skills UI polls the run on top of it.

## System skills

`seedSystemSkills()` (idempotent `INSERT OR IGNORE`) seeds the v1 starter set at server bootstrap —
definitions live in `src/db/skills.ts` (`SYSTEM_SKILLS`), not in the migration:

- `sys-tense-score` — one music step, inputs `mood` (default `tense`) and `length` (default `30s`).
- `sys-foley-pass` — one sfx step, required input `action`.
- `sys-t2v-prompting` — assistant-only: no steps, a `text_to_video` assistant block with general
  prompting guidance and example prompts. Selecting it in the assist dialog's skill picker shapes
  `enhance_prompt` output (see `docs/llm.md`).

System skills are visible to every user but cannot be deleted (admins included) and can only be
updated or toggled by an admin.

## Frontend

`skills-list` (`frontend/src/components/skills-list.js`, route `#/skills`, "Skills" nav item):

- skill cards: name/id/version/author, enable status chip, system marker, description and step-kind
  chips; per-card actions are toggle, Edit and Delete (hidden for system skills) and a "View jobs"
  link;
- create/edit panel: for new skills an id field plus a JSON definition textarea pre-filled with a
  sample; server validation errors are surfaced verbatim;
- run panel: project picker + one field per declared input (seeded from defaults; number and boolean
  values are coerced before submit);
- run history panel: statuses, per-step job ids and error text; live job events (WebSocket) refetch
  known runs and a 2.5 s poll covers the rest until the run settles;
- version history listed newest first under the run history.

## Out of scope for v1

SKL-004 (output schema), SKL-009 (permission declarations), SKL-010 (examples), SKL-011
(import/export, YAML files), SKL-012 (test cases) and SKL-013 (chaining) build on this format in
later packages; the definition JSON is intentionally extensible (unknown top-level fields are
rejected today, step types and input types are closed sets expected to grow).
