import { loadConfig } from "../config.ts";
import { BENCHMARK_JOB_TYPE, listJobs } from "../db/jobs.ts";
import { logProposalEvent, touchConversation } from "../db/llm_conversations.ts";
import {
  deleteModel,
  getModel,
  listBenchmarkResults,
  listModels,
  type Model,
  MODEL_TASK_TYPES,
  registerModel,
  type RegisterModelInput,
  updateModel,
  type UpdateModelInput,
} from "../db/models.ts";
import { listSkills } from "../db/skills.ts";
import { storageLayout } from "../storage/paths.ts";
import { AppError, badRequest, conflict, ERROR_CODES, forbidden, notFound } from "../errors.ts";
import {
  getHuggingFaceRepo,
  registerModelFromHuggingFace,
  searchHuggingFaceModels,
} from "./huggingface.ts";
import { describeHardware, detectHardware } from "./hardware.ts";
import { requestBenchmark } from "./model_benchmark.ts";
import { installModelById, removeModelFiles } from "./model_files.ts";
import {
  runSmokeTest,
  SMOKE_TEST_DEFAULT_TIMEOUT_SECONDS,
  SMOKE_TEST_MAX_TIMEOUT_SECONDS,
} from "./model_smoke.ts";
import { listModelFiles, setupModelVenv, writeModelFile } from "./model_runtime.ts";
import { chatLlm, type LlmMessage, type LlmToolCall, type LlmToolDef } from "./llm_client.ts";

/** Max mutating/read tool round-trips per agent turn. Each iteration is one
 * LLM call, so this bounds both the cost and the wall time of a turn. The
 * budget is generous enough for an auto-approved fix loop
 * (change -> smoke test -> fix -> smoke test -> benchmark). */
export const AGENT_MAX_TOOL_ITERATIONS = 16;
/** Extra LLM iterations granted for the one-shot claim-verification nudge
 * (see claimsProposalReply) when a reply promises a proposal that was never
 * created. */
export const AGENT_CLAIM_NUDGE_ITERATIONS = 3;
/**
 * Conversation budget for agent requests: the newest 32 messages are the
 * most history sent to the LLM. Longer histories are trimmed (oldest
 * dropped) instead of rejected — a long copilot conversation must not
 * permanently 400 — and a short synthetic note marks the gap.
 */
export const AGENT_MAX_HISTORY = 32;
const PROPOSAL_TTL_MS = 60 * 60 * 1000;
const TOOL_RESULT_MAX_CHARS = 8000;
const COMFYUI_TIMEOUT_MS = 10_000;

export type AgentToolName =
  | "list_models"
  | "model_info"
  | "model_files"
  | "list_skills"
  | "huggingface_search"
  | "huggingface_model_info"
  | "comfyui_status"
  | "register_model"
  | "register_model_from_huggingface"
  | "update_model"
  | "write_model_file"
  | "install_model_deps"
  | "install_model"
  | "remove_model"
  | "run_smoke_test"
  | "run_benchmark"
  | "benchmark_results";

const TASK_TYPES_HELP = `Task types the model covers. Allowed: ${MODEL_TASK_TYPES.join(", ")}`;

const SETTINGS_HELP = {
  type: "object",
  description: "Adapter settings. REQUIRED for local_cli: 'command' (string, the executable run " +
    "per candidate) + 'args' (string[] with {prompt}/{seed}/{output} placeholders, plus " +
    "{input:0}..{input:7} for reference image inputs; a bare {input:<i>} token is optional — " +
    "dropped together with a flag token directly before it when the job has no such input, so " +
    "one settings row can serve both text-to-image and image-to-image; {output} is the path " +
    "the command must write the result file to). REQUIRED for comfyui: 'endpoint' (http(s) " +
    "server URL) + 'workflow' (ComfyUI prompt graph with {{prompt}}/{{seed}} placeholders). " +
    "Optional for both: 'timeout_seconds'.",
};

export const READ_ONLY_AGENT_TOOLS: readonly AgentToolName[] = [
  "list_models",
  "model_info",
  "model_files",
  "list_skills",
  "huggingface_search",
  "huggingface_model_info",
  "comfyui_status",
  "benchmark_results",
] as const;

const MUTATING_AGENT_TOOLS: readonly AgentToolName[] = [
  "register_model",
  "register_model_from_huggingface",
  "update_model",
  "write_model_file",
  "install_model_deps",
  "install_model",
  "remove_model",
  "run_smoke_test",
  "run_benchmark",
] as const;

function toolDef(
  name: AgentToolName,
  description: string,
  parameters: Record<string, unknown>,
): LlmToolDef {
  return { type: "function", function: { name, description, parameters } };
}

const stringProperty = (description: string) => ({ type: "string", description });
const stringArrayProperty = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});

/** All tool schemas, in OpenAI function-calling form. */
export const AGENT_TOOL_DEFS: LlmToolDef[] = [
  toolDef("list_models", "List registered generation models (optionally filtered by task type).", {
    type: "object",
    properties: { task_type: stringProperty("Only models covering this task type") },
  }),
  toolDef("model_info", "Full metadata for one registered model.", {
    type: "object",
    required: ["model_id"],
    properties: { model_id: stringProperty("Registered model id") },
  }),
  toolDef(
    "model_files",
    "List the files stored for a registered model (weights, runner scripts, .venv).",
    {
      type: "object",
      required: ["model_id"],
      properties: { model_id: stringProperty("Registered model id") },
    },
  ),
  toolDef("list_skills", "List skills (optionally only those with assistant prompt guidance).", {
    type: "object",
    properties: { assistant_only: { type: "boolean" } },
  }),
  toolDef("huggingface_search", "Search public HuggingFace model repos.", {
    type: "object",
    required: ["query"],
    properties: {
      query: stringProperty("Search text"),
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
  }),
  toolDef("huggingface_model_info", "Repo metadata + file listing for a HuggingFace repo.", {
    type: "object",
    required: ["repo_id"],
    properties: { repo_id: stringProperty("Repo id, 'owner/name'") },
  }),
  toolDef(
    "comfyui_status",
    "Probe a ComfyUI server's /system_stats (queue, devices, VRAM).",
    {
      type: "object",
      required: ["endpoint"],
      properties: { endpoint: stringProperty("ComfyUI server URL, e.g. http://127.0.0.1:8188") },
    },
  ),
  toolDef("register_model", "Register a generation model row (no download).", {
    type: "object",
    required: ["name", "backend", "task_types"],
    properties: {
      name: stringProperty("Display name"),
      model_id: stringProperty("Explicit model id (lowercase, default: generated)"),
      backend: stringProperty("mock | local_cli | comfyui | local_http"),
      task_types: stringArrayProperty(TASK_TYPES_HELP),
      file_url: stringProperty("Direct download URL for the weights (source: url)"),
      repository_url: stringProperty("Download URL for the weights (source: url)"),
      version: stringProperty("Version string"),
      min_vram_mb: { type: "integer" },
      dependencies: stringArrayProperty("Required binaries"),
      known_limitations: stringArrayProperty("Known limitations"),
      default_settings: SETTINGS_HELP,
    },
  }),
  toolDef("register_model_from_huggingface", "Register a model straight from a HuggingFace repo.", {
    type: "object",
    required: ["repo_id"],
    properties: {
      repo_id: stringProperty("Repo id, 'owner/name'"),
      file: stringProperty("Weight file (default: largest .safetensors/.gguf/.ckpt/.bin)"),
      backend: stringProperty("mock | local_cli | comfyui | local_http (default: local_cli)"),
      task_types: stringArrayProperty(TASK_TYPES_HELP),
      name: stringProperty("Display name (default: repo id)"),
      version: stringProperty("Version string (default: 1.0)"),
      default_settings: SETTINGS_HELP,
    },
  }),
  toolDef(
    "update_model",
    "Update a registered model's editable fields (task_types, default_settings, enabled). " +
      "Use to fix or complete a model's adapter settings without re-registering.",
    {
      type: "object",
      required: ["model_id"],
      properties: {
        model_id: stringProperty("Registered model id"),
        task_types: stringArrayProperty(TASK_TYPES_HELP),
        default_settings: SETTINGS_HELP,
        enabled: { type: "boolean" },
      },
    },
  ),
  toolDef(
    "write_model_file",
    "Write a text file (e.g. a Python runner script or requirements notes) into a model's " +
      "storage directory so a local_cli command can reference it by absolute path.",
    {
      type: "object",
      required: ["model_id", "filename", "content"],
      properties: {
        model_id: stringProperty("Registered model id"),
        filename: stringProperty(
          "Basename only, e.g. 'runner.py' (no slashes; 'model.bin*' and '.venv' are reserved)",
        ),
        content: stringProperty("Full file content (UTF-8, max 256 KB)"),
      },
    },
  ),
  toolDef(
    "install_model_deps",
    "Create a Python virtualenv inside the model's directory and pip-install the given " +
      "packages into it (multi-GB downloads are normal). Returns the venv python path to use " +
      "as the local_cli 'command'.",
    {
      type: "object",
      required: ["model_id", "packages"],
      properties: {
        model_id: stringProperty("Registered model id"),
        packages: stringArrayProperty(
          "pip requirements, e.g. ['torch', 'diffusers'] (name + optional version spec)",
        ),
      },
    },
  ),
  toolDef("install_model", "Download + store a model's weights (consent is the user's approval).", {
    type: "object",
    required: ["model_id"],
    properties: { model_id: stringProperty("Registered model id") },
  }),
  toolDef("remove_model", "Remove a registered model and its stored files.", {
    type: "object",
    required: ["model_id"],
    properties: { model_id: stringProperty("Registered model id") },
  }),
  toolDef(
    "run_smoke_test",
    "Run the model's local_cli command ONCE with a minimal prompt and a short timeout (default 60s, max 180s). " +
      "Returns the exit code and the exact stderr tail on failure — the error to fix. Use it to validate every " +
      "change in a fix loop instead of asking the user to run the model and paste the error back. A 'started_ok' " +
      "status means the process ran the full timeout without failing (startup healthy — not a quality or speed " +
      "measurement; use run_benchmark for that).",
    {
      type: "object",
      required: ["model_id"],
      properties: {
        model_id: stringProperty("Registered model id"),
        timeout_seconds: {
          type: "integer",
          minimum: 1,
          maximum: SMOKE_TEST_MAX_TIMEOUT_SECONDS,
          description: `Bounded run in seconds (default ${SMOKE_TEST_DEFAULT_TIMEOUT_SECONDS})`,
        },
      },
    },
  ),
  toolDef(
    "run_benchmark",
    "Enqueue a deterministic benchmark job (fixed prompts, 2 candidates per benchmarkable task type). Runs " +
      "asynchronously in the job queue — a full run can take hours on CPU. Returns the job id immediately; check " +
      "status and measurement rows with benchmark_results. Only benchmark once run_smoke_test passes.",
    {
      type: "object",
      required: ["model_id"],
      properties: { model_id: stringProperty("Registered model id") },
    },
  ),
  toolDef(
    "benchmark_results",
    "Read a model's benchmark measurement rows (duration_ms, candidate_count, output_bytes per task) and the " +
      "status of its most recent benchmark jobs. Read-only.",
    {
      type: "object",
      required: ["model_id"],
      properties: { model_id: stringProperty("Registered model id") },
    },
  ),
];

/** Tools a caller may use: mutating tools are admin-only (schema level). */
export function agentToolDefs(isAdmin: boolean): LlmToolDef[] {
  if (isAdmin) return AGENT_TOOL_DEFS;
  const allowed = new Set(READ_ONLY_AGENT_TOOLS);
  return AGENT_TOOL_DEFS.filter((t) => allowed.has(t.function.name as AgentToolName));
}

export function isMutatingAgentTool(name: string): boolean {
  return (MUTATING_AGENT_TOOLS as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// Proposals (in-memory, 1 h TTL, never persisted)
// ---------------------------------------------------------------------------

export interface AgentProposal {
  id: string;
  tool: AgentToolName;
  args: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  expires_at: string;
  /** User who created the proposal (via an agent turn). */
  user_id: number;
  /** True while the approved tool call is executing (status is still "pending"). */
  in_flight?: boolean;
  /** Set when the approved tool call started executing. */
  started_at?: string;
  /** Conversation that created the proposal (client conversation id). */
  conversation_id?: string;
  result?: Record<string, unknown> | null;
}

const proposals = new Map<string, AgentProposal>();

function nowIso(): string {
  return new Date().toISOString();
}

function pruneProposals(now = Date.now()): void {
  for (const [id, p] of proposals) {
    if (now > Date.parse(p.expires_at)) proposals.delete(id);
  }
}

/** Test-only: drop all in-memory proposals (the map outlives individual tests). */
export function resetProposals(): void {
  proposals.clear();
}

export interface CreateProposalResult {
  proposal: AgentProposal;
  /**
   * True when a pending proposal with the same tool and identical
   * (canonicalized) arguments already exists in this conversation — the
   * existing proposal is returned and no new one is created, so a looping
   * model cannot stack duplicate approval cards for the same step.
   */
  duplicate: boolean;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function proposalArgsKey(tool: AgentToolName, args: Record<string, unknown>): string {
  return `${tool}\u0000${JSON.stringify(canonicalize(args))}`;
}

export function createProposal(
  tool: AgentToolName,
  args: Record<string, unknown>,
  userId: number,
  conversationId?: string,
): CreateProposalResult {
  pruneProposals();
  const scope = conversationId ?? `user:${userId}`;
  const key = proposalArgsKey(tool, args);
  for (const existing of proposals.values()) {
    if (
      existing.status === "pending" &&
      (existing.conversation_id ?? `user:${existing.user_id}`) === scope &&
      proposalArgsKey(existing.tool, existing.args) === key
    ) {
      return { proposal: existing, duplicate: true };
    }
  }
  const proposal: AgentProposal = {
    id: crypto.randomUUID(),
    tool,
    args,
    status: "pending",
    created_at: nowIso(),
    expires_at: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString(),
    user_id: userId,
  };
  if (conversationId) proposal.conversation_id = conversationId;
  proposals.set(proposal.id, proposal);
  return { proposal, duplicate: false };
}

function findPendingProposal(id: string): AgentProposal {
  pruneProposals();
  const proposal = proposals.get(id);
  if (!proposal) throw notFound("Proposal not found or expired");
  if (proposal.in_flight) {
    throw conflict("Proposal is already in progress");
  }
  if (proposal.status !== "pending") {
    throw conflict(`Proposal is already ${proposal.status}`);
  }
  return proposal;
}

/**
 * Approve a proposal: re-check admin + re-run validation by executing the
 * stored call (a validation failure propagates and leaves the proposal
 * pending, so it can be retried or rejected).
 */
export async function approveProposal(
  id: string,
  userId: number,
  isAdmin: boolean,
): Promise<{ proposal: AgentProposal; result: Record<string, unknown> | null }> {
  const proposal = findPendingProposal(id);
  if (!isAdmin) throw forbidden("Admin role required to approve proposals");
  // Mark in-flight BEFORE executing so a duplicate approve (double-click,
  // second tab, client retry) fails fast with 409 instead of starting a
  // second concurrent execution of the same tool call.
  proposal.in_flight = true;
  proposal.started_at = nowIso();
  let result: Record<string, unknown> | null;
  try {
    result = (await runTool(proposal.tool, proposal.args, { userId, isAdmin })) as
      | Record<string, unknown>
      | null;
  } catch (err) {
    proposal.in_flight = false;
    throw err;
  }
  proposal.in_flight = false;
  proposal.status = "approved";
  proposal.result = result;
  return { proposal, result };
}

export function rejectProposal(
  id: string,
  isAdmin: boolean,
): AgentProposal {
  const proposal = findPendingProposal(id);
  if (!isAdmin) throw forbidden("Admin role required to reject proposals");
  proposal.status = "rejected";
  return proposal;
}

export function listPendingProposals(): AgentProposal[] {
  pruneProposals();
  return [...proposals.values()].filter((p) => p.status === "pending");
}

/** Proposals visible to a user: their own, plus everything for admins. */
export function listProposals(userId: number, isAdmin: boolean): AgentProposal[] {
  pruneProposals();
  return [...proposals.values()].filter((p) => isAdmin || p.user_id === userId);
}

/** Model-scoped mutating tools that may auto-approve under a model's
 * agent_auto_approve flag. Non-scoped tools (register, install, remove,
 * settings) always need a human approval. */
const AUTO_APPROVABLE_TOOLS: ReadonlySet<string> = new Set([
  "update_model",
  "write_model_file",
  "install_model_deps",
  "run_smoke_test",
  "run_benchmark",
]);

/** The target model when the call is model-scoped, that model has
 * agent_auto_approve, and the tool is auto-approvable — else undefined. */
function autoApproveModelFor(
  tool: string,
  args: Record<string, unknown>,
): Model | undefined {
  if (!AUTO_APPROVABLE_TOOLS.has(tool)) return undefined;
  const modelId = args.model_id;
  if (typeof modelId !== "string" || modelId === "") return undefined;
  const model = getModel(modelId);
  return model && model.agent_auto_approve ? model : undefined;
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

interface ToolContext {
  userId: number;
  isAdmin: boolean;
}

function argString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value === "") return undefined;
  return value;
}

function argStringRequired(args: Record<string, unknown>, key: string): string {
  const value = argString(args, key);
  if (value === undefined) throw badRequest(`${key} is required`, key);
  return value;
}

function argInt(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`${key} must be an integer`, key);
  }
  return value;
}

function argStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw badRequest(`${key} must be an array of strings`, key);
  }
  return value as string[];
}

function argBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw badRequest(`${key} must be a boolean`, key);
  return value;
}

function argObject(
  args: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0
  ) {
    throw badRequest(`${key} must be a non-empty JSON object`, key);
  }
  return value as Record<string, unknown>;
}

async function comfyuiStatus(endpoint: string): Promise<Record<string, unknown>> {
  let parsed: URL;
  try {
    parsed = new URL(endpoint.trim());
  } catch {
    throw badRequest("endpoint must be a URL like http://127.0.0.1:8188", "endpoint");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw badRequest("endpoint must use http or https", "endpoint");
  }
  let res: Response;
  try {
    res = await fetch(`${parsed.origin}/system_stats`, {
      signal: AbortSignal.timeout(COMFYUI_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError(
      ERROR_CODES.LLM_UNREACHABLE,
      `Cannot reach ComfyUI at ${parsed.origin}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { status: 502 },
    );
  }
  if (!res.ok) {
    throw new AppError(
      ERROR_CODES.LLM_BAD_RESPONSE,
      `ComfyUI at ${parsed.origin} answered HTTP ${res.status}`,
      { status: 502, details: `HTTP ${res.status}` },
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  const devices = Array.isArray(data.devices) ? data.devices : [];
  return {
    reachable: true,
    queue: {
      running: Array.isArray(data.queue_running) ? data.queue_running.length : 0,
      pending: Array.isArray(data.queue_pending) ? data.queue_pending.length : 0,
    },
    devices: (devices as Array<Record<string, unknown>>).map((d) => ({
      name: d.name,
      vram_total_mb: d.vram_total !== undefined ? Math.round(Number(d.vram_total) / 1048576) : null,
      vram_free_mb: d.vram_free !== undefined ? Math.round(Number(d.vram_free) / 1048576) : null,
    })),
  };
}

function buildRegisterInput(
  args: Record<string, unknown>,
): RegisterModelInput {
  const name = argStringRequired(args, "name");
  const backend = argStringRequired(args, "backend");
  const taskTypes = argStringArray(args, "task_types");
  const repositoryUrl = argString(args, "repository_url") ?? argString(args, "file_url");
  const input: RegisterModelInput = {
    name,
    version: argString(args, "version") ?? "1.0",
    backend: backend as RegisterModelInput["backend"],
    task_types: taskTypes,
    vram_requirement_mb: argInt(args, "min_vram_mb"),
    dependencies: argStringArray(args, "dependencies"),
    known_limitations: argStringArray(args, "known_limitations"),
    default_settings: argObject(args, "default_settings"),
  };
  const explicitId = argString(args, "model_id");
  if (explicitId) input.id = explicitId;
  if (repositoryUrl) {
    input.source = "url";
    input.repository_url = repositoryUrl;
  }
  return input;
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  switch (name) {
    case "list_models": {
      const taskType = argString(args, "task_type");
      const models = listModels(taskType ? { task_type: taskType } : {});
      return models.map((m) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        backend: m.backend,
        task_types: m.task_types,
        enabled: m.enabled,
        installed: m.installed_at !== null,
        license: m.license,
      }));
    }
    case "model_info": {
      const id = argStringRequired(args, "model_id");
      const model = getModel(id);
      if (!model) throw notFound(`Unknown model id '${id}'`);
      return model;
    }
    case "model_files": {
      const id = argStringRequired(args, "model_id");
      return listModelFiles(id);
    }
    case "list_skills": {
      const assistantOnly = argBool(args, "assistant_only") ?? false;
      return listSkills(assistantOnly).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        version: s.version,
        enabled: s.enabled,
        is_system: s.is_system,
        assistant: s.definition.assistant !== undefined,
      }));
    }
    case "huggingface_search": {
      const query = argStringRequired(args, "query");
      const limit = argInt(args, "limit");
      const results = await searchHuggingFaceModels(query, null, limit ?? 12);
      return results.map((r) => ({
        id: r.id,
        likes: r.likes,
        downloads: r.downloads,
        pipeline_tag: r.pipeline_tag,
        license: r.license,
      }));
    }
    case "huggingface_model_info": {
      const repoId = argStringRequired(args, "repo_id");
      const info = await getHuggingFaceRepo(repoId);
      return { repo: info.repo, files: info.files };
    }
    case "comfyui_status": {
      const endpoint = argStringRequired(args, "endpoint");
      return await comfyuiStatus(endpoint);
    }
    case "register_model": {
      const input = buildRegisterInput(args);
      const model = registerModel(ctx.userId, input);
      return { model, installed: false, note: "Weights not downloaded — install_model next" };
    }
    case "register_model_from_huggingface": {
      const repoId = argStringRequired(args, "repo_id");
      const result = await registerModelFromHuggingFace(ctx.userId, repoId, {
        file: argString(args, "file"),
        backend: argString(args, "backend"),
        name: argString(args, "name"),
        version: argString(args, "version"),
        task_types: argStringArray(args, "task_types"),
        default_settings: argObject(args, "default_settings"),
      });
      return { ...result, installed: false, note: "Weights not downloaded — install_model next" };
    }
    case "update_model": {
      const id = argStringRequired(args, "model_id");
      const patch: UpdateModelInput = {};
      const taskTypes = argStringArray(args, "task_types");
      if (taskTypes) patch.task_types = taskTypes;
      const settings = argObject(args, "default_settings");
      if (settings) patch.default_settings = settings;
      const enabled = argBool(args, "enabled");
      if (enabled !== undefined) patch.enabled = enabled;
      if (Object.keys(patch).length === 0) {
        throw badRequest(
          "Provide at least one field to update (task_types, default_settings, enabled)",
          "patch",
        );
      }
      const updated = updateModel(ctx.userId, id, patch);
      if (!updated) throw notFound(`Unknown model id '${id}'`);
      return { model: updated };
    }
    case "write_model_file": {
      const id = argStringRequired(args, "model_id");
      if (!getModel(id)) throw notFound(`Unknown model id '${id}'`);
      const filename = argStringRequired(args, "filename");
      const content = args["content"];
      if (typeof content !== "string") throw badRequest("content is required", "content");
      return await writeModelFile(id, filename, content);
    }
    case "install_model_deps": {
      const id = argStringRequired(args, "model_id");
      if (!getModel(id)) throw notFound(`Unknown model id '${id}'`);
      const packages = argStringArray(args, "packages");
      if (!packages || packages.length === 0) {
        throw badRequest("packages is required", "packages");
      }
      return await setupModelVenv(id, packages);
    }
    case "install_model": {
      const id = argStringRequired(args, "model_id");
      // The user's approval of this proposal is the explicit consent (MOD-013).
      return await installModelById(id, { consent: true });
    }
    case "remove_model": {
      const id = argStringRequired(args, "model_id");
      const model = getModel(id);
      if (!model) throw notFound(`Unknown model id '${id}'`);
      deleteModel(ctx.userId, id);
      await removeModelFiles(storageLayout(loadConfig().appDataDir), id);
      return { deleted: true, id };
    }
    case "run_smoke_test": {
      const id = argStringRequired(args, "model_id");
      const timeout = argInt(args, "timeout_seconds");
      return await runSmokeTest(id, timeout);
    }
    case "run_benchmark": {
      const id = argStringRequired(args, "model_id");
      const open = listJobs({ model_id: id, job_type: BENCHMARK_JOB_TYPE }).filter(
        (j) => j.status === "queued" || j.status === "running",
      );
      if (open.length > 0) {
        throw badRequest(
          `A benchmark for this model is already ${open[0].status} (job ${open[0].id}) — ` +
            "check benchmark_results instead of enqueueing another",
          "model_id",
        );
      }
      const job = requestBenchmark(id, ctx.userId);
      return {
        job_id: job.job_id,
        tasks: job.tasks,
        note: "Benchmark enqueued — it runs asynchronously in the job queue and can take hours " +
          "on CPU. Check status and measurement rows with benchmark_results.",
      };
    }
    case "benchmark_results": {
      const id = argStringRequired(args, "model_id");
      if (!getModel(id)) throw notFound(`Unknown model id '${id}'`);
      const recent = listJobs({ model_id: id, job_type: BENCHMARK_JOB_TYPE, limit: 3 }).map(
        (j) => ({
          job_id: j.id,
          status: j.status,
          progress: j.progress,
          created_at: j.created_at,
          finished_at: j.finished_at,
          error: j.error_text,
        }),
      );
      return { results: listBenchmarkResults(id), recent_jobs: recent };
    }
    default:
      throw badRequest(`Unknown tool '${name}'`, "tool");
  }
}

// ---------------------------------------------------------------------------
// The bounded tool-calling loop
// ---------------------------------------------------------------------------

export interface AgentHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  status: "ok" | "error" | "proposal";
  summary: string;
  proposal_id?: string;
}

export interface AgentRunResult {
  reply: string;
  model: string;
  iterations: number;
  truncated: boolean;
  steps: AgentStep[];
  proposals: AgentProposal[];
}

export function validateAgentHistory(raw: unknown): LlmMessage[] {
  if (!Array.isArray(raw)) throw badRequest("history must be an array");
  if (raw.length === 0) throw badRequest("history must contain at least one message");
  let entries: unknown[] = raw;
  let trimmed = false;
  if (entries.length > AGENT_MAX_HISTORY) {
    // Keep the newest window, never reject: the conversation log keeps the
    // full history, and re-sending a growing transcript to the LLM every
    // turn is what the budget is for.
    entries = entries.slice(-AGENT_MAX_HISTORY);
    trimmed = true;
    // Start the window at a user turn so the conversation sent to the LLM
    // does not begin with an orphaned assistant reply.
    const firstUser = entries.findIndex((entry) =>
      typeof entry === "object" && entry !== null && (entry as { role?: unknown }).role === "user"
    );
    if (firstUser > 0) entries = entries.slice(firstUser);
  }
  const offset = raw.length - entries.length;
  const messages = entries.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw badRequest(`history[${offset + i}] must be an object`);
    }
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") {
      throw badRequest(`history[${offset + i}].role must be 'user' or 'assistant'`);
    }
    if (typeof content !== "string" || content.trim() === "") {
      throw badRequest(`history[${offset + i}].content must be a non-empty string`);
    }
    return { role: role as "user" | "assistant", content: content.slice(0, 20000) };
  });
  if (trimmed) {
    messages.unshift({
      role: "user",
      content:
        "Note: the earliest turns of this conversation were omitted to stay within the context budget. Rely only on the turns shown below.",
    });
  }
  return messages;
}

/**
 * Live context so the copilot knows what is already registered and which
 * proposals are still awaiting approval (live from the proposal store), so
 * it can propose corrected replacements for broken pending steps instead of
 * re-proposing them or staying silent.
 */
export async function copilotSystemPrompt(userId: number, isAdmin: boolean): Promise<string> {
  const models = listModels();
  const taskTypes = [...new Set(models.flatMap((m) => m.task_types))].sort();
  const assistantSkills = listSkills(true);
  const hardware = await detectHardware();
  const pending = listProposals(userId, isAdmin).filter((p) => p.status === "pending");
  const pendingSection = pending.length === 0
    ? "No proposals are currently pending."
    : "Pending proposals awaiting the user's decision (created earlier, not yet executed):\n" +
      pending
        .map((p, i) => {
          const args = JSON.stringify(p.args);
          const summary = args.length > 200 ? `${args.slice(0, 200)}…` : args;
          const flight = p.in_flight ? " (currently executing)" : "";
          return `${i + 1}. ${p.tool} — ${summary}${flight}`;
        })
        .join("\n");
  const autoModels = isAdmin ? models.filter((m) => m.agent_auto_approve) : [];
  const autoApproveSection = autoModels.length === 0 ? "" : "Agent auto-approval is ON for: " +
    autoModels.map((m) => `${m.id} (${m.name})`).join("; ") +
    ". Mutating tools scoped to one of these models (update_model, write_model_file, " +
    "install_model_deps, run_smoke_test, run_benchmark) auto-execute the moment you call " +
    "them — the result comes back in the SAME turn, so drive a broken or freshly-set-up " +
    "model to a working state end-to-end: make the change, run_smoke_test it, read the " +
    "error, fix the ROOT CAUSE, and repeat. Non-scoped tools (register_model, install_model, " +
    "remove_model) still need manual approval.";
  return [
    "You are the model copilot of cinemaItor, a local-first AI movie studio.",
    "You help the user choose, register, and install local generation models, and connect runtimes such as ComfyUI.",
    "Current state: " +
    `${models.length} model(s) registered` +
    (models.length > 0 ? ` covering task types: ${taskTypes.join(", ")}` : "") +
    `; ${assistantSkills.length} skill(s) carry prompt-creation guidance.`,
    `This server runs on: ${describeHardware(hardware)}.`,
    "Use that hardware as the ground truth when judging whether a model fits: compare the model's weight/VRAM needs against the free VRAM (or RAM for CPU-only), and only warn about it not fitting when the numbers actually say so — prefer quantized or smaller variants when it genuinely would not fit.",
    "Use the tools to look things up before answering. When the user asks you to register or install a model, call the matching tool — the action is only executed after the user explicitly approves your proposal (or automatically, when the model's auto-approval is on — see below).",
    "Setting up a local_cli model: it only works when its default_settings 'command' is an existing executable and every file its 'args' reference exists. When the user wants to set up (or repair) a local_cli model, propose these steps in order: " +
    "(1) huggingface_model_info and/or model_files to see what the repo/weights actually are; " +
    "(2) write_model_file a small runner script (e.g. 'runner.py') that loads the weights, takes --prompt/--seed and an OPTIONAL --image (absent = text-to-image, present = image-to-image) and writes the result to the --output path — keep it minimal and standard (a diffusers pipeline script for diffusers-format repos). --seed arrives VERBATIM as a string (benchmark jobs pass 'bench-<model-id>', candidate i gets '<seed>:<i>'), so accept any string and map it to the runtime's integer RNG seed (numeric strings pass through; otherwise hash deterministically, e.g. FNV-1a) — a type=int argparse on --seed breaks benchmarks. If the model is HuggingFace-origin, any hub downloads the script needs at run time (VAE / text encoder / tokenizer) are authenticated for you: the app injects the configured HF token into the runner environment as HF_TOKEN, so rely on that (huggingface_hub picks it up automatically) and NEVER hardcode a token into the script; " +
    "(3) install_model_deps to build a .venv with the packages the script needs — its result carries the venv python path; " +
    "(4) register_model / register_model_from_huggingface (or update_model for an existing row) with default_settings.command set to that venv python path, args referencing the runner script by its absolute path with the {prompt}/{seed}/{output} placeholders and a BARE '{input:0}' token (as its own args entry, after its flag) for the reference image — the app drops it when a job has no references, so dual t2i/i2i models work from one settings row — plus a device flag matching this server's hardware (cuda when a GPU with sufficient free VRAM is detected, cpu otherwise). " +
    "Never leave a local_cli model whose command or referenced script is missing — if you are unsure what the runtime needs, propose the setup steps instead of guessing.",
    'GGUF weights (a single .gguf file, e.g. city96-style FLUX/SD3.5/Wan/LTX/HiDream/Qwen quants): diffusers has a native GGUF loader, but it is BACKBONE-ONLY and the backbone must be a DiT/transformer — UNet models (SD 1.5/SDXL) CANNOT be loaded from GGUF in diffusers (4-D conv weights are not representable; third-party SDXL GGUFs store convs as flat 2-D matrices and the loader rejects them — for those models use the full-precision checkpoint or ComfyUI). `Pipeline.from_pretrained("....gguf")` is also NOT supported, and a failure there does NOT mean the GGUF is unsupported; do not conclude \'diffusers has no GGUF support\' from it. Recipe: add `gguf>=0.10`, `accelerate` (and `transformers` for the pipeline classes) to the venv; load the backbone with `backbone = <TransformerClass>.from_single_file(gguf_path, quantization_config=GGUFQuantizationConfig(compute_dtype=...))`, passing `config="<diffusers-format repo>", subfolder="transformer"` explicitly for diffusers-format GGUFs (the shape heuristic misidentifies the base model otherwise); original-layout (city96) files embed their source repo and load without it. Then build the pipeline from the diffusers-format base repo, injecting the backbone, and load the text encoder(s)/VAE/tokenizer(s) as usual (their .safetensors also work via from_single_file). Supported quants: BF16, Q4_0/Q4_1, Q5_0/Q5_1, Q8_0, Q2_K–Q6_K. Weights stay uint8 and dequantize per forward pass, so a quantized model needs far less RAM/VRAM than its full-precision size and runs on CPU. The app sets two env vars on the runner: RUNNER_DEVICE (cpu|cuda — the user\'s explicit device choice from the pre-generation VRAM dialog; honour it when set) and RUNNER_MIN_FREE_VRAM_MB (the model\'s declared VRAM requirement in MB — use it as the auto-fallback threshold when set, else a conservative default). Workstations often share the GPU with other processes (LLM servers, other pipelines): when deciding the device yourself (no RUNNER_DEVICE), check `torch.cuda.mem_get_info()` before moving the pipeline to cuda and fall back to cpu when free VRAM is below the threshold — a .to(`cuda`) on a saturated GPU dies with an OOM mid-move. Once the device is decided, print a flushed machine-readable line `RUNNER_STATUS {"device": "cuda" or "cpu"}` (optionally with free_vram_gib) to stdout — the app forwards it to the job card as a runner.log event, so a multi-hour run tells the user which device it is actually using.',
    "Fixing a model: validate EVERY change (settings, runner script, venv) with run_smoke_test instead of asking the user to run the model and paste the error back — when auto-approval is on the test runs in the same turn, so chain change -> smoke test -> fix -> smoke test; otherwise propose the smoke test and continue once it is approved. On a smoke-test failure, read its error_tail, fix the ROOT CAUSE (wrong path, missing module, bad flag — never a workaround), and smoke-test again. Run a full run_benchmark only once the smoke test passes — benchmarks are slow (hours on CPU) and async: report the job id and check benchmark_results when asked.",
    "If you ask the user to approve something, you must have called the matching mutating tool in this same turn. Never end a turn asking for approval of a proposal you did not create; if you cannot create the proposal because information is missing, say exactly what is missing instead of asking for approval. Never write 'I've proposed ...' / 'I've created a proposal ...' unless the mutating tool call has actually been made in this turn and returned — describe what you intend to do instead.",
    "The user approves each proposal AFTER your turn ends — the outcome reaches you as a new message. When it does, continue the plan and propose the next steps; never assume an approval already happened within the current turn. Do not re-propose a pending step with identical arguments — it already awaits the user's decision. But if a pending step is wrong (the user reports an error, or it failed or was rejected), propose the CORRECTED version as a new proposal: a replacement for a broken pending step is expected, not a duplicate. When the user explicitly asks you to create an approval request, call the mutating tool — the pending list below tells you what is already open.",
    pendingSection,
    autoApproveSection,
    "Be concise and practical; explain trade-offs (VRAM, backend) in one or two lines.",
  ].filter((part) => part !== "").join("\n");
}

function toolMessage(call: LlmToolCall, content: string): LlmMessage {
  return {
    role: "tool",
    tool_call_id: call.id,
    name: call.function.name,
    content,
  };
}

function summarizeStep(name: string, result: unknown): string {
  if (Array.isArray(result)) return `${result.length} result(s)`;
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (r.deleted) return "model removed";
    if (
      typeof r.status === "string" &&
      (r.status === "ok" || r.status === "failed" || r.status === "started_ok") &&
      typeof r.duration_ms === "number"
    ) {
      const secs = (r.duration_ms / 1000).toFixed(1);
      if (r.status === "failed") {
        const tail = String(r.error_tail ?? "").slice(0, 200);
        return `smoke test failed (exit ${String(r.exit_code)} in ${secs}s) — ${tail}`;
      }
      if (r.status === "started_ok") {
        return `smoke test: process ran the full ${secs}s timeout without failing (startup healthy)`;
      }
      return `smoke test passed in ${secs}s`;
    }
    if (r.job_id && Array.isArray(r.tasks)) {
      return `benchmark enqueued (job ${String(r.job_id)}, tasks: ${r.tasks.join(", ")})`;
    }
    if (r.reachable) {
      const q = r.queue as { running: number; pending: number } | undefined;
      return q
        ? `ComfyUI reachable (queue: ${q.running} running, ${q.pending} pending)`
        : "ComfyUI reachable";
    }
    if (r.model) return `model '${(r.model as Record<string, unknown>).name}'`;
    if (r.repo) return `repo ${(r.repo as Record<string, unknown>).id}`;
    if (r.file) return `weight file: ${r.file}`;
  }
  return `${name}: ok`;
}

export interface AgentRunOptions {
  history: unknown;
  userId: number;
  isAdmin: boolean;
  model?: string;
  /** Client conversation id — stamped on created proposals so the
   *  conversation log can record approval/rejection outcomes. */
  conversationId?: string;
}

/**
 * Run one copilot turn: a bounded tool-calling loop
 * (max AGENT_MAX_TOOL_ITERATIONS tool round-trips). Read-only tools
 * auto-execute; mutating tools create proposals that await explicit user
 * approval (approveProposal/rejectProposal) — except model-scoped calls under
 * a model's agent_auto_approve flag, which execute in-loop and log an
 * "auto_approved" outcome.
 */
/** First user message, whitespace-normalized, 80 chars — the conversation
 * title convention (mirrors the route's conversationTitle). */
function historyTitle(history: LlmMessage[]): string {
  for (const m of history) {
    if (m.role === "user" && m.content) {
      return m.content.replace(/\s+/g, " ").trim().slice(0, 80);
    }
  }
  return "";
}

const CLAIM_PROPOSAL_PATTERNS: RegExp[] = [
  /i'?ve (?:proposed|created)/i,
  /\bi (?:have |just )?proposed\b/i,
  /\bproposed (?:running|installing|writing|updating|adding|removing|creating|registering|that|a |an |the)\b/i,
  /\bproposals? (?:is|are) (?:\w+ )?(?:ready|pending|awaiting|submitted)\b/i,
  /approval request (?:is|was)/i,
];

/**
 * True when an assistant reply claims a proposal was made ("I've proposed
 * running a smoke test") — the claim that must be backed by an actual tool
 * call. Used by runAgent's one-shot verification nudge when the turn
 * created zero proposals, and by tests.
 */
export function claimsProposalReply(content: string): boolean {
  if (typeof content !== "string" || content.trim() === "") return false;
  return CLAIM_PROPOSAL_PATTERNS.some((re) => re.test(content));
}

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const history = validateAgentHistory(opts.history);
  if (opts.conversationId) {
    // Proposal events log mid-loop; the row must exist before the first write
    // (logAgentTurn only creates it after the turn completes).
    touchConversation(opts.conversationId, opts.userId, opts.isAdmin, historyTitle(history));
  }
  const messages: LlmMessage[] = [
    { role: "system", content: await copilotSystemPrompt(opts.userId, opts.isAdmin) },
    ...history,
  ];
  const tools = agentToolDefs(opts.isAdmin);
  const steps: AgentStep[] = [];
  const created: AgentProposal[] = [];
  let reply = "";
  let model = "";
  let iterations = 0;
  let lastHadToolCalls = false;
  let budget = AGENT_MAX_TOOL_ITERATIONS;
  let claimNudged = false;

  for (let i = 0; i < budget; i++) {
    iterations++;
    const result = await chatLlm({ messages, model: opts.model, tools });
    model = result.model;
    if (result.content) reply = result.content;

    const assistantMessage: LlmMessage = {
      role: "assistant",
      content: result.content,
    };
    if (result.toolCalls.length > 0) assistantMessage.tool_calls = result.toolCalls;
    messages.push(assistantMessage);

    lastHadToolCalls = result.toolCalls.length > 0;
    if (!lastHadToolCalls) {
      // Claim-verification guard: the reply asserts that a proposal was
      // created, but the turn produced none — the "I've proposed running a
      // smoke test" dead end where the user has nothing to approve. Send the
      // copilot back ONCE with an explicit instruction to make the tool call
      // for real (the frontend nudge button remains as the fallback).
      if (!claimNudged && created.length === 0 && claimsProposalReply(result.content ?? "")) {
        claimNudged = true;
        budget += AGENT_CLAIM_NUDGE_ITERATIONS;
        messages.push({
          role: "user",
          content:
            "You said you proposed something, but no proposal was created this turn — there is nothing for me to approve. " +
            "Call the matching mutating tool now so the approval request actually exists. " +
            "If you cannot create it, say exactly what is missing.",
        });
        continue;
      }
      break;
    }

    for (const call of result.toolCalls) {
      const name = call.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        if (typeof args !== "object" || args === null || Array.isArray(args)) args = {};
      } catch {
        args = {};
      }
      const step: AgentStep = { tool: name, args, status: "error", summary: "" };

      if (!AGENT_TOOL_DEFS.some((t) => t.function.name === name)) {
        step.summary = `Unknown tool '${name}'`;
        messages.push(toolMessage(call, JSON.stringify({ error: step.summary })));
      } else if (isMutatingAgentTool(name) && !opts.isAdmin) {
        step.summary = "Mutating tools require the admin role";
        messages.push(toolMessage(call, JSON.stringify({ error: step.summary })));
      } else if (isMutatingAgentTool(name)) {
        const { proposal, duplicate } = createProposal(
          name as AgentToolName,
          args,
          opts.userId,
          opts.conversationId,
        );
        if (duplicate) {
          // The identical step already awaits the user's decision — do not
          // stack duplicate cards, and tell the model to stop re-proposing.
          step.status = "proposal";
          step.proposal_id = proposal.id;
          step.summary = `Duplicate — an identical ${name} proposal is already pending`;
          messages.push(
            toolMessage(
              call,
              JSON.stringify({
                status: "already_pending",
                proposal_id: proposal.id,
                tool: proposal.tool,
                note:
                  "An identical proposal is already awaiting approval. Do not re-propose it — the user will approve or reject the existing one.",
              }),
            ),
          );
        } else {
          created.push(proposal);
          step.proposal_id = proposal.id;
          // Model-scoped proposals under a model's agent_auto_approve flag
          // execute immediately through the same single-flight path as a
          // manual approval, so the fix loop (change -> smoke test -> fix ->
          // ...) runs inside this turn. On failure the proposal stays pending
          // for a manual retry.
          const autoModel = autoApproveModelFor(name, args);
          if (autoModel) {
            try {
              const { result } = await approveProposal(
                proposal.id,
                opts.userId,
                opts.isAdmin,
              );
              step.status = "ok";
              step.summary = `auto-approved (${autoModel.id}) — ${summarizeStep(name, result)}`;
              if (opts.conversationId) {
                // Best-effort: a storage failure must not fail the turn.
                try {
                  logProposalEvent(
                    opts.conversationId,
                    opts.userId,
                    opts.isAdmin,
                    proposal.id,
                    "auto_approved",
                  );
                } catch (err) {
                  console.warn("[llm_agent] failed to log auto-approval event:", err);
                }
              }
              messages.push(
                toolMessage(call, JSON.stringify(result).slice(0, TOOL_RESULT_MAX_CHARS)),
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              step.status = "error";
              step.summary = `auto-approval failed: ${message}`;
              messages.push(
                toolMessage(
                  call,
                  JSON.stringify({
                    error: message,
                    proposal_id: proposal.id,
                    status: "auto_approval_failed",
                    note: "The proposal is still pending; the user can approve it manually.",
                  }),
                ),
              );
            }
          } else {
            step.status = "proposal";
            step.summary = "Proposal created — awaiting user approval";
            messages.push(
              toolMessage(
                call,
                JSON.stringify({
                  status: "pending_approval",
                  proposal_id: proposal.id,
                  tool: proposal.tool,
                }),
              ),
            );
          }
        }
      } else {
        try {
          const result = await runTool(name, args, { userId: opts.userId, isAdmin: opts.isAdmin });
          step.status = "ok";
          step.summary = summarizeStep(name, result);
          messages.push(
            toolMessage(call, JSON.stringify(result).slice(0, TOOL_RESULT_MAX_CHARS)),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          step.summary = `Error: ${message}`;
          messages.push(toolMessage(call, JSON.stringify({ error: message })));
        }
      }
      steps.push(step);
    }
  }

  let truncated = false;
  if (lastHadToolCalls) {
    truncated = true;
    const note = `(stopped after ${iterations} tool iterations)`;
    reply = reply ? `${reply}\n\n${note}` : note;
  }

  return { reply, model, iterations, truncated, steps, proposals: created };
}
