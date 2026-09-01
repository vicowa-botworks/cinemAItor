# Generation Pipeline (Jobs)

Generation requests run as background jobs: a durable queue in SQLite, an in-process runner with
leases, and model runtimes behind a common adapter interface.

## Concepts

- **Job** (`generation_jobs`): one generation request. Carries job type, model, prompt, seed,
  settings (JSON), input asset versions, reference roles, status, progress, error, and the ids of
  what it produced.
- **Job event** (`job_events`): append-only log per job (`created`, `claimed`, `started`,
  `progress`, `runner.log`, `candidate.created`, `succeeded`, `failed`, `cancelled`, `retried`,
  `recovered`).
- **Statuses**: `queued` -> `running` -> `succeeded` | `failed` | `cancelled` (cancelling a running
  job goes through `cancelling` first).
- **Adapter interface** (GEN-007): `backend/src/services/adapters.ts` defines
  `ModelAdapter.generate(input, hooks)`. The runner never touches runtimes directly. The **mock
  adapter** produces deterministic pseudo-output (seeded, per candidate) so development and tests
  run without model binaries. **local_cli** (GEN-009) runs a user-configured command per candidate
  and **comfyui** (GEN-010) submits a workflow to a local ComfyUI server — both are driven by the
  model's `default_settings` (see `docs/models.md` "Real adapters"). The runner resolves the job's
  input asset files, merges `default_settings` into the job settings, and passes a per-job working
  directory before invoking the adapter. Unknown backends fail the job with a clear error until an
  adapter is registered.

## Endpoints

| Method   | Endpoint                  | Description                                                |
| -------- | ------------------------- | ---------------------------------------------------------- |
| GET      | `/api/v1/jobs`            | List (filter: `status`, `project_id`, `model_id`, `limit`) |
| POST     | `/api/v1/jobs`            | Create a queued job                                        |
| GET      | `/api/v1/jobs/:id`        | Job detail                                                 |
| POST     | `/api/v1/jobs/:id/cancel` | Cancel queued (immediate) or running (graceful)            |
| POST     | `/api/v1/jobs/:id/retry`  | Re-queue a finished job (input state preserved)            |
| GET      | `/api/v1/jobs/:id/events` | Event log for the job                                      |
| GET (WS) | `/ws/v1/jobs`             | Live job/render updates (WebSocket, see below)             |

Creation validates the model: it must exist, be **enabled**, and its task types must include the
requested `job_type`. Target/input asset permissions are checked too. `prompt_text` is required
except for image-input tasks.

## Runner behavior

- Polls the queue; claims the oldest queued job with a lease (owner + expiry).
- Concurrency: one GPU job at a time by default (`JOB_CONCURRENCY_GPU`), mock jobs use
  `JOB_CONCURRENCY_CPU`.
- Progress callbacks update the job row and append events; cancellation is observed between adapter
  stages.
- **Recovery** (GEN-017): on startup (and on each tick) jobs still marked running whose lease
  expired are re-queued with a `recovered` event.
- **Runner status lines**: a local_cli command may print `RUNNER_STATUS {"key": value}` lines to
  stdout (e.g. the device a long generation runs on:
  `RUNNER_STATUS {"device":"cuda","free_vram_gib":95.1}`). Each line is forwarded live as a
  `runner.log` job event formatted as `key=value, ...`, so the job card reports runtime state while
  the CLI is still running.
- **Device env for local_cli**: the adapter injects `RUNNER_DEVICE` (`cpu`/`cuda`) when the job
  settings carry a user-chosen device (from the pre-generation VRAM check) and
  `RUNNER_MIN_FREE_VRAM_MB` when the model declares a `vram_requirement_mb` — so a runner's auto
  CPU/GPU fallback threshold matches the UI's check. An explicit `settings.env` entry always wins
  over both.
- **Seeds are strings**: the `{seed}` placeholder is rendered verbatim — benchmark jobs pass
  `bench-<model-id>` and per-candidate seeds derive as `<seed>:<index>` for non-numeric seeds.
  Runner scripts must accept arbitrary seed strings (numeric ones pass through unchanged; runtimes
  typically hash non-numeric ones deterministically into their integer RNG seed).
- Candidates are stored through the content store and registered as asset versions of the target
  asset (or a newly created `gen_*` asset when none is given). The last candidate becomes the active
  version.
- **Provenance** (GEN-015): each candidate version stores `technical_metadata_json` with job
  id/type, model id/name/version/backend, prompt, negative prompt, seed used, settings, input
  versions, request context, and candidate index/count.

## Live updates (WebSocket)

`GET /ws/v1/jobs` upgrades to a WebSocket that pushes job and render updates to connected clients.

- **Auth**: browsers cannot set the `Authorization` header on a WebSocket handshake, so the bearer
  token is passed as `?token=...` and verified through the same path as the auth middleware (JWT
  signature + expiry, active user, unrevoked session). A failed handshake returns `401` before the
  upgrade.
- **Messages** (JSON, one object per frame):
  - `{ "kind": "progress", jobId, progress }` — generation job progress (0-100)
  - `{ "kind": "status", jobId, status }` — generation job transition (`queued` / `running` /
    `succeeded` / `failed` / `cancelled`)
  - `{ "kind": "progress", renderId, progress }` — render job progress
  - `{ "kind": "status", renderId, status }` — render job transition
- **Source**: events are emitted from the job/render store write paths (`createJob`, `claimJob`,
  `updateJobProgress`, `finishJob`, `retryJob`, `recoverStaleJobs`, and the render equivalents), so
  every transition is pushed exactly once regardless of which code path performed it.
- **Scope**: one shared in-process broadcast per server; connections are read-only (inbound frames
  are ignored) and no messages are buffered for absent subscribers. A single instance is expected,
  so a multi-process deployment would need a fan-out mechanism (e.g. pub/sub) added.
- **Client side** (`frontend/src/job-events.js`): a small shared client multiplexes one socket
  across all mounted consumers (job monitor, timeline render panel), authenticates with the stored
  token, reconnects with exponential backoff (1 s base, 30 s cap) while any listener is subscribed,
  and closes the socket when the last consumer unmounts. Consumers keep their 2-3 second polling as
  a fallback: progress frames patch the local list in place, status frames trigger a full refresh so
  filters and detail fields stay consistent.
