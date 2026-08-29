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

| Method | Endpoint                                   | Description                                                                  |
| ------ | ------------------------------------------ | ---------------------------------------------------------------------------- |
| GET    | `/api/v1/models`                           | List (filter: `enabled`, `task_type`, `query`)                               |
| POST   | `/api/v1/models`                           | Register metadata (admin)                                                    |
| GET    | `/api/v1/models/hardware`                  | Detected hardware + requirement warnings for enabled models                  |
| GET    | `/api/v1/models/huggingface/search`        | Search the public HuggingFace catalog (`?q=&filter=&limit=`)                 |
| GET    | `/api/v1/models/huggingface/:repoId`       | Repo metadata + recursive file listing + README (`:repoId` = `owner%2Fname`) |
| GET    | `/api/v1/models/huggingface/settings`      | HF token status, masked (`{tokenSet, tokenSource}`) (admin)                  |
| PATCH  | `/api/v1/models/huggingface/settings`      | Store or clear the HF token (`{token}`) (admin)                              |
| POST   | `/api/v1/models/huggingface/settings/test` | Validate the effective token via HF `/whoami-v2` (admin)                     |
| POST   | `/api/v1/models/from-huggingface`          | Register a model straight from an HF repo (admin)                            |
| GET    | `/api/v1/models/:id`                       | One model                                                                    |
| PATCH  | `/api/v1/models/:id`                       | Update metadata / enable / disable (admin)                                   |
| DELETE | `/api/v1/models/:id`                       | Remove model + installed files (admin)                                       |
| POST   | `/api/v1/models/:id/install`               | Install artifact (admin); network sources need `consent: true`               |
| POST   | `/api/v1/models/:id/verify`                | SHA-256 checksum of installed file vs stored hash                            |
| POST   | `/api/v1/models/:id/health-check`          | Install state, checksum, runtime availability                                |
| POST   | `/api/v1/models/:id/benchmark`             | Enqueue a benchmark job (202 → `{ job_id, tasks, seed }`)                    |
| GET    | `/api/v1/models/:id/benchmarks`            | Benchmark results, newest first (latest 20)                                  |

Read endpoints and benchmarks accept any authenticated user (both are measurements only, no assets
are written); mutations (register/patch/delete/install) require the admin role. Everything is
written to `audit_logs` (entity type `model`).

## Registering models

The model-manager page (`#/models`) shows a **Register model** button for admin users (next to
Refresh), toggling a registration form that calls `POST /api/v1/models`:

- **Required**: `name`, `version`, `backend` (`mock`, `local_cli`, `comfyui`, or `local_http` — see
  the adapter tables below for the `default_settings` each backend expects; `local_http` has no
  adapter yet, so jobs for such models fail).
- **Task types**: multi-select of `text_to_image`, `image_to_image`, `image_to_video`,
  `text_to_video`, `audio`, `music`, `voice`, `transcribe` — the model is offered for the generation
  features of the checked tasks.
- **Source** (optional): `local` (with `source_path`), `url` (with `repository_url`; installs from
  URL sources require the consent prompt), or `mock`.
- **Requirements** (optional): `vram_requirement_mb` / `ram_requirement_mb` — drive the hardware
  requirement warnings.
- **Advanced** (optional): `dependencies` (comma-separated in the form, validated against `PATH` by
  `local_cli` health checks), `default_settings` (a JSON object, parsed client-side before submit),
  and the enabled flag (a model can be registered disabled and enabled later).

The server validates the backend, source, and task types against the same allowlists and answers
`400` with the allowed values on mismatch; duplicate registrations are allowed (models are
distinguished by id/name/version metadata).

**Adapter settings validation:** the register and update endpoints also validate `default_settings`
per backend and answer `400` naming the missing key — `local_cli` requires `command` (string;
`args`, when given, must be a string array), `comfyui` requires `endpoint` (http(s) URL) plus a
non-empty `workflow` object. This is the difference between a model that registers and a model that
can actually run: a `local_cli` model without a `command` used to be registered fine and only failed
later with an opaque adapter error at benchmark/generation time. On updates, the check only runs
when the payload touches `default_settings` or `backend`, so unrelated PATCHes to an
already-registered model can't be blocked by a missing setting. The Model Copilot's register tools
describe the expected settings shape, and the model-manager rows offer a per-model **Settings**
editor (admin) that round-trips `default_settings` as JSON through the same PATCH.

**Task-type aliases:** the canonical task types use underscores. HuggingFace pipeline tags use
dashes for the image/video family, and the Model Copilot's context carries those tags — so every
validation boundary (model register/update, skill `model_task_types`, job `job_type`) also accepts
the dashed aliases `text-to-image`, `image-to-image`, `image-to-video`, `text-to-video` and
normalizes them to the canonical forms before validation and storage. An alias and its canonical
duplicate collapse to one entry; anything unknown still answers `400` with the allowed list.

## Browsing HuggingFace

The model-manager page also has a **Browse HuggingFace** panel (all authenticated users can search;
registering is admin-only). It is a server-side proxy of the **public** HuggingFace REST API —
`https://huggingface.co/api`, public repos only, 15 s timeout. HF has been restricting anonymous
per-repo access; a HuggingFace access token is forwarded as a Bearer credential. The effective token
is the one **stored in CinemAItor** (admin, see below) when set, otherwise the `HF_TOKEN`
environment variable:

- `GET /api/v1/models/huggingface/search?q=&filter=&limit=` — search repo ids; `filter` is the HF
  pipeline tag (e.g. `text-to-image`); limit 1–50 (default 12). The response normalizes each repo to
  `{id, likes, downloads, pipeline_tag, tags, license}` (license parsed from the `license:*` tag).
- `GET /api/v1/models/huggingface/:repoId` — `:repoId` is the percent-encoded `owner/name` on the
  wire (our router decodes it); upstream it is requested with a **literal** slash
  (`/api/models/<owner>/<name>`) — the live HF API rejects `owner%2Fname` with HTTP 400. Returns
  `{repo: {id, likes, downloads, pipeline_tag, tags, license}, branch, files, filesTruncated,
   readme}`:
  - `branch` — the branch the listing was read from. Most repos default to `main`; older repos
    default to `master`. The tree endpoint 404s on an unknown branch, so the service probes `main`
    and falls back to `master` (both are then used for the README fetch and the registered
    `repository_url`).
  - `files` — the **recursive** file listing from `/tree/<branch>?recursive=true` (directory entries
    filtered out), so weight files in subdirectories (`vae/`, `transformer/`, `text_encoder/`, the
    typical diffusers layout) are discoverable. Live HF tree entries are keyed by `path` (never
    `name`); entries not matching that shape are dropped. Capped at 500 files, weight files
    (`.safetensors`/`.gguf`/`.ckpt`/`.bin`) always kept; `filesTruncated` flags a capped listing.
  - `readme` — the first ~4,000 characters of the repo's `README.md` (usage examples, model-card
    notes); `null` when the repo has none or the fetch fails.
- **HF token settings** (admin) —
  - `GET /api/v1/models/huggingface/settings` → `{tokenSet, tokenSource}` (`tokenSource`: `settings`
    | `env` | `none`). The token itself is never returned.
  - `PATCH /api/v1/models/huggingface/settings` with `{token}` (string of at most 512 chars,
    trimmed; empty clears) stores the token in the `settings` table (`huggingface_token`, stored raw
    like the LLM key); `{token: null}` clears it. Validation failure → `400`.
  - `POST /api/v1/models/huggingface/settings/test` validates the _effective_ token against HF's
    `/whoami-v2` and returns `{ok, name, source}`; `400` when no token is configured, `502` when HF
    rejects it (actionable message).
  - The admin UI shows the status chip, save/clear/test controls, and notes the stored-over-env
    precedence.
- `POST /api/v1/models/from-huggingface` (admin) —
  `{repo_id, file?, backend?, task_types?, name?,
  version?, min_vram_mb?, dependencies?, known_limitations?, default_settings?}`.
  The server picks the weight file (explicit `file`, or the largest file among
  `.safetensors`/`.gguf`/`.ckpt`/`.bin` in the recursive listing) and registers a model row with
  `source: "url"` and `repository_url` set to the `resolve/<branch>` URL of that file — the normal
  install flow then downloads it from there (consent-gated, as with any URL source). The model id is
  the slugified last repo segment (`stabilityai/sdxl-base` → `sdxl_base`); if that id is already
  registered the call answers `409` (use the manual form to register the repo under a different id).
  Weights are **not** downloaded by this call.

  **Gated repos:** HF gates the weight _downloads_ (`resolve/...`) even when the metadata and file
  tree are publicly readable, and requires the caller's token to have accepted the gate (anonymous
  `resolve` requests get a 401). The install flow therefore forwards the effective HF token
  (`Authorization: Bearer …`) on any download whose URL origin matches the HF public base (default
  `https://huggingface.co`, `HF_PUBLIC_BASE` in tests) — never to other hosts. A token configured
  via the HF token settings or `HF_TOKEN` env makes gated-repo installs work once the account has
  accepted the license on HuggingFace.

The repo panel also surfaces the repo's tags and README, prefills the task types from the pipeline
tag, and offers an **Ask Model Copilot** action that hands the repo context (id, pipeline, selected
weight file, README excerpt) to the Model Copilot, which can walk the registration through its tool
harness (mutating tools as approve-gated proposals for admins). For `local_cli` / `comfyui` backends
the panel shows a `default_settings` JSON field (required — the server applies the same adapter
settings validation, so a repo registered without a `command`/`endpoint` is rejected up front
instead of failing later at benchmark or generation time).

Errors: `400` bad repo id / no usable weight file / unknown `file` / invalid token, `404` unknown
repo, `409` model id already registered, `502` HuggingFace unreachable, timed out, or rejected
(upstream `401`/`403` — store a token in the HF token settings or set `HF_TOKEN`).

## Behavior

- **Install**: copies/downloads the source into the store, computes SHA-256, stores `file_hash` +
  `installed_at`. URL installs stream to a stable temp file (`model.bin.part`) and rename it into
  place when complete (no in-memory buffering, so large weight files are bounded only by disk
  space). **Resumable downloads**: a dropped connection or transient server error (`5xx`, network
  reset) keeps the part file and retries with `Range: bytes=<size>-` on an exponential backoff (1s →
  30s cap, no retry limit), so a flaky link resumes where it stopped instead of restarting a
  multi-gigabyte transfer. Servers that ignore `Range` (plain `200`) trigger a clean restart; a
  `416` that matches the part file's size finalizes it directly. The part file records the source
  URL it was downloaded from (`.part.url` sidecar); a leftover part from a _different_
  `repository_url` is discarded rather than resumed, so an interrupted install of one URL can never
  corrupt a download of another. Permanent failures (bad URL/protocol, HTTP `4xx`, size cap) clean
  up the part file, so nothing partial is left behind. The size is uncapped by default — set
  `MODEL_DOWNLOAD_MAX_SIZE` (bytes, 0 = unlimited) to enforce a limit (a part file already beyond
  the cap is removed and the install fails).
- **Verify**: always re-hashes the installed file (a full SHA-256 — minutes for multi-GB models) and
  compares to the stored hash; when no hash was stored yet, verify records the current hash. A
  successful full verification also refreshes the verification sidecar (below).
- **Verification sidecar** (`model.bin.verified`, JSON `{size, mtimeMs, hash}`): written at install
  time and after every successful full verification, recording the file's size + mtime at the moment
  its hash matched. The health check consults it first: when the file's size and mtime are
  unchanged, the re-hash is skipped (the file is the one that was verified) and the result says
  "File unchanged since last verification". Any size/mtime change triggers a full re-hash, so a
  rewritten or truncated file is caught. Trade-off: a same-size tamper with a restored mtime is
  trusted until the next real modification — the explicit Verify action always re-hashes.
- **Health check** per backend:
  - `mock` → always ok (simulated).
  - `local_cli` → file exists + checksum ok (full re-hash, or sidecar fast path) + all
    `dependencies` resolvable on `PATH`.
  - `comfyui` / `local_http` → (if `default_settings.endpoint` is set) the endpoint answers — the
    runtime is remote, so no local file is required; a local file is still checksum-verified when
    one is present. Result is persisted (`health_status`, `health_error`, `health_checked_at`). The
    diagnostics models report (`GET /api/v1/diagnostics/models`) runs the same checks, so the
    sidecar keeps it fast for large models too.
- **Hardware detection** (`detectHardware` in `services/hardware.ts`): platform, CPU count, and
  total RAM come from `/proc` (Linux) or `sysctl` (macOS); the GPU is detected via
  `nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version` (3s timeout, first GPU on
  multi-GPU hosts). Memory fields are unit-aware (`MiB` is the nvidia-smi default), e.g. `97871 MiB`
  → `vram_mb: 97871`. The CUDA version is a best-effort second query: `--query-gpu=cuda_version` on
  older drivers, falling back to the `CUDA Version` line of `nvidia-smi -q` on drivers ≥ 590, where
  the field was removed from the queryable set (nvidia-smi fails the _entire_ query when any field
  is invalid, so the core fields must be queried separately). The GPU object is
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

| `default_settings` key | Type        | Description                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `command`              | string, req | Executable name or absolute path                                                                                                                                                                                                                                                                                                       |
| `args`                 | string[]    | Argument templates; one entry must contain `{output}`                                                                                                                                                                                                                                                                                  |
| `timeout_seconds`      | number      | Default 600, clamped 1–6h; on timeout the child is SIGKILLed and the pipes drain for a 2s grace (orphaned grandchildren may hold them) before the job fails                                                                                                                                                                            |
| `env`                  | string map  | Extra env vars; the server env is inherited. For models whose `repository_url` is on HuggingFace, the effective HF token is also injected as `HF_TOKEN` + `HUGGING_FACE_HUB_TOKEN` (unless `env` sets either explicitly), so runners can pull gated-repo files (VAE, text encoders) via `huggingface_hub` — no token hardcoding needed |
| `output_extension`     | string      | Default derived from the job type                                                                                                                                                                                                                                                                                                      |

`args` placeholders: `{prompt}`, `{seed}`, `{candidate}`, `{count}`, `{output}`, and `{input:<i>}`
(absolute path of the i-th input file; out-of-range references fail the job before spawning).
`{seed}` is the **per-candidate** seed: candidate 0 gets the job's exact seed (a requested seed
stays reproducible), candidate _i_ gets a derived one — numeric seeds offset numerically (`42` →
`42,43,…`), non-numeric seeds suffix the index (`abc` → `abc,abc:1,…`) — so deterministic runtimes
(e.g. a CPU diffusers runner) produce distinct candidates instead of byte-identical copies. The
per-candidate seed is recorded in each version's `technical_metadata.seed_used`. A **bare**
`{input:<i>}` token (the whole `args` entry) is an _optional_ reference: when the job carries no
such input the token — and a lone flag token directly before it, e.g. `["--image", "{input:0}"]` —
is dropped from the command line, so one settings row can serve both text-to-image and
image-to-image jobs (dual-mode models). `{input:<i>}` embedded in a larger token still fails the job
when the input is absent. Each candidate is written to a temp file in the job's working directory,
read back as the candidate bytes, then removed. A non-zero exit fails the job with the last 1500
chars of stderr (stdout as fallback). Cancellation kills the child between candidates.

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

Submits a workflow graph to a ComfyUI server (local or hosted):

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

**Using a hosted ComfyUI** (e.g. `https://comfyui.internal.example.com`):

- `endpoint` is the server base URL (no trailing path) — it must be reachable from the server
  hosting this app. The health check probes it directly, and remote backends need **no local model
  install**: register + enable is all that's required.
- `workflow` is the API-format prompt graph (node map), not the UI workflow JSON. Get it from the
  ComfyUI UI via **Save (API Format)**, or — if the workflow has been queued at least once — from
  `GET /history/<prompt_id>` on the server: the fragment of a ComfyUI URL is the prompt id, and the
  entry's `prompt` field is exactly the graph the adapter submits.
- Wire the placeholders: the prompt goes into the text-encode node(s) value as `{{prompt}}`, the
  sampler seed node value as `"{{seed}}"`, and (for image-to-video/image-to-image) the image-load
  node value as `"{{input:0}}"` — the app uploads the job's input asset (e.g. a panel preview)
  before submitting.
- The workflow must contain at least one node whose outputs include an `images`/`gifs`/`videos`
  entry (e.g. Save Image, a video-combine node) — a run with zero such outputs fails the job.
- Each job run submits the workflow once with the job's seed; re-running a job with the same seed is
  reproducible on the ComfyUI side.
- The ComfyUI UI's "Save as Python script" export is a standalone local runner and is **not** what
  this backend consumes — for a hosted server, use the HTTP API path above (or, if you want to run
  the script yourself locally, register the model with the `local_cli` backend instead).
