import { loadConfig } from "../config.ts";
import {
  deleteModel,
  getModel,
  listModels,
  registerModel,
  type RegisterModelInput,
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
import { installModelById, removeModelFiles } from "./model_files.ts";
import { chatLlm, type LlmMessage, type LlmToolCall, type LlmToolDef } from "./llm_client.ts";

export const AGENT_MAX_TOOL_ITERATIONS = 8;
export const AGENT_MAX_HISTORY = 32;
const PROPOSAL_TTL_MS = 60 * 60 * 1000;
const TOOL_RESULT_MAX_CHARS = 8000;
const COMFYUI_TIMEOUT_MS = 10_000;

export type AgentToolName =
  | "list_models"
  | "model_info"
  | "list_skills"
  | "huggingface_search"
  | "huggingface_model_info"
  | "comfyui_status"
  | "register_model"
  | "register_model_from_huggingface"
  | "install_model"
  | "remove_model";

export const READ_ONLY_AGENT_TOOLS: readonly AgentToolName[] = [
  "list_models",
  "model_info",
  "list_skills",
  "huggingface_search",
  "huggingface_model_info",
  "comfyui_status",
] as const;

const MUTATING_AGENT_TOOLS: readonly AgentToolName[] = [
  "register_model",
  "register_model_from_huggingface",
  "install_model",
  "remove_model",
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
      task_types: stringArrayProperty("Task types the model covers"),
      file_url: stringProperty("Direct download URL for the weights (source: url)"),
      repository_url: stringProperty("Download URL for the weights (source: url)"),
      version: stringProperty("Version string"),
      min_vram_mb: { type: "integer" },
      dependencies: stringArrayProperty("Required binaries"),
      known_limitations: stringArrayProperty("Known limitations"),
    },
  }),
  toolDef("register_model_from_huggingface", "Register a model straight from a HuggingFace repo.", {
    type: "object",
    required: ["repo_id"],
    properties: {
      repo_id: stringProperty("Repo id, 'owner/name'"),
      file: stringProperty("Weight file (default: largest .safetensors/.gguf/.ckpt/.bin)"),
      backend: stringProperty("mock | local_cli | comfyui | local_http (default: local_cli)"),
      task_types: stringArrayProperty("Task types the model covers"),
      name: stringProperty("Display name (default: repo id)"),
      version: stringProperty("Version string (default: 1.0)"),
    },
  }),
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

export function createProposal(
  tool: AgentToolName,
  args: Record<string, unknown>,
): AgentProposal {
  pruneProposals();
  const proposal: AgentProposal = {
    id: crypto.randomUUID(),
    tool,
    args,
    status: "pending",
    created_at: nowIso(),
    expires_at: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString(),
  };
  proposals.set(proposal.id, proposal);
  return proposal;
}

function findPendingProposal(id: string): AgentProposal {
  pruneProposals();
  const proposal = proposals.get(id);
  if (!proposal) throw notFound("Proposal not found or expired");
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
  const result = (await runTool(proposal.tool, proposal.args, { userId, isAdmin })) as
    | Record<string, unknown>
    | null;
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
      });
      return { ...result, installed: false, note: "Weights not downloaded — install_model next" };
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
  if (raw.length > AGENT_MAX_HISTORY) {
    throw badRequest(`history is limited to ${AGENT_MAX_HISTORY} messages`);
  }
  return raw.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw badRequest(`history[${i}] must be an object`);
    }
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") {
      throw badRequest(`history[${i}].role must be 'user' or 'assistant'`);
    }
    if (typeof content !== "string" || content.trim() === "") {
      throw badRequest(`history[${i}].content must be a non-empty string`);
    }
    return { role, content: content.slice(0, 20000) };
  });
}

/** Live context so the copilot knows what is already registered. */
export async function copilotSystemPrompt(): Promise<string> {
  const models = listModels();
  const taskTypes = [...new Set(models.flatMap((m) => m.task_types))].sort();
  const assistantSkills = listSkills(true);
  const hardware = await detectHardware();
  return [
    "You are the model copilot of cinemaItor, a local-first AI movie studio.",
    "You help the user choose, register, and install local generation models, and connect runtimes such as ComfyUI.",
    "Current state: " +
    `${models.length} model(s) registered` +
    (models.length > 0 ? ` covering task types: ${taskTypes.join(", ")}` : "") +
    `; ${assistantSkills.length} skill(s) carry prompt-creation guidance.`,
    `This server runs on: ${describeHardware(hardware)}.`,
    "Use that hardware as the ground truth when judging whether a model fits: compare the model's weight/VRAM needs against the free VRAM (or RAM for CPU-only), and only warn about it not fitting when the numbers actually say so — prefer quantized or smaller variants when it genuinely would not fit.",
    "Use the tools to look things up before answering. When the user asks you to register or install a model, call the matching tool — the action is only executed after the user explicitly approves your proposal.",
    "Be concise and practical; explain trade-offs (VRAM, backend) in one or two lines.",
  ].join("\n");
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
}

/**
 * Run one copilot turn: a bounded tool-calling loop (max 8 tool iterations).
 * Read-only tools auto-execute; mutating tools create proposals that await
 * explicit user approval (approveProposal/rejectProposal).
 */
export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const history = validateAgentHistory(opts.history);
  const messages: LlmMessage[] = [
    { role: "system", content: await copilotSystemPrompt() },
    ...history,
  ];
  const tools = agentToolDefs(opts.isAdmin);
  const steps: AgentStep[] = [];
  const created: AgentProposal[] = [];
  let reply = "";
  let model = "";
  let iterations = 0;
  let lastHadToolCalls = false;

  for (let i = 0; i < AGENT_MAX_TOOL_ITERATIONS; i++) {
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
    if (!lastHadToolCalls) break;

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
        const proposal = createProposal(name as AgentToolName, args);
        created.push(proposal);
        step.status = "proposal";
        step.proposal_id = proposal.id;
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
    const note = `(stopped after ${AGENT_MAX_TOOL_ITERATIONS} tool iterations)`;
    reply = reply ? `${reply}\n\n${note}` : note;
  }

  return { reply, model, iterations, truncated, steps, proposals: created };
}
