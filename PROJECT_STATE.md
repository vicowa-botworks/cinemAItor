# Project State - CinemaItor

## Current Status: Milestone 7 in progress (subtitles + text overlays, proxy workflow, frontend

migration through phase 7 — audio generation + waveforms and the diagnostics panel shipped, legacy
demo surface removed; remaining: skills, templates, advanced storage, audio polish, model benchmark)

The product track follows `MASTER-PLAN.md`.

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
      under `backups/` + `backups` table record, media manifest with presence/size, sibling media
      bundle dir for transferability; schema 2 adds storyboards/panels, scenes/shots, prompt-version
      history, and resolved references; schema 3 adds full timeline snapshots); DIA-007 restore
      (fresh ids, slug-collision-safe, FK-remapped assets/versions/aliases/tags/
      timelines/tracks/items/markers plus all creative objects and their prompt/reference links,
      SHA-256-verified media-bundle import, per-file missing-media and dangling-link reports);
      DIA-008 crash recovery (already covered by the lease + stale-recovery of the job/render
      runners, tested)
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
- [x] Audio + source edits in renders (Workstream 12 follow-ups): the ffmpeg fx pass now handles
      per-item video source trimming + speed (`trim`/`setpts`) and mixes audio-track items
      (`dialogue`/`voiceover`/`music`/`sfx`/`ambience`) into the output — per-item `atrim` (with the
      version's trim window clamping the source window), `atempo` chain for speed, `volume` from the
      version's `gain_db`, item fades, `adelay` into the timeline slot, `amix` (no normalization,
      tail cut to video length) mapped as AAC; plans with audio or source edits always take the fx
      pass; mock engine fingerprints audio + source edits (bytes are content-addressed, so unchanged
      re-renders dedupe in the content store); validation report gains an `audio`
      (`{items, proxy, master}`) tally
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
- [x] Frontend phase 3 (MASTER-PLAN §15.3): prompt studio (`#/prompts`) with versioned editing per
      scope (history view + restore, duplicate detection notice), live `@slug` / `@slug:vN`
      reference parsing with per-token status badges, asset picker that inserts references at the
      caret; model manager (`#/models`) with registry list/filters, hardware report + requirement
      warnings, per-model health check + checksum verification, admin-gated install (with network
      consent), enable/disable, and remove
- [x] Frontend phase 4 (MASTER-PLAN §15.3): job queue monitor (`#/jobs`) with auto-refresh polling
      (WebSocket fallback until `/ws/v1/jobs` exists), status/type/project filters, live progress
      bars, per-job detail (prompt, seed, settings, inputs, errors, event log), and cancel/retry
      actions; creative jobs (t2i / i2v / t2v) link through to the review board
- [x] Frontend phase 5 (MASTER-PLAN §15.3): creative screens — storyboard board (`#/storyboards`,
      `#/storyboard/:id`) with panel CRUD, versioned panel prompts, and t2i preview generation into
      the job queue; scene inspector (`#/scenes`, `#/scene/:id`) with shot CRUD, scene/shot prompts,
      single + batch generation (i2v/t2v), model/seed selection, and clip playback; review board
      (`#/review/:jobId`) with candidate comparison and approve / reject / shortlist decisions;
      project-detail entry points into both boards
- [x] Frontend phase 6 (MASTER-PLAN §15.3): timeline editor + render/export UI — timeline list
      (`#/timelines`, also `?project=` filter from project detail) with project filtering, card
      grid, and create; timeline editor (`#/timeline/:id`) with ruler + click-to-set playhead, typed
      tracks (add, lock/mute, swap reorder, delete), clip + text placement via asset version picker,
      pointer-drag item moving, per-item fx panel (trim, speed, fades, transitions, color grade,
      text style), duplicate/delete, markers, full-state snapshots + restore, and a render / export
      panel (preset select, queue draft/final renders with polling status/progress, cancel,
      resulting export linked to its asset, recent-exports list)
- [x] Frontend phase 7 (MASTER-PLAN §15.3): audio generation dialog (music / voiceover / SFX prompt
      → job queue, scene-scoped in scene detail and project-scoped in timeline detail), waveform
      strips (200-bucket peaks) on audio-track timeline items, and the diagnostics & settings panel
      (`#/diagnostics`: hardware / model health / storage reports, diagnostics log browser with
      filters, redacted export, project backup / restore); legacy `movies` demo surface removed
      (frontend components/routes/API + `/api/movies` backend routes + legacy CRUD)
- [x] Audio adjustments UI (asset detail, Workstream 11 follow-up): audio assets show an "Audio
      adjustments" section in their detail view — the active version's 200-bucket waveform with the
      stored trim window highlighted, plus trim start/end (s) and gain (dB) inputs validated against
      the version duration and saved per-version via the adjustments endpoint (applied at render
      time by the fx pass); reset restores the full window and 0 dB; the parse/prefill/validation
      logic lives in shared `frontend/src/audio-adjustments.js` with unit tests
- [x] Render progress from ffmpeg stats (Workstream 12 follow-up): the ffmpeg render engine runs
      with `-nostats -progress pipe:1` and maps the reported `out_time` onto job progress (concat
      path 20 → 90, fx path 10 → 90; 100 after the output is stat-verified), so the job queue and
      render panel show live percent while a render executes; the progress read loop races against
      process exit, and a 250 ms poller kills ffmpeg on cancellation so it never waits on ffmpeg
      output. Enabling `--allow-run` for the engine tests also surfaced two latent ffmpeg-path bugs,
      fixed here: proxy scratch output now carries the target extension (ffmpeg infers the output
      format from the file name) and failed transcodes include ffmpeg's stderr in the job error, and
      audio analysis probes with ffprobe (`FFPROBE_PATH`, default `ffprobe`) instead of passing
      ffprobe-only flags to ffmpeg
- [x] Audio export (Workstream 12 goal): `wav` presets (e.g. the seeded `preset-audio`) now produce
      real audio-only renders. The plan builder builds an audio-only plan for `wav` formats — no
      video items, no text overlays, `total_duration` = the audio items' end extent, and a "no
      audio-track items" render failure when there is nothing to mix; the ffmpeg engine gained an
      audio path (`buildAudioArgs`) that runs each audio item through the same
      `atrim`/`atempo`/`volume`/`afade` chain as the fx pass, delays it into its timeline slot and
      sums the mix with `amix=duration=longest:normalize=0` into a PCM 16-bit wav with no video
      (`-vn`); the mix runs to the longest item instead of a video length, and exports land as audio
      assets with an `audio/wav` version (mock engine already wrote valid wavs). Verified against
      real ffmpeg 8.0 in a live smoke (exact 5.000 s output from two sine inputs with
      speed/gain/fade); tests cover the arg builder, wav routing, mock e2e export and the no-audio
      failure
- [x] WebSocket `/ws/v1/jobs` live updates (Milestone 3 follow-up): authenticated WebSocket
      (`?token=` query param verified through the auth-middleware path — JWT + session) that pushes
      job and render updates to every connected client. Frames are
      `{kind: "progress"|"status", jobId|renderId, progress?|status?}` and are emitted from the
      store write paths (create/claim/updateProgress/finish/retry/recover for both generation jobs
      and render jobs), so every transition is pushed exactly once regardless of code path
      (in-process broadcast; single-instance assumption documented). Frontend: shared
      `job-events.js` client (one socket multiplexed across consumers, reconnect with 1s→30s
      backoff, closes when the last consumer unmounts); job-monitor patches progress in place and
      refreshes on status, timeline render panel does the same for the active render; 2-3s polling
      is kept as a fallback so the UI degrades to the previous behavior when the socket cannot
      connect
- [x] Timeline playback preview (TIM-010 / Workstream 10 follow-up): browser-side preview of a
      timeline in the editor — `<timeline-preview>` above the canvas with play/pause/stop, 0.25×–2×
      rate, and in/out loop range. Video comes from the same source selection as the render runner
      (unlocked video/overlay tracks, top track wins): proxy-first media resolution with master
      fallback for the active/preview version, per-clip speed/fade-in-fade-out (applied to
      playbackRate, opacity, and audio volume), and CSS-filter approximations of the stored color
      grade + temperature. Audio-track items are mixed from a small pool of `<audio>` elements: the
      served stream is the unadjusted stored file, so the item's version `gain_db` (plus its track's
      mixer `gain_db`) and the version's trim window are applied client-side (only the active
      version carries adjustments — the adjustments UI targets that version); audio plays for the
      asset's active/preview version only, since the media endpoint streams that version's file.
      Item fades apply on top; text/subtitle items render as positioned overlays. The pure geometry
      (active-visual/audio/text selection, source time at timeline time, fade factors, grade →
      filter mapping, in/out range) lives in `frontend/src/timeline-playback.js` with unit tests;
      the component drives it from a requestAnimationFrame loop and emits `playheadchange` (~10 Hz)
      which the ruler playhead follows. The ruler now also drag-scrubs (pointer capture) in addition
      to click-to-set. Grades/mixes are preview approximations — the render pipeline remains the
      source of truth
- [x] Basic mixer (AUD-007 / Workstream 11 follow-up): audio tracks (dialogue, voiceover, music,
      SFX, ambience) gain a per-track `gain_db` mixer slider (−24..+24 dB in the UI; the API allows
      −60..+24) on the track row. The render plan now skips muted audio tracks and applies the
      track's `gain_db` on top of each clip's version `gain_db` (dB values summed, then a single
      linear factor — the preview uses the same 10^(dB/20) scale after fixing the playback module's
      2^(dB/20) scale mismatch), so the preview and the render match. Migrations
      `0016_track_gain.sql`
- [x] Timeline undo/redo (Workstream 10 follow-up): `POST /api/v1/timelines/:id/state` atomically
      replaces a timeline's full state in one transaction (duration/settings, tracks, items,
      markers) — each row re-validated like the single-item create/update routes (ranges, speed,
      fades, text overlay placement, gain), with duplicate ids and dangling `track_id`s rejected up
      front (400, nothing applied); row ids in the body are kept, so undo restores the same row
      identity, not just the data. The editor stores an in-memory, per-visit history
      (`frontend/src/undo-history.js`, bounded to the last 50 changes, unit-tested, lost on refresh
      — durable checkpoints remain snapshots): every track/item/marker mutation pushes the
      pre-change state, and the header Undo/Redo buttons plus `Ctrl+Z` / `Ctrl+Shift+Z` (outside
      text fields) replay stored states through the endpoint; a failed restore rolls the step back
      onto the stack it came from
- [x] Basic audio track (Workstream 10 follow-up): media-kind matching enforced on item create, item
      update, and full-state restore (400 on mismatch) — `video`/`overlay` tracks accept only video
      assets, `dialogue`/`voiceover`/`music`/`sfx`/`ambience` tracks only audio assets, the reserved
      `effect`/`transition` types stay open — so a misplaced clip can no longer silently vanish from
      the render output. The editor's placement picker offers only matching assets for the selected
      track (audio tracks additionally list globally generated audio, fetched once per load and
      shared with the waveform + preview paths), clears a stale selection when the track changes,
      and prefills the placement duration from the selected version's ffprobe audio metadata (also
      fixed the picker's blank option labels, which read `a.name` instead of `display_name`)
- [x] Timeline video thumbnails (STO-007..008 / Workstream 12):
      `GET
      /api/v1/assets/:id/versions/:versionId/thumbnail` generates a cached JPEG per
      version and geometry: video = one frame at `?at=<sec>` (input seek, quantized to 100 ms),
      images scaled down to `?w=<px>` (clamped 64..1280, default 320), via ffmpeg. Files land in
      `appDataDir/assets/thumbnails/` under a deterministic `version-at-width` name, so repeated
      requests are a `stat`; 404 for audio versions or missing files, 400 for a bad `at`, 503 when
      ffmpeg is unavailable, 502 when extraction fails (stderr in the error details, 30 s spawn
      timeout). The timeline editor now draws a film strip inside video/overlay items: the
      unit-tested pure `filmstripFramesFor` (one frame per ~2 s of span, at most 4, in source time
      at 100 ms — the same speed/offset math as the preview) feeds `api.getAssetThumbnailUrl`, whose
      blob URLs are cached per version+seek and revoked on unmount; failed fetches leave the item as
      a plain color block
- [x] Frame-accurate cuts (Workstream 12 follow-up): the lossless concat fast path can only splice
      whole files, so a tail-trimmed clip (shorter than its source — the editor's default shrink)
      was previously concatenated in full and rendered longer than the timeline. `buildPlan` now
      ffprobes each video item's file (the proxy in draft renders, the master in final renders) and
      sets `consumes_full_source`; a `false` flag forces the re-encoding fx pass, whose `trim`
      filter cuts frame-accurately. A 0.1 s tolerance absorbs the editor's 0.01 s rounding (plus
      float-approximate probed durations) so untouched clips stay lossless; when ffprobe is
      unavailable or fails, the duration is unknown and the legacy concat behavior is kept
- [x] Creative-objects backup (Workstream 13 follow-up): the backup document is now `schema: 2` and
      includes storyboards + panels, scenes + shots, the full `prompt_versions` history per creative
      object, and their resolved `asset_references` (references keep global asset ids). Restore
      re-creates all of it under fresh UUIDs with every creative link remapped (panel/ scene/shot
      `prompt_version_id`, preview/clip/generated version ids, scene/shot links,
      `scene.storyboard_id`, reference source/asset/version ids); links to objects missing from the
      backup are nulled and reported in `issues`. Schema-1 backups remain restorable (empty creative
      sections)
- [x] Timeline-snapshot backup (Workstream 13 follow-up): the backup document is now `schema: 3` and
      includes each timeline's snapshots with their full serialized state. Restore re-creates them
      under fresh timeline rows and rewrites every embedded id (`track_id`, `item_id`, `marker_id`,
      `asset_version_id`) to the restored objects, so the app's own `restoreSnapshot` path replays
      them on the restored timeline. Snapshot entries whose targets were not part of the backup are
      dropped and reported; snapshots in pre-schema-3 backups (count-only) are skipped and reported.
      Backup `counts.snapshots` now counts the snapshots carried by the document (the earlier
      `snapshots_skipped` field is gone)
- [x] Media-bundle backup (Workstream 13 follow-up): the backup export now also writes a media
      bundle next to the JSON — `backups/backup-<id>/media/<h0:2>/<h2:4>/<hash>.<ext>` (the
      content-store layout, one copy per referenced file still in the store) — so a backup + bundle
      is transferable between hosts. Restore imports the bundle first (each file re-verified by
      SHA-256; corrupt copies skipped + reported, present files deduplicated) and then resolves
      media against the content store as before; the response gains a
      `media: { restored, reused, corrupted }` summary. Pre-bundle single-file backups remain
      restorable; deleting a backup removes the bundle too
- [x] MVP acceptance flow test (Milestone 6 exit criterion): `backend/tests/mvp_acceptance.test.ts`
      exercises the entire studio journey over live HTTP with the mock render engine — bootstrap +
      multi-user (admin/collaborator/viewer), model register + enable, project, media uploads
      (image/video/audio) with versions, versioned prompt with @alias reference audit, storyboard
      panel t2i preview job, scene + shots with panel-link and i2v batch clip job, review approval,
      multi-track timeline (video + music + text overlay) with marker/snapshot, snapshot restore via
      the atomic state endpoint, wav render + export, diagnostics endpoints, project backup with
      media bundle → restore → delete, and non-admin isolation (404s over the HTTP surface). Also
      fixed the gap it exposed: text overlay items (null `asset_version_id`) were silently dropped
      on backup restore and `item_text`/`text_style` were never captured — the backup payload now
      carries both and restore keeps versionless items (media items with a missing version are still
      dropped + reported, including inside restored snapshots)
- [x] Ducking (AUD-013 / Workstream 14): music lowers under dialogue. `tracks` gain a `duck_db`
      (0..60 dB, default 0 = off; migration `0017_track_ducking.sql`; settable via PATCH track and
      the full-state restore, unit-tested). The render plan computes duck windows per music item —
      the rendered dialogue items' timeline spans, clipped to the music item's lifetime and merged
      when they overlap or touch (locked/muted dialogue is outside the plan and never ducks; only
      `dialogue` drives, and only `music` ducks) — and the engine applies each window as a
      frame-evaluated `volume` stage (`1-(1-G)*…`, `G = 10^(-duck_db/20)`) on the item's audio
      chain, so a render with ducking differs byte-for-byte from the unducked plan (mock
      fingerprint + fake-ffmpeg `volume=`-stage assertions cover this). The editor gets a
      per-music-track duck slider on the track row, and the browser preview attenuates music clips
      by the same factor while audible dialogue plays (`duckGainAt` in `timeline-playback.js`,
      unit-tested) — preview and render match

### Planned (next work packages per MASTER-PLAN.md)

- [ ] Workstream 12 follow-up: render farm / multiple render runners
- [ ] Milestone 3 follow-up: real model adapters (ComfyUI/local CLI)
- [ ] Workstream 14 (Professional Workflow Expansion, Milestone 7) remaining: skills (JSON/YAML v1),
      project templates, advanced storage management, audio cleanup, subtitle generation from
      dialogue/voiceover, A/B + version comparison improvements, model benchmark
- [ ] Docker packaging, production hardening (MVP acceptance E2E is done)

### Known Issues

- [ ] Upload bodies are buffered by the runtime parser (no chunked streaming yet)
- [ ] No rate limiting on auth endpoints

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
- Frontend phase 3 (prompt studio + model manager, MASTER-PLAN §15.3): Thu Aug 20 2026
- Frontend phase 4 (job queue monitor, MASTER-PLAN §15.3): Thu Aug 20 2026
- Frontend phase 5 (creative screens, MASTER-PLAN §15.3): Fri Aug 21 2026
- Frontend phase 6 (timeline editor + render/export UI, MASTER-PLAN §15.3): Fri Aug 21 2026
- Frontend phase 7 (audio generation dialog + waveforms, diagnostics panel, legacy movies removal,
  MASTER-PLAN §15.3): Fri Aug 21 2026
- Timeline playback preview (TIM-010): Fri Aug 21 2026
- Basic mixer (AUD-007, track gain in preview + renders): Fri Aug 21 2026
- MVP acceptance flow (E2E over HTTP) + backup text-overlay restore fix: Sat Aug 22 2026
- Ducking (AUD-013, music lowers under dialogue in preview + renders): Sat Aug 22 2026
