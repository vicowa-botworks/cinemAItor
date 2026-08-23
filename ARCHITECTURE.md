# Architecture & Technical Documentation

## Overview

CinemaItor is a full-stack web application for AI-assisted movie creation. Users can plan movies,
write scenes, and generate content using AI tools.

## Tech Stack

### Backend

| Component      | Technology                 | Justification                                                                       |
| -------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| Runtime        | Deno 2.x                   | Secure by default, built-in TypeScript, excellent std library                       |
| Web Framework  | Oak (`@oak/oak`)           | Mature, Express-like middleware framework for Deno                                  |
| Router         | Oak Router (`@oak/router`) | Decorator-based routing                                                             |
| Database       | SQLite (via `@db/sqlite`)  | Lightweight, zero-config, file-based, perfect for startup                           |
| Authentication | Custom JWT with PBKDF2     | Self-implemented for full control; PBKDF2 with 100k iterations for password hashing |
| CORS           | `@oak/cors`                | Standard CORS middleware                                                            |

### Frontend

| Component    | Technology                                     | Justification                                              |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------- |
| Runtime      | Deno (serve command)                           | Serves static files and proxies API requests               |
| UI Framework | Lit (ESM CDN via import map)                   | Lightweight web components library with reactive rendering |
| Styling      | CSS with Shadow DOM                            | Encapsulated styles per component                          |
| State        | Browser storage (localStorage) + custom events | Simple, no external state management                       |
| Routing      | Hash-based (`#/movies`, `#/login`)             | No server-side routing needed                              |

### Development

| Component  | Technology                                     |
| ---------- | ---------------------------------------------- |
| Linting    | `deno lint` (backend), ESLint (frontend)       |
| Type Check | `deno check` (backend and frontend)            |
| Formatting | Deno built-in `deno fmt`                       |
| Testing    | Deno built-in test runner (`@std/testing/bdd`) |
| CI/CD      | GitHub Actions                                 |

## Architecture

### High-Level Architecture

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Browser    │────────▶│   Frontend   │────────▶│    Backend   │
│  (Client)    │◀────────│  (Deno)      │◀────────│   (Deno)     │
│              │         │  :8124       │         │   :8123      │
└──────────────┘         └──────────────┘         └──────┬───────┘
                                                          │
                                                          ▼
                                                 ┌──────────────┐
                                                 │    SQLite    │
                                                 │   Database   │
                                                 └──────────────┘
```

### Frontend Architecture

The frontend is plain JavaScript (no build step). It uses a component-based architecture built on
Web Components with Lit, loaded from an ESM CDN via an import map. For production, a minifier is the
only planned processing step:

```
app-root (main router)
├── app-header (navigation)
├── login-form (v1 auth: login / bootstrap)
├── project-list (project dashboard)
│   ├── project-card (individual project)
│   └── project-form (create; template picker pre-creates a starting timeline)
├── project-detail (project settings, edit, delete; shows the project's template)
│   └── project-form (edit)
├── asset-list (global library + per-project via #/project/:id/assets)
│   ├── asset-card (tile with lazy blob-preview thumbnail)
│   ├── asset-form (create metadata-only asset)
│   └── asset-upload (create + multipart file upload → first version)
  ├── asset-detail (preview, master/proxy switch, metadata, versions/restore,
  │   │              version A/B compare (two versions side by side: synced play + metadata diff,
  │   │              see compare.js),
  │   │              audio adjustments (waveform + trim/gain for audio assets),
  │   │              audio cleanup (denoise/normalize → new version, AUD-012),
  │   │              subtitle generation (transcribe → SRT candidates on a new subtitle asset, AUD-014),
  │   │              tags, aliases, delete)
├── prompt-editor (Prompt Studio: versioned prompts per scope, live @slug reference
│   │              parsing with status badges, asset picker, history view/restore)
├── model-manager (registry list/filters, hardware report + warnings, per-model
│   │              health check + checksum verify, per-model benchmark run + results
│   │              table (WS 14), admin-gated install/enable/remove)
├── job-monitor (queue monitor: auto-refresh polling + live `/ws/v1/jobs` WebSocket
│   │            updates (see `job-events.js`), status/type/project filters, progress bars,
│   │            per-job detail + event log, cancel/retry)
├── job-events (shared WebSocket client: one socket multiplexed across consumers, token
│   │           handshake auth, reconnect with backoff, polling kept as fallback)
├── storyboard-list (board list + create; project filter via #/storyboards?project=)
├── storyboard-detail (panels: CRUD, versioned panel prompts, t2i preview → job queue,
│   │                 live preview polling)
├── scene-list (scene list + create; project/storyboard filters)
├── scene-detail (shots: CRUD, scene/shot prompts, i2v/t2v single + batch → job queue,
│   │            clip playback, embedded audio generation)
├── review-board (job candidate comparison with two-candidate A/B mode — synced play/seek +
│   │             quick approve; approve / reject / shortlist + notes)
├── skills-list (v1 skill system: list, create/edit JSON definitions, version history,
│    enable/disable, delete; run form (project + inputs) with live WebSocket job events +
│    poll-to-terminal run history showing per-step job ids)
├── timeline-list (timeline list + create; project filter via #/timelines?project=)
├── timeline-detail (tracks with lock/mute + mixer gain + ducking + swap reorder,
│   │               clip/text placement via
│   │               kind-filtered picker (audio tracks offer project + global generated audio,
│   │               duration prefilled from ffprobe metadata) + move/resize +
│   │               speed/volume/fades/transition/color-grade
│   │               fx panel, waveform strip on audio items, markers, snapshots/restore,
│   │               undo/redo (in-memory history replayed through the atomic full-state
│   │               restore endpoint),
│   │               render presets + queue + exports with job log, in-browser playback preview
│   │               above the canvas — see timeline-preview; ruler click + drag-scrub)
├── timeline-preview (browser-side timeline playback: play/pause/stop, 0.25×–2× rate, in/out
│   │             loop range; proxy-first media with master fallback, render-source track
│   │             selection, per-clip speed/fades, CSS-approximated color grade, audio mix from
│   │             track + version gain/trim + fades + dialogue ducking, text/subtitle overlays)
├── undo-history (bounded in-memory undo/redo stack + detail→state flatten, unit-tested;
│   │             consumed by timeline-detail)
├── audio-dialog (shareable audio generation: music/voiceover/SFX prompt → job queue;
│   │             embedded in scene-detail and timeline-detail)
├── creative-assets (shared deterministic slug→asset-id map for panel_/scene_/shot_)
├── audio-adjustments (shared trim/gain parse/prefill/validation for the asset-detail
│   │                  adjustments UI)
├── compare (shared A/B pair selection, row differ, and synced-media transport (CompareSync)
│   │        for review-board candidate compare and asset-detail version compare — unit-tested)
├── timeline-playback (shared pure playback math: active visual/audio/text at time, source time,
│   │                  fade factors, grade→CSS filter mapping, in/out range — unit-tested)
└── diagnostics-panel (hardware/model/storage reports, diagnostics log browser,
    diagnostic bundle export, project backup/restore, storage management — per-project
    usage, `?verify=1` checksum integrity and admin cache cleanup)
```

**Key design decisions:**

- **Shadow DOM**: Each component encapsulates its styles and markup, preventing CSS leakage
- **Hash-based routing**: Simple client-side routing without server configuration
- **Custom events**: Components communicate via `CustomEvent` dispatching
- **API client**: Singleton `ApiClient` class handles all HTTP communication with automatic token
  injection

### Backend Architecture

```
server.ts (entry point)
├── CORS middleware
├── Error handling middleware
├── Health routes (/api/v1/health)
├── Auth routes (/api/v1/auth/*)
│   ├── POST /bootstrap (first user, becomes admin)
│   ├── POST /login
│   ├── POST /logout
│   └── GET /me
├── Project routes (/api/v1/projects/*, auth middleware)
│   ├── GET / (list accessible)
│   ├── POST / (create; optional template_id materializes a starting timeline)
│   ├── GET /:id
│   ├── PATCH /:id
│   └── DELETE /:id (soft delete)
├── Template routes (/api/v1/templates, auth middleware)
│   ├── GET / (system-seeded starting structures; read-only)
│   └── (see docs/projects.md "Project templates")
├── Asset routes (/api/v1/assets/*, auth middleware)
 │   ├── CRUD + upload + versions + restore + aliases + tags + preview
 │   │   + per-version preview (GET /:id/versions/:versionId/preview, A/B compare)
 │   │   + thumbnails (video frame / image scale, cached JPEG, 503 w/o ffmpeg)
│   ├── Media proxies: GET/POST /:id/versions/:versionId/proxy (transcode + serve)
│   └── (see docs/assets.md)
├── Prompt routes (/api/v1/prompts/*, auth middleware)
│   ├── Versioned prompt history per scope + restore
│   └── (see docs/references.md)
├── Reference routes (/api/v1/references/*, auth middleware)
│   ├── POST /parse (resolve @tokens), GET /audit, GET /:id, POST /:id/replace
│   └── (see docs/references.md)
├── Model routes (/api/v1/models/*, auth middleware, admin for mutations)
 │   ├── Registry, install/verify (SHA-256), remove, enable/disable, /:id/health-check
   │   ├── Model benchmark (WS 14): /:id/benchmark (POST, any auth — measurement only)
   │   │   + /:id/benchmarks (GET); deterministic per-task prompts, 2 candidates each,
   │   │   `model_benchmark` job records duration_ms / candidate_count / output_bytes rows
   │   ├── Hardware detection + requirement warnings (/hardware)
   │   └── (see docs/models.md)
  ├── Job routes (/api/v1/jobs/*, auth middleware)
  │   ├── Queue + events, cancel/retry; in-process runner with leases + recovery
  │   ├── Adapters: mock (deterministic); provenance on produced asset versions
  │   ├── Model-less `proxy` jobs (ffmpeg or mock transcode of media proxies); list filter
  │   │   `?job_type=`
  │   ├── WebSocket `/ws/v1/jobs` (?token= auth): pushes job + render progress/status
  │   │   frames from the store write paths (in-process broadcast, read-only clients)
  │   └── (see docs/jobs.md)
 ├── Storyboard/scene/shot routes (auth middleware, project-permission gated)
 │   ├── Storyboards + ordered panels; scenes + ordered shots
 │   ├── Prompt versioning + reference resolution on creative objects
 │   ├── generate-preview (t2i) and scene generate (i2v/t2v) -> job queue; runner
 │   │   links preview/clip outputs back to panels and shots
 │   └── (see docs/storyboards.md)
  ├── Review routes (/api/v1/review/*, auth middleware, asset write permission)
  │   ├── Job candidate comparison; approve (promote active) / reject / shortlist + notes
  │   └── (see docs/review.md)
  ├── Skill routes (/api/v1/skills/*, auth middleware, project write gate on runs)
  │   ├── CRUD + enable/disable toggle + immutable version history (WS 14 v1, JSON definitions)
  │   ├── POST /:id/run — resolves typed inputs, expands the placeholders, enqueues one
  │   │   generation job per step (all-or-nothing pre-flight); runs settle lazily on read.
  │   │   (running → succeeded/failed from step job states)
  │   └── (see docs/skills.md)
   ├── Audio routes (/api/v1/audio/*, auth middleware, asset write permission)
  │   ├── Generation (AUD-009/010/011): POST /generate — music/voiceover/sfx from prompt
  │   │   (kind → task type music/voice/audio), fresh audio asset per call, job queue + review
  │   ├── Upload + versioning for audio assets (wav/mp3/flac/ogg/m4a/aac)
 │   ├── Optional ffprobe/ffmpeg analysis: duration, sample rate, channels,
 │   │   200-bucket waveform (no-ffmpeg fallback keeps uploads working)
  │   ├── Non-destructive trim/gain adjustments (applied at render time); waveform endpoint
  │   ├── Cleanup (AUD-012): POST /:id/versions/:versionId/cleanup — model-less
  │   │   `audio_cleanup` job (ffmpeg denoise + EBU R128 normalize, mock fallback) producing
  │   │   a new non-active version with cleanup provenance
  │   ├── Subtitles (AUD-014): POST /:id/versions/:versionId/subtitles — `transcribe` model job
  │   │   storing SRT candidates on a fresh global `subtitle` asset (review-board workflow);
  │   │   mock adapter synthesizes a deterministic seeded SRT
  │   └── (see docs/audio.md)
 ├── Timeline routes (/api/v1/timelines/*, auth middleware, project-permission gated)
  │   ├── Timelines + typed tracks (swap reorder, lock/mute, mixer gain_db, duck_db) + placed items (move/trim/
  │   │   speed/transform/fades/transitions/color grade), text overlays (text/subtitle
  │   │   tracks), item duplicate, duration recompute, markers; media-kind matching on item
  │   │   create/update/restore (video tracks need video assets, audio tracks need audio assets)
   │   ├── Full-state snapshots with restore
   │   ├── Atomic full-state restore `POST /:id/state` (duration/settings/tracks/items/markers in
   │   │   one transaction; per-row validation like the item routes; duplicate ids rejected) —
   │   │   backs the editor's undo/redo
   │   └── (see docs/timelines.md)
  ├── Render routes (/api/v1/render-presets, /api/v1/renders/*, /api/v1/exports,
  │   auth middleware, project-permission gated; preset writes admin-only)
  │   ├── Durable render queue (leases, stale recovery) + in-process render runner
  │   ├── Engines: ffmpeg concat (`-c copy`; only when every item consumes its whole
  │   │   source — the plan builder ffprobes each item's file and routes tail-trimmed
  │   │   clips to the fx pass for a frame-accurate cut), ffmpeg fx pass (source trim/speed,
  │   │   transitions/fades/grade, `drawtext` text overlays, audio-track mix via
  │   │   `atrim`/`atempo`/`volume`/`adelay`/`amix` → AAC, with ducking: music items drop by the
  │   │   track's `duck_db` under audible dialogue via a frame-evaluated `volume` stage), ffmpeg
  │   │   audio-only export for `wav`
  │   │   presets (`amix=duration=longest` → `pcm_s16le`, no video), or deterministic mock (auto
  │   │   by availability, `RENDER_ENGINE=auto|ffmpeg|mock`); cancel (queued/running, polled during
  │   │   ffmpeg runs); progress from ffmpeg `-progress pipe:1` out_time; structured logs
    │   ├── Draft/final source selection (video + audio items): draft presets render proxies
    │   │   (master fallback), final presets render masters only; per-source tallies in the
    │   │   validation report; audio items apply the version's trim/gain_db adjustments
   │   ├── Output validation report; exports with provenance as asset + immutable version
   │   └── (see docs/renders.md)
  ├── Diagnostics routes (/api/v1/diagnostics/*, auth middleware)
  │   ├── GET /hardware (CPU/RAM/GPU/OS), GET /models (health batch),
  │   │   GET /storage (usage/orphans/missing media + per-project `projects[]` +
  │   │   top-asset `top_assets[]`; `?verify=1` adds a content-store checksum `integrity`
  │   │   block) (STO-010/011)
  │   ├── POST /storage/cleanup (admin; removes regenerable preview/proxy/thumbnail caches and,
  │   │   optionally, orphaned media — referenced media untouched) (STO-012)
  │   ├── GET /logs (filtered `diagnostics` rows), POST /export (admin; redacted JSON on disk)
   │   ├── Project backup/restore (DIA-006/007): POST /backups, GET /backups,
   │   │   POST /backups/:id/restore, DELETE /backups/:id — schema-3 bundles cover assets,
   │   │   timelines (tracks/items/markers/snapshots), and creative objects (storyboards/panels,
   │   │   scenes/shots, prompt versions, references); export also writes a media bundle
   │   │   (`backup-<id>/media/`, content-store layout) for transferability; restore remaps every
   │   │   creative FK, rewrites snapshot-embedded ids, and imports the bundle media (SHA-256
   │   │   verified), reporting dangling links and missing/corrupt media
  │   ├── Logger sink mirrors warn/error into the durable `diagnostics` table (DIA-003)
  │   └── (see docs/diagnostics.md)
   └── Legacy auth routes (/api/auth/register, /api/auth/login, /api/auth/me —
       multi-user test helper; the /api/movies demo routes were removed in phase 7)
```

**Database layer:**

- `database.ts`: Singleton `Database` instance, schema initialization
- `migrations/`: Ordered, idempotent SQL migrations tracked in `schema_migrations`
- `schema.ts`: Legacy CRUD functions with parameterized queries (SQL injection safe)
- `projects.ts`: Project repository + project permission checks
- `assets.ts`: Asset/alias/tag/version repository + asset permission checks
- `templates.ts`: Global project templates — structure parsing/validation, list/get, and
  `applyTemplateStructure` (creates the starting timeline + tracks with compensation)
- `skills.ts`: Skill system v1 repository — definition parse/validation, CRUD, version snapshots,
  runs, and idempotent `seedSystemSkills`; `skill_engine.ts` (services) resolves typed inputs,
  expands placeholders and enqueues one generation job per step (see `docs/skills.md`)

### Storage layer:

- `storage/paths.ts`: `app_data` layout and content-addressed paths
- `storage/checksums.ts`: incremental SHA-256 file hashing
- `storage/content_store.ts`: atomic, deduplicated media file storage
- `storage/media_types.ts`: extension → MIME/type inference

See `docs/storage.md` and `docs/assets.md` for the storage and asset contracts.

### Authorization

- `admin` role users bypass all checks.
- Creators hold implicit `admin` over their projects and assets.
- Otherwise the highest permission rank wins: `project_permissions` (inherited by project-scoped
  assets) and `asset_permissions` rows (`read` < `write` < `admin`).

### Authentication Flow

```
Bootstrap (once):
  1. Client sends email + password + display_name
  2. Server hashes password with PBKDF2 (salt + 100k iterations)
  3. First user is created with role 'admin'
  4. Session row + JWT generated; token returned to client

Login:
  1. Client sends email + password
  2. Server verifies password with PBKDF2
  3. Session row + fresh JWT issued

Logout:
  1. Session row is revoked (jti)

Authenticated Request:
  1. Client sends Bearer token in Authorization header
  2. Auth middleware verifies JWT signature and expiry
  3. Session looked up by jti; revoked/expired sessions are rejected
  4. Request proceeds with user context
```

### Data Models

**User:**

- `id` (INTEGER, PK, AUTOINCREMENT)
- `email` (TEXT, UNIQUE)
- `password_hash` (TEXT) - format: `base64url(salt):base64url(hash)`
- `display_name` (TEXT)
- `role` (TEXT, default: 'user')
- `created_at`, `updated_at` (TEXT, datetime)

**Legacy demo tables (unused):** The `movies`, `scenes` (movie scenes), and v0 `prompts` tables were
created by migration `0001_init.sql`. After frontend phase 7 their routes and CRUD functions are
gone; the tables remain for backward compatibility of existing databases. v1 prompt data lives in
`prompt_versions` / creative objects (storyboard panels, scenes, shots), and v1 creative
`scenes`/`shots` are defined in `0007_storyboard.sql`.

### Security

- **Password hashing**: PBKDF2 with SHA-256, 100,000 iterations, 16-byte random salt
- **JWT**: HMAC-SHA256, 7-day expiry, stored in localStorage
- **SQL**: All queries use parameterized statements (no string concatenation)
- **CORS**: Restricted to `http://localhost:8124` in development
- **Data isolation**: All v1 queries are permission-gated (see Authorization above), enforced in the
  repository layer (`projects.ts`, `assets.ts`, creative repos)

### Dependencies

#### Backend

- `jsr:@oak/oak` - Web framework
- `jsr:@oak/router` - Decorator-based routing
- `jsr:@oak/cors` - CORS middleware
- `jsr:@db/sqlite` - SQLite driver
- `jsr:@std/testing/bdd` - Test framework
- `jsr:@oslo-jwt/jwt` - JWT utilities

#### Frontend

- Lit (loaded from ESM CDN via import map in the browser) - Web components library
- No other dependencies

## Future Considerations

### Database Migration

SQLite is the initial database. The data access layer is abstracted via `schema.ts`, making it
feasible to swap in PostgreSQL or another database later.

### Authentication Options

Current JWT implementation provides full control but may be replaced with:

- **Auth.js / NextAuth-style** for Deno (if available)
- **Supabase Auth** for managed auth
- **Custom OAuth** providers (Google, GitHub)

### AI Integration

The `prompts` table is structured to support:

- Conversation history per movie/scene
- Role-based messages (system/user/assistant)
- Associating AI outputs with specific scenes

### Testing Strategy

- **Backend**: Unit tests for schema layer, integration tests for routes
- **Frontend**: Unit tests for API client, component tests with mock DOM
- **E2E**: HTTP-level MVP acceptance flow (`backend/tests/mvp_acceptance.test.ts`) drives the full
  studio journey over live routes (auth → media → jobs → timeline → render/export → backup/restore);
  a browser-level E2E (Cypress or Playwright) is not implemented yet

### Deployment

**Docker (primary packaging, FND-013):** the `Dockerfile` at the repo root builds a single
`cinemaitor` image (Deno 2.9.5 + ffmpeg, non-root user, JSR dependencies cached at build time,
sqlite native lib pre-warmed — no runtime network needed). `docker/entrypoint.ts` is the supervisor:
it bootstraps a `JWT_SECRET` into the data dir when none is provided (stable across container
recreation), spawns `backend/src/server.ts` + `frontend/src/server.js`, forwards SIGTERM/SIGINT, and
exits non-zero if a child dies. State lives in `/data` (mounted as a named volume by
`docker-compose.yml`): SQLite DB, media, proxies, and the generated secret. Public surface: **8124**
(UI + `/api` proxy) and **8123** (direct backend — the browser's job-feed WebSocket connects here).
`CORS_ORIGINS` (comma-separated env) replaces the hardcoded dev origin (see `server.ts`); default
remains `http://localhost:8124`. `docker compose up -d --build` is the one-command start; CI
verifies the image builds (`docker-build` job).

- Backend: Deploy to Deno Deploy, Fly.io, or self-hosted Deno runtime
- Frontend: Same host as backend (proxied) or separate static hosting
- Database: SQLite file on persistent storage; migrate to managed PostgreSQL for production scale
