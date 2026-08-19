# Project State - CinemaItor

## Current Status: Milestone 1 complete, Milestone 2 in progress

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

### In Progress

- [ ] Frontend: wire the asset library and project views to the `/api/v1` endpoints

### Planned (next work packages per MASTER-PLAN.md)

- [ ] Workstream 6: Model manager (registry, install, health checks)
- [ ] Workstream 7: Generation pipeline (job queue, adapters, mock first)
- [ ] Thumbnails/proxies/waveforms via FFmpeg (STO-007..009)
- [ ] E2E tests, Docker packaging, production hardening

### Known Issues

- [ ] Upload bodies are buffered by the runtime parser (no chunked streaming yet)
- [ ] No rate limiting on auth endpoints
- [ ] Frontend still uses the legacy `movies` API surface for the demo views

### Version

- Reference engine + prompt versioning: Wed Aug 19 2026
