# LLM Assistant & Model Copilot

A user-configured local LLM (llama.cpp server, Ollama, LM Studio, vLLM, or any OpenAI-compatible
chat endpoint) acts as a creative and operational helper:

- **Settings** — endpoint configured in a separate section of the Models page
- **Assist** — one-shot creative help: write scripts (Fountain-lite), design scenes, enhance
  generation prompts (model- and skill-aware)
- **Model Copilot** — bounded tool-calling loop where the LLM can look up HuggingFace models,
  inspect the registry, probe ComfyUI, and set up `local_cli` runtimes (runner scripts + Python
  virtualenvs); mutating actions require explicit user approval
- **HuggingFace** — server-side proxy of the public HF API + auto-register a model row from a repo
  (install remains the consent-gated install flow)

Local-first: the app only talks to the user's configured endpoint and to `huggingface.co` for public
model metadata. No cloud LLM services.

## Settings

Stored in `app_settings` (same mechanism as the SMTP settings, see `docs/email.md`):

| Key                   | Meaning                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm_enabled`         | `"0"` / `"1"` — when off every LLM endpoint answers `503`                                                                                      |
| `llm_base_url`        | Server root, e.g. `http://127.0.0.1:11434/v1` (Ollama) or `http://127.0.0.1:8080/v1` (llama.cpp). Requests go to `{base_url}/chat/completions` |
| `llm_api_key`         | Optional bearer key; sent only when non-empty                                                                                                  |
| `llm_model`           | Model name to send in the request body (`qwen2.5:14b`, `local-model`, …)                                                                       |
| `llm_temperature`     | Sampling temperature string (`"0.7"`), sent when set                                                                                           |
| `llm_max_tokens`      | Default max completion tokens (`"1024"`), sent when set                                                                                        |
| `llm_timeout_seconds` | Request timeout (`"300"` default; 1–600)                                                                                                       |

The key is never returned by any endpoint — settings GET exposes `api_key_set: boolean`. PUT accepts
a partial update; `llm_api_key` accepts a string (set/replace) or `null` (clear). Mutating settings
require admin; reading settings requires admin; every authenticated user can read the coarse status.

## Endpoints

| Method | Endpoint                            | Access        | Description                                                                                        |
| ------ | ----------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/llm/settings`              | admin         | Current settings (key masked) + `enabled` + `configured`                                           |
| PUT    | `/api/v1/llm/settings`              | admin         | Partial update (see table above)                                                                   |
| GET    | `/api/v1/llm/status`                | authenticated | `{configured: boolean}` — enabled + has base URL + has model name                                  |
| POST   | `/api/v1/llm/test`                  | admin         | Minimal completion; `200 {ok: true, latency_ms, model}` or a mapped error                          |
| POST   | `/api/v1/llm/chat`                  | authenticated | One-shot chat `{messages, model?, temperature?, max_tokens?}`                                      |
| POST   | `/api/v1/llm/assist`                | authenticated | `{purpose, context, model_id?, skill_id?, max_tokens?}` → `{purpose, content}`                     |
| POST   | `/api/v1/llm/agent`                 | authenticated | Model Copilot: `{history, model?}` → `{reply, model, iterations, truncated, steps[], proposals[]}` |
| POST   | `/api/v1/llm/proposals/:id/approve` | admin         | Execute a pending mutating-tool proposal → `{proposal, result}`                                    |
| POST   | `/api/v1/llm/proposals/:id/reject`  | admin         | Reject a pending proposal → `{proposal}`                                                           |
| GET    | `/api/v1/llm/proposals`             | authenticated | The caller's proposals with live status (`in_flight`, `started_at`); admins see all                |

### Error mapping (chat / test / assist / agent)

| Condition                         | Status | Code                  |
| --------------------------------- | ------ | --------------------- |
| LLM disabled or missing URL/model | 503    | `LLM_NOT_CONFIGURED`  |
| Network failure / DNS / refused   | 502    | `LLM_UNREACHABLE`     |
| 401/403 from the endpoint         | 502    | `LLM_AUTH_FAILED`     |
| 404 from the endpoint             | 502    | `LLM_MODEL_NOT_FOUND` |
| Timeout                           | 504    | `LLM_TIMEOUT`         |
| Non-JSON or unexpected response   | 502    | `LLM_BAD_RESPONSE`    |

Calls are synchronous (bounded by `llm_timeout_seconds`), never queued jobs.

## Chat

Request body:

```json
{
  "messages": [{ "role": "system", "content": "…" }, { "role": "user", "content": "…" }],
  "model": "optional override",
  "temperature": "optional override",
  "max_tokens": "optional override"
}
```

Roles must be `system` / `user` / `assistant`; `messages` is 1–32; user content ≤ 32 000 chars each
(system ≤ 16 000). Response: `{content, model, usage?}` where `usage` is the endpoint's `usage`
block verbatim when present.

## Assist purposes

System prompts live in `services/llm_assist.ts`. The client supplies `context` (≤ 32 000 chars) and
the server composes `[system prompt, user: context]`.

- `write_script` — the model answers with **Fountain-lite only** (scene headings
  `INT./EXT. <place> - <TIME>`, action lines, `CHARACTER` + dialogue; no markdown fences, no
  commentary). The output is pasteable into the scene-list script import (SCN-015).
- `design_scene` — fixed answer shape: `## Overview`, `## Mood & Tone`, `## Shots` (numbered:
  description / camera / movement / duration), `## Lighting`, `## Time of day`, `## Dialogue`.
- `enhance_prompt` — rewrites a generation prompt. When `model_id` is given the model's metadata
  (name, task types, version, known limitations, default-settings keys) is injected; when `skill_id`
  is given the skill's `assistant` block (guidance + examples) is injected. `@reference` tokens in
  the input must survive verbatim — the server post-checks and re-appends any dropped ref (400
  pre-check: the model must exist and be enabled; with both a model and a skill, the skill's task
  types must overlap the model's).

All three return `503 LLM_NOT_CONFIGURED` when the LLM is not configured.

## Skills as prompt knowledge

A skill definition may carry an optional `assistant` block (validated with the rest of the
definition; included in version snapshots):

```json
"assistant": {
  "model_task_types": ["text_to_video"],
  "guidance": "…how to write prompts for this model family…",
  "examples": [{ "prompt": "…", "notes": "why this works" }]
}
```

- `guidance` ≤ 4 000 chars; `examples` ≤ 8 (`prompt` ≤ 2 000, `notes` ≤ 500); `model_task_types`
  (optional) must be a non-empty subset of known task types.
- `GET /api/v1/skills?assistant=1` lists only skills with an `assistant` block.
- The seeded system skill `sys-t2v-prompting` carries general text-to-video prompting guidance so
  `enhance_prompt` is useful before the user writes their own.

## HuggingFace catalog

Server-side proxy of the **public** HF API (`https://huggingface.co/api/…`, 15 s timeout, no token —
public repos only):

| Method | Endpoint                             | Description                                                                                                                                       |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/models/huggingface/search`  | `?q=&filter=&limit=` (limit 1–50, default 12; `filter` = HF pipeline tag) → `{results: [{id, likes, downloads, pipeline_tag, tags, license}]}`    |
| GET    | `/api/v1/models/huggingface/:repoId` | `:repoId` is the percent-encoded `owner/name` → `{repo: {…same fields…}, files: [{path, size, type}]}` from `/tree/main` (root level, files only) |
| POST   | `/api/v1/models/from-huggingface`    | Admin. `{repo_id, file?, backend?, task_types?, name?, version?, min_vram_mb?, dependencies?, known_limitations?}` → `{model, file, repo}`        |

`from-huggingface` fetches the file listing, picks the weight file (explicit `file` or heuristic:
largest file among `.safetensors`, `.gguf`, `.ckpt`, `.bin`), and registers a model row with
`source: "url"` and `repository_url` = `https://huggingface.co/<repo>/resolve/main/<file>` (the
install flow reads `repository_url` as the download URL). `model_id` is the slugified last repo
segment; a taken id answers `409` instead of suffixing. `name` defaults to the repo id, `version` to
`1.0`, `backend` to `local_cli`, `license` comes from the repo's tags. Weights are **not**
downloaded — use the normal `POST /:id/install` (`consent: true`) afterwards. Errors: `400` no
usable weight file / bad repo id / unknown `file`, `404` unknown repo, `409` id already registered,
`502` HF unreachable (incl. 15 s timeout).

## Model Copilot (agent)

`POST /api/v1/llm/agent` runs a bounded tool-calling loop (max 8 tool iterations, max 32 messages in
`history`). The LLM is told it is the cinemaItor model copilot and handed the tools in OpenAI
function-calling form.

The system prompt carries **live context** so the copilot answers from actual state: the current
model/skill registry, and the **hardware the server runs on** (RAM, CPU count, GPU model, total and
free VRAM — or "no GPU detected (CPU-only)"). It is told to treat that hardware as ground truth when
judging whether a model fits, and to only warn about it not fitting when the numbers actually say
so. Hardware detection spawns `nvidia-smi`, so results are cached for 60 s (`detectHardware()` in
`services/hardware.ts`).

**Request:** `{history: [{role: "user" | "assistant", content: string}...], model?}` — at least one
message, each content trimmed to 20 000 chars; `model` overrides the configured model name.

**Response:** `{reply, model, iterations, truncated, steps, proposals}` where `steps` is one entry
per tool call — `{tool, args, status: "ok" | "error" | "proposal", summary, proposal_id?}` — and
`proposals` is the list of proposals created in this turn (empty when the turn only read data).
`truncated` is true when the loop stopped at the iteration cap without a final reply.

**Read-only tools (auto-execute):**

- `list_models` `{task_type?}`
- `model_info` `{model_id}`
- `model_files` `{model_id}` — lists the model's storage directory (weights, runner scripts,
  `.venv`)
- `list_skills` `{assistant_only?}`
- `huggingface_search` `{query, limit?}`
- `huggingface_model_info` `{repo_id}`
- `comfyui_status` `{endpoint}` — GETs `{endpoint}/system_stats` (queue, devices, VRAM)

**Mutating tools (admin-only, never auto-executed):**

- `register_model`
  `{name, model_id?, backend, task_types, file_url?, repository_url?, version?, min_vram_mb?, dependencies?, known_limitations?, default_settings?}`
- `register_model_from_huggingface` `{repo_id, file?, backend?, task_types?, name?, version?}`
- `update_model` `{model_id, task_types?, default_settings?, enabled?}` — re-validates adapter
  settings when `default_settings` or `backend` are touched (see `docs/models.md`)
- `write_model_file` `{model_id, filename, content}` — writes a text file (e.g. `runner.py`) into
  the model's directory; basenames only, `model.bin*` and `.venv` are reserved, 256 KB max
- `install_model_deps` `{model_id, packages}` — creates `<modelDir>/.venv` (base interpreter
  `python3`, overridable via `MODEL_VENV_PYTHON`) and pip-installs the packages into it; returns the
  venv python path to use as the `local_cli` `command`
- `install_model` `{model_id}`
- `remove_model` `{model_id}`

When the model calls a mutating tool, the harness creates a **proposal**
(`{id, tool, args, status, created_at, expires_at, user_id, in_flight?, started_at?}` — in-memory, 1
h TTL, never persisted) and appends a tool message telling the model the action awaits user
approval. Non-admin users only receive read-only tools in the schema (a stray mutating call still
fails the step, it is not executed).

- `POST /api/v1/llm/proposals/:id/approve` — re-checks admin + validation and executes the stored
  call, answering `{proposal, result}` (the executed proposal with its result attached). Execution
  is **single-flight**: the approval sets `in_flight` before the tool runs, so a duplicate approve
  or reject (double-click, second tab, client retry) gets `409` instead of starting a second
  concurrent run — important for `install_model_deps`, where two pip installs into the same `.venv`
  would corrupt it. The status flips to `approved` only after the tool succeeds; a failed tool
  clears `in_flight` and leaves the proposal pending so it can be retried.
- `POST /api/v1/llm/proposals/:id/reject` — closes it, answering `{proposal}`.
- `GET /api/v1/llm/proposals` — the caller's proposals with their current status (admins see all).
  `in_flight: true` + `started_at` are set while the approved tool call executes, so a reloaded page
  or a dropped request still knows a long install is running server-side.

Both mutation endpoints answer `404` for unknown/expired proposals, `403` for non-admins, and `409`
when the proposal is no longer pending or is already in progress.

The Model Copilot UI re-syncs its proposal cards from the list endpoint after an approve/reject
error: a long-running approval whose client-side request was dropped (or a duplicate that got the
`409`) converges on the server-side state — the card shows the settled result, or stays busy
(`Running… since HH:MM`) while the server-side run is still executing — instead of stranding stale,
re-clickable buttons.

**Auto-continue.** A copilot turn ends when it creates its proposals — approving a proposal only
executes the tool, it does not resume the conversation. So after each approval/rejection resolves,
the UI automatically sends one follow-up turn (rendered as a dashed `auto-continue` bubble) whose
synthetic message reports the outcome, a short result summary, and which steps are still pending
("do not re-propose those steps"). The copilot then proposes the next planned action for approval
(or confirms the plan is complete), which is what lets multi-step setups — runner script → venv →
adapter `update_model` — run to completion without the user typing "continue". Each follow-up is
still gated on explicit human approval, so the loop can never run unattended.

**Local-cli model setup.** The copilot's system prompt carries a setup playbook: a `local_cli` model
only works when its `default_settings.command` is an existing executable and every file its `args`
reference exists, so when the user asks to set up (or repair) one the copilot proposes the steps in
order — inspect the repo/weights (`huggingface_model_info` / `model_files`), `write_model_file` a
minimal runner script (takes `--prompt/--seed`/`--image`, writes the `--output` path),
`install_model_deps` to build the `.venv` (multi-GB pip downloads are normal; the result carries the
venv python path), then `register_model` / `update_model` with `command` = that venv python, `args`
referencing the runner script by absolute path with the `{prompt}/{seed}/{output}` (`{input:0}` for
reference images) placeholders, and a device flag matching the detected hardware (`cuda` when the
GPU has sufficient free VRAM, `cpu` otherwise). Every file the copilot writes (scripts, `.venv`)
lives inside the model's own storage directory, so removing the model removes its runtime too.
