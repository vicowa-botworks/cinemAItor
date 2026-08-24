# Render / Export

Preset-driven rendering of timelines to media files with durable queueing, cancellation, structured
logs, output validation and export provenance (Workstream 12, Milestone 6 part 2).

## Concepts

- **Render presets** (`render_presets`) capture output settings: `name`, `kind` (`draft` or
  `final`), `output_format`, `resolution`, `frame_rate`, `codec`, `audio_codec`, `bitrate` plus
  free-form `settings` JSON. Five defaults are seeded (migration 0010 + 0021): `preset-draft`
  720p30, `preset-final` 1080p60, `preset-audio` wav, `preset-master` (archival-quality h264: CRF
  17, `slow` preset, yuv420p) and `preset-hdr` (HEVC HLG 10-bit wide-gamut: CRF 20, `slow`,
  yuv420p10le with BT.2020 primaries / arib-std-b67 transfer / bt2020nc matrix — needs `libx265` in
  the ffmpeg build). Presets are global; creation is admin-only. `ensureDefaultPresets()` re-seeds
  idempotently for databases reset row-wise. Preset definitions are validated on create:
  `output_format` ∈ {`mp4`, `mov`, `wav`}, `codec` ∈ {`h264`, `hevc`}, `resolution` must look like
  `1920x1080`, `frame_rate` 0–240.
- **Render jobs** (`render_jobs`) are a durable queue that mirrors the generation job system:
  `queued → running → succeeded | failed | cancelled` (or `cancelling` while a running job winds
  down). Jobs carry a lease (`lease_owner`, `lease_expires_at`); stale leases are recovered back to
  `queued` by `recoverStaleRenderJobs`. The in-process render runner polls every 250 ms, claims one
  job per poll, and executes it.
- **Engines** implement `RenderEngine.render(plan, hooks)` in `services/render_engine.ts`:
  - `FfmpegRenderEngine` — three paths, chosen per plan (audio preset first, then
    `planNeedsFxPass`):
  - **No fx** (all items hard-cut, no fades, no grade, no source trim/speed, no text overlays, no
    audio, every item plays its source to the end — no tail trim — and the preset's encode profile
    matches the legacy default): lossless concat demuxer (`ffmpeg -f concat -c copy`), stream copy.
    The concat demuxer can only splice whole files, so a tail-trimmed item instead takes the fx path
    below and gets a frame-accurate cut (see the plan's `consumes_full_source` flag). A preset whose
    encode profile differs from the default (the advanced presets) can never be satisfied by a
    stream copy and forces the fx path (`presetRequiresReencode`).
  - **With fx**: one input per item plus a filter graph — per-item `trim` + `setpts` (source offset
    / speed), `eq` (brightness/contrast/saturation), `colortemperature` (grade temperature →
    Kelvin), `fade` in/out — chained with `xfade` for real transitions and the `concat` filter for
    hard cuts; text overlays are drawn in a final `drawtext` stage (per-overlay
    `enable=between(t, start, end)`, position/size/color from the item's `text_style`). Audio-track
    items become extra inputs, each run through `atrim` (the source window after the version trim is
    applied) + `asetpts` + `atempo` chain (speed; extreme speeds are split into repeated `atempo`
    stages) + `volume` (the version's `gain_db` plus the track's mixer `gain_db`) + a
    frame-evaluated ducking `volume` stage for music items (see “Ducking”) + `afade` in/out, then
    silenced into its timeline slot with `adelay` and summed with
    `amix=duration=longest:normalize=0` (no 1/N normalization) — the mix is trimmed back to the
    video length and mapped as AAC (192 k). Re-encodes with the plan's preset: the video stream goes
    through `videoEncodeArgs(preset)` (defaults reproduce the legacy libx264 `veryfast` CRF 20
    8-bit; advanced presets raise quality, or switch to 10-bit wide-gamut HEVC with the `hvc1` tag
    and BT.2020 color metadata), and the audio codec comes from `preset.audio_codec` (default
    `aac`). Silent plans keep `-an`.
  - **Audio-only** (`wav` presets): one input per audio-track item, each run through the same
    `atrim` + `asetpts` + `atempo` + `volume` + `afade` chain as the fx pass, then silenced into its
    timeline slot with `adelay` and summed with `amix=duration=longest:normalize=0` (no 1/N
    normalization, no trim back to a video length — the mix runs to the longest item). Mapped as PCM
    16-bit (`pcm_s16le`) with no video stream (`-vn`).
  - **Progress**: all paths run ffmpeg with `-nostats -progress pipe:1`; the reported `out_time`
    (microseconds preferred, seconds fallback) is mapped onto the job progress scale — concat 20 →
    90, fx 10 → 90, audio 10 → 90 — and 100 is reported after the output file is stat-verified. The
    read loop races against process exit (a killed ffmpeg with helper processes would otherwise hold
    the pipe open), and a 250 ms poller kills ffmpeg when the job is cancelled so cancellation does
    not wait on ffmpeg output.
  - **Encoder availability**: before the fx pass, the engine probes `ffmpeg -encoders` once per
    process (cached) and fails the job with a readable error when the preset requires an encoder the
    build lacks (e.g. `libx265` for the HDR preset) instead of crashing mid-render. An unparseable
    probe result is treated as "unknown" and the render proceeds.
- `MockRenderEngine` — deterministic placeholder output, content-addressed on the plan (seeded from
  format + duration + a fingerprint of every item's source/source-edit, fx, the text and audio
  overlays, and the preset's encode profile — so the same timeline rendered with different presets
  produces different bytes; valid minimal WAV for the `wav` format) so rendering works on machines
  without ffmpeg and re-renders of an unchanged timeline deduplicate in the content store.
- Selection: `RENDER_ENGINE=auto|ffmpeg|mock` (default `auto` = ffmpeg when available, else mock).
  `setRenderEngine()` is a test hook.
- **Render plan**: non-archived items on unlocked video/overlay tracks, sorted by start time, each
  resolved to its asset version's stored file (carrying the item's `source_offset` and `speed`).
  Because the lossless concat path can only splice whole files, the builder ffprobes each video
  item's file (the proxy in draft renders, the master in final renders) and sets
  `consumes_full_source`: `true` when the item's source consumption (timeline duration ÷ speed)
  reaches the source end within a 0.1 s tolerance (the editor rounds times to 0.01 s and probed
  durations are float-approximate, so untouched clips stay lossless), `false` for a tail trim
  (forcing the frame-accurate fx pass), and `undefined` when the duration is unknown (ffprobe
  missing or failing), which preserves the legacy concat behavior; plus the active text overlays
  from unlocked `text`/`subtitle` tracks (text items sorted by start time); plus audio items from
  unlocked, non-muted `dialogue`/`voiceover`/`music`/`sfx`/`ambience` tracks (non-archived items
  with an asset version, sorted by start time; each clip's version `gain_db` plus its track's mixer
  `gain_db` is applied, so the render matches the preview mix). The plan is passed to the engine
  with progress and `isCancelled` hooks.
- **Audio-only plans** (`wav` presets, e.g. the seeded `preset-audio`): no video items and no text
  overlays are collected; the plan's `total_duration` is the audio items' end extent (latest
  `end_time`), and rendering is rejected with a validation error when the timeline has no
  audio-track items.
- **Source selection (draft/final)**: each plan item (video and audio) resolves to a `source` —
  `proxy` or `master` (the asset version's stored file). `draft`-kind presets prefer the version's
  proxy and fall back to the master if none exists; `final`-kind presets always use the master and
  fail the render (`No file for asset version ...`) if its proxy-only state has no master file.
  Per-item `source` is part of the mock engine's fingerprint and of the `validation_report.sources`
  (video `{proxy, master}`) and `validation_report.audio` (`{items, proxy, master}`) tallies.
- **Ducking (music lowers under dialogue)**: a music-track item on a track with a positive `duck_db`
  (0..60, default 0 = off) gets a frame-evaluated `volume` stage
  (`volume='1-(1-G)*clip(between(t,s0,e0)+between(t,s1,e1)+…),0,1)':eval=frame`, where
  `G = 10^(-duck_db/20)` and the windows are the rendered dialogue items' timeline spans clipped to
  the music item's lifetime, merged when they overlap or touch, expressed in item-local seconds).
  Dialogue items that are locked or muted (outside the render source) never duck; non-music tracks
  are neither ducked nor ducking. The same windows drive the in-browser preview, so the mix matches
  what the editor plays.
- **Audio placement (items × version adjustments)**: an audio item's source window starts at
  `max(item.source_offset, version trim.start)` and consumes
  `min(duration / speed, trim.end −
  start)` source seconds; the version's `gain_db` becomes a
  linear `volume` multiplier, and an item that lands entirely outside the version's trimmed window
  is dropped from the plan. Item-level `source_offset`, `speed` and fades always apply.
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
| POST   | `/api/v1/render-presets`     | Create a preset (admin only; format/codec/resolution/frame-rate validated)                                 |
| POST   | `/api/v1/renders`            | Queue a render: `{project_id, timeline_id, preset_id?}` → 202 with the queued job                          |
| GET    | `/api/v1/renders/:id`        | Job state (status, progress, error, output path, validation report)                                        |
| GET    | `/api/v1/renders/:id/log`    | Structured event log for the job                                                                           |
| POST   | `/api/v1/renders/:id/cancel` | Cancel: queued → `cancelled`; running → `cancelling` (engine stops at the next checkpoint); terminal → 409 |
| GET    | `/api/v1/exports`            | List exports (filters: `project_id`, `render_job_id`), scoped to projects the user can read                |

All endpoints require authentication; reads/writes are gated by project permissions (create requires
timeline write + read on the first item's media). A video preset requires at least one renderable
video item; a `wav` (audio) preset requires at least one audio-track item — otherwise the queued job
fails the render with a validation error.
