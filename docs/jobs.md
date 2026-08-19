# Generation Pipeline (Jobs)

Generation requests run as background jobs: a durable queue in SQLite, an in-process runner with
leases, and model runtimes behind a common adapter interface.

## Concepts

- **Job** (`generation_jobs`): one generation request. Carries job type, model, prompt, seed,
  settings (JSON), input asset versions, reference roles, status, progress, error, and the ids of
  what it produced.
- **Job event** (`job_events`): append-only log per job (`created`, `claimed`, `started`,
  `progress`, `candidate.created`, `succeeded`, `failed`, `cancelled`, `retried`, `recovered`).
- **Statuses**: `queued` -> `running` -> `succeeded` | `failed` | `cancelled` (cancelling a running
  job goes through `cancelling` first).
- **Adapter interface** (GEN-007): `backend/src/services/adapters.ts` defines
  `ModelAdapter.generate(input, hooks)`. The runner never touches runtimes directly. The **mock
  adapter** produces deterministic pseudo-output (seeded, per candidate) so development and tests
  run without model binaries. Unknown backends fail the job with a clear error until an adapter is
  registered.

## Endpoints

| Method | Endpoint                  | Description                                                |
| ------ | ------------------------- | ---------------------------------------------------------- |
| GET    | `/api/v1/jobs`            | List (filter: `status`, `project_id`, `model_id`, `limit`) |
| POST   | `/api/v1/jobs`            | Create a queued job                                        |
| GET    | `/api/v1/jobs/:id`        | Job detail                                                 |
| POST   | `/api/v1/jobs/:id/cancel` | Cancel queued (immediate) or running (graceful)            |
| POST   | `/api/v1/jobs/:id/retry`  | Re-queue a finished job (input state preserved)            |
| GET    | `/api/v1/jobs/:id/events` | Event log for the job                                      |

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
- Candidates are stored through the content store and registered as asset versions of the target
  asset (or a newly created `gen_*` asset when none is given). The last candidate becomes the active
  version.
- **Provenance** (GEN-015): each candidate version stores `technical_metadata_json` with job
  id/type, model id/name/version/backend, prompt, negative prompt, seed used, settings, input
  versions, request context, and candidate index/count.

## Notes

- Live push updates (WebSocket `/ws/v1/jobs`) are a follow-up; clients poll the job and its events
  endpoints in the meantime.
