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
| POST   | `/api/v1/models/:id/benchmark`    | Enqueue a benchmark job (202 → `{ job_id, tasks, seed }`)      |
| GET    | `/api/v1/models/:id/benchmarks`   | Benchmark results, newest first (latest 20)                    |

Read endpoints and benchmarks accept any authenticated user (both are measurements only, no assets
are written); mutations (register/patch/delete/install) require the admin role. Everything is
written to `audit_logs` (entity type `model`).

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
- **Hardware detection** (`detectHardware` in `services/hardware.ts`): platform, CPU count, and
  total RAM come from `/proc` (Linux) or `sysctl` (macOS); the GPU is detected via
  `nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version,cuda_version` (3s timeout,
  first GPU on multi-GPU hosts). Memory fields are unit-aware (`MiB` is the nvidia-smi default),
  e.g. `97871 MiB` → `vram_mb: 97871`. The GPU object is
  `{ vendor, model, vram_mb, vram_used_mb, driver_version, cuda_version }` with every field null
  when undetectable — both the models hardware endpoint and the diagnostics hardware report
  (DIA-001) return this same object, so the UIs must use these exact keys.
- **Requirement warnings**: each enabled model is compared against detected hardware (VRAM / total
  RAM / missing dependencies) and reported by `/api/v1/models/hardware`.
- **Disable**: disabled models are excluded from task-mapping lookups, so the generation pipeline
  will never pick them.
- **Benchmark** (`model_benchmark.ts`, job type `model_benchmark`): a deterministic performance
  measurement for comparison between models/machines. Each run generates
  `BENCHMARK_CANDIDATES =
  2` candidates per benchmarkable task type with a fixed prompt per task
  (e.g. "A lighthouse on a cliff at dusk…" for `text_to_image`) under job seed `bench-<model_id>`,
  and records one `model_benchmarks` row per task: `duration_ms`, `candidate_count`, `output_bytes`.
  Rows are measurement metadata only — candidates are never stored as assets.
  - Benchmarkable tasks (input-less): `text_to_image`, `text_to_video`, `audio`, `music`, `voice`.
    `image_to_image`, `image_to_video`, and `transcribe` need a source asset and are excluded in v1.
  - The request rejects (400) models that are not installed, disabled, or without a benchmarkable
    task; each task runs through the model's normal adapter, so cancellation mid-run propagates to
    the runner and the job settles `cancelled`.
  - Removing a model deletes its benchmark rows (explicit cleanup — SQLite FK enforcement is off).
  - The model-manager UI shows a Benchmark button per model and a per-task results table (latest
    runs first), polling the job to a terminal state before refreshing.

## Real adapters (GEN-009/010)

`mock` simulates generation; `local_cli` and `comfyui` run real generation. A job executes through
the adapter registered for the picked model's backend (`getAdapter` in `services/adapters.ts`). The
job runner resolves the job's input asset files, merges the model's `default_settings` into the job
settings, and passes a scratch working directory (a content-store cache area; adapters write
UUID-named temp files there) — adapters receive a ready context and return candidate bytes.
`local_http` is still unimplemented (jobs for such models fail with "No adapter registered").

Shared setting: `candidates` (number, 1–8, default 1) — one candidate per adapter pass.

### local_cli

Runs a user-configured command, once per candidate:

| `default_settings` key | Type        | Description                                                                                                                                                 |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`              | string, req | Executable name or absolute path                                                                                                                            |
| `args`                 | string[]    | Argument templates; one entry must contain `{output}`                                                                                                       |
| `timeout_seconds`      | number      | Default 600, clamped 1–6h; on timeout the child is SIGKILLed and the pipes drain for a 2s grace (orphaned grandchildren may hold them) before the job fails |
| `env`                  | string map  | Extra env vars; the server env is inherited                                                                                                                 |
| `output_extension`     | string      | Default derived from the job type                                                                                                                           |

`args` placeholders: `{prompt}`, `{seed}`, `{candidate}`, `{count}`, `{output}`, and `{input:<i>}`
(absolute path of the i-th input file; out-of-range references fail the job before spawning). Each
candidate is written to a temp file in the job's working directory, read back as the candidate
bytes, then removed. A non-zero exit fails the job with the last 1500 chars of stderr (stdout as
fallback). Cancellation kills the child between candidates.

Example:

```json
{
  "command": "/usr/local/bin/comfy-cli",
  "args": ["--prompt", "{prompt}", "--seed", "{seed}", "--image", "{input:0}", "--out", "{output}"],
  "timeout_seconds": 900,
  "env": { "CUDA_VISIBLE_DEVICES": "0" },
  "candidates": 2
}
```

### comfyui

Submits a workflow graph to a local ComfyUI server:

| `default_settings` key | Type        | Description                                                      |
| ---------------------- | ----------- | ---------------------------------------------------------------- |
| `endpoint`             | string, req | e.g. `http://127.0.0.1:8188`                                     |
| `workflow`             | object, req | ComfyUI prompt graph (node map)                                  |
| `timeout_seconds`      | number      | Default 600, clamped 1–6h; on timeout `POST /interrupt` and fail |

Placeholders in workflow string values: `{{prompt}}`, `{{seed}}` (coerced to a number when the whole
value is numeric), and `{{input:<i>}}`. Referenced inputs are uploaded first via
`POST /upload/image` (unique filename, `overwrite=true`) and the returned name is substituted. The
adapter then submits `POST /prompt` with a unique `client_id`, polls `GET /history/<prompt_id>`
every second, surfaces `execution_error` details from the entry status, collects every
`images`/`gifs`/`videos` file ref from the node outputs, and downloads each through `GET /view`. An
unreachable server, a rejected prompt, and a run with zero outputs all fail the job; cancellation
issues `POST /interrupt`.
