# Diagnostics / Ops

Operational visibility over the running instance: hardware, installed models, storage usage, recent
logs, a redacted support export, and per-project backup/restore (Workstream 13, Milestone 7,
DIA-001…DIA-008).

## Concepts

- **Hardware report** (DIA-001): `detectHardware()` (from the model manager) plus OS/arch, Deno
  version, and process uptime.
- **Model report** (DIA-002): every registered model with a live `checkModelHealth` result and
  summary counters (`total`, `enabled`, `unhealthy`).
- **Diagnostics table** (DIA-003): a durable, capped store of operational events. The backend logger
  is constructed with a sink (`createDiagnosticLogSink` in `services/diagnostics.ts`) that mirrors
  every `warn`/`error` entry into the table; the sink swallows its own failures so a broken DB can
  never take down logging. Rows are filtered by `category`, `severity`, `since_hours` and `limit`
  (capped at 1000).
- **Storage report** (DIA-004): walks each `app_data` subdirectory for file count/bytes, reports the
  database file size, content-store usage, orphaned content-addressed files (stored bytes with no
  referencing asset version) and versions whose files are missing on disk.
- **Redacted export** (DIA-004): assembles hardware + models + storage + the latest 500 diagnostics
  entries into a single JSON bundle written under `<app_data>/logs/diagnostics-*.json`. Secret
  config keys (`jwt_secret`, etc.) are never included — safe to hand to support.
- **Project backup** (DIA-006): `buildProjectBackupData(projectId)` snapshots the project's
  _subtree_ — project, project-scoped assets with their versions/aliases/tags, timelines with
  tracks/items/markers, and the creative objects — storyboards + panels, scenes + shots, the full
  `prompt_versions` history for those objects, and the resolved `asset_references` — into a
  versioned JSON document (`schema: 2`; schema-1 backups remain restorable, the creative sections
  are simply absent). Global-scope assets, jobs and renders are intentionally out of scope; asset
  references keep global asset ids (they ride along with the prompt scope). A **media manifest**
  (`hash → present/size`) lets the operator see exactly which content-addressed files a restore will
  need.
- **Restore** (DIA-007): `restoreProjectBackup()` re-creates the subtree under **fresh UUIDs** in a
  new project (the creator is the restoring user). Slugs/alias slugs are made unique on collision.
  Every FK is remapped — asset → version → alias/tag, timeline → track → item → marker, and
  storyboard → panel / scene → shot, prompt versions per creative scope, and the creative pointers
  (panel/scene/shot `prompt_version_id`, preview/clip/generated-asset version ids, `linked_scene_id`
  / `linked_shot_id`, `scene.storyboard_id`) plus reference `source_id` (prompt version) /
  `asset_id` / `asset_version_id`. A link whose target was not part of the backup is nulled and
  reported in `issues` rather than failing the restore. Media is re-resolved against the content
  store (`resolveExisting` verifies the file is actually on disk); missing files do **not** fail the
  restore — the version row is still created (so item ordering is preserved) and each gap is
  reported in `issues`, as are skipped timeline snapshots.
- **Crash recovery** (DIA-008): already provided by the generation-job and render-job runners — both
  use leases (`lease_owner` / `lease_expires_at`) and `recoverStale*Jobs()` re-queues jobs whose
  lease expired, so a crashed process leaves no stuck work (covered by the job/render runner tests).

## Endpoints

All under `/api/v1/diagnostics`, behind `authMiddleware`.

| Method | Path                                               | Access                 | Result                                                                |
| ------ | -------------------------------------------------- | ---------------------- | --------------------------------------------------------------------- |
| GET    | `/hardware`                                        | any user               | hardware report                                                       |
| GET    | `/models`                                          | any user               | model health report                                                   |
| GET    | `/storage`                                         | any user               | storage usage / orphans / missing media                               |
| GET    | `/logs?category&severity&since_hours&limit`        | any user               | `count` + filtered entries                                            |
| POST   | `/export`                                          | admin                  | writes redacted bundle → `{ path, generated_at, size }`               |
| POST   | `/backups` `(body: { project_id })`                | project read           | creates backup file + row → `201 { backup, counts, media }`           |
| GET    | `/backups`                                         | any user               | caller's backups (admin sees all)                                     |
| POST   | `/backups/:id/restore` `(body: { project_name? })` | backup creator / admin | restores subtree → `201 { project_id, project_name, counts, issues }` |
| DELETE | `/backups/:id`                                     | backup creator / admin | removes file + row → `{ ok: true }`                                   |

Backups are stored as `<app_data>/backups/backup-<uuid>.json`; the `backups` table (migration 0012)
tracks id, source project, path, and `counts_json`.

## Testing

- `tests/diagnostics.test.ts` — diagnostics table CRUD, capping at 1000 rows, filter/limit
  validation, and the logger sink (captures warn/error, never throws).
- `tests/diagnostics_api.test.ts` — all five report/export endpoints end-to-end, including the admin
  gate on export and redaction of secret keys.
- `tests/backups.test.ts` — build/restore subtree at the service level (fresh ids, FK remap incl.
  storyboards/panels/scenes/shots/prompts/references, slug collision safety, missing-media and
  dangling creative-link issues, schema-1 compatibility).
- `tests/backups_api.test.ts` — backup/restore/delete over HTTP with permission checks.
