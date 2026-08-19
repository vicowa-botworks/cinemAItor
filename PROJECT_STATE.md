# Project State - CinemaItor

## Current Status: Milestone 6 in progress (Audio import + versioning complete)

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

### In Progress

- [ ] Frontend: wire the asset library and project views to the `/api/v1` endpoints

### Planned (next work packages per MASTER-PLAN.md)

- [ ] Workstream 11 follow-ups: audio trim/gain rendering, waveforms in the timeline, basic mixer
- [ ] Workstream 12: Render / Export (presets, render queue, MP4/audio export, logs, export
      provenance)
- [ ] Workstream 10 follow-ups: playback engine, undo/redo, basic audio track
- [ ] Milestone 3 follow-up: WebSocket `/ws/v1/jobs` live updates; real model adapters
      (ComfyUI/local CLI)
- [ ] Thumbnails/proxies/waveforms via FFmpeg (STO-007..009)
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
