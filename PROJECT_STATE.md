# Project State - CinemaItor

## Current Status: Milestone 7 in progress (subtitles + text overlays, proxy workflow, frontend

phase 3 prompt studio + model manager shipped; remaining: skills, templates, advanced storage, audio
polish, model benchmark)

The product track follows `MASTER-PLAN.md`. The legacy demo API (movies/scenes) remains until it is
removed.

### Completed

- [x] Foundations: Deno + Oak backend, SQLite migrations, config, logging, errors, CI
- [x] Storage base: `app_data` layout, SHA-256 checksums, content-addressed store, atomic writes,
      dedupe
- [x] Auth v1: bootstrap (first user = admin), login/logout, session revocation, JWT sessions
- [x] Projects: CRUD, defaults, settings, ownership + `project_permissions`, soft delete, audit
- [x] Asset library: CRUD with global/project scope, unique `@name` slugs, aliases, tags, immutable
      versions, active/preview pointers, restore, upload pipeline, stored-hash version registration,
      preview streaming, search/filters, soft delete with broken-reference warnings, audit log
- [x] Authorization model: admin role bypass, creator ownership, project-permission inheritance,
      explicit `asset_permissions` (highest rank wins)
- [x] Reference engine: `@slug` / `@slug:vN` parsing, resolution against live assets, roles,
      persisted references per source, audit with broken flags, reference replacement
- [x] Prompt versioning: versioned prompt history per scope, SHA-256 duplicate detection, parent
      links, restore, per-version reference persistence
- [x] Model manager: model registry + metadata, local/URL install with SHA-256 verify, remove,
      enable/disable, backend health checks (mock/cli/http), task mapping, hardware detection,
      requirement warnings, model presets, license metadata
- [x] Generation pipeline: job queue (durable, leased), in-process runner with concurrency, adapter
      interface + mock adapter (deterministic, seeded), progress/ events, cancel + retry, job
      recovery, candidates -> asset versions with full provenance
      (prompt/model/seed/settings/inputs)
- [x] Storyboards, scenes & shots (Milestone 4 part 1): ordered panels/scenes/shots, prompt
      versioning + reference resolution on creative objects, panel generate-preview (t2i) and scene
      generate (i2v from linked panel preview / t2v), runner links outputs back to panels/shots
- [x] Review workflow (Milestone 4 part 2): candidate comparison per job, approve (promotes to
      active version) / reject / shortlist (toggle) with per-candidate notes, asset write-permission
      gated, audited
- [x] Timeline editor core (Milestone 5): project-scoped timelines, typed tracks (swap reorder,
      lock/mute), items placed on asset versions (move/trim/speed/transform/fades/effects), item
      duplicate, duration recompute, markers, full-state snapshots with restore
- [x] Audio import + versioning (Milestone 6 part 1): audio asset upload (wav/mp3/flac/ogg/
      m4a/aac), version by upload or stored hash, ffprobe/ffmpeg analysis (duration, sample rate,
      channels, 200-bucket waveform) with graceful no-ffmpeg fallback, non-destructive trim/gain
      adjustments applied at render time, waveform endpoint (503 when unanalyzable). Also: logger
      stdio writes are now failure-safe (a logging failure can no longer turn a 5xx into a
      plain 500)
- [x] Render / Export (Milestone 6 part 2): render presets (seeded draft/final/audio defaults,
      admin-manageable), durable render queue with leases + stale recovery, in-process render
      runner, pluggable engines (ffmpeg concat `-c copy` when available, deterministic mock engine
      otherwise; `RENDER_ENGINE=auto|ffmpeg|mock`), cancellation (queued or running), structured log
      endpoint, output validation report, exports table with full provenance (render job, timeline,
      preset, engine, media hash) as asset + immutable asset version
- [x] Diagnostics / Ops (Milestone 6 part 3): DIA-001 hardware report (CPU/RAM/GPU/OS); DIA-002
      model health batch report; DIA-003 durable `diagnostics` table mirrored from the backend
      logger (warn/error sink; logging failures can never break a request); DIA-004 storage report
      (per-directory usage, content-store dedup, orphan files, missing version media); DIA-005
      redacted diagnostics export (no `*_secret` config keys); DIA-006 project backup (JSON bundle
      under `backups/` + `backups` table record, media manifest with presence/size); DIA-007 restore
      (fresh ids, slug-collision-safe, FK-remapped assets/versions/aliases/tags/timelines/tracks/
      items/markers, per-file missing-media report); DIA-008 crash recovery (already covered by the
      lease + stale-recovery of the job/render runners, tested)
- [x] Audio generation (Milestone 7 part 1, AUD-009/010/011): `POST /api/v1/audio/generate`
      generates music / voiceover (text to speech) / SFX from a prompt via the generation pipeline
      (kind → task type `music` / `voice` / `audio`), each call targeting a fresh `audio` asset;
      candidates are stored as asset versions with full provenance and picked in the review
      workflow; scoped by `scene_id` (scene write) or `project_id` (project write)
- [x] Batch shot generation (Milestone 7 part 2): `POST /api/v1/scenes/:id/batch-generate` queues
      one generation job per shot (shared scene input: i2v from a linked panel preview, else t2v);
      each shot uses its own prompt when present, otherwise the scene prompt; shots without any
      prompt are skipped with a reason; on success the runner links each shot's
      `generated_asset_version_id` + status
- [x] Transitions + color grading (Milestone 7 part 3): per-item transition type/duration, fade
      in/out, and color grade (brightness/contrast/saturation/temperature) with strict validation;
      null clears a field on updates; render plans carry the fx — ffmpeg engine uses a filter graph
      (xfade/eq/colortemperature/fade, H.264 re-encode, video-only fx pass) when any item has fx and
      keeps the lossless concat path otherwise; mock engine fingerprints fx into its deterministic
      output
- [x] Subtitles + text overlays (Milestone 7 part 4): `text`/`subtitle` track items can carry an
      inline `text` payload (max 512 chars) with an optional `text_style` (`font_size`,
      `font_color`, `position` top/middle/bottom, `margin`) — strict validation, 400 on media
      tracks, `null` clears on updates, versionless items allowed on text tracks (media tracks still
      require a version); render plans carry the overlays — the ffmpeg engine draws them in a final
      `drawtext` stage (`enable=between(t, start, end)`, quoted/escaped text, per-overlay position)
      and the mock engine fingerprints them into its deterministic output
- [x] Proxy workflow polish (Milestone 7 part 5): every video/image/audio asset version can carry a
      `proxy` (a small fast-transcoded copy, `asset_versions.proxy_path`) — uploads and version
      registration queue a model-less `proxy` job through the normal job runner (ffmpeg when
      available: 720p H.264/AAC, 320px JPEG, 128 kbps MP3; deterministic mock proxy otherwise);
      `GET/POST /api/v1/assets/:id/versions/:versionId/proxy` serve/regenerate; jobs are listable
      via `?job_type=proxy`
- [x] Render draft/final source selection: `draft` presets render proxies (falling back to the
      master if no proxy exists), `final` presets render masters only and fail on missing media;
      per-item `source` is part of the mock engine fingerprint and the validation report carries a
      `sources` tally (`{proxy, master}`)
- [x] Frontend phase 1 (MASTER-PLAN §15.3): frontend auth on `/api/v1/auth` (bootstrap for the first
      user, login, logout with server-side session revocation, `me`), project dashboard (list
      accessible projects, create, edit settings, soft delete) on `/api/v1/projects`, `#/projects`
      becomes the default route; legacy movie demo views remain until the phase 7 cleanup
- [x] Frontend phase 2 (asset library UI, MASTER-PLAN §15.3): `#/assets` global library plus
      per-project `#/project/:id/assets` (linked from project detail); asset cards with lazy
      blob-preview thumbnails; create (metadata-only asset) and upload (multipart `POST /upload`
      producing the first version) flows with auto-slugification, type/scope/project selection and
      version notes; list filters (search, scope, type, status, tag) mapped to the v1 query params;
      asset detail with image/video/audio blob preview, master/proxy switch + proxy regeneration,
      metadata editing, new-version upload, version history with restore, tag and alias management,
      soft delete

### In Progress

- [ ] Frontend phase 3 (MASTER-PLAN §15.3): prompt studio (`#/prompts`) with versioned editing per
      scope (history view + restore, duplicate detection notice), live `@slug` / `@slug:vN`
      reference parsing with per-token status badges, asset picker that inserts references at the
      caret; model manager (`#/models`) with registry list/filters, hardware report + requirement
      warnings, per-model health check + checksum verification, admin-gated install (with network
      consent), enable/disable, and remove

### Planned (next work packages per MASTER-PLAN.md)

- [ ] Workstream 11 follow-ups: audio trim/gain rendering, waveforms in the timeline, basic mixer
- [ ] Workstream 12 follow-ups: per-item source trimming in the ffmpeg engine, audio track placement
      in renders (fx pass is video-only), frame-accurate cuts, render farm / multiple render
      runners, progress from ffmpeg stats
- [ ] Workstream 10 follow-ups: playback engine, undo/redo, basic audio track
- [ ] Milestone 3 follow-up: WebSocket `/ws/v1/jobs` live updates; real model adapters
      (ComfyUI/local CLI)
- [ ] Thumbnails/waveforms in the timeline view via FFmpeg (STO-007..009) — asset proxies now ship
      with the proxy workflow above
- [ ] Workstream 13 (Diagnostics) follow-ups: restore also re-links storyboards/scenes/prompts,
      snapshot JSON id-remap on restore, backup of media binaries (transferable bundles)
- [ ] Workstream 14 (Professional Workflow Expansion, Milestone 7) remaining: skills (JSON/YAML v1),
      project templates, advanced storage management, ducking, audio cleanup, subtitle generation
      from dialogue/voiceover, A/B + version comparison improvements, model benchmark
- [ ] E2E tests, Docker packaging, production hardening

### Known Issues

- [ ] Upload bodies are buffered by the runtime parser (no chunked streaming yet)
- [ ] No rate limiting on auth endpoints
- [ ] Frontend still uses the legacy `movies` API surface for the demo views

### Version

- Generation pipeline: Wed Aug 19 2026
- Storyboards, scenes & shots: Wed Aug 19 2026
- Review workflow: Wed Aug 19 2026
- Timeline editor core: Wed Aug 19 2026
- Audio import + versioning: Wed Aug 19 2026
- Render / Export: Wed Aug 19 2026
- Diagnostics / Ops (hardware, model health, storage, logs, export, project backup/restore): Thu Aug
  20 2026
- Audio generation (music / voiceover / SFX): Thu Aug 20 2026
- Batch shot generation: Thu Aug 20 2026
- Transitions + color grading: Thu Aug 20 2026
- Subtitles + text overlays: Thu Aug 20 2026
- Proxy workflow polish: Thu Aug 20 2026
- Render draft/final source selection: Thu Aug 20 2026
- Frontend phase 1 (v1 auth + project dashboard, MASTER-PLAN §15.3): Thu Aug 20 2026
- Frontend phase 2 (asset library UI, MASTER-PLAN §15.3): Thu Aug 20 2026
