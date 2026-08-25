# LLM Assistant & Model Copilot

A user-configured local LLM (llama.cpp server, Ollama, LM Studio, vLLM, or any OpenAI-compatible
chat endpoint) acts as a creative and operational helper:

- **Settings** — endpoint configured in a separate section of the Models page
- **Assist** — one-shot creative help: write scripts (Fountain-lite), design scenes, enhance
  generation prompts (model- and skill-aware)
- **Model Copilot** — bounded tool-calling loop where the LLM can look up HuggingFace models,
  inspect the registry, and probe ComfyUI; mutating actions require explicit user approval
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
| `llm_timeout_seconds` | Request timeout (`"60"` default; 1–600)                                                                                                        |

The key is never returned by any endpoint — settings GET exposes `api_key_set: boolean`. PUT accepts
a partial update; `llm_api_key` accepts a string (set/replace) or `null` (clear). Mutating settings
require admin; reading settings requires admin; every authenticated user can read the coarse status.

## Endpoints

| Method | Endpoint                                  | Access        | Description                                                                    |
| ------ | ----------------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| GET    | `/api/v1/llm/settings`                    | admin         | Current settings (key masked) + `enabled` + `configured`                       |
| PUT    | `/api/v1/llm/settings`                    | admin         | Partial update (see table above)                                               |
| GET    | `/api/v1/llm/status`                      | authenticated | `{configured: boolean}` — enabled + has base URL + has model name              |
| POST   | `/api/v1/llm/test`                        | admin         | Minimal completion; `200 {ok: true, latency_ms, model}` or a mapped error      |
| POST   | `/api/v1/llm/chat`                        | authenticated | One-shot chat `{messages, model?, temperature?, max_tokens?}`                  |
| POST   | `/api/v1/llm/assist`                      | authenticated | `{purpose, context, model_id?, skill_id?, max_tokens?}` → `{purpose, content}` |
| POST   | `/api/v1/llm/agent`                       | authenticated | Model Copilot: `{message, history?}` → `{content, proposals[]}`                |
| POST   | `/api/v1/llm/agent/proposals/:id/approve` | admin         | Execute a pending mutating-tool proposal → `{ok, output}`                      |
| POST   | `/api/v1/llm/agent/proposals/:id/reject`  | admin         | Reject a pending proposal → `{ok: true}`                                       |

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

| Method | Endpoint                             | Description                                                                                                                  |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/models/huggingface/search`  | `?q=&filter=&limit=` (limit 1–50, default 12) → `{results: [{id, likes, downloads, pipeline_tag, tags, license}]}`           |
| GET    | `/api/v1/models/huggingface/:repoId` | `{repo: {…same fields…}, files: [{path, size, type}]}` from `/tree/main` (root level)                                        |
| POST   | `/api/v1/models/from-huggingface`    | Admin. `{repo_id, file?, backend?, task_types?, name?, version?, min_vram_mb?, dependencies?, known_limitations?, consent?}` |

`from-huggingface` fetches the file listing, picks the weight file (explicit `file` or heuristic:
largest file among `.safetensors`, `.gguf`, `.ckpt`, `.bin`), and registers a model row with
`source: "url"`, `file_url` = `https://huggingface.co/<repo>/resolve/main/<file>`, `repository_url`
= the repo page. `model_id` is the slugified last repo segment (suffixed to stay unique). Weights
are **not** downloaded — use the normal `POST /:id/install` (`consent: true`) afterwards. Errors:
`400` no usable weight file / bad repo id, `404` unknown repo, `409` id already registered, `502` HF
unreachable.

## Model Copilot (agent)

`POST /api/v1/llm/agent` runs a bounded tool-calling loop (max 8 tool iterations, max 32 messages in
`history`). The LLM is told it is the cinemaItor model copilot and handed the tools in OpenAI
function-calling form.

**Read-only tools (auto-execute):**

- `list_models` `{task_type?}`
- `model_info` `{model_id}`
- `list_skills` `{assistant_only?}`
- `huggingface_search` `{query, limit?}`
- `huggingface_model_info` `{repo_id}`
- `comfyui_status` `{endpoint}` — GETs `{endpoint}/system_stats` (queue, devices, VRAM)

**Mutating tools (admin-only, never auto-executed):**

- `register_model`
  `{name, model_id?, backend, task_types, file_url?, repository_url?, version?, min_vram_mb?, dependencies?, known_limitations?}`
- `register_model_from_huggingface` `{repo_id, file?, backend?, task_types?, name?, version?}`
- `install_model` `{model_id}`
- `remove_model` `{model_id}`

When the model calls a mutating tool, the harness creates a **proposal**
(`{id, tool, args, created_at, expires_at}` — in-memory, 1 h TTL, never persisted) and appends a
tool message telling the model the action awaits user approval. Non-admin users only receive
read-only tools in the schema. Approve re-checks admin + validation and executes the stored call;
reject closes it. Both answer `404` for unknown/expired proposals and `409` when the proposal is no
longer pending.
