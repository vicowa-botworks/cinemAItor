import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import {
  getLlmSettingsView,
  isLlmConfigured,
  updateLlmSettings,
} from "@cinemaItor/db/llm_settings.ts";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { getUserById } from "@cinemaItor/db/schema.ts";
import {
  AppError,
  badRequest,
  ERROR_CODES,
  forbidden,
  notFound,
  unauthorized,
} from "@cinemaItor/errors.ts";
import { chatLlm, type LlmMessage, testLlmConnection } from "@cinemaItor/services/llm_client.ts";
import { approveProposal, rejectProposal, runAgent } from "@cinemaItor/services/llm_agent.ts";
import {
  ASSIST_PURPOSES,
  type AssistPurpose,
  buildAssistMessages,
  ensureRefsPreserved,
} from "@cinemaItor/services/llm_assist.ts";
import { getModel } from "@cinemaItor/db/models.ts";
import { getSkill } from "@cinemaItor/db/skills.ts";
import { logAudit } from "@cinemaItor/services/audit.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { errorResponses, ref } from "@cinemaItor/openapi/types.ts";

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

function requireAdmin(ctx: Context): number {
  const userId = requireUserId(ctx);
  const user = getUserById(userId);
  if (!user || user.role !== "admin") {
    throw forbidden("Admin role required for LLM settings");
  }
  return userId;
}

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function handleGetSettings(ctx: Context): void {
  requireAdmin(ctx);
  ctx.response.body = { ...getLlmSettingsView(), configured: isLlmConfigured() };
}

function handleStatus(ctx: Context): void {
  requireUserId(ctx);
  ctx.response.body = { configured: isLlmConfigured() };
}

function handleUpdateSettings(ctx: Context, body: Record<string, unknown>): void {
  const adminId = requireAdmin(ctx);
  const update: Parameters<typeof updateLlmSettings>[0] = {};
  let touched = false;

  for (const [key, value] of Object.entries(body)) {
    switch (key) {
      case "enabled": {
        if (typeof value !== "boolean") throw badRequest("enabled must be a boolean");
        update.enabled = value;
        touched = true;
        break;
      }
      case "base_url": {
        if (typeof value !== "string" || !value.trim()) {
          throw badRequest("base_url must be a non-empty string");
        }
        let parsed: URL;
        try {
          parsed = new URL(value.trim());
        } catch {
          throw badRequest("base_url is not a valid URL");
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw badRequest("base_url must use http or https");
        }
        update.baseUrl = value;
        touched = true;
        break;
      }
      case "api_key": {
        if (value !== null && typeof value !== "string") {
          throw badRequest("api_key must be a string or null to clear");
        }
        update.apiKey = value;
        touched = true;
        break;
      }
      case "model": {
        if (typeof value !== "string" || !value.trim()) {
          throw badRequest("model must be a non-empty string");
        }
        update.model = value;
        touched = true;
        break;
      }
      case "temperature": {
        if (typeof value !== "string" || !value.trim()) {
          throw badRequest("temperature must be a string");
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) {
          throw badRequest("temperature must be a number between 0 and 10");
        }
        update.temperature = value.trim();
        touched = true;
        break;
      }
      case "max_tokens": {
        if (typeof value !== "string" || !value.trim()) {
          throw badRequest("max_tokens must be a string");
        }
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
          throw badRequest("max_tokens must be an integer between 1 and 1000000");
        }
        update.maxTokens = value.trim();
        touched = true;
        break;
      }
      case "timeout_seconds": {
        if (
          typeof value !== "number" || !Number.isInteger(value) ||
          value < 1 || value > 600
        ) {
          throw badRequest("timeout_seconds must be an integer between 1 and 600");
        }
        update.timeoutSeconds = value;
        touched = true;
        break;
      }
      default:
        throw badRequest(`Unknown LLM setting '${key}'`);
    }
  }
  if (!touched) throw badRequest("No valid fields to update");

  const view = updateLlmSettings(update);
  logAudit(adminId, "llm.settings_update", "setting", Object.keys(update).join(","));
  ctx.response.body = { ...view, configured: isLlmConfigured() };
}

// ---------------------------------------------------------------------------
// Test + chat
// ---------------------------------------------------------------------------

async function handleTest(ctx: Context): Promise<void> {
  requireAdmin(ctx);
  const result = await testLlmConnection();
  if (!result.ok) {
    const { status, code, message, details } = result.error;
    ctx.response.status = status;
    ctx.response.body = { error: { code, message, details, traceId: "" } };
    return;
  }
  ctx.response.body = {
    ok: true,
    latency_ms: result.latencyMs,
    model: result.model,
    content: result.content,
  };
}

function parseChatBody(body: Record<string, unknown>) {
  const rawMessages = body.messages;
  if (
    !Array.isArray(rawMessages) || rawMessages.length === 0 ||
    rawMessages.length > 32
  ) {
    throw badRequest("messages must be an array of 1 to 32 items");
  }
  const messages: LlmMessage[] = rawMessages.map((raw, index) => {
    const msg = raw as { role?: unknown; content?: unknown };
    if (
      typeof msg !== "object" || msg === null ||
      (msg.role !== "system" && msg.role !== "user" && msg.role !== "assistant")
    ) {
      throw badRequest(`messages[${index}].role must be system, user or assistant`);
    }
    if (typeof msg.content !== "string") {
      throw badRequest(`messages[${index}].content must be a string`);
    }
    const limit = msg.role === "system" ? 16_000 : 32_000;
    if (msg.content.length > limit) {
      throw badRequest(
        `messages[${index}].content exceeds ${limit} characters`,
      );
    }
    return { role: msg.role, content: msg.content };
  });

  let model: string | undefined;
  if (body.model !== undefined) {
    if (
      typeof body.model !== "string" || !body.model.trim() ||
      body.model.trim().length > 200
    ) {
      throw badRequest("model must be a non-empty string of at most 200 chars");
    }
    model = body.model.trim();
  }
  let temperature: number | undefined;
  if (body.temperature !== undefined) {
    if (
      typeof body.temperature !== "number" || !Number.isFinite(body.temperature) ||
      body.temperature < 0 || body.temperature > 10
    ) {
      throw badRequest("temperature must be a number between 0 and 10");
    }
    temperature = body.temperature;
  }
  let maxTokens: number | undefined;
  if (body.max_tokens !== undefined) {
    if (
      typeof body.max_tokens !== "number" ||
      !Number.isInteger(body.max_tokens) || body.max_tokens < 1 ||
      body.max_tokens > 1_000_000
    ) {
      throw badRequest("max_tokens must be an integer between 1 and 1000000");
    }
    maxTokens = body.max_tokens;
  }
  return { messages, model, temperature, maxTokens };
}

async function handleChat(ctx: Context): Promise<void> {
  requireUserId(ctx);
  const body = await readJsonBody(ctx);
  const { messages, model, temperature, maxTokens } = parseChatBody(body);
  const result = await chatLlm({ messages, model, temperature, maxTokens });
  ctx.response.body = {
    content: result.content,
    model: result.model,
    usage: result.usage,
  };
}

// ---------------------------------------------------------------------------
// Assist
// ---------------------------------------------------------------------------

function parseAssistBody(body: Record<string, unknown>) {
  const purpose = body.purpose;
  if (typeof purpose !== "string" || !ASSIST_PURPOSES.includes(purpose as AssistPurpose)) {
    throw badRequest(`purpose must be one of: ${ASSIST_PURPOSES.join(", ")}`);
  }
  const context = body.context;
  if (typeof context !== "string" || context.trim().length === 0) {
    throw badRequest("context must be a non-empty string");
  }
  if (context.length > 32_000) {
    throw badRequest("context exceeds 32000 characters");
  }
  let modelId: string | undefined;
  if (body.model_id !== undefined) {
    if (typeof body.model_id !== "string" || !body.model_id.trim()) {
      throw badRequest("model_id must be a non-empty string");
    }
    modelId = body.model_id.trim();
  }
  let skillId: string | undefined;
  if (body.skill_id !== undefined) {
    if (typeof body.skill_id !== "string" || !body.skill_id.trim()) {
      throw badRequest("skill_id must be a non-empty string");
    }
    skillId = body.skill_id.trim();
  }
  let maxTokens: number | undefined;
  if (body.max_tokens !== undefined) {
    if (
      typeof body.max_tokens !== "number" ||
      !Number.isInteger(body.max_tokens) || body.max_tokens < 1 ||
      body.max_tokens > 1_000_000
    ) {
      throw badRequest("max_tokens must be an integer between 1 and 1000000");
    }
    maxTokens = body.max_tokens;
  }
  return { purpose: purpose as AssistPurpose, context, modelId, skillId, maxTokens };
}

async function handleAssist(ctx: Context): Promise<void> {
  requireUserId(ctx);
  const body = await readJsonBody(ctx);
  const { purpose, context, modelId, skillId, maxTokens } = parseAssistBody(body);

  if (purpose !== "enhance_prompt" && (modelId || skillId)) {
    throw badRequest("model_id and skill_id are only supported for purpose 'enhance_prompt'");
  }

  let model = undefined as ReturnType<typeof getModel> | undefined;
  if (modelId) {
    model = getModel(modelId);
    if (!model) throw badRequest(`Unknown model_id '${modelId}'`);
    if (!model.enabled) throw badRequest(`Model '${model.id}' is not enabled`);
  }

  let skill: ReturnType<typeof getSkill> | undefined;
  if (skillId) {
    skill = getSkill(skillId);
    if (!skill) throw badRequest(`Unknown skill_id '${skillId}'`);
    if (!skill.definition.assistant) {
      throw badRequest(`Skill '${skill.id}' has no assistant block`);
    }
  }

  if (model && skill) {
    const skillTypes = skill.definition.assistant!.model_task_types;
    const overlap = model.task_types.filter((t) => skillTypes.includes(t));
    if (overlap.length === 0) {
      throw badRequest(
        `Skill '${skill.id}' targets task types [${skillTypes.join(", ")}] which do not ` +
          `overlap the task types of model '${model.id}' [${model.task_types.join(", ")}]`,
      );
    }
  }

  const result = await chatLlm({
    messages: buildAssistMessages(purpose, context, { model, skill }),
    maxTokens,
  });
  if (result.content === null) {
    throw new AppError(
      ERROR_CODES.LLM_BAD_RESPONSE,
      "The LLM endpoint returned an unexpected response: the response has no content",
      { status: 502 },
    );
  }
  const content = purpose === "enhance_prompt"
    ? ensureRefsPreserved(result.content, context)
    : result.content;
  ctx.response.body = { purpose, content };
}

// ---------------------------------------------------------------------------
// Agent (model copilot)
// ---------------------------------------------------------------------------

function isAdminUser(userId: number): boolean {
  const user = getUserById(userId);
  return user !== undefined && user.role === "admin";
}

interface ProposalParamContext extends AuthedContext {
  params: { id?: string };
}

function proposalParam(ctx: Context): string {
  const id = (ctx as ProposalParamContext).params?.id ?? "";
  if (!id) throw notFound("Proposal not found");
  return id;
}

async function handleAgent(ctx: Context): Promise<void> {
  const userId = requireUserId(ctx);
  const body = await readJsonBody(ctx);
  let model: string | undefined;
  if (body.model !== undefined) {
    if (typeof body.model !== "string" || !body.model.trim()) {
      throw badRequest("model must be a non-empty string");
    }
    model = body.model.trim();
  }
  const result = await runAgent({
    history: body.history,
    userId,
    isAdmin: isAdminUser(userId),
    model,
  });
  logAudit(
    userId,
    "llm.agent_run",
    "llm",
    "agent",
    {
      iterations: result.iterations,
      truncated: result.truncated,
      tools: result.steps.map((s) => s.tool),
    },
  );
  ctx.response.body = {
    reply: result.reply,
    model: result.model,
    iterations: result.iterations,
    truncated: result.truncated,
    steps: result.steps,
    proposals: result.proposals,
  };
}

async function handleApproveProposal(ctx: Context): Promise<void> {
  const userId = requireUserId(ctx);
  const id = proposalParam(ctx);
  const { proposal, result } = await approveProposal(id, userId, isAdminUser(userId));
  logAudit(userId, "llm.proposal_approve", proposal.tool, proposal.id);
  ctx.response.body = { proposal, result };
}

function handleRejectProposal(ctx: Context): void {
  const userId = requireUserId(ctx);
  const id = proposalParam(ctx);
  const proposal = rejectProposal(id, isAdminUser(userId));
  logAudit(userId, "llm.proposal_reject", proposal.tool, proposal.id);
  ctx.response.body = { proposal };
}

// ---------------------------------------------------------------------------
// Router + OpenAPI metadata
// ---------------------------------------------------------------------------

export const router = new Router()
  .get("/api/v1/llm/settings", authMiddleware, handleGetSettings)
  .put("/api/v1/llm/settings", authMiddleware, async (ctx: Context) => {
    await handleUpdateSettings(ctx, await readJsonBody(ctx));
  })
  .get("/api/v1/llm/status", authMiddleware, handleStatus)
  .post("/api/v1/llm/test", authMiddleware, handleTest)
  .post("/api/v1/llm/chat", authMiddleware, handleChat)
  .post("/api/v1/llm/assist", authMiddleware, handleAssist)
  .post("/api/v1/llm/agent", authMiddleware, handleAgent)
  .post("/api/v1/llm/proposals/:id/approve", authMiddleware, handleApproveProposal)
  .post("/api/v1/llm/proposals/:id/reject", authMiddleware, handleRejectProposal);

const LlmSettingsViewSchema = {
  type: "object",
  required: [
    "enabled",
    "baseUrl",
    "apiKeySet",
    "model",
    "temperature",
    "maxTokens",
    "timeoutSeconds",
  ],
  properties: {
    enabled: { type: "boolean" },
    baseUrl: { type: "string" },
    apiKeySet: { type: "boolean" },
    model: { type: "string" },
    temperature: { type: "string" },
    maxTokens: { type: "string" },
    timeoutSeconds: { type: "integer" },
  },
} as const;

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/llm/settings": {
    summary: "Get LLM endpoint settings (API key masked)",
    adminOnly: true,
    responses: {
      200: {
        description: "Current settings; the API key is only reported as a boolean",
        schema: {
          ...LlmSettingsViewSchema,
          required: [
            "enabled",
            "baseUrl",
            "apiKeySet",
            "model",
            "temperature",
            "maxTokens",
            "timeoutSeconds",
            "configured",
          ],
          properties: {
            ...LlmSettingsViewSchema.properties,
            configured: { type: "boolean" },
          },
        },
      },
      ...errorResponses(401, 403),
    },
  },
  "PUT /api/v1/llm/settings": {
    summary: "Update LLM endpoint settings (partial)",
    adminOnly: true,
    description: "Partial update of the OpenAI-compatible LLM endpoint. api_key accepts a " +
      "string (set/replace) or null (clear).",
    requestBody: {
      description: "Any subset of the settings fields",
      schema: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          base_url: { type: "string" },
          api_key: { type: ["string", "null"] },
          model: { type: "string" },
          temperature: { type: "string" },
          max_tokens: { type: "string" },
          timeout_seconds: { type: "integer" },
        },
      },
    },
    responses: {
      200: { description: "Updated settings", schema: ref("LlmSettings") },
      ...errorResponses(400, 401, 403),
    },
  },
  "GET /api/v1/llm/status": {
    summary: "Coarse LLM status for creative UIs",
    responses: {
      200: {
        description: "Whether an LLM is enabled and fully configured",
        schema: {
          type: "object",
          required: ["configured"],
          properties: { configured: { type: "boolean" } },
        },
      },
      ...errorResponses(401),
    },
  },
  "POST /api/v1/llm/test": {
    summary: "Test the LLM connection with a minimal completion",
    adminOnly: true,
    responses: {
      200: {
        description: "Connection succeeded",
        schema: {
          type: "object",
          required: ["ok", "latency_ms", "model", "content"],
          properties: {
            ok: { type: "boolean", enum: [true] },
            latency_ms: { type: "integer" },
            model: { type: "string" },
            content: { type: "string" },
          },
        },
      },
      ...errorResponses(401, 403, 502, 503, 504),
    },
  },
  "POST /api/v1/llm/chat": {
    summary: "One-shot chat against the configured LLM",
    description: "Sends the messages to the configured OpenAI-compatible endpoint and " +
      "returns the completion. Synchronous; bounded by the configured timeout.",
    requestBody: {
      description: "Chat messages plus optional sampling overrides",
      schema: {
        type: "object",
        required: ["messages"],
        properties: {
          messages: {
            type: "array",
            minItems: 1,
            maxItems: 32,
            items: {
              type: "object",
              required: ["role", "content"],
              properties: {
                role: { type: "string", enum: ["system", "user", "assistant"] },
                content: { type: "string" },
              },
            },
          },
          model: { type: "string" },
          temperature: { type: "number" },
          max_tokens: { type: "integer" },
        },
      },
    },
    responses: {
      200: {
        description: "The completion",
        schema: {
          type: "object",
          required: ["content", "model"],
          properties: {
            content: { type: ["string", "null"] },
            model: { type: "string" },
            usage: {
              type: "object",
              properties: {
                prompt_tokens: { type: "integer" },
                completion_tokens: { type: "integer" },
                total_tokens: { type: "integer" },
              },
            },
          },
        },
      },
      ...errorResponses(400, 401, 502, 503, 504),
    },
  },
  "POST /api/v1/llm/assist": {
    summary: "Purpose-specific LLM assistance (script, scene design, prompt enhancement)",
    description:
      "Sends the purpose's system prompt plus the caller's context to the configured LLM. " +
      "For enhance_prompt, model_id injects the model's metadata and skill_id the skill's " +
      "assistant block into the system prompt; @reference tokens in the context are " +
      "re-appended if the model drops them. Synchronous; bounded by the configured timeout.",
    requestBody: {
      description: "The assist request",
      schema: {
        type: "object",
        required: ["purpose", "context"],
        properties: {
          purpose: { type: "string", enum: [...ASSIST_PURPOSES] },
          context: { type: "string", maxLength: 32000 },
          model_id: { type: "string" },
          skill_id: { type: "string" },
          max_tokens: { type: "integer" },
        },
      },
    },
    responses: {
      200: {
        description: "The generated content for the purpose",
        schema: {
          type: "object",
          required: ["purpose", "content"],
          properties: {
            purpose: { type: "string", enum: [...ASSIST_PURPOSES] },
            content: { type: "string" },
          },
        },
      },
      ...errorResponses(400, 401, 502, 503, 504),
    },
  },
  "POST /api/v1/llm/agent": {
    summary: "Model copilot turn: bounded tool-calling loop",
    description:
      "Runs the cinemaItor model copilot against the configured LLM with its tool set. " +
      "Read-only tools auto-execute; mutating tools create proposals that await explicit " +
      "approval (POST /api/v1/llm/proposals/{id}/approve). Admin callers get the mutating " +
      "tools; other callers only the read-only schema.",
    requestBody: {
      description: "Conversation history (user/assistant turns)",
      schema: {
        type: "object",
        required: ["history"],
        properties: {
          history: {
            type: "array",
            minItems: 1,
            maxItems: 32,
            items: {
              type: "object",
              required: ["role", "content"],
              properties: {
                role: { type: "string", enum: ["user", "assistant"] },
                content: { type: "string" },
              },
            },
          },
          model: { type: "string" },
        },
      },
    },
    responses: {
      200: {
        description: "The copilot reply + tool steps + any proposals created",
        schema: {
          type: "object",
          required: ["reply", "model", "iterations", "truncated", "steps", "proposals"],
          properties: {
            reply: { type: "string" },
            model: { type: "string" },
            iterations: { type: "integer" },
            truncated: { type: "boolean" },
            steps: {
              type: "array",
              items: {
                type: "object",
                required: ["tool", "args", "status", "summary"],
                properties: {
                  tool: { type: "string" },
                  args: { type: "object" },
                  status: { type: "string", enum: ["ok", "error", "proposal"] },
                  summary: { type: "string" },
                  proposal_id: { type: "string" },
                },
              },
            },
            proposals: { type: "array", items: ref("LlmProposal") },
          },
        },
      },
      ...errorResponses(400, 401, 502, 503, 504),
    },
  },
  "POST /api/v1/llm/proposals/{id}/approve": {
    summary: "Approve a pending copilot proposal (admin)",
    description: "Re-checks admin role and re-runs validation by executing the stored tool call. " +
      "A validation failure propagates and leaves the proposal pending.",
    responses: {
      200: {
        description: "The executed proposal",
        schema: {
          type: "object",
          required: ["proposal", "result"],
          properties: {
            proposal: ref("LlmProposal"),
            result: { type: "object" },
          },
        },
      },
      ...errorResponses(400, 401, 403, 404, 409, 502),
    },
  },
  "POST /api/v1/llm/proposals/{id}/reject": {
    summary: "Reject a pending copilot proposal (admin)",
    responses: {
      200: {
        description: "The closed proposal",
        schema: {
          type: "object",
          required: ["proposal"],
          properties: { proposal: ref("LlmProposal") },
        },
      },
      ...errorResponses(401, 403, 404, 409),
    },
  },
};
