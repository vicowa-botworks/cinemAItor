# Diagnostics / Ops

Operational visibility over the running instance: hardware, installed models, storage usage (incl.
per-project breakdown, checksum integrity and cache cleanup — STO-010…STO-012), recent logs, a
redacted support export, and per-project backup/restore (Workstream 13, Milestone 7,
DIA-001…DIA-008).

## Concepts

- **Hardware report** (DIA-001): `detectHardware()` (from the model manager) plus OS/arch, Deno
  version, and process uptime. GPU detection is shared with the models hardware endpoint — the
  report carries
  `hardware.gpu = { vendor, model, vram_mb, vram_used_mb, driver_version,
  cuda_version }` (all
  null when no GPU is detected; see `docs/models.md`, Hardware detection).
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
- **Storage management** (STO-010…STO-012): the storage report additionally carries:
  - `projects[]` (STO-010): per-project media usage — file count and total bytes of every
    content-addressed file referenced by at least one version of an asset in that project. A file
    shared by assets of several projects (content dedupe) is counted for **each** owner, so project
    sums may exceed the content-store total; the global (non-project) scope gets its own
    `project_id: null` row.
  - `top_assets[]` (STO-011): the heaviest assets by summed version bytes, most-heavy first, capped
    at 10 rows.
  - `integrity` (STO-011): with `?verify=1` the whole content store is re-hashed (SHA-256) and
    compared to each file's content-addressed name; the result is
    `{ verified, corrupted:
    [{ file_path }] }`. Without the flag it is `null`, so default
    reports stay cheap. Verified totals are included in the report regardless of the flag (cheap
    `stat` walk).
- **Cache cleanup** (STO-012): `cleanupCache({ includeOrphanedMedia })` removes regeneration-able
  files — everything under `<app_data>/previews`, `<app_data>/proxies` and `<app_data>/thumbnails`
  (previews/proxies are regenerated on demand; thumbnails likewise) — and, only when explicitly
  requested, the **orphaned** content files (stored bytes with no referencing version). Referenced
  media is never touched. Returns removed counts, bytes freed, and the per-directory breakdown. This
  route is admin-only; the service logs a `storage` diagnostic entry for every run.
- **Redacted export** (DIA-004): assembles hardware + models + storage + the latest 500 diagnostics
  entries into a single JSON bundle written under `<app_data>/logs/diagnostics-*.json`. Secret
  config keys (`jwt_secret`, etc.) are never included — safe to hand to support.
- **Project backup** (DIA-006): `buildProjectBackupData(projectId)` snapshots the project's
  _subtree_ — project, project-scoped assets with their versions/aliases/tags, timelines with
  tracks/items/markers, and the creative objects — storyboards + panels, scenes + shots, the full
  `prompt_versions` history for those objects, and the resolved `asset_references` — into a
  versioned JSON document (`schema: 3`; schema-1 backups remain restorable with the creative
  sections simply absent, and pre-schema-3 backups with count-only snapshots). Schema 3 adds the
  timeline **snapshots** themselves, with their serialized state. Global-scope assets, jobs and
  renders are intentionally out of scope; asset references keep global asset ids (they ride along
  with the prompt scope). A **media manifest** (`hash → present/size`) lets the operator see exactly
  which content-addressed files a restore will need. The export also writes a **media bundle**: a
  sibling `backup-<id>/media/<h0:2>/<h2:4>/<hash>.<ext>` tree — the content-store layout — with one
  copy of each referenced file that is still in the store, so a backup + its bundle directory is
  transferable between hosts (pre-bundle single-file backups remain restorable).
- **Restore** (DIA-007): `restoreProjectBackup()` re-creates the subtree under **fresh UUIDs** in a
  new project (the creator is the restoring user). Slugs/alias slugs are made unique on collision.
  Every FK is remapped — asset → version → alias/tag, timeline → track → item → **marker** →
  snapshot, and storyboard → panel / scene → shot, prompt versions per creative scope, and the
  creative pointers (panel/scene/shot `prompt_version_id`, preview/clip/generated-asset version ids,
  `linked_scene_id` / `linked_shot_id`, `scene.storyboard_id`) plus reference `source_id` (prompt
  version) / `asset_id` / `asset_version_id`. Schema-3 snapshots are restored with every embedded id
  (track / item / marker / media version) rewritten to the restored objects, so `restoreSnapshot`
  works on the restored timeline; snapshot entries whose targets were not part of the backup are
  dropped from the payload and reported, as are snapshots from pre-schema-3 backups. A link whose
  target was not part of the backup is nulled and reported in `issues` rather than failing the
  restore. Before the state restore, any media bundle next to the backup JSON is copied into the
  content store, each file's SHA-256 re-verified against its content-addressed name — a corrupt copy
  is skipped and reported in `issues`, already-present files are deduplicated as `reused`, and the
  response carries a `media: { restored, reused, corrupted }` summary. Media is then re-resolved
  against the content store (`resolveExisting` verifies the file is actually on disk); missing files
  do **not** fail the restore — the version row is still created (so item ordering is preserved) and
  each gap is reported in `issues`. Text overlay items (versionless, carrying `item_text` +
  `text_style`) are captured in the backup document and restored as-is; only media items whose
  version was not part of the backup are dropped and reported — including inside restored snapshot
  payloads.
- **Crash recovery** (DIA-008): already provided by the generation-job and render-job runners — both
  use leases (`lease_owner` / `lease_expires_at`) and `recoverStale*Jobs()` re-queues jobs whose
  lease expired, so a crashed process leaves no stuck work (covered by the job/render runner tests).

## Endpoints

All under `/api/v1/diagnostics`, behind `authMiddleware`.

| Method | Path                                                     | Access                 | Result                                                                                                                              |
| ------ | -------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/hardware`                                              | any user               | hardware report                                                                                                                     |
| GET    | `/models`                                                | any user               | model health report                                                                                                                 |
| GET    | `/storage?verify=1`                                      | any user               | storage usage / orphans / missing media + per-project & top-asset usage; `verify=1` adds a content-store checksum `integrity` block |
| POST   | `/storage/cleanup` `(body: { include_orphaned_media? })` | admin                  | removes regenerable preview/proxy/thumbnail caches (and, if flagged, orphaned media) → removed counts + bytes freed                 |
| GET    | `/logs?category&severity&since_hours&limit`              | any user               | `count` + filtered entries                                                                                                          |
| POST   | `/export`                                                | admin                  | writes redacted bundle → `{ path, generated_at, size }`                                                                             |
| POST   | `/backups` `(body: { project_id })`                      | project read           | creates backup file + row → `201 { backup, counts, media }`                                                                         |
| GET    | `/backups`                                               | any user               | caller's backups (admin sees all)                                                                                                   |
| POST   | `/backups/:id/restore` `(body: { project_name? })`       | backup creator / admin | restores subtree (importing any media bundle) → `201 { project_id, project_name, counts, issues, media }`                           |
| DELETE | `/backups/:id`                                           | backup creator / admin | removes file + row → `{ ok: true }`                                                                                                 |

Backups are stored as `<app_data>/backups/backup-<uuid>.json` plus an optional media bundle
(`<app_data>/backups/backup-<uuid>/media/...`); the `backups` table (migration 0012) tracks id,
source project, path, and `counts_json`.

## Testing

- `tests/diagnostics.test.ts` — diagnostics table CRUD, capping at 1000 rows, filter/limit
  validation, the logger sink (captures warn/error, never throws), and storage management:
  per-project usage grouping with cross-project shared-file dedupe, `?verify=1` integrity that
  re-hashes the store and flags files whose content drifted from their name, and cleanup that clears
  regenerable caches while leaving referenced media (orphaned media only when flagged).
- `tests/diagnostics_api.test.ts` — all report/export endpoints end-to-end (including the admin gate
  on export and redaction of secret keys), plus `?verify=1` integrity over HTTP and the admin-gated
  cleanup endpoint (cache-only default, explicit orphaned-media removal).
- `tests/backups.test.ts` — build/restore subtree at the service level (fresh ids, FK remap incl.
  storyboards/panels/scenes/shots/prompts/references, slug collision safety, missing-media and
  dangling creative-link issues, schema-1 compatibility).
- `tests/backups_api.test.ts` — backup/restore/delete over HTTP with permission checks.
