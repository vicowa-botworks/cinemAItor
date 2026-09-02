# Implementation Plan: Local AI Movie Studio

This is an execution plan for building the product described in `GOAL.md`.

It is intentionally organized by **dependencies, work packages, milestones, and acceptance
criteria** rather than by calendar time. No time estimates are included.

The plan assumes:

- The product is **local-first / user-controlled**.
- v1 does **not** include third-party public cloud AI generation APIs.
- Single-user product, but with **authorization and ownership design from the start**.
- CPU-only operation is acceptable.
- Maximum clip length is model-dependent.
- `@names` are globally unique with aliases.
- MVP uses **linear versions + snapshots**, not branching.
- Skills, when implemented, start as **JSON/YAML workflows**, not arbitrary code.
- 3D starts with import, preview, export views, and use as reference.
- Music starts with prompt/mood-based generation, not “watch the movie and generate score”.

---

# 1. Build Strategy

The implementation should be built as a **vertical product**, not a collection of isolated features.

The first stable version should prove this end-to-end loop:

```text
Project
→ Assets
→ @References
→ Model Manager
→ Generation Job
→ Storyboard / Scene
→ Review
→ Timeline
→ Audio
→ Export
→ Version History
```

The build order should be:

1. Stable local app shell and storage
2. Projects and assets
3. Asset versioning and reference engine
4. Local model management
5. Generation pipeline
6. Creative structure: storyboard, scenes, shots
7. Review workflow
8. Timeline and audio
9. Render/export
10. Hardening, diagnostics, backup, and professional workflow expansion

The most important implementation rule:

> Every generated or uploaded media file must become a versioned asset with provenance.

---

# 2. MVP Build Boundary

## 2.1 MVP In Scope

The MVP should support the product’s core movie pipeline:

- Web app
- Local-first / self-hosted
- Single user
- Project creation
- Global and project asset libraries
- Asset upload
- Asset versioning
- Unique `@asset` names
- Basic prompt editor
- `@asset` reference resolution
- Local model installation and management
- Text-to-image generation
- Image-to-video generation
- Basic generation queue
- Basic storyboard
- Basic scenes with prompts
- Basic review/approval
- Basic timeline
- Basic audio import and basic audio track
- MP4 export
- Project snapshots
- Basic error recovery
- Authorization model for projects and assets, even if sharing is not implemented

## 2.2 MVP Out of Scope

These should be deferred:

- Full DAW
- Full non-linear editor feature parity
- Advanced 3D animation
- Real-time collaboration
- Public cloud generation APIs
- Marketplace
- Advanced skill scripting
- HDR
- Lip-sync
- Script-to-movie
- Advanced continuity analysis
- Team review
- Advanced render farm

---

# 3. High-Level Architecture

The system should be split into clearly separated layers.

```text
Browser
  - Vanilla JS web components
  - Shadow DOM
  - No build step
  - Talks to backend over HTTP + WebSocket

Deno Backend
  - REST API
  - WebSocket API
  - Static frontend server
  - Auth / authorization
  - Project service
  - Asset service
  - Versioning service
  - Reference engine
  - Job queue service
  - Model manager service
  - Timeline service
  - Render/export service
  - Diagnostics service

SQLite
  - Metadata database
  - Job queue state
  - Version history
  - Permissions
  - Audit logs

Filesystem / Content Store
  - Masters
  - Proxies
  - Previews
  - Models
  - Logs
  - Snapshots
  - Render outputs

Media Processor
  - FFmpeg
  - Thumbnail generation
  - Proxy generation
  - Waveform generation
  - Export rendering
  - Audio/video validation

Inference Adapters
  - Local image model runtime
  - Local image-to-video model runtime
  - Optional local audio/music/voice runtime
  - Optional local STT/LLM runtime
  - All behind a common adapter interface
```

Important architectural decisions:

- The browser should never directly own complex generation logic.
- The backend should be the source of truth for metadata.
- Media files should be content-addressed where practical.
- Generation should be job-based.
- Model runtimes should be adapters, not hard-coded into the core.
- The UI should update from backend state via API + WebSocket.

---

# 4. Recommended Technology Choices

| Area             | Choice                                    | Notes                                       |
| ---------------- | ----------------------------------------- | ------------------------------------------- |
| Backend          | Deno                                      | Runs directly, no build step                |
| API              | HTTP + WebSocket                          | REST for CRUD, WS for jobs/live updates     |
| Database         | SQLite                                    | Metadata, queue, versions, audit            |
| Frontend         | Vanilla JavaScript                        | Web components + Shadow DOM                 |
| Frontend build   | None                                      | ES modules only                             |
| Media processing | FFmpeg                                    | Required                                    |
| Job processing   | In-process or separate Deno runner        | Queue-backed                                |
| Model runtime    | Adapter layer                             | ComfyUI, local CLI, local HTTP server, etc. |
| 3D preview       | Three.js or equivalent vendored ES module | No build step                               |
| Packaging        | Docker / tarball / install script         | Linux primary                               |
| Testing          | Deno test, Playwright for UI              | Optional real-model tests behind flag       |

## 4.1 Deno Notes

Use Deno in a self-hosted process model.

Recommended runtime capabilities:

- `serve`
- `sql` or SQLite driver
- filesystem access
- process spawning
- WebSocket
- fetch for local/user-controlled model endpoints
- logging
- configuration via env + config file

The product should run as a local service:

```bash
deno run -A server/main.ts
```

or through a packaged launcher / Docker container.

---

# 5. Repository Layout

Suggested repository structure:

```text
/
  deno.json
  README.md
  docs/
    architecture.md
    api.md
    data-model.md
    deployment.md
    security.md
    operations.md

  server/
    main.ts
    config.ts
    logger.ts
    errors.ts

    http/
      router.ts
      middleware.ts
      websocket.ts
      static.ts

    api/
      auth.ts
      projects.ts
      assets.ts
      versions.ts
      references.ts
      models.ts
      jobs.ts
      storyboards.ts
      scenes.ts
      shots.ts
      timelines.ts
      audio.ts
      renders.ts
      diagnostics.ts

    db/
      connection.ts
      migrations/
        0001_init.sql
        0002_assets.sql
        0003_generation_jobs.sql
        ...
      repositories/
        projects.ts
        assets.ts
        asset_versions.ts
        references.ts
        generation_jobs.ts
        models.ts
        storyboards.ts
        scenes.ts
        timelines.ts
        renders.ts

    services/
      project_service.ts
      asset_service.ts
      version_service.ts
      reference_service.ts
      generation_service.ts
      model_service.ts
      media_service.ts
      timeline_service.ts
      render_service.ts
      audit_service.ts
      diagnostics_service.ts

    storage/
      content_store.ts
      paths.ts
      checksums.ts
      integrity.ts
      backup.ts

    auth/
      users.ts
      sessions.ts
      permissions.ts

    jobs/
      queue.ts
      runner.ts
      scheduler.ts
      events.ts

    media/
      ffmpeg.ts
      thumbnails.ts
      proxies.ts
      waveforms.ts
      validation.ts

    models/
      registry.ts
      catalog.ts
      installer.ts
      health.ts
      adapters/
        base.ts
        mock.ts
        comfyui_image.ts
        comfyui_image_to_video.ts
        local_api.ts
        cli.ts

  runners/
    job_runner.ts
    media_runner.ts

  web/
    index.html
    login.html

    styles/
      global.css
      components.css

    lib/
      api.ts
      websocket.ts
      state.ts
      format.ts
      utils.ts

    components/
      app-shell.js
      project-card.js
      asset-grid.js
      asset-details.js
      version-list.js
      prompt-editor.js
      reference-picker.js
      model-row.js
      job-row.js
      storyboard-panel.js
      scene-inspector.js
      review-board.js
      timeline-editor.js
      track-row.js
      clip-item.js
      audio-waveform.js
      export-dialog.js
      diagnostics-panel.js

    pages/
      dashboard.js
      asset-library.js
      storyboard.js
      scene.js
      timeline.js
      models.js
      jobs.js
      review.js
      settings.js

  adapters/
    ffmpeg.ts
    hardware.ts

  tests/
    unit/
    integration/
    e2e/
    fixtures/
      media/
      models/
      projects/

  packaging/
    docker/
    systemd/
    install.sh
```

This layout keeps the product modular and testable while remaining simple.

---

# 6. Core Design Rules

## 6.1 Metadata vs Files

SQLite stores metadata.

Files are stored on disk.

Rules:

- Every media file has a checksum.
- Every media file belongs to an asset version.
- Asset versions are immutable.
- The “active” version is a pointer, not a copy.
- Restoration changes pointers and audit logs; it does not delete old versions.
- Deleted assets should be soft-deleted or archived first.

## 6.2 Content-Addressed Storage

Recommended storage pattern:

```text
app_data/
  media/
    <sha256:0:1>/
      <sha256:1:3>/
        <file>.<ext>
```

Example:

```text
app_data/media/ab/12cd34.../clip.mp4
```

Metadata stores:

- `content_hash`
- `logical_path`
- `file_size`
- `mime_type`
- `format`
- `checksum_algorithm`

Benefits:

- Duplicate detection
- Integrity checks
- Safe caching
- Backup/restore
- Easier storage reporting

## 6.3 Masters, Proxies, and Previews

Every media type should support:

- `master`
- `proxy`
- `preview`

Rules:

- Timeline playback should prefer proxy.
- Final export should prefer master.
- Missing master should be detected before final export.
- Proxies should be regenerable.
- Previews should be lightweight and safe for quick UI display.

## 6.4 Immutable Generation Results

Every generated asset version should store:

- prompt
- prompt version
- negative prompt
- model
- model version
- seed
- settings
- input asset versions
- reference roles
- job ID
- timestamp
- status
- output checksum

This makes generations traceable and reproducible where the model allows reproducibility.

## 6.5 Job-Based Generation

All generation should go through a job queue.

No direct synchronous generation from UI.

Required job states:

- `queued`
- `loading_model`
- `running`
- `processing`
- `succeeded`
- `failed`
- `cancelled`

Required job features:

- progress updates
- cancellation
- retry
- logs
- error messages
- resource constraints

---

# 7. Data Model Implementation

This is the implementation-level interpretation of the conceptual data model in `GOAL.md`.

## 7.1 Core Tables

### `users`

```sql
users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL,             -- admin | editor | viewer
  is_active INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

### `project_permissions`

```sql
project_permissions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL,       -- read | write | admin
  created_at TEXT NOT NULL
)
```

### `asset_permissions`

```sql
asset_permissions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permission TEXT NOT NULL,       -- read | write | admin
  created_at TEXT NOT NULL
)
```

### `projects`

```sql
projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  media_directory TEXT,
  output_directory TEXT,
  aspect_ratio TEXT,
  frame_rate REAL,
  resolution_width INTEGER,
  resolution_height INTEGER,
  color_space TEXT,
  audio_sample_rate INTEGER,
  default_export_preset_id TEXT,
  default_model_preferences_json TEXT,
  template_id TEXT,
  status TEXT NOT NULL,           -- active | archived | deleted
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_user_id TEXT
)
```

### `assets`

```sql
assets (
  id TEXT PRIMARY KEY,
  library_scope TEXT NOT NULL,    -- global | project
  project_id TEXT,
  unique_slug TEXT UNIQUE NOT NULL,   -- person
  display_name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,           -- draft | approved | rejected | archived
  source_type TEXT NOT NULL,      -- uploaded | generated | imported | derived
  license TEXT,
  rights_status TEXT,
  attribution TEXT,
  parent_asset_id TEXT,
  active_version_id TEXT,
  preview_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by_user_id TEXT
)
```

### `asset_aliases`

```sql
asset_aliases (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  alias_slug TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
)
```

### `asset_tags`

```sql
asset_tags (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  tag TEXT NOT NULL
)
```

### `asset_versions`

```sql
asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL,           -- draft | approved | rejected | archived
  content_hash TEXT,
  file_path TEXT,
  proxy_path TEXT,
  preview_path TEXT,
  format TEXT,
  file_size INTEGER,
  technical_metadata_json TEXT,
  generation_job_id TEXT,
  prompt_version_id TEXT,
  model_id TEXT,
  model_version TEXT,
  seed TEXT,
  settings_json TEXT,
  input_asset_versions_json TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT
)
```

### `references`

```sql
references (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,      -- prompt | scene | shot | storyboard_panel
  source_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  asset_version_id TEXT,
  role TEXT,
  raw_text TEXT NOT NULL,
  start_index INTEGER,
  end_index INTEGER,
  status TEXT NOT NULL,           -- resolved | missing | ambiguous
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

### `prompts`

```sql
prompts (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,       -- scene | shot | storyboard_panel | generic
  scope_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  parent_prompt_id TEXT,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT
)
```

### `generation_jobs`

```sql
generation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  asset_id TEXT,
  scene_id TEXT,
  shot_id TEXT,
  storyboard_panel_id TEXT,
  job_type TEXT NOT NULL,         -- t2i | i2i | i2v | t2v | audio | music | voice ...
  model_id TEXT NOT NULL,
  model_version TEXT,
  prompt_version_id TEXT,
  prompt_text TEXT,
  negative_prompt TEXT,
  seed TEXT,
  settings_json TEXT NOT NULL,
  input_asset_versions_json TEXT,
  reference_roles_json TEXT,
  status TEXT NOT NULL,
  progress REAL,
  error_text TEXT,
  output_asset_version_id TEXT,
  candidate_count INTEGER,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
)
```

### `job_events`

```sql
job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  data_json TEXT,
  created_at TEXT NOT NULL
)
```

### `models`

```sql
models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  source TEXT,
  repository_url TEXT,
  file_hash TEXT,
  license TEXT,
  backend TEXT,
  task_types_json TEXT,
  input_types_json TEXT,
  output_types_json TEXT,
  supported_resolutions_json TEXT,
  supported_frame_rates_json TEXT,
  supported_duration_json TEXT,
  vram_requirement_mb INTEGER,
  ram_requirement_mb INTEGER,
  dependencies_json TEXT,
  default_settings_json TEXT,
  known_limitations_json TEXT,
  enabled INTEGER NOT NULL,
  installed_at TEXT,
  last_used_at TEXT,
  health_status TEXT,
  health_checked_at TEXT
)
```

### `storyboards`

```sql
storyboards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

### `storyboard_panels`

```sql
storyboard_panels (
  id TEXT PRIMARY KEY,
  storyboard_id TEXT NOT NULL,
  panel_order INTEGER NOT NULL,
  shot_number TEXT,
  description TEXT,
  prompt_version_id TEXT,
  duration REAL,
  camera_settings_json TEXT,
  mood TEXT,
  lighting TEXT,
  time_of_day TEXT,
  dialogue TEXT,
  voiceover TEXT,
  music_cue TEXT,
  sfx TEXT,
  transition TEXT,
  notes TEXT,
  status TEXT NOT NULL,
  preview_asset_version_id TEXT,
  generated_clip_asset_version_id TEXT,
  linked_scene_id TEXT,
  linked_shot_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

### `scenes`

```sql
scenes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  storyboard_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  prompt_version_id TEXT,
  status TEXT NOT NULL,
  target_duration REAL,
  aspect_ratio_override TEXT,
  frame_rate_override REAL,
  notes TEXT,
  audio_plan_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

### `shots`

```sql
shots (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL,
  shot_order INTEGER NOT NULL,
  name TEXT,
  prompt_version_id TEXT,
  duration REAL,
  camera_settings_json TEXT,
  status TEXT NOT NULL,
  generated_asset_version_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

### `timelines`

```sql
timelines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  duration REAL,
  settings_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

### `tracks`

```sql
tracks (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  track_type TEXT NOT NULL,       -- video | dialogue | voiceover | music | sfx | ambience | overlay | text | subtitle | effect | transition
  name TEXT NOT NULL,
  track_order INTEGER NOT NULL,
  locked INTEGER NOT NULL,
  muted INTEGER NOT NULL
)
```

### `timeline_items`

```sql
timeline_items (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  asset_version_id TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  source_offset REAL NOT NULL,
  speed REAL NOT NULL,
  transform_json TEXT,
  fade_in REAL,
  fade_out REAL,
  transition TEXT,
  effect_chain_json TEXT,
  color_grade_json TEXT,
  audio_settings_json TEXT,
  notes TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

### `timeline_markers`

```sql
timeline_markers (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  time REAL NOT NULL,
  label TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
)
```

### `timeline_snapshots`

```sql
timeline_snapshots (
  id TEXT PRIMARY KEY,
  timeline_id TEXT NOT NULL,
  name TEXT NOT NULL,
  snapshot_data_json TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT
)
```

### `project_snapshots`

```sql
project_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  snapshot_data_json TEXT NOT NULL,
  checksum TEXT,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT
)
```

### `render_jobs`

```sql
render_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  timeline_id TEXT NOT NULL,
  preset_id TEXT,
  status TEXT NOT NULL,
  progress REAL,
  error_text TEXT,
  output_path TEXT,
  validation_report_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
)
```

### `exports`

```sql
exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  render_job_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  format TEXT NOT NULL,
  settings_json TEXT,
  created_at TEXT NOT NULL
)
```

### `audit_logs`

```sql
audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL
)
```

### `diagnostics`

```sql
diagnostics (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL
)
```

## 7.2 Indexes

Create indexes for:

- `projects.name`
- `projects.status`
- `assets.library_scope`
- `assets.project_id`
- `assets.asset_type`
- `assets.status`
- `asset_versions.asset_id`
- `references.source_type`
- `references.source_id`
- `references.asset_id`
- `generation_jobs.status`
- `generation_jobs.created_at`
- `models.enabled`
- `storyboard_panels.storyboard_id`
- `storyboard_panels.panel_order`
- `scenes.project_id`
- `shots.scene_id`
- `tracks.timeline_id`
- `timeline_items.timeline_id`
- `timeline_items.track_id`
- `render_jobs.status`

## 7.3 Search

Use SQLite FTS5 for:

- asset names
- asset descriptions
- tags
- prompt content
- scene names/descriptions
- notes

Suggested virtual table:

```sql
CREATE VIRTUAL TABLE assets_fts USING fts5(
  display_name,
  description,
  tags,
  content='assets',
  content_rowid='rowid'
);
```

---

# 8. API Design

Use a versioned API:

```text
/api/v1
```

Use WebSocket for:

- job progress
- project update events
- model health events
- storage diagnostics events

## 8.1 Authentication

```text
POST /api/v1/auth/bootstrap
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
GET  /api/v1/auth/setup-status
PUT  /api/v1/auth/password
POST /api/v1/auth/password-reset/request
POST /api/v1/auth/password-reset/confirm
POST /api/v1/auth/email-confirmation/confirm
POST /api/v1/auth/email-confirmation/resend
GET    /api/v1/invitations
POST   /api/v1/invitations
DELETE /api/v1/invitations/:id
POST   /api/v1/invitations/accept
GET    /api/v1/users/settings/email
PATCH  /api/v1/users/settings/email
POST   /api/v1/users/settings/email/test
```

Email system (SMTP configuration, password reset, email confirmation, invitations): see
`docs/email.md`.

## 8.2 Projects

```text
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:id
PATCH  /api/v1/projects/:id
DELETE /api/v1/projects/:id
POST   /api/v1/projects/:id/snapshots
GET    /api/v1/projects/:id/snapshots
POST   /api/v1/projects/:id/snapshots/:snapshotId/restore
```

## 8.3 Assets

```text
GET    /api/v1/assets
POST   /api/v1/assets
GET    /api/v1/assets/:id
PATCH  /api/v1/assets/:id
DELETE /api/v1/assets/:id
POST   /api/v1/assets/:id/upload
GET    /api/v1/assets/:id/versions
POST   /api/v1/assets/:id/versions
GET    /api/v1/assets/:id/versions/:versionId
POST   /api/v1/assets/:id/versions/:versionId/restore
POST   /api/v1/assets/:id/aliases
GET    /api/v1/assets/:id/dependencies
GET    /api/v1/assets/:id/preview
```

## 8.4 References

```text
POST   /api/v1/references/parse
GET    /api/v1/references/audit
POST   /api/v1/references/:id/replace
```

## 8.5 Models

```text
GET    /api/v1/models
POST   /api/v1/models
DELETE /api/v1/models/:id
PATCH  /api/v1/models/:id
POST   /api/v1/models/:id/health-check
POST   /api/v1/models/:id/install
POST   /api/v1/models/:id/verify
```

## 8.6 Generation Jobs

```text
GET    /api/v1/jobs
POST   /api/v1/jobs
GET    /api/v1/jobs/:id
POST   /api/v1/jobs/:id/cancel
POST   /api/v1/jobs/:id/retry
GET    /api/v1/jobs/:id/events
```

WebSocket:

```text
WS /ws/v1/jobs
```

## 8.7 Storyboards

```text
GET    /api/v1/storyboards
POST   /api/v1/storyboards
GET    /api/v1/storyboards/:id
PATCH  /api/v1/storyboards/:id
DELETE /api/v1/storyboards/:id
POST   /api/v1/storyboards/:id/panels
PATCH  /api/v1/storyboards/:id/panels/:panelId
DELETE /api/v1/storyboards/:id/panels/:panelId
POST   /api/v1/storyboards/:id/panels/:panelId/generate-preview
```

## 8.8 Scenes and Shots

```text
GET    /api/v1/scenes
POST   /api/v1/scenes
GET    /api/v1/scenes/:id
PATCH  /api/v1/scenes/:id
DELETE /api/v1/scenes/:id
POST   /api/v1/scenes/:id/generate
GET    /api/v1/scenes/:id/shots
POST   /api/v1/scenes/:id/shots
PATCH  /api/v1/scenes/:id/shots/:shotId
DELETE /api/v1/scenes/:id/shots/:shotId
POST   /api/v1/scenes/:id/shots/:shotId/generate
```

## 8.9 Review

```text
GET    /api/v1/review/jobs/:jobId/candidates
POST   /api/v1/review/candidates/:versionId/approve
POST   /api/v1/review/candidates/:versionId/reject
POST   /api/v1/review/candidates/:versionId/shortlist
```

## 8.10 Timelines

```text
GET    /api/v1/timelines
POST   /api/v1/timelines
GET    /api/v1/timelines/:id
PATCH  /api/v1/timelines/:id
DELETE /api/v1/timelines/:id
POST   /api/v1/timelines/:id/tracks
PATCH  /api/v1/timelines/:id/tracks/:trackId
DELETE /api/v1/timelines/:id/tracks/:trackId
POST   /api/v1/timelines/:id/items
PATCH  /api/v1/timelines/:id/items/:itemId
DELETE /api/v1/timelines/:id/items/:itemId
POST   /api/v1/timelines/:id/snapshots
GET    /api/v1/timelines/:id/snapshots
POST   /api/v1/timelines/:id/snapshots/:snapshotId/restore
```

## 8.11 Audio

```text
POST   /api/v1/audio/upload
GET    /api/v1/audio/assets
POST   /api/v1/audio/assets/:id/versions
```

Audio-specific metadata can live in `asset_versions.technical_metadata_json`.

## 8.12 Render / Export

```text
GET    /api/v1/render-presets
POST   /api/v1/render-presets
POST   /api/v1/renders
GET    /api/v1/renders/:id
GET    /api/v1/renders/:id/log
POST   /api/v1/renders/:id/cancel
GET    /api/v1/exports
```

## 8.13 Diagnostics

```text
GET    /api/v1/diagnostics/hardware
GET    /api/v1/diagnostics/models
GET    /api/v1/diagnostics/storage
GET    /api/v1/diagnostics/logs
POST   /api/v1/diagnostics/export
```

## 8.14 LLM Assistant & Model Copilot (Workstream 16)

```text
GET    /api/v1/llm/settings               (admin) LLM endpoint settings; api key as boolean flag only
PUT    /api/v1/llm/settings               (admin) partial update: base_url/model/api_key/temperature/max_tokens/timeout/enabled
POST   /api/v1/llm/test                   (admin) connection test, minimal completion, reports latency/error
POST   /api/v1/llm/chat                   (any auth) one-shot chat {messages, model?, temperature?, max_tokens?}
POST   /api/v1/llm/assist                 (any auth) creative assist: purpose write_script|design_scene|enhance_prompt
                                           + context, model_id?, skill_id? (see section 37)
POST   /api/v1/llm/agent                  (any auth) Model Copilot chat: bounded tool-calling loop;
                                           mutating tools return approval proposals, not execution
POST   /api/v1/llm/agent/proposals/:id/approve   (admin) execute a pending mutating tool proposal
POST   /api/v1/llm/agent/proposals/:id/reject    (admin) reject a pending mutating tool proposal
```

HuggingFace catalog (mounted under the models routes):

```text
GET    /api/v1/models/huggingface/search?q=&filter=&limit=   (any auth) search public HF repos
GET    /api/v1/models/huggingface/:repoId                    (any auth) repo metadata + file listing
POST   /api/v1/models/from-huggingface                       (admin) register a model row from a repo
                                           (source: url; install remains the consent-gated install flow)
```

## 8.15 MCP Tool Servers (Workstream 17)

```text
GET    /api/v1/mcp/servers                (admin) list registered MCP servers + live status
POST   /api/v1/mcp/servers                (admin) register an MCP server (stdio | http transport)
PATCH  /api/v1/mcp/servers/:id            (admin) update (incl. enabled / auto_approve);
                                            config changes close the live connection
DELETE /api/v1/mcp/servers/:id            (admin) remove + close the connection
POST   /api/v1/mcp/servers/:id/test       (admin) connection test -> discovered tools
GET    /api/v1/mcp/servers/:id/tools      (admin) current tool catalog
```

The Model Copilot exposes MCP server tools alongside its built-ins (qualified names
`mcp__<server>__<tool>`); non-read-only MCP tools go through the same approval-proposal flow as
built-in mutating tools (see section 38).

---

# 9. Core Workstreams

The implementation should be organized into these workstreams.

## Workstream 0: Foundations

Goal:

- Stable app skeleton
- Configuration
- Logging
- Error handling
- Database migrations
- Static frontend
- Basic testing

## Workstream 1: Storage and Media Base

Goal:

- Filesystem layout
- Checksums
- Content-addressed storage
- Upload pipeline
- Thumbnail/proxy generation
- Storage reporting
- Integrity checks

## Workstream 2: Auth and Authorization

Goal:

- Local user account
- Session login
- Role-based permissions
- Project ownership
- Asset ownership
- Audit logging
- No sharing yet, but permission model exists

## Workstream 3: Projects

Goal:

- Create/open/save/close/rename/delete
- Project settings
- Snapshots
- Missing media detection
- Safe deletion

## Workstream 4: Asset Library

Goal:

- Upload
- Metadata
- Versioning
- Search
- Preview
- Global/project scope
- Dependencies
- Broken reference warnings

## Workstream 5: Reference Engine

Goal:

- Parse `@asset`
- Resolve references
- Roles
- Audit
- Broken reference repair
- Versioned references

## Workstream 6: Model Manager

Goal:

- Model registry
- Install/remove
- Enable/disable
- Health checks
- Task mapping
- Hardware detection
- License display
- Model presets

## Workstream 7: Generation Pipeline

Goal:

- Job queue
- Job events
- Adapter interface
- Text-to-image
- Image-to-video
- Candidate output
- Provenance
- Cancel/retry

## Workstream 8: Storyboard and Scenes

Goal:

- Storyboard panels
- Scene prompts
- Shot lists
- Reference resolution in creative objects
- Generate from panel/scene/shot
- Versioning of prompts

## Workstream 9: Review

Goal:

- Candidate comparison
- Approve/reject
- Promote candidate to active asset version
- Shortlist
- Notes

## Workstream 10: Timeline Editor

Goal:

- Tracks
- Items
- Reorder/trim/duplicate/delete
- Playback
- Undo/redo
- Snapshots
- Basic audio track

## Workstream 11: Audio

Goal:

- Import
- Versioning
- Trim
- Gain
- Waveform
- Basic mixer later
- Music import in MVP
- Music/voice/SFX generation later

## Workstream 12: Render / Export

Goal:

- Presets
- Render queue
- MP4 export
- Audio export
- Validation
- Render logs
- Export provenance

## Workstream 13: Diagnostics and Operations

Goal:

- Hardware info
- Model health
- Storage report
- Error export
- Logs
- Backup/restore

## Workstream 14: Professional Workflow Expansion

Post-MVP:

- Music generation
- Voiceover
- SFX
- Transitions
- Color grading
- Subtitles
- Text overlays
- Proxy workflow polish
- Batch generation
- Skills
- Templates
- Advanced storage management

## Workstream 15: Advanced Studio Features

Later:

- 3D import/preview/reference
- Script parser
- Continuity analysis
- AI assistant (executed as Workstream 16)
- Advanced render
- Optional cloud gateway

## Workstream 16: LLM Assistant & Model Copilot

Goal: make the app approachable for new users by embedding a configurable local LLM as a creative
and operational helper, and giving the LLM a bounded tool harness so it can look up model details on
HuggingFace, register/install generation models, and help connect runtimes (ComfyUI, llama.cpp,
Ollama).

Scope:

- LLM endpoint configuration on the Models page (separate section): an OpenAI-compatible chat
  endpoint (llama.cpp server, Ollama `/v1`, LM Studio, vLLM, or any compatible local runner), with
  model name, optional API key, temperature, max tokens, timeout, and a connection test
- One-shot chat endpoint (synchronous, bounded by timeout — not a queued job; the user waits)
- Creative assist purposes: `write_script` (idea → Fountain-lite screenplay, importable),
  `design_scene` (scene design: description, shots, camera, mood, lighting, dialogue),
  `enhance_prompt` (rewrite a generation prompt for a target model/task, preserving `@refs`)
- AI-assist UI in the creative surfaces (prompt editor, scene list import, scene detail)
- Skills as prompt-creation knowledge: a skill definition may carry an `assistant` block (guidance +
  example prompts) that the assistant injects when writing prompts — e.g. a "text-to-video
  prompting" skill for a specific T2V model family
- Model-aware assist context: the target model's metadata (task types, limitations, defaults) plus
  selected skill guidance shape the system prompt
- HuggingFace integration (server-side proxy of the public HF API, explicit user action): search,
  repository/file listing, and auto-register a model row from a repo (weights then install through
  the normal consent-gated install flow)
- Tool harness ("Model Copilot"): the LLM calls named tools through OpenAI-style function calling in
  a bounded loop; read-only tools (list models, HF search/info, ComfyUI status) run automatically;
  mutating tools (register/install/remove model) are recorded as proposals the user explicitly
  approves or rejects in the UI (admin-gated)
- ComfyUI helper: the copilot probes an endpoint (`/system_stats`), inspects available models, and
  proposes registering a comfyui-backend model with a workflow

Non-goals (v1):

- No streaming responses; no persistent multi-session memory (history is per-request)
- No arbitrary code execution; no mutating tool without explicit user approval
- Approvals are in-memory (TTL-bounded), not durable across restarts
- No public cloud LLM services — endpoints are local/user-controlled

Detailed design: section 37.

---

## Workstream 17: MCP Tool Servers (Copilot Extension)

Goal: extend the Model Copilot into an MCP (Model Context Protocol) client so external tool servers
(file/repo helpers, ComfyUI add-ons, anything from the MCP ecosystem) can join the copilot's tool
loop without app code changes — under the same approval semantics as the built-in tools.

Scope:

- Admin-managed registry of MCP servers (`mcp_servers` table): `stdio` (spawned command + args +
  env, no shell) and `http` (MCP Streamable HTTP endpoint + optional headers) transports
- Client service on the official MCP TypeScript SDK (`npm:@modelcontextprotocol/sdk`): lazy connect,
  per-server reconnect, cached tool catalog, serialized calls, per-call timeouts, process cleanup on
  shutdown (no orphaned stdio children)
- Agent integration: MCP tools join the copilot tool set as `mcp__<server>__<tool>`; tools the
  server declares `readOnlyHint` (or any tool on an `auto_approve` server) auto-execute, all others
  become admin approval proposals; non-admins see only read-only MCP tools
- UI: "MCP Servers" panel on the Models page (admin CRUD, connection test, per-server tool list,
  status chips) + `MCP: <server>` badges on copilot steps/proposals

Non-goals (v1):

- MCP resources and prompts (tools only); no server-initiated sampling from the app's LLM
- The deprecated legacy SSE transport (Streamable HTTP only)
- Per-tool allowlisting (gating is read-only-hint / per-server `auto_approve` level)
- Durable proposals or persistent MCP state (proposals stay in-memory, TTL 1 h)

Detailed design: section 38.

---

# 10. Milestone Plan

Each milestone has a purpose, scope, and exit criteria.

No estimates are included.

---

## Milestone 0: Scaffold

### Purpose

Create the minimum stable foundation for all later work.

### Scope

- Deno server skeleton
- HTTP API skeleton
- Static frontend skeleton
- SQLite connection
- Migration system
- Configuration
- Logging
- Error handling
- Health endpoint
- Basic web components shell
- Test harness
- CI checks

### Exit Criteria

- App starts and serves UI
- `/api/v1/health` returns OK
- SQLite database initializes migrations
- Frontend loads without build step
- Unit tests run
- Lint/fmt pass
- Docker or local install script works

---

## Milestone 1: Storage, Auth, Projects, and Assets

### Purpose

Make the app able to own real user content safely.

### Scope

- Content-addressed storage
- Upload pipeline
- Checksums
- Local user bootstrap/login
- Session auth
- Project permissions
- Asset permissions
- Project CRUD
- Project settings
- Asset CRUD
- Asset metadata
- Asset upload
- Asset versioning
- Asset preview generation
- Basic search
- Audit log

### Exit Criteria

- A user can create an account and log in
- A user can create a project
- A user can upload an image/video/audio asset
- Uploaded asset is stored with checksum
- Asset can be given a `@name`
- Asset has versions
- User can see asset in library
- Project can be renamed/archived
- Deleting a referenced asset produces a warning
- Audit log records sensitive actions

---

## Milestone 2: Reference Engine and Prompt Versioning

### Purpose

Make `@asset` references a first-class system.

### Scope

- Reference parser
- Reference resolver
- Role assignment
- Reference audit
- Broken reference detection
- Prompt versioning
- Prompt history
- Reference replacement
- Basic prompt editor component

### Exit Criteria

- User can type `@person` and system resolves it
- System supports `@room` and `@table`
- Missing references produce warnings
- Prompt changes create prompt versions
- Older prompt versions can be inspected
- References can be replaced
- Audit lists all references in a project/scene

---

## Milestone 3: Model Manager and Generation Pipeline

### Purpose

Make local model-based generation reliable and traceable.

### Scope

- Model registry
- Model metadata
- Model install/remove
- Model enable/disable
- Model health check
- Task mapping
- Hardware detection
- Job queue
- Job API
- WebSocket job updates
- Adapter interface
- Mock adapter
- Text-to-image adapter
- Image-to-video adapter
- Candidate output
- Job cancel/retry
- Generation provenance

### Exit Criteria

- User can install a local image model
- User can install a local image-to-video model
- App reports model health
- User can generate an image from prompt
- User can generate a short video from image
- Job shows status and progress
- Job can be cancelled
- Failed job can be retried
- Generated output becomes asset version
- Output stores prompt/model/seed/settings/inputs

---

## Milestone 4: Storyboard, Scenes, and Review

### Purpose

Turn generation into a structured creative workflow.

### Scope

- Storyboard create
- Storyboard panels
- Panel prompts
- Panel references
- Panel duration/camera/mood fields
- Panel status
- Scene create
- Scene prompts
- Scene references
- Scene versioning
- Shot list
- Shot prompts
- Generate from storyboard panel
- Generate from scene
- Generate from shot
- Candidate review
- Approve/reject
- Promote approved candidate to active version
- Shortlist

### Exit Criteria

- User can create a storyboard with multiple panels
- Panels can reference `@assets`
- User can generate a preview image for a panel
- User can create a scene with prompt:

```text
@person walks into @room and stops at @table
```

- Scene resolves references
- User can generate a clip from scene
- Generated clip becomes asset version
- User can review candidates
- Approved candidate becomes active asset version
- Older prompt versions remain available

---

## Milestone 5: Timeline, Audio, and Export

### Purpose

Complete the core movie assembly loop.

### Scope

- Timeline create
- Video track
- Audio track
- Add clip
- Reorder clip
- Trim clip
- Duplicate clip
- Delete clip
- Playback
- Undo/redo
- Timeline snapshots
- Audio import
- Audio trim
- Basic gain
- Basic mixer UI
- Export presets
- Render queue
- MP4 export
- WAV export
- Render validation
- Render logs
- Export history

### Exit Criteria

- User can place generated clips on timeline
- User can reorder and trim clips
- User can add a music/audio track
- User can export a draft MP4
- User can export audio as WAV
- Export failure produces clear report
- Timeline changes can be undone
- Timeline snapshots can be restored

---

## Milestone 6: MVP Hardening

### Purpose

Make the core pipeline dependable.

### Scope

- Crash recovery
- Auto-save / snapshot behavior
- Missing media detection
- Integrity scan
- Better error messages
- Storage usage report
- Diagnostics export
- Security hardening
- Permission checks on all endpoints
- Job queue recovery after restart
- Backup/restore
- Performance optimization
- Accessibility pass
- UI polish
- MVP acceptance flow test

### Exit Criteria

- App recovers from interrupted save
- Missing media files are detected
- Failed jobs do not corrupt state
- Permission checks are enforced
- Diagnostics can be exported
- Backup can be restored
- MVP acceptance flow passes reliably

---

## Milestone 7: Professional Workflow Expansion

### Purpose

Make the product comfortable for repeated creative use.

### Scope

- Music generation
- Voiceover generation
- SFX generation
- Music mood matching
- Transitions
- Color grading
- Subtitles
- Text overlays
- Batch generation
- Proxy workflow polish
- Asset dependency tracking
- Broken reference repair
- Storage management
- Model benchmark
- Skill system v1 using JSON/YAML
- Project templates
- A/B comparison improvements
- Version comparison improvements
- Basic ducking
- Audio cleanup
- Subtitle generation from dialogue/voiceover

### Exit Criteria

- User can generate music locally
- User can generate simple voiceover
- User can generate SFX
- User can apply transitions and basic color grade
- User can add subtitles
- User can batch generate multiple shots
- User can run a JSON/YAML skill
- User can start from a project template
- User can compare versions and references more effectively

---

## Milestone 8: Advanced Studio Features

### Purpose

Expand into advanced local film production.

### Scope

- 3D import
- 3D preview
- 3D view export
- 3D as reference
- Advanced 3D pipeline later
- Script parser
- AI assistant (executed as Workstream 16: LLM endpoint settings, creative assist, skill prompt
  guidance, HuggingFace catalog, Model Copilot tool harness — section 37)
- Continuity analyzer
- AI “watch the movie” music
- Music stems
- Auto-mix
- Advanced render pipeline
- HDR export
- Archival master
- Optional cloud gateway, if later decided
- Team review

### Exit Criteria

- User can import 3D and use exported views as references
- User can import a script and produce structured draft scenes
- App can report continuity issues
- App can suggest or generate matching score after a cut is assembled
- Advanced exports work reliably

---

# 11. Detailed Implementation Backlog

The backlog below is intentionally acceptance-based.

## 11.1 Foundations

| ID      | Task                           | Acceptance Criteria                   |
| ------- | ------------------------------ | ------------------------------------- |
| FND-001 | Create Deno backend skeleton   | Server starts, health endpoint works  |
| FND-002 | Create config system           | Config from env + file, validated     |
| FND-003 | Create structured logging      | Logs include request/job/user context |
| FND-004 | Create error model             | Consistent API error shape            |
| FND-005 | Create static frontend server  | Serves local HTML/JS/CSS              |
| FND-006 | Create web component shell     | App loads pages via components        |
| FND-007 | Create SQLite migration system | Migrations run idempotently           |
| FND-008 | Create base DB schema          | Core tables exist                     |
| FND-009 | Create WebSocket gateway       | Client can subscribe to events        |
| FND-010 | Create unit test harness       | Deno tests pass                       |
| FND-011 | Create CI pipeline             | fmt/lint/test run                     |
| FND-012 | Create local install script    | One-command local start               |
| FND-013 | Create Docker image            | App runs in container                 |

## 11.2 Storage and Media

| ID      | Task                              | Acceptance Criteria                 |
| ------- | --------------------------------- | ----------------------------------- |
| STO-001 | Define storage layout             | `app_data` structure created        |
| STO-002 | Implement checksum utility        | SHA256 works for files              |
| STO-003 | Implement content-addressed store | Files stored by hash                |
| STO-004 | Implement upload pipeline         | Uploads stream to disk safely       |
| STO-005 | Implement atomic file writes      | No partial files remain             |
| STO-006 | Implement duplicate detection     | Same hash reuses stored file        |
| STO-007 | Implement thumbnail generation    | Image/video thumbnails work         |
| STO-008 | Implement proxy generation        | Proxy files created for video/audio |
| STO-009 | Implement waveform generation     | Audio waveform preview works        |
| STO-010 | Implement integrity scan          | Missing/corrupt files detected      |
| STO-011 | Implement storage usage report    | Size by project/asset/model/cache   |
| STO-012 | Implement cache cleanup           | Safe cleanup of regenerable files   |

## 11.3 Auth and Authorization

| ID      | Task                       | Acceptance Criteria                      |
| ------- | -------------------------- | ---------------------------------------- |
| AUT-001 | Bootstrap first local user | Initial account can be created           |
| AUT-002 | Password login/logout      | Session works                            |
| AUT-003 | Role-based permissions     | admin/editor/viewer enforced             |
| AUT-004 | Project ownership          | Users can only access permitted projects |
| AUT-005 | Asset ownership            | Users can only access permitted assets   |
| AUT-006 | Audit logging              | Sensitive actions logged                 |
| AUT-007 | Session invalidation       | Logout revokes access                    |
| AUT-008 | Secret storage             | API/session secrets handled safely       |

## 11.4 Projects

| ID      | Task                   | Acceptance Criteria                         |
| ------- | ---------------------- | ------------------------------------------- |
| PRJ-001 | Create project         | Project row + directories created           |
| PRJ-002 | Project settings       | Aspect/fps/resolution/audio defaults stored |
| PRJ-003 | Open project           | Metadata loads, directories verified        |
| PRJ-004 | Save project           | Metadata persisted                          |
| PRJ-005 | Close project          | Active project state cleared safely         |
| PRJ-006 | Rename project         | References remain valid                     |
| PRJ-007 | Archive/delete project | Soft delete/archive with confirmation       |
| PRJ-008 | Project snapshots      | Snapshot can be created and restored        |
| PRJ-009 | Missing media report   | Missing files listed per project            |
| PRJ-010 | Recent projects list   | Dashboard shows recents                     |
| PRJ-011 | Project search         | Search by name/description/status           |

## 11.5 Assets and Versioning

| ID      | Task                      | Acceptance Criteria                             |
| ------- | ------------------------- | ----------------------------------------------- |
| AST-001 | Create asset              | Asset metadata stored                           |
| AST-002 | Upload asset              | File stored, version created                    |
| AST-003 | Assign unique `@name`     | Slug unique globally                            |
| AST-004 | Add aliases               | Asset can have multiple `@` names               |
| AST-005 | Global/project scope      | Assets can be global or project-scoped          |
| AST-006 | Asset metadata            | Type, description, tags, license, source stored |
| AST-007 | Asset versions            | New upload/generation creates new version       |
| AST-008 | Active version pointer    | Asset points to active version                  |
| AST-009 | Restore version           | Old version can become active again             |
| AST-010 | Version notes             | Notes stored per version                        |
| AST-011 | Version preview           | Each version previewable                        |
| AST-012 | Asset search              | Search by name/type/tag/project/date            |
| AST-013 | Asset filters             | Filter by type/status/license/project           |
| AST-014 | Asset preview panel       | Thumbnail/waveform/3D placeholder shown         |
| AST-015 | Dependency tracking       | Shows scenes/timelines referencing asset        |
| AST-016 | Missing reference warning | Deleting referenced asset warns                 |
| AST-017 | Soft delete/archive       | Deleted assets recoverable                      |

## 11.6 Reference Engine

| ID      | Task                       | Acceptance Criteria                      |
| ------- | -------------------------- | ---------------------------------------- |
| REF-001 | Parse `@name` tokens       | Detects valid tokens in prompt text      |
| REF-002 | Resolve references         | Maps token to asset + active version     |
| REF-003 | Versioned references       | Supports `@name:v2` style syntax         |
| REF-004 | Role assignment            | Character/location/style/etc. can be set |
| REF-005 | Missing reference status   | Unresolved references flagged            |
| REF-006 | Reference audit            | Lists all references by project/scene    |
| REF-007 | Reference replacement      | Broken ref can be remapped               |
| REF-008 | Reference suggestions      | UI can suggest assets while typing       |
| REF-009 | Reference position storage | Start/end positions stored when useful   |
| REF-010 | Prompt integration         | Prompt editor highlights references      |

## 11.7 Prompt Versioning

| ID      | Task                               | Acceptance Criteria             |
| ------- | ---------------------------------- | ------------------------------- |
| PMP-001 | Store prompt versions              | Prompt edits create new version |
| PMP-002 | Prompt content hash                | Duplicate content detected      |
| PMP-003 | Prompt history UI                  | User can view prompt versions   |
| PMP-004 | Restore prompt                     | Older prompt can be restored    |
| PMP-005 | Link generations to prompt version | Job stores prompt version used  |

## 11.8 Model Manager

| ID      | Task                 | Acceptance Criteria                       |
| ------- | -------------------- | ----------------------------------------- |
| MOD-001 | Model registry       | Installed models listed                   |
| MOD-002 | Model metadata       | Name/version/license/backend/tasks stored |
| MOD-003 | Install model        | Model files downloaded/copied locally     |
| MOD-004 | Verify model         | Hash/checksum validation works            |
| MOD-005 | Remove model         | Model removed with metadata cleanup       |
| MOD-006 | Enable/disable model | Disabled model not usable                 |
| MOD-007 | Health check         | Model load/run test works                 |
| MOD-008 | Task mapping         | Model associated with supported tasks     |
| MOD-009 | Hardware detection   | CPU/RAM/GPU info detected                 |
| MOD-010 | Requirement warnings | Missing dependencies shown                |
| MOD-011 | Model presets        | Default settings per model stored         |
| MOD-012 | License display      | License visible in UI                     |
| MOD-013 | Model source consent | Network/model source use is explicit      |
| MOD-014 | Model catalog        | Local/user-controlled catalog browsable   |

## 11.9 Generation Pipeline

| ID      | Task                    | Acceptance Criteria                            |
| ------- | ----------------------- | ---------------------------------------------- |
| GEN-001 | Job queue               | Jobs stored and claimed safely                 |
| GEN-002 | Job API                 | Create/list/get jobs                           |
| GEN-003 | Job runner              | Runner executes queued jobs                    |
| GEN-004 | Job events              | Progress events stored and streamed            |
| GEN-005 | Job cancel              | Active job can be cancelled                    |
| GEN-006 | Job retry               | Failed job can be retried                      |
| GEN-007 | Adapter interface       | Common model runtime interface exists          |
| GEN-008 | Mock adapter            | Tests can simulate generation                  |
| GEN-009 | Text-to-image adapter   | T2I generation works                           |
| GEN-010 | Image-to-video adapter  | I2V generation works                           |
| GEN-011 | Candidate output        | Multiple candidates can be produced            |
| GEN-012 | Seed control            | Fixed/random seed supported                    |
| GEN-013 | Settings schema         | Settings stored as JSON                        |
| GEN-014 | Input references        | Input asset versions attached                  |
| GEN-015 | Provenance              | Output version records full generation context |
| GEN-016 | Concurrency control     | One GPU job at a time by default               |
| GEN-017 | Job recovery            | Jobs recover gracefully after restart          |
| GEN-018 | Error reporting         | Clear user-facing errors                       |
| GEN-019 | Low-res preview option  | Preview generation supported                   |
| GEN-020 | Full-quality generation | Final generation supported after preview       |

## 11.10 Storyboard

| ID      | Task                     | Acceptance Criteria                     |
| ------- | ------------------------ | --------------------------------------- |
| STB-001 | Create storyboard        | Storyboard per project                  |
| STB-002 | Add panel                | Panel represents a shot                 |
| STB-003 | Panel prompt             | Prompt editor with references           |
| STB-004 | Panel references         | Assets can be attached                  |
| STB-005 | Panel duration           | Duration stored                         |
| STB-006 | Panel camera fields      | Shot size/angle/movement stored         |
| STB-007 | Panel mood/lighting      | Mood/time/lighting stored               |
| STB-008 | Panel status             | Draft/approved/generated/needs revision |
| STB-009 | Panel preview generation | Generate image preview                  |
| STB-010 | Panel ordering           | Panels can be reordered                 |
| STB-011 | Panel notes              | Notes stored                            |
| STB-012 | Storyboard export        | Export as PDF/PNG/ZIP later             |

## 11.11 Scenes and Shots

| ID      | Task                 | Acceptance Criteria                       |
| ------- | -------------------- | ----------------------------------------- |
| SCN-001 | Create scene         | Scene within project                      |
| SCN-002 | Scene prompt         | Prompt with references                    |
| SCN-003 | Scene references     | References resolved and listed            |
| SCN-004 | Scene status         | Draft/generated/editing/approved/rejected |
| SCN-005 | Scene duration       | Target duration stored                    |
| SCN-006 | Scene versioning     | Prompt/structure changes versioned        |
| SCN-007 | Generate scene media | Generate clip from scene                  |
| SCN-008 | Shot list            | Scene can contain multiple shots          |
| SCN-009 | Shot prompt          | Each shot has prompt                      |
| SCN-010 | Shot references      | Each shot resolves references             |
| SCN-011 | Shot duration        | Duration per shot                         |
| SCN-012 | Generate shot        | Generate clip from shot                   |
| SCN-013 | Scene notes          | Notes stored                              |
| SCN-014 | Scene audio plan     | Dialogue/SFX/music fields stored          |

## 11.12 Review Workflow

| ID      | Task                   | Acceptance Criteria                           |
| ------- | ---------------------- | --------------------------------------------- |
| REV-001 | Candidate view         | Show candidates for job                       |
| REV-002 | Approve candidate      | Candidate marked approved                     |
| REV-003 | Reject candidate       | Candidate marked rejected                     |
| REV-004 | Use candidate          | Approved candidate placed into asset/timeline |
| REV-005 | Promote active version | Approved version becomes asset active version |
| REV-006 | A/B comparison         | Two candidates compared side by side          |
| REV-007 | Shortlist              | Favorites marked                              |
| REV-008 | Review notes           | Notes per candidate                           |
| REV-009 | Review board view      | Many shots/assets reviewable in one view      |

## 11.13 Timeline Editor

| ID      | Task               | Acceptance Criteria               |
| ------- | ------------------ | --------------------------------- |
| TIM-001 | Create timeline    | Timeline per project              |
| TIM-002 | Video track        | Add video track                   |
| TIM-003 | Audio track        | Add audio track                   |
| TIM-004 | Add clip           | Asset version placed on track     |
| TIM-005 | Reorder clip       | Drag/reorder works                |
| TIM-006 | Trim clip          | In/out points adjust              |
| TIM-007 | Split clip         | Split at playhead                 |
| TIM-008 | Delete clip        | Item removed                      |
| TIM-009 | Duplicate clip     | Item duplicated                   |
| TIM-010 | Playback           | Play selected range/full timeline |
| TIM-011 | Undo/redo          | Timeline actions reversible       |
| TIM-012 | Timeline snapshots | Snapshots can be saved/restored   |
| TIM-013 | Markers            | Markers/notes added               |
| TIM-014 | Lock/mute tracks   | Track state changes work          |
| TIM-015 | Text overlay       | Titles/credits added later        |
| TIM-016 | Subtitles          | SRT/VTT support later             |
| TIM-017 | Effects            | Basic effects later               |
| TIM-018 | Color grading      | LUT/grade applied later           |
| TIM-019 | Transitions        | Fade/dissolve/cut/wipe later      |

## 11.14 Audio and Music

| ID      | Task                   | Acceptance Criteria                        |
| ------- | ---------------------- | ------------------------------------------ |
| AUD-001 | Import audio           | WAV/MP3/etc. imported                      |
| AUD-002 | Audio asset versioning | Audio versions supported                   |
| AUD-003 | Add audio to timeline  | Audio clip placed on track                 |
| AUD-004 | Audio trim             | In/out points adjust                       |
| AUD-005 | Basic gain             | Per-clip volume control                    |
| AUD-006 | Waveform display       | Waveform preview works                     |
| AUD-007 | Basic mixer            | Track-level gain/mute/lock                 |
| AUD-008 | Music import           | Music file can be imported and used        |
| AUD-009 | Music generation       | Generate music from prompt/mood            |
| AUD-010 | Voiceover generation   | Generate voice from text                   |
| AUD-011 | SFX generation         | Generate sound effects                     |
| AUD-012 | Audio cleanup          | Denoise/normalize later                    |
| AUD-013 | Ducking                | Music lowers under dialogue                |
| AUD-014 | Subtitle generation    | Generate subtitles from voiceover/dialogue |
| AUD-015 | Music stems            | Separate stems if model supports           |

## 11.15 Render and Export

| ID      | Task                  | Acceptance Criteria                        |
| ------- | --------------------- | ------------------------------------------ |
| EXP-001 | Export presets        | Draft/final presets defined                |
| EXP-002 | Render queue          | Exports queued as jobs                     |
| EXP-003 | MP4 export            | Timeline rendered to MP4                   |
| EXP-004 | WAV export            | Audio rendered to WAV                      |
| EXP-005 | Render progress       | Progress reported                          |
| EXP-006 | Render log            | Warnings/errors captured                   |
| EXP-007 | Render validation     | Missing media checked before render        |
| EXP-008 | Export history        | Exports listed and versioned               |
| EXP-009 | Subtitle export       | SRT/VTT export later                       |
| EXP-010 | Storyboard export     | PDF/PNG/ZIP export later                   |
| EXP-011 | Project bundle export | Metadata + optional media exported         |
| EXP-012 | Multiple exports      | Same timeline exported in multiple formats |
| EXP-013 | Archival master       | High-quality master export later           |

## 11.16 Diagnostics and Operations

| ID      | Task                | Acceptance Criteria                      |
| ------- | ------------------- | ---------------------------------------- |
| DIA-001 | Hardware report     | CPU/RAM/GPU info visible                 |
| DIA-002 | Model health report | Model load errors visible                |
| DIA-003 | Storage report      | Disk usage and orphaned files visible    |
| DIA-004 | Diagnostics export  | Redacted diagnostics package created     |
| DIA-005 | Log viewer          | Recent logs viewable                     |
| DIA-006 | Backup project      | Project backup created                   |
| DIA-007 | Restore backup      | Backup restored                          |
| DIA-008 | Crash recovery      | App recovers from interrupted operations |

## 11.17 3D Support

Place after core MVP unless product decision changes.

| ID     | Task              | Acceptance Criteria                                |
| ------ | ----------------- | -------------------------------------------------- |
| 3D-001 | Import 3D         | GLB/GLTF/OBJ/FBX/USD accepted                      |
| 3D-002 | 3D preview        | Rotate/pan/scale in viewport                       |
| 3D-003 | 3D versioning     | 3D files versioned                                 |
| 3D-004 | Export views      | Front/side/top/perspective images                  |
| 3D-005 | Use as reference  | Exported views can be `@named` and used in prompts |
| 3D-006 | Format conversion | Basic conversion where supported                   |
| 3D-007 | 3D-to-video       | Generate video from 3D views later                 |
| 3D-008 | 3D generation     | Image/text-to-3D later                             |

## 11.18 Skill System

Post-MVP, JSON/YAML first.

| ID      | Task                 | Acceptance Criteria                 |
| ------- | -------------------- | ----------------------------------- |
| SKL-001 | Skill format         | JSON/YAML schema defined            |
| SKL-002 | Skill metadata       | Name/version/author/license stored  |
| SKL-003 | Skill input schema   | Required/optional inputs validated  |
| SKL-004 | Skill output schema  | Outputs defined                     |
| SKL-005 | Skill engine         | Executes declared steps             |
| SKL-006 | Skill parameters     | User supplies parameters            |
| SKL-007 | Skill versioning     | Skill versions stored               |
| SKL-008 | Skill enable/disable | Skills can be toggled               |
| SKL-009 | Skill permissions    | Required permissions declared       |
| SKL-010 | Skill examples       | Sample inputs/outputs included      |
| SKL-011 | Skill import/export  | Portable skill file supported       |
| SKL-012 | Skill testing        | Test cases can be run               |
| SKL-013 | Skill chaining       | Multiple skills can run in sequence |

## 11.19 LLM Assistant & Model Copilot (Workstream 16)

| ID      | Feature                          | Acceptance criteria                                                                                                                                                                                                  |
| ------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LMA-001 | LLM endpoint settings            | Models page has a separate LLM section; stores base URL, model, optional API key, temperature, max tokens, timeout, enabled flag in `app_settings`; GET never returns the raw key                                    |
| LMA-002 | LLM connection test              | `POST /api/v1/llm/test` performs a minimal completion against the configured OpenAI-compatible endpoint and reports ok + latency or a precise error; 503 when unconfigured                                           |
| LMA-003 | One-shot chat                    | `POST /api/v1/llm/chat` sends messages to the endpoint and returns `{content, model, usage?}`; bounded by timeout; 503 when unconfigured                                                                             |
| LMA-004 | Script writing assist            | `POST /api/v1/llm/assist` with `purpose: write_script` turns a movie idea into Fountain-lite screenplay text the scene-list script import can parse                                                                  |
| LMA-005 | Scene design assist              | `purpose: design_scene` returns a structured scene design (description, shots with camera/movement, mood, lighting, time of day, dialogue) from a context string                                                     |
| LMA-006 | Prompt enhancement               | `purpose: enhance_prompt` rewrites a generation prompt for a target model/task type; existing `@reference` tokens are preserved verbatim                                                                             |
| LMA-007 | AI-assist UI                     | Prompt editor, scene-list import, and scene detail offer an AI-assist dialog: context, run, copy/apply the result; disabled with tooltip when no LLM is configured                                                   |
| LMA-008 | Skill assistant block            | Skill definitions accept an optional `assistant` block (`model_task_types`, `guidance`, `examples`); validation + version snapshots include it                                                                       |
| LMA-009 | Model-aware assist context       | Assist requests may pass `model_id` (model metadata injected) and `skill_id` (assistant guidance + examples injected); the target model must be enabled                                                              |
| LMA-010 | HuggingFace search + repo detail | `GET /api/v1/models/huggingface/search` and `GET /api/v1/models/huggingface/:repoId` proxy the public HF API server-side; normalized repo metadata + file listing with sizes                                         |
| LMA-011 | Auto-register from HuggingFace   | `POST /api/v1/models/from-huggingface` (admin) creates a model row with `source: url` pointing at the chosen repo file (explicit or heuristic pick); install remains the consent-gated install flow                  |
| LMA-012 | HF browse panel                  | Models page panel: search box, results table, repo file picker, register button; installed state then uses the normal install/verify flow                                                                            |
| LMA-013 | Tool harness                     | Named tools with JSON schemas: read-only tools (list models, HF search/info, ComfyUI status) auto-execute; mutating tools (register model, register from HF, install, remove) are admin-gated and never auto-execute |
| LMA-014 | Agent chat (Model Copilot)       | `POST /api/v1/llm/agent` runs a bounded tool-calling loop (max 8 iterations); mutating tool calls are recorded as in-memory proposals (1h TTL) and the model is told to ask the user to approve in the UI            |
| LMA-015 | ComfyUI connection helper        | Copilot can probe a ComfyUI endpoint (`/system_stats`), report queue/GPU state, and propose registering a comfyui-backend model with endpoint + workflow                                                             |
| LMA-016 | Model Copilot UI                 | Models page copilot section: chat panel, tool-call activity log, and proposal cards with Approve/Reject (admin) that show the exact tool + arguments                                                                 |

---

## 11.20 MCP Tool Servers (Workstream 17)

| ID      | Feature             | Acceptance criteria                                                                                                                                                                                             |
| ------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP-001 | Server registry     | Admin CRUD of MCP servers (stdio: command/args/env; http: url/headers) validates transport-specific fields, name slug uniqueness, and 5-3600 s timeouts; GET views mask stored header values                    |
| MCP-002 | Connection test     | `POST /api/v1/mcp/servers/:id/test` connects, lists the server's tools, and returns them; failures map to 502 `MCP_UNREACHABLE` (spawn/HTTP/protocol) or 504 `MCP_TIMEOUT`                                      |
| MCP-003 | Tool catalog        | Enabled servers' tools join the copilot tool set as `mcp__<server>__<tool>` with pass-through JSON schemas; a failing server is isolated (others still available, error surfaced in the UI)                     |
| MCP-004 | Read-only execution | MCP tools with `readOnlyHint` (or on an `auto_approve` server) auto-execute inline in the agent loop like built-in read-only tools                                                                              |
| MCP-005 | Approval gating     | Non-read-only MCP tools create admin approval proposals (dedupe, in-flight, auto-continue unchanged); non-admin callers do not receive them in the tool schema                                                  |
| MCP-006 | Lifecycle           | Disable/delete closes the live connection; SIGTERM/SIGINT close all MCP connections (no orphaned stdio children); the next use reconnects transparently                                                         |
| MCP-007 | MCP Servers UI      | Models page panel (admin): server rows with status chips, add/edit form, test button (save-then-test), tool list with read-only chips; copilot steps/proposals for `mcp__…` tools show an `MCP: <server>` badge |

---

# 12. Model Runtime Adapter Design

This is one of the most important implementation areas.

The core app should not know whether generation is running through:

- ComfyUI
- a local HTTP server
- a CLI tool
- a Python inference service
- a user-controlled LAN endpoint

It should only know the adapter contract.

## 12.1 Adapter Interface

Suggested interface:

```ts
interface InferenceAdapter {
  id: string;
  name: string;

  capabilities(): Promise<AdapterCapabilities>;

  healthCheck(model: Model): Promise<AdapterHealth>;

  describeParameters(model: Model): Promise<ParameterSchema>;

  generate(params: GenerationRequest): AsyncIterable<GenerationEvent>;

  cancel(jobId: string): Promise<void>;
}
```

Where:

```ts
interface GenerationRequest {
  jobId: string;
  model: Model;
  task: string;
  prompt?: string;
  negativePrompt?: string;
  seed?: string;
  settings: Record<string, unknown>;
  inputs: InputReference[];
  outputDir: string;
  onProgress?: (progress: number) => void;
}
```

```ts
type GenerationEvent =
  | { type: "status"; status: string; message?: string }
  | { type: "progress"; progress: number }
  | { type: "candidate"; file: string; metadata?: Record<string, unknown> }
  | { type: "error"; message: string; details?: string }
  | { type: "complete" };
```

## 12.2 Required MVP Adapters

For MVP, implement at least:

- Mock adapter
- Text-to-image adapter
- Image-to-video adapter

Recommended approach:

- Use one stable open-source local image runtime as first-class supported adapter.
- Use one stable open-source local image-to-video runtime as first-class supported adapter.
- Keep exact model selection configurable.

Possible adapter categories:

- ComfyUI adapter
- Local HTTP API adapter
- CLI process adapter
- Mock adapter

## 12.3 Capability Discovery

Each adapter should report:

- supported tasks
- supported resolutions
- supported FPS
- maximum duration
- seed support
- negative prompt support
- reference image support
- first-frame support
- style reference support
- batch/candidate support
- preview support

This prevents the UI from exposing controls the model does not support.

---

# 13. Generation Pipeline Design

## 13.1 Job Lifecycle

```text
created
→ queued
→ claimed
→ loading_model
→ running
→ processing
→ succeeded | failed | cancelled
```

## 13.2 Queue Rules

- Jobs are persisted in SQLite.
- Runner claims jobs using lease.
- Lease prevents duplicate execution.
- Concurrency is configurable.
- Default: one GPU generation job at a time.
- CPU-only mode can run lower-priority or smaller jobs.
- Long-running jobs must emit progress events.
- Cancellation must be visible in UI quickly.
- Failed jobs must retain input state for retry.

## 13.3 Job Output

A generation job may produce:

- one candidate
- multiple candidates
- preview files
- full-quality files
- metadata sidecars

The job runner must:

- validate output files
- compute checksums
- create asset versions
- store provenance
- publish events
- update job status

## 13.4 Provenance Record

For each generated asset version, store:

- job ID
- prompt text
- prompt version ID
- negative prompt
- model ID
- model version
- seed
- settings JSON
- input asset version IDs
- reference roles
- output checksum
- start/end timestamps

---

# 14. Media Pipeline Design

## 14.1 Ingest Flow

When a media file is uploaded:

1. Validate file type.
2. Stream to temporary location.
3. Compute checksum.
4. Move into content store.
5. Create asset/version metadata.
6. Queue media processing.
7. Generate preview/proxy.
8. Update UI when ready.

## 14.2 Required Media Operations

Implement with FFmpeg:

- video thumbnail
- image thumbnail
- audio waveform
- audio proxy
- video proxy
- audio normalization
- basic audio trim
- MP4 export
- WAV export
- SRT/VTT burn-in later
- subtitle extraction later
- black frame detection later

## 14.3 Proxy Rules

Use practical defaults:

| Type  | Master        | Proxy                           |
| ----- | ------------- | ------------------------------- |
| Video | Original file | 720p or 1080p low-bitrate H.264 |
| Audio | WAV/FLAC      | MP3/AAC preview                 |
| Image | Original      | JPG preview                     |
| 3D    | Source model  | Lightweight preview mesh/image  |

Rules:

- Timeline uses proxy by default.
- Final render uses master when available.
- Missing master blocks final export or triggers warning.
- Proxies can be regenerated.

---

# 15. Frontend Implementation Plan

The frontend should be built as a set of reusable web components.

No framework. No build step.

## 15.1 Core Screens

### Project Dashboard

Purpose:

- Create project
- Open recent projects
- Search projects
- View storage usage
- Shortcut to model manager

Components:

- `ls-app-shell`
- `ls-project-card`
- `ls-project-form`
- `ls-storage-summary`

### Asset Library

Purpose:

- Browse assets
- Upload
- Generate
- Search/filter
- Version history

Components:

- `ls-asset-grid`
- `ls-asset-card`
- `ls-asset-details`
- `ls-version-list`
- `ls-asset-preview`
- `ls-upload-dialog`

### Prompt Editor

Purpose:

- Edit prompts
- Resolve `@references`
- Show reference status

Components:

- `ls-prompt-editor`
- `ls-reference-badge`
- `ls-reference-picker`

### Model Manager

Purpose:

- Install/manage models
- Health checks
- Hardware requirements

Components:

- `ls-model-list`
- `ls-model-row`
- `ls-model-install-dialog`
- `ls-hardware-summary`

### Generation Queue

Purpose:

- Monitor jobs
- Cancel/retry
- View logs

Components:

- `ls-job-list`
- `ls-job-row`
- `ls-job-log`
- `ls-progress-bar`

### Storyboard Editor

Purpose:

- Plan shots
- Generate previews
- Approve panels

Components:

- `ls-storyboard-board`
- `ls-storyboard-panel`
- `ls-panel-form`
- `ls-preview-image`

### Scene Inspector

Purpose:

- Manage scene prompt
- References
- Shots
- Generation
- Version history

Components:

- `ls-scene-inspector`
- `ls-shot-list`
- `ls-scene-status`
- `ls-version-history`

### Review Board

Purpose:

- Compare candidates
- Approve/reject
- Use candidate

Components:

- `ls-review-board`
- `ls-candidate-card`
- `ls-ab-compare`

### Timeline Editor

Purpose:

- Assemble movie
- Edit clips
- Add audio
- Export

Components:

- `ls-timeline`
- `ls-track-row`
- `ls-clip-item`
- `ls-playhead`
- `ls-preview-monitor`
- `ls-audio-waveform`
- `ls-marker-list`

### Settings and Diagnostics

Purpose:

- Storage paths
- Model settings
- Privacy
- Logs
- Hardware info

Components:

- `ls-settings-page`
- `ls-diagnostics-panel`
- `ls-log-viewer`

## 15.2 Frontend State Strategy

Use a lightweight client state layer:

- fetch API data
- subscribe to WebSocket events
- update local store
- components render from store

Avoid heavy client-side persistence for source of truth.

The backend is source of truth.

## 15.3 Migration Phases (Legacy Demo -> v1 Workbench)

The current frontend only serves the legacy demo (`/api/auth`, `/api/movies`). It migrates to the
`/api/v1` surface in dependency-ordered phases. Each phase is an independent, shippable PR that
leaves the app in a working state and updates `PROJECT_STATE.md`.

| Phase | v1 surface                      | Key components                                                          |
| ----- | ------------------------------- | ----------------------------------------------------------------------- |
| 1     | Auth + projects                 | `ls-project-card`, `ls-project-form`                                    |
| 2     | Asset library                   | `ls-asset-grid`, `ls-asset-card`, `ls-asset-details`, `ls-version-list` |
| 3     | Prompts, references, models     | `ls-prompt-editor`, `ls-reference-badge`, `ls-model-list`               |
| 4     | Job queue                       | `ls-job-list`, `ls-progress-bar`                                        |
| 5     | Storyboards, scenes, review     | `ls-storyboard-board`, `ls-shot-list`, `ls-review-board`                |
| 6     | Timeline + render/export        | `ls-timeline`, `ls-track-row`, `ls-preview-monitor`                     |
| 7     | Audio gen, diagnostics, cleanup | `ls-diagnostics-panel`                                                  |

### Phase 1: v1 auth + project dashboard

- `api.js` targets `/api/v1` (shared token lifecycle, consistent `ApiError` handling)
- Login screen: bootstrap (first user = admin), login, logout, `GET /me`
- Project dashboard: list accessible projects, create, edit, delete (soft), settings display
- `#/projects` becomes the default route; legacy movie views stay reachable until phase 7 removes
  them

Exit criteria:

- A fresh browser bootstraps and a returning browser logs in, both against `/api/v1/auth`
- Project CRUD works from the UI; permission errors (403) surface as actionable messages

### Phase 2: Asset library

- Grid with search + type/scope/tag filters; upload dialog (multipart)
- Asset details: version list, restore, active pointer, aliases, tags, preview streaming
- Proxies shown when present (draft quality indicator)

Exit criteria: full asset lifecycle in the UI: upload -> versions -> preview -> restore -> delete
with broken-reference warnings.

### Phase 3: Prompt editor + reference engine + model manager

- Versioned prompt editor: history, restore, duplicate-detection notice
- `@ref` / `@ref:vN` inline parsing, per-reference status badges (resolved/broken), reference picker
  for insertion
- Model manager view: list, health status, hardware summary; mutation buttons gated by role

Exit criteria: a user can write a prompt with references, see per-reference status, and resolve a
broken reference from the UI.

### Phase 4: Job queue monitor

- Job list (status/type filters), progress, cancel + retry, log viewer
- Polls the REST endpoints as the baseline; switches to `/ws/v1/jobs` push once the backend
  WebSocket gateway is implemented

Exit criteria: every queued/running/cancelled/retried job is visible and candidates reach the review
UI without a full page reload.

### Phase 5: Storyboard + scene + review

- Storyboard board: ordered panels, panel prompts, generate-preview (t2i), batch preview
- Scene inspector: scenes + shots, shot prompts, batch generation, per-shot status
- Review board: candidate comparison, approve (promote active) / reject / shortlist, notes

Exit criteria: full creative loop in the UI: panel prompt -> preview -> scene generation ->
candidate approval.

### Phase 6: Timeline editor + render/export

- Timeline: typed tracks (add/reorder/lock/mute), items from asset versions, move/trim/speed/
  transform/fades, transitions + color grade, text/subtitle items, markers, snapshots with restore
- Render: preset selection, render queue monitor, validation report, exports list

Exit criteria: a user can assemble a timeline, render a draft (proxies) and a final (masters), and
see the export as an asset.

### Phase 7: Audio generation, diagnostics, cleanup

- Audio generation dialog (music / voiceover / SFX) + waveforms in the timeline
- Diagnostics and settings panel: hardware, model health, storage report, log viewer, redacted
  export, project backup/restore
- Remove the legacy `movies` demo API surface and `movie-*` components

Exit criteria: no frontend references to legacy endpoints; the legacy demo routes are then removable
from the backend.

---

# 16. Authorization and Permissions Plan

Even though v1 is single-user, the data model and API must be permission-aware.

## 16.1 Roles

Initial roles:

- `admin`
- `editor`
- `viewer`

## 16.2 Permissions

Examples:

- `project:create`
- `project:read`
- `project:update`
- `project:delete`
- `asset:create`
- `asset:read`
- `asset:update`
- `asset:delete`
- `job:create`
- `job:cancel`
- `model:install`
- `model:remove`
- `render:create`
- `snapshot:create`
- `snapshot:restore`
- `diagnostics:read`
- `diagnostics:export`

## 16.3 Ownership Rules

- Projects have owners.
- Assets have owners.
- Global assets can have broader visibility.
- Project assets are scoped to the project.
- All permission changes are audited.

## 16.4 No Sharing Yet

Do not implement:

- invite flows
- shared links
- external collaborators
- sync between users

But do implement:

- permission tables
- permission checks
- audit logs

This prepares for future collaboration without changing the core model.

---

# 17. Security and Privacy Plan

## 17.1 Local-First Rules

- No cloud upload by default.
- No public cloud generation in v1.
- Network access should be explicit and limited.
- Model endpoints may be local or user-controlled LAN endpoints.
- Any network use must be user-visible.

## 17.2 Application Security

- Validate all input.
- Prevent path traversal.
- Validate uploaded file types.
- Enforce maximum upload sizes.
- Store passwords hashed.
- Use secure session tokens.
- Sanitize rendered text.
- Protect static files from exposing sensitive paths.
- Use least-privilege process permissions where practical.

## 17.3 Audit

Log:

- login/logout
- project create/delete
- asset create/delete
- version restore
- model install/remove
- job cancel/retry
- permission changes
- export creation
- diagnostics export

## 17.4 Sensitive Data

- API keys and secrets should not be stored in plaintext.
- Configuration should support secure local secret storage.
- Diagnostics export must redact secrets.

---

# 18. Testing Plan

Testing should be layered.

## 18.1 Unit Tests

Cover:

- reference parser
- slug validation
- checksums
- permission checks
- job queue logic
- version restore logic
- settings schema
- export preset logic
- prompt versioning
- storage path generation

## 18.2 Integration Tests

Cover:

- project CRUD
- asset upload
- asset versioning
- reference resolution
- job creation
- job status updates
- model install/remove
- storyboard/scene creation
- timeline item CRUD
- export creation

Use:

- temporary SQLite file
- temporary filesystem directory
- mock media files
- mock inference adapter

## 18.3 Media Tests

Use small synthetic fixtures:

- tiny image
- tiny video
- tiny audio

Verify:

- thumbnail generation
- proxy generation
- waveform generation
- export success
- missing media detection

## 18.4 Model Adapter Tests

Always test with:

- mock adapter first

Optionally add real-model tests behind an environment flag:

- `RUN_MODEL_INTEGRATION_TESTS=1`

Real model tests should not block normal CI.

## 18.5 End-to-End Tests

Use Playwright or equivalent.

Cover MVP acceptance flow:

- create project
- upload assets
- generate image
- generate video
- add to timeline
- add audio
- export MP4
- view history
- restore version

## 18.6 Failure Tests

Cover:

- cancelled job
- failed model
- missing media
- interrupted upload
- interrupted render
- missing model dependency
- disk full simulation
- broken reference

## 18.7 Migration Tests

Cover:

- migration from vN to vN+1
- rollback safety where possible
- data integrity after migration

---

# 19. CI/CD Plan

## 19.1 CI Checks

Automated checks should include:

- `deno fmt --check`
- `deno lint`
- type check
- unit tests
- integration tests
- frontend smoke test
- API smoke test
- migration test
- Docker build, if used

## 19.2 Artifacts

Produce:

- tarball
- Docker image
- release notes
- diagnostics package template

## 19.3 Deployment

Support:

- local install script
- Docker compose
- systemd service
- reverse proxy docs

The app should run on Linux as primary target.

---

# 20. Configuration Plan

Use configuration from:

- environment variables
- local config file
- first-run setup

Recommended config keys:

```text
APP_DATA_DIR
DATABASE_PATH
HTTP_PORT
SESSION_SECRET
UPLOAD_MAX_SIZE
FFMPEG_PATH
MODEL_DIR
MEDIA_DIR
OUTPUT_DIR
JOB_CONCURRENCY_GPU
JOB_CONCURRENCY_CPU
DEFAULT_PROXY_RESOLUTION
DEFAULT_PROXY_BITRATE
ENABLE_REMOTE_MODEL_SOURCES
LOG_LEVEL
```

Configuration should be validated at startup.

---

# 21. Error Handling Plan

Use a consistent error model.

Example API error:

```json
{
  "error": {
    "code": "MODEL_HEALTH_FAILED",
    "message": "Model failed to load.",
    "details": "CUDA out of memory",
    "traceId": "..."
  }
}
```

Required error categories:

- validation error
- auth error
- permission error
- missing file
- corrupt file
- model missing
- model unhealthy
- generation failed
- render failed
- storage error
- network error
- unknown error

Rules:

- User-facing messages must be clear.
- Technical details go to logs.
- Errors must not crash the queue.
- Errors must be exportable in diagnostics.

---

# 22. Performance Plan

Implement performance targets from the GOAL document.

## 22.1 Targets

- App startup under 5 seconds
- Project open under 2 seconds for medium project
- Thumbnail generation under 1 second per image
- Smooth timeline scrubbing using proxies
- Job status updates at least every 1 second
- Reference resolution under 100 ms
- Search under 500 ms for 10,000 assets
- Draft render starts within 10 seconds
- Clear error reporting under 5 seconds

## 22.2 Implementation Measures

- DB indexes
- FTS5 search
- pagination
- lazy loading
- proxy playback
- thumbnail cache
- job event batching
- media processing queue
- hardware-aware defaults
- avoid full-library scans in UI
- avoid blocking API calls during media processing

---

# 23. Observability Plan

## 23.1 Logs

Structured logs should include:

- timestamp
- level
- component
- user ID
- project ID
- job ID
- asset ID
- model ID
- duration

## 23.2 Events

Track:

- project created
- asset uploaded
- asset generated
- job started/failed/cancelled
- model installed
- snapshot created
- export completed
- permission denied
- missing reference detected

## 23.3 Diagnostics

Diagnostics report should include:

- app version
- OS info
- CPU/RAM
- GPU info if present
- ffmpeg version
- model list
- model health
- storage usage
- recent errors
- configuration summary with secrets redacted

---

# 24. Backup and Restore Plan

## 24.1 Project Snapshot

A project snapshot should capture:

- project metadata
- storyboard structure
- scenes
- shots
- timelines
- prompts
- references
- asset metadata and version pointers
- export metadata

It does not need to copy all media files by default.

## 24.2 Project Bundle

Project export/import should support:

- metadata only
- metadata + referenced media
- metadata + all project media
- optional model references, but not model weights by default

## 24.3 Recovery

Support:

- restore project snapshot
- restore timeline snapshot
- restore asset active version
- restore prompt version
- detect missing media after restore

---

# 25. 3D Implementation Plan

Because full 3D is not MVP-critical, implement in stages.

## 25.1 Stage 1: Import and Preview

- Accept GLB/GLTF/OBJ/FBX/USD/USDZ/STL
- Store as asset version
- Preview in browser viewport
- Rotate/pan/scale

## 25.2 Stage 2: Export Views

- Render front/side/top/perspective images
- Store images as derived asset versions
- Allow naming:
  - `@table_front`
  - `@table_side`
  - `@table_top`
- Use those images as reference inputs

## 25.3 Stage 3: Reference Use

- Allow 3D-derived images in prompts
- Track parent asset relationship
- Preserve provenance

## 25.4 Stage 4: Advanced

- 3D-to-video
- basic animation
- lighting/material tweaks
- 3D generation

---

# 26. Audio and Music Implementation Plan

## 26.1 MVP Audio

MVP audio should support:

- import
- versioning
- timeline placement
- trim
- gain
- waveform
- export

## 26.2 Professional Audio

Next stage:

- music generation
- voiceover
- SFX
- ducking
- basic mixing
- cleanup
- subtitles from dialogue

## 26.3 Advanced Audio

Later:

- stems
- auto-mix
- watch-movie music
- advanced sync
- multilingual dubbing
- lip-sync

---

# 27. Skill System Implementation Plan

Skills should be implemented after core MVP.

Use JSON/YAML first.

## 27.1 Skill File Shape

Example:

```yaml
id: tense_score_generator
name: Tense Score Generator
version: 1.0.0
author: local-user
license: MIT
description: Generates a tense music track for a selected scene.

inputs:
  scene:
    type: scene
    required: true
  mood:
    type: string
    default: tense
  duration:
    type: number
    default: 30

required_models:
  - music_generation

permissions:
  - job:create
  - asset:create

steps:
  - type: generate_music
    prompt: "tense cinematic score with low strings"
    duration: { { inputs.duration } }
    output:
      asset_type: music
      status: draft
```

## 27.2 Skill Engine Requirements

- validate schema
- resolve inputs
- check permissions
- execute steps
- create outputs
- log execution
- support versioning
- support import/export

Do not execute arbitrary code in v1.

---

# 28. Project Template Plan

Post-MVP.

Templates should define:

- default project settings
- default tracks
- default export presets
- default storyboard structure
- default model preferences
- sample asset types

Template types:

- short film
- social reel
- music video
- product video
- explainer video

---

# 29. Diagnostics and Support Plan

The app should make support possible without exposing private media.

Diagnostics package should include:

- app version
- configuration summary
- hardware summary
- model list and health
- storage usage
- recent errors
- job failures
- render failures
- missing media report
- logs

Exclude by default:

- media files
- API secrets
- private user data

---

# 30. MVP Acceptance Plan

The MVP is complete when this flow works reliably.

## 30.1 Acceptance Flow

1. Create a project.
2. Upload a character image and name it `@person`.
3. Upload a room image and name it `@room`.
4. Upload a table image and name it `@table`.
5. Generate a new character variation.
6. Restore the previous character version if needed.
7. Create a storyboard.
8. Add a scene prompt:

```text
@person walks into @room and stops at @table
```

9. Generate a short video clip.
10. Review the generated clip.
11. Add the clip to the timeline.
12. Add a music track.
13. Export a draft video.
14. See the generation history and restore a previous version.

## 30.2 Acceptance Checklist

- [ ] Project created successfully
- [ ] Three assets uploaded
- [ ] Each asset has a unique `@name`
- [ ] Assets appear in library
- [ ] New character variation generated
- [ ] Old character version still exists
- [ ] Previous character version restored
- [ ] Storyboard created
- [ ] Scene prompt created with references
- [ ] References resolved correctly
- [ ] Video clip generated
- [ ] Generated clip appears in asset library
- [ ] Generation history shows prompt/model/seed/settings
- [ ] Candidate can be approved
- [ ] Clip placed on timeline
- [ ] Music track added
- [ ] Draft MP4 exported
- [ ] Export listed in history
- [ ] Timeline snapshot restored
- [ ] Missing media detection works
- [ ] Job cancel/retry works
- [ ] Permissions enforced
- [ ] Diagnostics export works

If this acceptance flow passes repeatedly, the MVP is considered successful.

---

# 31. Implementation Order Recommendation

The recommended implementation order is:

## Step 1: Foundations

- FND-001 through FND-013

## Step 2: Storage, Auth, Projects, Assets

- STO-001 through STO-012
- AUT-001 through AUT-008
- PRJ-001 through PRJ-011
- AST-001 through AST-017

## Step 3: References and Prompts

- REF-001 through REF-010
- PMP-001 through PMP-005

## Step 4: Models and Generation

- MOD-001 through MOD-014
- GEN-001 through GEN-020

## Step 5: Creative Structure

- STB-001 through STB-012
- SCN-001 through SCN-014
- REV-001 through REV-009

## Step 6: Assembly and Export

- TIM-001 through TIM-019
- AUD-001 through AUD-015
- EXP-001 through EXP-013

## Step 7: Hardening

- DIA-001 through DIA-008
- security pass
- performance pass
- accessibility pass
- MVP acceptance test

## Step 8: Professional Expansion

- skills
- templates
- advanced audio
- transitions
- grading
- subtitles
- batch generation
- storage management

## Step 9: Advanced Studio

- 3D
- script parser
- continuity
- AI assistant (executed as Step 10 / Workstream 16)
- advanced render
- optional cloud gateway

## Step 10: LLM Assistant & Model Copilot

- LMA-001 through LMA-003 (LLM endpoint settings, test, one-shot chat)
- LMA-004 through LMA-007 (assist purposes + creative UI)
- LMA-008 through LMA-009 (skill prompt-creation guidance, model-aware context)
- LMA-010 through LMA-012 (HuggingFace catalog + auto-register)
- LMA-013 through LMA-016 (tool harness, agent, ComfyUI helper, copilot UI)

Design: section 37.

---

# 32. Definition of Done

A feature is complete when:

- API and UI work end-to-end
- persistence works
- permission checks are applied
- validation works
- error cases are handled
- tests exist
- docs are updated
- no secrets are exposed
- audit log is updated where relevant
- UI state updates correctly from backend
- generated/provenance metadata is stored
- feature does not break existing milestones
- diagnostics can explain failures

---

# 33. Documentation Plan

Maintain these documents as the implementation progresses:

- `docs/architecture.md`
- `docs/api.md` — replaced by the generated OpenAPI document: `GET /api/v1/openapi.json` (Swagger UI
  at `GET /api/v1/docs`); conventions in `docs/openapi.md`. The spec is derived from the mounted
  routes + per-endpoint `openApiOps` metadata and kept in lockstep by
  `backend/tests/openapi.test.ts`, so no manually maintained API reference is needed.
- `docs/data-model.md`
- `docs/deployment.md`
- `docs/security.md`
- `docs/operations.md`
- `docs/model-adapters.md`
- `docs/skill-format.md`
- `docs/troubleshooting.md`

Each major milestone should update documentation before completion.

---

# 34. Risk Mitigation Plan

## 34.1 Local Video Generation Is Slow

Mitigation:

- short clips
- low-res previews
- image-to-video as preferred path
- proxy review
- job queue visibility
- hardware-aware recommendations

## 34.2 Character Consistency Is Hard

Mitigation:

- character reference system
- character sheets
- style references
- versioning
- review board
- regenerate only selected shots

## 34.3 Storage Grows Quickly

Mitigation:

- content-addressed storage
- proxy workflow
- cache cleanup
- duplicate detection
- storage report
- archive/backup

## 34.4 Model Licensing Is Complex

Mitigation:

- store license per model
- display license clearly
- verify hashes
- prefer reputable sources
- warn on restrictive licenses

## 34.5 Hardware Variance Is High

Mitigation:

- hardware detection
- model health checks
- recommended models per tier
- clear errors
- CPU-only fallback
- configurable defaults

## 34.6 Scope Creep

Mitigation:

- strict MVP boundary
- milestone exit criteria
- defer advanced features
- keep adapter-based design
- avoid hard-coding model families

---

# 35. AI Implementation Protocol

Because this will be implemented by AI, use strict execution rules.

## 35.1 Task Slicing Rules

- One task should change one bounded area.
- Each task must have clear acceptance criteria.
- Do not mix UI, DB, and inference adapter changes unnecessarily.
- Keep migrations separate from feature logic where possible.
- Keep API contracts stable.
- Update tests with every task.

## 35.2 Pull Request Rules

Each change should include:

- code
- tests
- docs update
- migration if needed
- API doc update if needed
- no unrelated refactors
- no secrets
- no unnecessary dependency growth

## 35.3 Stop Conditions

Stop and report if:

- a test cannot be written for the behavior
- a feature requires cloud API access in v1
- a model adapter requires non-local network calls without explicit user consent
- data integrity could be compromised
- a migration could lose data
- a permission bypass is possible
- a feature conflicts with the local-first principle

## 35.4 Preferred AI Build Order

1. Scaffold
2. Storage
3. Auth/permissions
4. Projects
5. Assets
6. Versioning
7. References
8. Model manager
9. Job queue
10. Mock adapter
11. T2I adapter
12. I2V adapter
13. Storyboard
14. Scenes
15. Review
16. Timeline
17. Audio
18. Export
19. Diagnostics
20. Hardening

---

# 36. Final Build Recommendation

The implementation should be treated as a **platform build**, not a demo build.

The most important foundations are:

1. **Content-addressed storage**
2. **Asset versioning**
3. **Reference engine**
4. **Model adapter layer**
5. **Generation job queue**
6. **Storyboard/scene structure**
7. **Timeline editing**
8. **Render/export pipeline**
9. **Version history and snapshots**
10. **Diagnostics and recovery**

If those foundations are built correctly, the product can expand into:

- short films
- music videos
- social videos
- product videos
- experimental AI films
- story-driven content
- local privacy-focused creation
- professional local AI film production

The MVP should be judged by one question:

> Can a user reliably create, generate, version, edit, and export a short AI-assisted movie on
> user-controlled hardware?

If yes, the product core is validated.

---

# 37. LLM Assistant & Model Copilot Design (Workstream 16)

## Purpose

New users face three walls: they do not know how to write good prompts, which models to install, or
how to connect a runtime such as ComfyUI. A local LLM (llama.cpp server, Ollama, LM Studio, vLLM, or
any OpenAI-compatible endpoint) removes those walls: it writes and improves prompts, designs scenes,
and — through a bounded tool harness — looks up model details on HuggingFace and registers/installs
models, with every mutating action explicitly approved by the user.

Local-first rule: the endpoint is always user-controlled. No public cloud LLM services are called by
the app itself.

## Configuration & Transport

- Settings live in `app_settings` (same mechanism as the SMTP settings): `llm_enabled`,
  `llm_base_url`, `llm_api_key`, `llm_model`, `llm_temperature`, `llm_max_tokens`,
  `llm_timeout_seconds`.
- `llm_base_url` is the server root (e.g. `http://127.0.0.1:11434/v1` for Ollama,
  `http://127.0.0.1:8080/v1` for llama.cpp). The client POSTs to `{base_url}/chat/completions` — the
  OpenAI-compatible shape, which all supported runners expose. `Authorization: Bearer <key>` is sent
  only when a key is set.
- All LLM calls are **synchronous and bounded** (default timeout 60 s, configurable). They are not
  queued jobs: the user is waiting, and a hung local runner should fail fast and loudly. Media
  generation stays in the job queue.
- Error mapping: not configured → `503 LLM_NOT_CONFIGURED`; network failure → `502 LLM_UNREACHABLE`;
  401/403 → `502 LLM_AUTH_FAILED`; 404 → `502 LLM_MODEL_NOT_FOUND`; timeout → `504 LLM_TIMEOUT`;
  non-JSON/unexpected → `502 LLM_BAD_RESPONSE`.
- The API key is never returned: `GET /api/v1/llm/settings` exposes `api_key_set` only; `PUT`
  accepts a new key string or `null` to clear. A `GET /api/v1/llm/status` (any authenticated user)
  returns `{configured: boolean}` so the creative UIs can enable/disable their AI buttons without
  admin rights.

## Assist purposes

`POST /api/v1/llm/assist` takes `{purpose, context, model_id?, skill_id?, max_tokens?}`:

- `write_script` — context is a movie idea/outline; the system prompt makes the model answer with
  Fountain-lite only (scene headings `INT./EXT. … - TIME`, action, character names in caps,
  dialogue). The output is directly pasteable into the scene-list script import.
- `design_scene` — context is a story beat/panel summary; the system prompt fixes the answer shape:
  Overview, Mood & Tone, numbered Shots (description, camera, movement, duration), Lighting, Time of
  day, Dialogue.
- `enhance_prompt` — context is the current prompt; with `model_id` the model's metadata (name, task
  types, known limitations, default settings) is injected into the system prompt; with `skill_id`
  the skill's assistant block (below) is injected. Existing `@reference` tokens must survive
  verbatim (the system prompt enforces this; a post-check strips any lost refs back in).

System prompts live in `services/llm_assist.ts` as versioned constants.

## Skills as prompt knowledge

A skill definition may carry an optional `assistant` block:

```json
"assistant": {
  "model_task_types": ["text_to_video"],
  "guidance": "How to write prompts for this model family: motion verbs, camera language,
               what to avoid, style keywords that work…",
  "examples": [ { "prompt": "…", "notes": "why this works" } ]
}
```

- Validation: `guidance` ≤ 4000 chars; `examples` ≤ 8 (each `prompt` ≤ 2000, `notes` ≤ 500);
  `model_task_types` a non-empty subset of known task types when present.
- Skills with an `assistant` block are "prompt-creation skills" — e.g. one per T2V model family with
  the vocabulary that model responds to.
- `GET /api/v1/skills?assistant=1` lists them for the assist dialog's picker.
- Assist with `skill_id` + `model_id`: the skill's task types must overlap the model's (400 with a
  precise message otherwise). A seeded system skill `sys-t2v-prompting` provides general
  text-to-video prompting guidance out of the box.

## HuggingFace catalog

`services/huggingface.ts` proxies the **public** HuggingFace REST API server-side
(`https://huggingface.co/api/models…`, no token required for public reads, 15 s timeout):

- `GET /api/v1/models/huggingface/search?q=&filter=&limit=` → normalized
  `{id, likes, downloads, pipeline_tag, tags, license}` per repo.
- `GET /api/v1/models/huggingface/:repoId` → repo metadata + file listing with sizes (`/tree/main`).
- `POST /api/v1/models/from-huggingface` (admin) —
  `{repo_id, file?, backend?, task_types?,
  name?, version?, min_vram_mb?, dependencies?, known_limitations?}`:
  fetches the file listing, picks the weight file (explicit `file` or heuristic: largest file among
  `.safetensors` / `.gguf` / `.ckpt` / `.bin`), and registers a model row with `source: "url"`,
  `file_url` = `https://huggingface.co/<repo>/resolve/main/<file>`, `repository_url` = the repo
  page. Weights are **not** downloaded here — the normal consent-gated `POST /:id/install` flow does
  that. `409` when the slugified id already exists; `400` when no usable weight file is found.

The Models page gets a "Browse HuggingFace" panel (search → results → file picker → Register), so a
new user can go from "I want a good image model" to an installed model in three clicks.

## Tool harness & Model Copilot

The LLM can call named tools through OpenAI-style function calling in a bounded loop
(`POST /api/v1/llm/agent`, max 8 tool iterations):

- **Read-only tools (auto-execute):** `list_models`, `model_info`, `list_skills`,
  `huggingface_search`, `huggingface_model_info`, `comfyui_status` (GETs the endpoint's
  `/system_stats`: queue, devices, VRAM).
- **Mutating tools (admin-only, never auto-execute):** `register_model`,
  `register_model_from_huggingface`, `install_model`, `remove_model`. When the model calls one, the
  harness records a **proposal** (in-memory, 1 h TTL: tool + exact args), tells the model "proposal
  `X` created — ask the user to approve it in the UI", and the final response returns the proposals
  to the client. The UI renders a proposal card with Approve/Reject; approve executes the stored
  call (re-checking admin + validation) and feeds the result back to the user.
- Non-admin users only see read-only tools in the schema, so the copilot degrades to a consultant
  for them.
- The copilot system prompt includes the live context: number of registered models, which task types
  are covered, whether the LLM itself is the only configured model, etc.

**ComfyUI helper:** the same harness covers connecting ComfyUI — the user pastes the endpoint, the
copilot probes `/system_stats`, reports what it sees, and proposes a comfyui-backend model row
(endpoint in `default_settings`, workflow JSON in `workflow_json`) for approval.

## Frontend

- **Models page** (no new route; three new sections under `model-manager`):
  - _LLM Assistant_ panel (admin edits; everyone sees a configured/not chip): base URL, model, API
    key (blank = keep), temperature, max tokens, timeout, enable, Save + Test connection.
  - _Browse HuggingFace_ panel: search, results, file picker, Register.
  - _Model Copilot_ panel (admin): chat box, tool-call activity, proposal cards.
- **AI-assist dialog** (new shared component, `ai-assist-dialog.js`): purpose-specific context
  field(s), optional model + skill pickers for `enhance_prompt`, Run, result with Copy / Insert.
  Wired into the prompt editor (enhance), scene-list import dialog (write script), and scene detail
  (design scene / shot prompts). Buttons disable with a tooltip when `GET /api/v1/llm/status`
  reports unconfigured.

## Tests

- LLM client against an in-process fake OpenAI server (`Deno.serve`): success, tool calls, 401/404,
  timeout, bad JSON.
- Settings store round-trip + key masking.
- Route tests: settings masking, status, chat 503/success, assist purpose validation +
  ref-preservation post-check, agent loop (read-only auto-execution, mutating → proposal,
  approve/reject lifecycle, non-admin tool visibility).
- HuggingFace client against a fake HF server (search mapping, repo, tree) + from-huggingface
  register (success, 409, no-weight-file 400).
- Skill definition validation for the `assistant` block.

## Documentation

- `docs/llm.md` — full contract (settings keys, error codes, purposes, agent/proposals, tools,
  HuggingFace behavior).
- `docs/models.md` — HuggingFace browse + auto-register section.
- `docs/skills.md` — assistant block section.

## Non-goals (v1)

- No streaming responses; history is per-request (the UI keeps the visible thread).
- No persistent multi-session memory; proposals are in-memory (TTL 1 h, lost on restart).
- No arbitrary code execution; no mutating tool without explicit approval.
- No public cloud LLM endpoints by design (the user points the app at their runner).

---

# 38. MCP Tool Servers (Workstream 17)

Contract doc: `docs/mcp.md`. This section is the design overview.

## 38.1 Purpose

The Model Copilot (section 37) is a bounded tool-calling loop over a closed set of built-in tools.
MCP (Model Context Protocol) is the emerging open standard for giving LLMs tools from external
servers. Making the copilot an MCP **client** lets the app consume any MCP tool server — spawned
locally (stdio) or running elsewhere (Streamable HTTP) — with zero per-server code, while keeping
the copilot's core safety property: nothing that mutates runs without explicit approval.

## 38.2 Transports & dependencies

- `stdio`: the backend spawns `command` + `args` (argv array, no shell) with `env` merged over the
  app environment, and speaks newline-delimited JSON-RPC on its pipes. This is an explicit admin
  action — arbitrary process spawn on the host — and is audit-logged.
- `http`: MCP Streamable HTTP (JSON-RPC POST, optional static headers for auth). The deprecated
  legacy SSE transport is out of scope.
- Dependency: `npm:@modelcontextprotocol/sdk` (≥ 1.30) + peer `npm:zod` in `backend/deno.json`. The
  SDK's stdio transport uses `node:child_process`, which Deno 2.9.5 supports (verified by spike:
  connect, `listTools`, `callTool`).

## 38.3 Registry (`mcp_servers`)

Admin-managed rows (migration `0029`): id (slug), name, description, transport, command/args_json/
env_json (stdio), url/headers_json (http), timeout_seconds (5–3600, default 120), enabled,
auto_approve, created_by, timestamps. Header values (potential secrets) are masked in GET views
(`header_names` + `headers_set`), matching the `llm_api_key` pattern.

## 38.4 Client service (`services/mcp.ts`)

Per-server in-memory connection manager: lazy connect, reconnect-on-next-use after failure, 60 s
tool-catalog cache (forced refresh on test/config change), per-server call serialization (stdio is
one session), per-call timeout from the row. One failing server is isolated: the catalog reports its
`state: error` + `last_error` and the remaining servers still contribute tools.

Qualified names `mcp__<server_id>__<tool_name>` keep the tool namespace collision-free (both MCP and
OpenAI function names are `[a-zA-Z0-9_-]{1,64}`); over-long names are dropped with a warning. MCP
`inputSchema` passes through as the function's `parameters`; `callTool` results convert
`structuredContent` (preferred) or joined text blocks (non-text blocks → `[<type>]` placeholders),
`isError` fails the step, and the agent's existing 8000-char result cap applies. `mcpCloseAll()`
runs from new SIGTERM/SIGINT handlers in `server.ts`; delete/disable close immediately.

## 38.5 Agent integration (`services/llm_agent.ts`)

- `agentToolDefs(isAdmin)` = built-in tools + MCP catalog (skipping failed servers).
- Classification mirrors the built-in split: **auto-execute** when the server has `auto_approve` or
  the tool's annotations carry `readOnlyHint: true`; otherwise **mutating** → approval proposal
  (dedupe, in-flight single-flight, auto-continue follow-ups: all unchanged). Non-admins only see
  auto-executing MCP tools in the schema, like built-in mutating tools.
- `AgentProposal.tool` generalizes from the closed `AgentToolName` union to `string` (`mcp__…` names
  included); proposal storage, TTL, and the OpenAPI `LlmProposal.tool` enum (relaxed to an open
  string) adjust accordingly.
- System prompt gains a compact live MCP section (servers + qualified tools + one-line
  descriptions + the approval rule); full schemas ride in the `tools` array.
- MCP calls count against the existing 16-iteration cap; conversation logging records MCP steps and
  approvals verbatim.

## 38.6 UI

Models page, below the LLM Assistant panel: admin-only "MCP Servers" panel — rows (name,
transport/status chips, tool count, description), add/edit form (transport-conditional fields,
`auto_approve` warning), Test connection (save-then-test pattern), enable toggle, delete
(confirm-dialog), expandable per-server tool list (read-only chips). Copilot chat: steps and
proposal cards for `mcp__…` tools show an `MCP: <server>` badge; the existing Approve/Reject and
auto-continue flow is unchanged.

## 38.7 Security & limits

Management is admin-only + audit-logged. Gating defaults to safe (read-only hint or explicit
per-server `auto_approve` for auto-execution; everything else costs an approval). The app never
initiates MCP sampling and does not expose MCP resources/prompts — tools only. Limits: name ≤ 64
chars, description ≤ 500 chars, timeout 5–3600 s, tool JSON schema ≤ 16 KB (larger tools are dropped
with a warning), qualified tool name ≤ 64 chars.
