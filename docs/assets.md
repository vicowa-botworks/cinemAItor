# Assets

Assets are the versioned, content-addressed media units of the studio. Every asset has a globally
unique `@name` (its slug) plus optional aliases, tags, and a list of immutable versions. The
"active" version is a pointer, not a copy: generating, uploading, or restoring only moves pointers
and audit logs.

## Naming

- Primary slugs and aliases live in one global namespace: `@person`, `@room`, `@table`, ...
- Slugs match `[a-z0-9][a-z0-9_]{0,63}` and are immutable after creation (aliases can change without
  breaking names).
- Duplicates are rejected with a `CONFLICT` error.

## Scoping

- `global` - shared library, no project.
- `project` - tied to a project; the creator must have `write` permission on it.
- Access: the asset creator owns it, admin-role users always pass, project-scoped assets inherit the
  project's permission rank, and explicit rows in `asset_permissions` apply in addition (highest
  rank wins).

## Versions

- Each version stores `content_hash`, stored file path, format, MIME type, size, checksum algorithm,
  technical metadata, and notes.
- Uploading or registering a new version makes it active and preview by default.
- `restore` re-points the active/preview pointers at an older version; stored files are never
  mutated.
- Versions are immutable.

## Proxies

- Every version of a video, image, or audio asset can carry a **proxy**: a small, fast-transcoded
  copy used by draft renders and quick previews. `asset_versions.proxy_path` stores it.
- Proxies are generated asynchronously as `proxy` generation jobs (model-less jobs dispatched by the
  normal job runner): uploading or registering a version queues one automatically.
- Generation uses ffmpeg when available (`FFMPEG_PATH`), transcoding to a compact container (720p
  H.264 + AAC for video, 320px JPEG for images, 128 kbps MP3 for audio). The scratch output carries
  the target extension — ffmpeg infers the output format from the file name — and a failed transcode
  surfaces ffmpeg's stderr in the job error. Without ffmpeg a deterministic mock proxy is written
  instead, so the workflow degrades gracefully.
- `POST .../proxy` regenerates a version's proxy (a fresh job, re-linking `proxy_path` on success);
  `GET .../proxy` streams the proxy file (404 until the job has produced one).

## Thumbnails

- `GET .../thumbnail` generates a small JPEG of a version for quick visual previews (the timeline
  editor's film strips):
  - **Video**: one frame at `?at=<seconds>` (default `0`), input-seeked (`-ss` before `-i`) so any
    seek point costs the same sub-second extraction; the request time is quantized to 100 ms.
  - **Image**: scaled down to `?w=<width>` px (clamped 64..1280, default 320, height kept
    proportional via `force_original_aspect_ratio=decrease` plus the `-2` even-dimension rule).
- Output is cached at `appDataDir/assets/thumbnails/<version>-<at>-<w>.jpg` (same root as the
  content store, `APP_DATA_DIR`), so a repeated request for the same frame and width is a `stat`
  plus a file read — no ffmpeg re-run; responses carry `cache-control: private, max-age=86400`.
- Errors: `404` for audio versions (no image to show) and versions without a stored file, `400` for
  a negative/non-numeric `at`, `503` when ffmpeg is unavailable (`FFMPEG_PATH`/PATH probe), `502`
  when the extraction itself fails (ffmpeg stderr in the error details; generation is force-killed
  after 30 s). Generated thumbnails carry no provenance row — they are derived, not uploaded, files.

## Endpoints

| Method | Endpoint                                           | Description                                                     |
| ------ | -------------------------------------------------- | --------------------------------------------------------------- |
| GET    | `/api/v1/assets`                                   | List assets (filter + search)                                   |
| POST   | `/api/v1/assets`                                   | Create an asset                                                 |
| GET    | `/api/v1/assets/:id`                               | Asset detail (aliases, tags, active v.)                         |
| PATCH  | `/api/v1/assets/:id`                               | Update metadata or status                                       |
| DELETE | `/api/v1/assets/:id`                               | Soft-delete (with reference warnings)                           |
| POST   | `/api/v1/assets/:id/upload`                        | Multipart upload, creates a version                             |
| GET    | `/api/v1/assets/:id/versions`                      | List versions (newest first)                                    |
| POST   | `/api/v1/assets/:id/versions`                      | Register a version from a stored hash                           |
| GET    | `/api/v1/assets/:id/versions/:versionId`           | Get one version                                                 |
| POST   | `/api/v1/assets/:id/versions/:versionId/restore`   | Restore an older version                                        |
| GET    | `/api/v1/assets/:id/versions/:versionId/proxy`     | Stream the version's proxy file                                 |
| GET    | `/api/v1/assets/:id/versions/:versionId/thumbnail` | Cached JPEG thumbnail (`?at=`, `?w=`) for video frames / images |
| POST   | `/api/v1/assets/:id/versions/:versionId/proxy`     | Regenerate the version's proxy (fresh job)                      |
| POST   | `/api/v1/assets/:id/aliases`                       | Add an alias `@name`                                            |
| DELETE | `/api/v1/assets/:id/aliases/:aliasSlug`            | Remove an alias                                                 |
| POST   | `/api/v1/assets/:id/tags`                          | Add a tag                                                       |
| DELETE | `/api/v1/assets/:id/tags/:tag`                     | Remove a tag                                                    |
| GET    | `/api/v1/assets/:id/preview`                       | Stream the active version's file                                |

List filters (query params): `project_id`, `library_scope`, `asset_type`, `status`, `tag`, and `q`
(case-insensitive match on slug, display name, and description).

## Behavior

- Uploaded files are streamed through the content store: hashed, deduplicated, and atomically placed
  under `app_data/media` (see `docs/storage.md`).
- Uploads are bounded by `UPLOAD_MAX_SIZE` (default 2 GiB).
- `DELETE` marks the asset `deleted` (soft delete) and reports how many references now dangle; rows
  are kept for audit history.
- Create, update, delete, version, alias, and tag actions are written to `audit_logs`.
- Preview responses stream the stored file with the version's MIME type.
- Proxy jobs run on the CPU lane; `GET /api/v1/jobs?job_type=proxy` lists them.
