# MCP Tool Servers (Copilot Extension)

The Model Copilot acts as an **MCP (Model Context Protocol) client**: an admin registers one or more
MCP servers, and the copilot discovers their tools and calls them inside the same bounded
tool-calling loop as its built-in tools — with the same approval semantics. This lets external tool
servers (file/repo helpers, ComfyUI add-ons, anything from the MCP ecosystem) join the copilot
without app code changes.

Local-first: MCP servers are user-configured processes (stdio) or user-controlled endpoints (HTTP).
The app itself never calls a public MCP service.

## Transports

- `stdio` — the app spawns the server process (`command` + `args`, optional `env` merged over the
  app's environment) and speaks newline-delimited JSON-RPC over its stdin/stdout. No shell is
  involved: the command runs as an argv array.
- `http` — MCP **Streamable HTTP**: JSON-RPC POSTed to the configured `url`, with optional static
  `headers` (e.g. `Authorization`). The deprecated legacy SSE transport is not supported.

## Storage

`mcp_servers` table (migration `0029_mcp_servers.sql`; renumber per the migration-conflict rule if a
concurrent PR claims the number — see also `migrations.test.ts` filename/count lists):

| Column                      | Type    | Meaning                                                                   |
| --------------------------- | ------- | ------------------------------------------------------------------------- |
| `id`                        | TEXT PK | Slug of the name, `[a-z0-9_-]{1,64}`; unique                              |
| `name`                      | TEXT    | Display name, 1–64 chars                                                  |
| `description`               | TEXT    | Free text, ≤ 500 chars (shown in the UI + the copilot's system prompt)    |
| `transport`                 | TEXT    | `stdio` \| `http`                                                         |
| `command`                   | TEXT    | stdio: executable (required for stdio)                                    |
| `args_json`                 | TEXT    | stdio: JSON array of strings (default `[]`)                               |
| `env_json`                  | TEXT    | stdio: JSON object of string env vars merged over the app's env           |
| `url`                       | TEXT    | http: endpoint URL (required for http), `http:`/`https:` only             |
| `headers_json`              | TEXT    | http: JSON object of string headers (secrets live here — masked in views) |
| `timeout_seconds`           | INTEGER | Per-call timeout, 5–3600, default 120                                     |
| `enabled`                   | INTEGER | Default 1; disabled servers are closed and hidden from the copilot        |
| `auto_approve`              | INTEGER | Default 0; 1 = every tool on this server auto-executes (trusted servers)  |
| `created_by`                | INTEGER | Admin user id                                                             |
| `created_at` / `updated_at` | TEXT    | Timestamps                                                                |

Repository: `backend/src/db/mcp.ts` — parse/validate/CRUD, following the `db/workflows.ts` pattern.
`GET` views never return raw `headers`: they return `header_names: string[]` +
`headers_set: boolean` (same masking pattern as `llm_api_key`); the edit form leaves a stored value
untouched when its field is left empty, `null` clears the whole object.

## Endpoints

| Method | Endpoint                        | Access | Description                                                                                                               |
| ------ | ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/mcp/servers`           | admin  | Rows + live status (`state`, `tool_count`, `last_error`, `tools_fetched_at`)                                              |
| POST   | `/api/v1/mcp/servers`           | admin  | Create (transport-specific validation) → `201`; `409` on taken id                                                         |
| PATCH  | `/api/v1/mcp/servers/:id`       | admin  | Partial update (incl. `enabled`, `auto_approve`); any config change closes the live connection so the next use reconnects |
| DELETE | `/api/v1/mcp/servers/:id`       | admin  | Close connection + delete row → `204`                                                                                     |
| POST   | `/api/v1/mcp/servers/:id/test`  | admin  | Connect + list tools (forced refresh) → `{ok: true, tools}` or a mapped error                                             |
| GET    | `/api/v1/mcp/servers/:id/tools` | admin  | Current cached tool catalog (qualified names, descriptions, read-only hints)                                              |

All routes are admin-only (management), audit-logged (`mcp.server_create/update/delete/test`), and
documented in the OpenAPI layer (`routes/mcp.ts` carries its own `openApiOps` — route↔ops parity is
enforced by `backend/tests/openapi.test.ts`).

### Error mapping

| Condition                                         | Status | Code              |
| ------------------------------------------------- | ------ | ----------------- |
| Validation (transport fields, name, timeout…)     | 400    | `BAD_REQUEST`     |
| Unknown server id                                 | 404    | `NOT_FOUND`       |
| Non-admin caller                                  | 403    | `FORBIDDEN`       |
| Spawn failure / HTTP unreachable / protocol error | 502    | `MCP_UNREACHABLE` |
| Connect or call timeout                           | 504    | `MCP_TIMEOUT`     |

(`MCP_UNREACHABLE` / `MCP_TIMEOUT` are new entries in `services/../errors.ts` `ERROR_CODES`.)

## Client service (`services/mcp.ts`)

- Dependency: `npm:@modelcontextprotocol/sdk` (≥ 1.30) + its peer `npm:zod`, added to
  `backend/deno.json` imports. The SDK's stdio transport runs under Deno via `node:child_process`
  (verified by spike on Deno 2.9.5: connect, `listTools`, `callTool`).
- A module-level manager holds per-server connection state
  (`{client, state: idle|connecting|connected|error, last_error, tools, tools_fetched_at}`).
  Connections are **lazy** (first catalog fetch or tool call), **reconnecting** (a failure closes
  and the next use retries), and **serialized per server** (stdio is a single JSON-RPC session).
- The tool catalog is cached 60 s per server; the test endpoint and config changes force a refresh.
  One failing server is isolated: the catalog lists it with `state: error` + `last_error` and the
  remaining servers still contribute tools.
- **Qualified tool names**: `mcp__<server_id>__<tool_name>`. MCP tool names and OpenAI function
  names are both `[a-zA-Z0-9_-]{1,64}`, so the prefix is unambiguous and schema-safe. A qualified
  name longer than 64 chars is dropped from the catalog (surfaced in the server status).
- MCP `inputSchema` (JSON Schema) passes through as the OpenAI function `parameters` unchanged.
- **Result conversion**: `callTool` results use `structuredContent` when present, otherwise the text
  content blocks joined by newlines (non-text blocks become `[<type>]` placeholders).
  `isError: true` fails the step with the server's error text. Results then pass through the agent's
  existing 8000-char tool-result cap.
- **Cleanup**: `mcpCloseAll()` is called from the `SIGTERM`/`SIGINT` handlers in `server.ts` (new —
  the server currently has no explicit signal handler) so stdio children never outlive the backend;
  `DELETE`/disable close their connection immediately.

## Agent integration (`services/llm_agent.ts`)

- The copilot's tool set is **built-in + MCP**: `runAgent` builds it from `agentToolDefs(isAdmin)` +
  `mcpToolDefs(mcpAgentTools(isAdmin))` (qualified names, server schemas passed through; fetched
  once per turn — the 60 s catalog TTL cache means the system prompt and the tool list share one
  live refresh). A server that fails to list simply contributes no tools; its status is visible in
  the panel.
- **Classification** is three-state, mirroring the built-in split:
  - the server declared `annotations.readOnlyHint: true` for the tool → **read-only**: executes
    inline like the built-in read-only tools (no proposal)
  - the server has `auto_approve` on → **auto-approval**: a proposal is created and executed in-loop
    through the same single-flight approval path as model-scoped auto-approval (step summary
    `auto-approved (mcp:<server>) — …`, `auto_approved` conversation event); a failed call leaves
    the proposal pending for a manual retry
  - otherwise → **mutating**: the call creates an approval proposal (dedupe, in-flight
    single-flight, auto-continue follow-ups: all unchanged) Non-admin callers only see read-only MCP
    tools in the schema — side effects (including auto-approved ones) require the admin role,
    exactly like built-in mutating tools (a stray call still fails the step, never executes).
- `AgentProposal.tool` is generalized from the closed `AgentToolName` union to `string` (built-in
  names or `mcp__…` names); proposal storage/TTL/dedupe are untouched.
- The system prompt gains a live **MCP section**: connected servers with their qualified tool
  names + one-line descriptions, and the rule that MCP tools follow the same approval flow as
  built-in mutating tools (broadly bounded so many tools cannot blow up the prompt — tool schemas
  ride in the `tools` array, the prompt section is a compact index).
- **Self-registration** — `add_mcp_server` is a built-in mutating (admin-only) agent tool: it is the
  copilot's way to _add_ a server, closing the loop where most MCP servers are "installed" purely by
  registering their stdio command or HTTP endpoint. Its parameters mirror the
  `POST /api/v1/mcp/servers` body (name/transport plus the transport-specific fields); the tool
  calls the same `createMcpServer` repository path, so validation (400) and duplicate-name rejection
  (409) behave exactly as the REST route. A second, admin-only system-prompt section tells the
  copilot when and how to propose a registration, and to follow up with a connection test once
  approved. Non-admins never see the tool (it is in `MUTATING_AGENT_TOOLS`), and the "Ask Model
  Copilot" button in the MCP panel pre-fills the chat with a registration request.
- MCP calls count against the existing 16-iteration cap; per-call timeout is the server's
  `timeout_seconds`. Conversation logging records MCP steps and approve/reject events verbatim (the
  qualified name carries the server identity).
- The OpenAPI `LlmProposal` schema's `tool` field (currently a closed enum) becomes an open string.

## Frontend (`frontend/src/components/model-manager.js`)

- **MCP Servers panel** below the LLM Assistant panel (admin-only, like the LLM form; non-admins get
  the "Only admins can change…" note):
  - one row per server: name, transport chip, status chip (`connected` / `error` + tooltip with
    `last_error` / `disabled`), tool count, description
  - actions: **Test connection** (busy spinner; the row's form is saved first, then the test runs —
    the established settings pattern), add/edit form, enable toggle, delete (confirm-dialog)
  - add/edit form: name, description, transport select; stdio → command / args (JSON array) / env
    (JSON object); http → url / headers (JSON object, stored values shown as "set — leave empty to
    keep"); timeout; `auto_approve` checkbox with an explicit warning that all of the server's tools
    will execute without approval
  - expandable per-server tool list: qualified name, read-only chip, description
  - **Ask Model Copilot** button (admin-only, next to "Add server"): pre-fills the copilot chat with
    a request to register a new MCP server, so the copilot's `add_mcp_server` tool can gather the
    details and propose the registration
- **Copilot chat** (unchanged request/response shape): step lines and proposal cards whose tool
  matches `mcp__<server>__…` show an `MCP: <server>` badge; Approve/Reject/auto-continue work as-is.

## Security

- Management is admin-only and audit-logged; a stdio server is an **arbitrary process spawn on the
  host** — an explicit admin action, argv-only (no shell), env = app env + the server's explicit
  merge.
- Gating defaults to safe: without `auto_approve`, only tools that the server itself declares
  `readOnlyHint` execute inline; everything else costs an approval. `auto_approve` is a per-server
  admin override for trusted servers (labeled as such in the UI).
- HTTP servers: `http:`/`https:` URLs only; header secrets are never returned by GET views.
- The app never initiates MCP **sampling** (a server cannot ask the app's LLM for completions) and
  does not expose MCP **resources**/**prompts** — tools only (v1).

## Tests

- `backend/tests/mcp_fake/server.mjs` — a fake MCP stdio server (SDK `McpServer`): read-only tools
  (`readOnlyHint`), a mutating tool, a slow tool, and (opt-in `--with-error-tool`) a tool that
  always answers `isError`; spawned per test under the test tree.
- `backend/tests/mcp.test.ts` — registry validation + CRUD (transport fields, slug uniqueness, 403
  non-admin, 404/409), test endpoint (ok with tool list / unreachable command / slow server
  timeout), tools endpoint, catalog isolation (one broken server, others intact), connection closed
  on delete.
- `backend/tests/llm_agent.test.ts` (extended) — MCP tools present in the fake LLM's `tools` array;
  read-only MCP tool executes inline (step `ok`); non-read-only MCP tool → proposal → approve
  executes it on the fake server; `auto_approve` server executes in-loop (step
  `auto-approved (mcp:<server>) — …`); non-admin schema excludes non-read-only MCP tools; an
  unreachable server contributes no tools while a healthy one keeps working; a timed-out call
  surfaces as an `error` step; approving a proposal whose tool answers `isError` fails (400) and
  leaves the proposal pending; system prompt carries the MCP section.
- `backend/tests/openapi.test.ts` — route↔ops parity for the new routes (automatic).

## Documentation

- This file (contract). `docs/llm.md` gains a cross-reference: the copilot exposes MCP server tools
  alongside its built-ins. MASTER-PLAN: Workstream 17, section 8.15 (API surface), section 11.20
  (acceptance), section 38 (detailed design).

## Implementation split (PRs)

1. **MCP client layer**: migration + `db/mcp.ts` + `services/mcp.ts` + `routes/mcp.ts` + OpenAPI
   (`McpServer` schema, ops) + `mcp.test.ts`. No agent changes yet.
2. **Agent integration**: catalog + classification in `llm_agent.ts`, proposal tool typing, system
   prompt section, `LlmProposal` schema relaxation + `llm_agent.test.ts` extensions + `docs/llm.md`
   cross-reference.
3. **UI**: MCP Servers panel + copilot badges.

Every PR runs the full gate
(`deno task lint && deno task check && deno fmt --check &&
deno task test`) and goes through the
review-loop workflow.
