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
| `llm_timeout_seconds` | Request timeout (`"300"` default; 1–3600)                                                                                                      |

The key is never returned by any endpoint — settings GET exposes `api_key_set: boolean`. PUT accepts
a partial update; `llm_api_key` accepts a string (set/replace) or `null` (clear). Mutating settings
require admin; reading settings requires admin; every authenticated user can read the coarse status.

## Endpoints

| Method | Endpoint                            | Access        | Description                                                                                                          |
| ------ | ----------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/llm/settings`              | admin         | Current settings (key masked) + `enabled` + `configured`                                                             |
| PUT    | `/api/v1/llm/settings`              | admin         | Partial update (see table above)                                                                                     |
| GET    | `/api/v1/llm/status`                | authenticated | `{configured: boolean}` — enabled + has base URL + has model name                                                    |
| POST   | `/api/v1/llm/test`                  | admin         | Minimal completion; `200 {ok: true, latency_ms, model}` or a mapped error                                            |
| POST   | `/api/v1/llm/chat`                  | authenticated | One-shot chat `{messages, model?, temperature?, max_tokens?}`                                                        |
| POST   | `/api/v1/llm/assist`                | authenticated | `{purpose, context, model_id?, skill_id?, max_tokens?}` → `{purpose, content}`                                       |
| POST   | `/api/v1/llm/agent`                 | authenticated | Model Copilot: `{history, model?, conversation_id?}` → `{reply, model, iterations, truncated, steps[], proposals[]}` |
| POST   | `/api/v1/llm/proposals/:id/approve` | admin         | Execute a pending mutating-tool proposal → `{proposal, result}`                                                      |
| POST   | `/api/v1/llm/proposals/:id/reject`  | admin         | Reject a pending proposal → `{proposal}`                                                                             |
| GET    | `/api/v1/llm/proposals`             | authenticated | The caller's proposals with live status (`in_flight`, `started_at`, `conversation_id`); admins see all               |
| GET    | `/api/v1/llm/conversations`         | authenticated | The caller's logged copilot conversations (newest first, ≤50); admins see all                                        |
| GET    | `/api/v1/llm/conversations/:id`     | owner/admin   | One conversation with its full message log                                                                           |
| DELETE | `/api/v1/llm/conversations/:id`     | owner/admin   | Delete a conversation log → `204`                                                                                    |

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

`POST /api/v1/llm/agent` runs a bounded tool-calling loop (max 16 tool iterations). The LLM is told
it is the cinemaItor model copilot and handed the tools in OpenAI function-calling form.

**History budget.** Each request re-sends the whole conversation to the LLM (once per tool-loop
iteration), so `history` is bounded to the newest 32 messages. Longer histories are **trimmed, not
rejected** — the oldest turns are dropped, the window is re-anchored at a user turn, and a short
synthetic note ("the earliest turns … were omitted") is prepended so the copilot knows the context
was cut. The full conversation still lands in the caller's conversation log (see below), so nothing
is lost for review.

The system prompt carries **live context** so the copilot answers from actual state: the current
model/skill registry, and the **hardware the server runs on** (RAM, CPU count, GPU model, total and
free VRAM — or "no GPU detected (CPU-only)"). It is told to treat that hardware as ground truth when
judging whether a model fits, and to only warn about it not fitting when the numbers actually say
so. Hardware detection spawns `nvidia-smi`, so results are cached for 60 s (`detectHardware()` in
`services/hardware.ts`).

**Request:**
`{history: [{role: "user" | "assistant", content: string, synthetic?}...], model?,
conversation_id?}`
— at least one message, each content trimmed to 20 000 chars; `model` overrides the configured model
name. `conversation_id` (string, ≤128 chars) is optional: when present, the turn is persisted to the
caller's copilot conversation log (see [Conversation logging](#conversation-logging)); when absent,
the turn is stateless as before.

**Response:** `{reply, model, iterations, truncated, steps, proposals}` where `steps` is one entry
per tool call —
`{tool, args, status: "ok" | "error" | "proposal" | "duplicate", summary,
proposal_id?}` — and
`proposals` is the list of proposals created in this turn (empty when the turn only read data).
`truncated` is true when the loop stopped at the iteration cap without a final reply.

**Duplicate proposals.** Proposals are deduplicated per conversation: if a pending proposal already
exists with the same tool and identical (key-order-insensitive) arguments, the mutating tool call
does not create a new one — it returns the existing proposal with a `duplicate` step ("an identical
`<tool>` proposal is already pending") so the model stops re-proposing it. Once the first proposal
is approved or rejected, new proposals for the same step are allowed again.

**Claim verification.** A reply that _claims_ a proposal was created ("I've proposed running…")
while the turn produced no proposals is the classic dead end — the user has nothing to approve. The
loop detects this phrasing and, if no proposal was created, sends the copilot back **once** with a
verification nudge ("no proposal was created this turn — call the matching mutating tool now"). The
nudge fires at most once per turn; if the copilot honestly reports it cannot create the proposal,
the turn ends with that explanation. The frontend shows a matching "Ask for the proposal" nudge
button on such replies as a second safety net.

**Read-only tools (auto-execute):**

- `list_models` `{task_type?}`
- `model_info` `{model_id}`
- `model_files` `{model_id}` — lists the model's storage directory (weights, runner scripts,
  `.venv`)
- `list_skills` `{assistant_only?}`
- `huggingface_search` `{query, limit?}`
- `huggingface_model_info` `{repo_id}`
- `comfyui_status` `{endpoint}` — GETs `{endpoint}/system_stats` (queue, devices, VRAM)
- `benchmark_results` `{model_id}` — the model's benchmark measurement rows plus the status of its
  three most recent benchmark jobs

**Mutating tools (admin-only; proposals unless the model's auto-approval is on):**

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
- `run_smoke_test` `{model_id, timeout_seconds?}` — runs the model's `local_cli` command ONCE with a
  minimal prompt and a bounded timeout (default 60 s, max 180 s, `services/model_smoke.ts`): the
  result is
  `{status: "ok" | "failed" | "started_ok", exit_code, duration_ms, output_written,
  error_tail?, note}`
  — `failed` carries the stderr tail (the error to fix); `started_ok` means the process ran the full
  timeout without failing (startup healthy, not a speed/quality measurement). `local_cli` models
  only, must be installed.
- `run_benchmark` `{model_id}` — enqueues the deterministic benchmark job (fixed prompts, 2
  candidates per benchmarkable task type; `services/model_benchmark.ts`). It returns the job id
  immediately — the run is asynchronous in the job queue (hours on CPU); 400 when a benchmark for
  the model is already queued/running.

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
("do not re-propose them with the same arguments; propose a corrected replacement if one of them is
wrong or failed"). The copilot then proposes the next planned action for approval (or confirms the
plan is complete), which is what lets multi-step setups — runner script → venv → adapter
`update_model` — run to completion without the user typing "continue". Each follow-up is still gated
on explicit human approval, so the loop can never run unattended.

**Failure follow-ups.** When an approved proposal's tool execution fails, the UI sends a `failed`
follow-up turn carrying the error message: the copilot learns its step failed (the proposal stays
pending server-side) and is expected to propose a corrected replacement as a NEW proposal. The
copilot's system prompt carries the live list of pending proposals (tool + argument summary, marked
when one is executing), and its approval-flow rule distinguishes the two cases: identical
re-proposals of a still-pending step are forbidden, but a corrected replacement for a
wrong/failed/rejected step is expected. This closes the loop where the copilot could fix an error in
text yet never produce a new approval request.

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

**GGUF weights.** The playbook also carries the GGUF loading recipe, because a single `.gguf` file
(FLUX/SD3.5/Wan/LTX/HiDream/Qwen quants) is easy to misread as "unsupported by diffusers": diffusers
has a native GGUF loader, but it is **backbone-only** and the backbone must be a **DiT/transformer**
— `Pipeline.from_pretrained("....gguf")` is not supported, UNet models (SD 1.5/SDXL) cannot be
loaded from GGUF at all (4-D conv weights are not representable in GGUF; third-party SDXL GGUFs
store convs as flat 2-D matrices that the loader rejects — for those use the full-precision
checkpoint or ComfyUI). The playbook tells the copilot that a `from_single_file` failure does NOT
mean the GGUF is unsupported. The recipe: `gguf>=0.10`, `accelerate` and `transformers` in the venv;
load the backbone with
`<TransformerClass>.from_single_file(gguf_path, quantization_config=GGUFQuantizationConfig(...))`,
passing `config=`/`subfolder="transformer"` explicitly for diffusers-format GGUFs (the shape
heuristic misidentifies the base model otherwise); build the pipeline from the diffusers-format base
repo, injecting the backbone, with text encoders/VAE/tokenizers loaded as usual. Weights stay uint8
and dequantize per forward pass, so a quantized model needs far less RAM/VRAM than its
full-precision size and runs on CPU. A reference runner exercising the recipe against the
SD3.5-medium Q4_0 GGUF lives at `backend/tests/gguf_smoke/runner.py`, with an availability-gated
smoke test in `backend/tests/gguf_smoke.test.ts` (skips when the Python env or the multi-GB weights
are absent).

**Agent auto-approval (per model).** Every model has an admin-set `agent_auto_approve` flag (model
card toggle, `PATCH /api/v1/models/:id {agent_auto_approve: true}`; migration 0026, default off).
When it is on, the copilot's **model-scoped** mutating tools — `update_model`, `write_model_file`,
`install_model_deps`, `run_smoke_test`, `run_benchmark` — auto-execute the moment the agent calls
them: the harness still creates the proposal (same audit trail, same conversation event log), then
immediately runs it through the same single-flight approval path and feeds the tool result back into
the loop in the same turn. Non-scoped tools (`register_model`, `register_model_from_huggingface`,
`install_model`, `remove_model`) are never auto-approved — installing or deleting a model always
costs a human decision.

This is what lets the copilot drive a broken or freshly-set-up model to a working state end-to-end
inside one turn: change → `run_smoke_test` → read the `error_tail` → fix the root cause →
`run_smoke_test` again → `run_benchmark` once it passes. The 16-iteration cap bounds both the cost
and the wall time of such a loop (each iteration is one LLM call; a smoke test itself is bounded at
180 s). An auto-approval that fails leaves the proposal **pending** (the proposal card still
appears, so a human can retry or reject it) and the step is reported as
`auto-approval failed: <error>`; successes log an `auto_approved` event row on the conversation. The
system prompt tells the copilot which models have auto-approval on, and its fix-loop rule is
smoke-test-first: validate every change with `run_smoke_test` instead of asking the user to run the
model and paste the error back, and only run a (slow, asynchronous) benchmark after the smoke test
passes.

**No approval without a proposal.** The system prompt forbids the dead end where the copilot ends a
turn asking the user to approve something it never proposed: "If you ask the user to approve
something, you must have called the matching mutating tool in this same turn." As a UI-level
backstop, an assistant reply that asks for approval but created zero proposals shows a
`Request the proposal` nudge button, which sends a synthetic follow-up pointing out the gap and
demanding the tool call.

## Conversation logging

The Model Copilot's conversations are logged server-side so they can be mined later to improve the
agent (which tools it picks, where plans go off the rails, which setups need better guidance). The
UI sends a stable `conversation_id` for the live chat (created on the first turn, reset by "Clear
conversation"); every agent turn that carries one is persisted.

**Storage** (migration `0025_llm_conversations.sql`, repository `db/llm_conversations.ts`):

- `llm_conversations` — one row per conversation: `id` (client-chosen, ≤128 chars), `user_id`,
  `title` (set from the first user message), `model`, timestamps.
- `llm_messages` — append-only, one row per logged message: `role` `user` | `assistant` | `event`,
  `content`, `synthetic` (auto-continue / failure follow-ups), `steps_json` (the assistant turn's
  per-step `tool`/`status`/`summary`), `proposals_json`, `proposal_id` (event rows), `created_at`.
  The list endpoint computes `message_count` per conversation.

**What gets logged:**

- `POST /api/v1/llm/agent` with a `conversation_id` logs the turn's last user message plus the
  assistant reply (content, per-step `tool`/`status`/`summary`, proposal ids). The conversation row
  is upserted; `title` is set only once (first turn).
- Approving or rejecting a proposal logs an `event` row (`approved` / `rejected`) on the
  conversation the proposal belongs to, so the plan's approval trail is part of the log.
- Turns without a `conversation_id` are not logged (stateless behavior is preserved).

**Access** is ownership-gated: a user sees and can delete their own conversations; admins see and
can delete all. Deleting removes the conversation and its messages. The Model Manager UI's "History"
button (Model Copilot panel) lists the caller's conversations, opens any one as a read-only
transcript (user / assistant / event rows with timestamps), and offers per-conversation delete.
`GET /api/v1/llm/proposals` includes `conversation_id` on each proposal so the UI can correlate
cards with the log.

Logs are never sent back to the LLM — the agent's `history` is still whatever the client sends, so
the log is a pure audit/improvement record, not a memory the model reads.
