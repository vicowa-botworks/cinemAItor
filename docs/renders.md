# Render / Export

Preset-driven rendering of timelines to media files with durable queueing, cancellation, structured
logs, output validation and export provenance (Workstream 12, Milestone 6 part 2).

## Concepts

- **Render presets** (`render_presets`) capture output settings: `name`, `kind` (`draft` or
  `final`), `output_format`, `resolution`, `frame_rate`, `codec`, `audio_codec`, `bitrate` plus
  free-form `settings` JSON. Three defaults are seeded by migration 0010 (`preset-draft` 720p30,
  `preset-final` 1080p60, `preset-audio` wav). Presets are global; creation is admin-only.
  `ensureDefaultPresets()` re-seeds idempotently for databases reset row-wise.
- **Render jobs** (`render_jobs`) are a durable queue that mirrors the generation job system:
  `queued → running → succeeded | failed | cancelled` (or `cancelling` while a running job winds
  down). Jobs carry a lease (`lease_owner`, `lease_expires_at`); stale leases are recovered back to
  `queued` by `recoverStaleRenderJobs`. The in-process render runner polls every 250 ms, claims one
  job per poll, and executes it.
- **Engines** implement `RenderEngine.render(plan, hooks)` in `services/render_engine.ts`:
  - `FfmpegRenderEngine` — two paths, chosen per plan:
    - **No fx** (all items hard-cut, no fades, no grade, no text overlays): lossless concat demuxer
      (`ffmpeg -f concat -c copy`), stream copy.
    - **With fx**: one input per item plus a filter graph — per-item `eq` (brightness/contrast/
      saturation), `colortemperature` (grade temperature → Kelvin), `fade` in/out — chained with
      `xfade` for real transitions and the `concat` filter for hard cuts; text overlays are drawn in
      a final `drawtext` stage (per-overlay `enable=between(t, start, end)`, position/size/color
      from the item's `text_style`). Re-encodes to H.264. The fx pass is video-only (`-an`):
      per-track audio placement is a separate render concern not yet modelled in the plan.
  - `MockRenderEngine` — deterministic placeholder output (seeded from `output_path` + duration +
    per-item source/fx and text-overlay fingerprint, valid minimal WAV for the `wav` format) so
    rendering works on machines without ffmpeg.
  - Selection: `RENDER_ENGINE=auto|ffmpeg|mock` (default `auto` = ffmpeg when available, else mock).
    `setRenderEngine()` is a test hook.
- **Render plan**: non-archived items on unlocked video/overlay tracks, sorted by start time, each
  resolved to its asset version's stored file; plus the active text overlays from unlocked
  `text`/`subtitle` tracks (text items sorted by start time). The plan is passed to the engine with
  progress and `isCancelled` hooks.
- **Source selection (draft/final)**: each plan item resolves to a `source` — `proxy` or `master`
  (the asset version's stored file). `draft`-kind presets prefer the version's proxy and fall back
  to the master if none exists; `final`-kind presets always use the master and fail the render
  (`No file for asset version ...`) if its proxy-only state has no master file. Per-item `source` is
  part of the mock engine's fingerprint and of the `validation_report.sources` (`{proxy, master}`)
  tally.
- **Validation**: after rendering, the output must exist, be non-empty and match the preset's
  extension; the outcome (including `file_size` and per-check booleans) is stored as
  `validation_report_json` on the job. Failures fail the job.
- **Exports** (`exports`) record each successful render: project, render job, output file path +
  format + settings. The file is also ingested into the content store as an asset (`render_<job-id>`
  slug, one asset per render job) with an immutable version whose `technical_metadata_json.render`
  carries full provenance: render job id, timeline id, preset, engine, format, item count, total
  duration and the media SHA-256.
- **Logs**: every job transition/approval/approval event lands in `render_events`
  (`{level, message, at}`), readable via the log endpoint.

## Endpoints

| Method | Endpoint                     | Description                                                                                                |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/render-presets`     | List presets                                                                                               |
| POST   | `/api/v1/render-presets`     | Create a preset (admin only)                                                                               |
| POST   | `/api/v1/renders`            | Queue a render: `{project_id, timeline_id, preset_id?}` → 202 with the queued job                          |
| GET    | `/api/v1/renders/:id`        | Job state (status, progress, error, output path, validation report)                                        |
| GET    | `/api/v1/renders/:id/log`    | Structured event log for the job                                                                           |
| POST   | `/api/v1/renders/:id/cancel` | Cancel: queued → `cancelled`; running → `cancelling` (engine stops at the next checkpoint); terminal → 409 |
| GET    | `/api/v1/exports`            | List exports (filters: `project_id`, `render_job_id`), scoped to projects the user can read                |

All endpoints require authentication; reads/writes are gated by project permissions (create requires
timeline write + read on the first item's media; the first renderable video item is required).
