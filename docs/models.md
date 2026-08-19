# Model Manager

Registry of local generation models: metadata, install/verify/remove, enable/disable, health checks,
task mapping, hardware detection, and requirement warnings.

## Concepts

- A **model** is metadata plus an optional installed artifact. Artifacts live at
  `<app_data>/models/<model_id>/model.bin`.
- **Backends**: `mock` (simulated runtime, no file needed), `local_cli`, `comfyui`, `local_http`.
- **Sources**: `local` (copy a file into the store), `url` (download, explicit consent), `mock` (no
  artifact).
- **Task types**: `text_to_image`, `image_to_image`, `image_to_video`, `text_to_video`, `audio`,
  `music`, `voice`.

## Endpoints

| Method | Endpoint                          | Description                                                    |
| ------ | --------------------------------- | -------------------------------------------------------------- |
| GET    | `/api/v1/models`                  | List (filter: `enabled`, `task_type`, `query`)                 |
| POST   | `/api/v1/models`                  | Register metadata (admin)                                      |
| GET    | `/api/v1/models/hardware`         | Detected hardware + requirement warnings for enabled models    |
| GET    | `/api/v1/models/:id`              | One model                                                      |
| PATCH  | `/api/v1/models/:id`              | Update metadata / enable / disable (admin)                     |
| DELETE | `/api/v1/models/:id`              | Remove model + installed files (admin)                         |
| POST   | `/api/v1/models/:id/install`      | Install artifact (admin); network sources need `consent: true` |
| POST   | `/api/v1/models/:id/verify`       | SHA-256 checksum of installed file vs stored hash              |
| POST   | `/api/v1/models/:id/health-check` | Install state, checksum, runtime availability                  |

Read endpoints accept any authenticated user; mutations (register/patch/delete/install) require the
admin role. Everything is written to `audit_logs` (entity type `model`).

## Behavior

- **Install**: copies/downloads the source into the store, computes SHA-256, stores `file_hash` +
  `installed_at`. URL installs also enforce a size limit (`UPLOAD_MAX_SIZE` bytes).
- **Verify**: re-hashes the installed file and compares to the stored hash; when no hash was stored
  yet, verify records the current hash.
- **Health check** per backend:
  - `mock` → always ok (simulated).
  - `local_cli` → file exists + checksum ok + all `dependencies` resolvable on `PATH`.
  - `comfyui` / `local_http` → file exists + checksum ok + (if `default_settings.endpoint` is set)
    the endpoint answers. Result is persisted (`health_status`, `health_error`,
    `health_checked_at`).
- **Requirement warnings**: each enabled model is compared against detected hardware (VRAM / total
  RAM / missing dependencies) and reported by `/api/v1/models/hardware`.
- **Disable**: disabled models are excluded from task-mapping lookups, so the generation pipeline
  will never pick them.
