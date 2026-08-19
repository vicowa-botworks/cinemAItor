# Project State - CinemaItor

## Current Status: Milestone 1 (Storage, Auth, Projects, Assets) - complete

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

### In Progress

- [ ] Frontend: wire the asset library and project views to the `/api/v1` endpoints

### Planned (next work packages per MASTER-PLAN.md)

- [ ] Workstream 5: Reference engine (`@asset` parsing/resolution, roles, audit, repair) and prompt
      versioning
- [ ] Workstream 6: Model manager (registry, install, health checks)
- [ ] Workstream 7: Generation pipeline (job queue, adapters, mock first)
- [ ] Thumbnails/proxies/waveforms via FFmpeg (STO-007..009)
- [ ] E2E tests, Docker packaging, production hardening

### Known Issues

- [ ] Upload bodies are buffered by the runtime parser (no chunked streaming yet)
- [ ] No rate limiting on auth endpoints
- [ ] Frontend still uses the legacy `movies` API surface for the demo views

### Version

- Asset library: Tue Aug 18 2026
