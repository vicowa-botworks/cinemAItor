import { getLlmSettings, isLlmConfigured } from "@cinemaItor/db/llm_settings.ts";
import { AppError, ERROR_CODES } from "@cinemaItor/errors.ts";

export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  /** Present on assistant messages that call tools. */
  tool_calls?: LlmToolCall[];
  /** Present on tool-result messages; matches the LlmToolCall.id. */
  tool_call_id?: string;
  /** Present on tool-result messages (some runners require it). */
  name?: string;
}

export interface LlmToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmChatOptions {
  messages: LlmMessage[];
  /** Override the configured model name for this call. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: LlmToolDef[];
  /** Override the configured timeout for this call (seconds). */
  timeoutSeconds?: number;
}

export interface LlmUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface LlmChatResult {
  content: string | null;
  toolCalls: LlmToolCall[];
  model: string;
  usage?: LlmUsage;
  latencyMs: number;
}

function notConfigured(): AppError {
  return new AppError(
    ERROR_CODES.LLM_NOT_CONFIGURED,
    "No LLM is configured. Set the endpoint in the Models page (LLM Assistant section).",
    { status: 503 },
  );
}

function unreachable(message: string, cause?: unknown): AppError {
  return new AppError(
    ERROR_CODES.LLM_UNREACHABLE,
    `Cannot reach the LLM endpoint: ${message}`,
    { status: 502, details: message, cause },
  );
}

function badResponse(message: string, details?: string): AppError {
  return new AppError(
    ERROR_CODES.LLM_BAD_RESPONSE,
    `The LLM endpoint returned an unexpected response: ${message}`,
    { status: 502, details },
  );
}

function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "http://" + url;
  while (url.endsWith("/")) url = url.slice(0, -1);
  return url;
}

export function llmCompletionUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl) + "/chat/completions";
}

/**
 * One-shot chat completion against the configured OpenAI-compatible endpoint.
 * Synchronous and bounded by the configured timeout; errors are mapped to the
 * LLM_* error codes (see docs/llm.md).
 */
export async function chatLlm(
  options: LlmChatOptions,
): Promise<LlmChatResult> {
  if (!isLlmConfigured()) throw notConfigured();
  const settings = getLlmSettings();
  const model = options.model?.trim() || settings.model;
  const url = llmCompletionUrl(settings.baseUrl);

  const body: Record<string, unknown> = {
    model,
    messages: options.messages.map((m) => {
      const out: Record<string, unknown> = {
        role: m.role,
        content: m.content ?? "",
      };
      if (m.tool_calls) out.tool_calls = m.tool_calls;
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
      if (m.name) out.name = m.name;
      return out;
    }),
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  const maxTokens = options.maxTokens ??
    (settings.maxTokens !== "" ? Number(settings.maxTokens) : undefined);
  if (maxTokens !== undefined && Number.isFinite(maxTokens)) {
    body.max_tokens = maxTokens;
  }
  if (options.tools && options.tools.length > 0) body.tools = options.tools;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (settings.apiKey) headers.authorization = `Bearer ${settings.apiKey}`;

  const timeoutMs = Math.max(
    1,
    options.timeoutSeconds ?? settings.timeoutSeconds,
  ) * 1000;
  const started = performance.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new AppError(
        ERROR_CODES.LLM_TIMEOUT,
        `The LLM endpoint did not answer within ${timeoutMs / 1000}s`,
        { status: 504, cause: err },
      );
    }
    throw unreachable(
      err instanceof Error ? err.message : String(err),
      err,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      ERROR_CODES.LLM_AUTH_FAILED,
      `The LLM endpoint rejected the credentials (HTTP ${response.status})`,
      { status: 502, details: `HTTP ${response.status}` },
    );
  }
  if (response.status === 404) {
    throw new AppError(
      ERROR_CODES.LLM_MODEL_NOT_FOUND,
      `The LLM endpoint does not know model '${model}' (HTTP 404)`,
      { status: 502, details: `model: ${model}` },
    );
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 300);
    throw badResponse(`HTTP ${response.status}`, text || undefined);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw badResponse("the response body is not valid JSON", undefined);
  }

  const doc = payload as {
    model?: unknown;
    usage?: unknown;
    choices?: unknown;
  };
  if (!Array.isArray(doc.choices) || doc.choices.length === 0) {
    throw badResponse("the response has no choices");
  }
  const message = (doc.choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) {
    throw badResponse("the response choice has no message");
  }
  const msg = message as {
    content?: unknown;
    tool_calls?: unknown;
  };
  const content = typeof msg.content === "string" ? msg.content : null;
  const toolCalls: LlmToolCall[] = [];
  if (Array.isArray(msg.tool_calls)) {
    for (const call of msg.tool_calls) {
      const c = call as {
        id?: unknown;
        type?: unknown;
        function?: unknown;
      };
      const fn = c.function as { name?: unknown; arguments?: unknown } | null;
      if (!fn || typeof fn.name !== "string") continue;
      toolCalls.push({
        id: typeof c.id === "string" ? c.id : crypto.randomUUID(),
        type: "function",
        function: {
          name: fn.name,
          arguments: typeof fn.arguments === "string"
            ? fn.arguments
            : JSON.stringify(fn.arguments ?? {}),
        },
      });
    }
  }
  const usage = (typeof doc.usage === "object" && doc.usage !== null ? doc.usage : undefined) as
    | LlmUsage
    | undefined;

  return {
    content,
    toolCalls,
    model: typeof doc.model === "string" ? doc.model : model,
    usage,
    latencyMs: Math.round(performance.now() - started),
  };
}

/** Outcome of the advisory tool-calling probe (see `testLlmConnection`). */
export interface LlmToolSupport {
  /**
   * False only when the endpoint REFUSED a request that carried tool
   * definitions. Transport-level failures leave this true — see `inconclusive`.
   */
  supported: boolean;
  /**
   * The probe could not reach a verdict (timeout, unreachable, auth, unknown
   * model). Those say nothing about tool support, and the gate request has
   * already reported them, so the UI stays silent.
   */
  inconclusive?: boolean;
  /** The endpoint's own reason, when it refused the request. */
  error?: string;
}

/**
 * The probe only needs to learn whether the endpoint ACCEPTS a `tools` array,
 * which is a fast answer. Left on the configured timeout (default 300 s, max
 * 3600 s) it would double the worst-case wall time of the synchronous test
 * endpoint for information an admin cannot act on any faster.
 */
export const PROBE_TIMEOUT_SECONDS = 60;

/** The probe's timeout: never longer than the configured request timeout. */
export function probeTimeoutFor(configuredSeconds: number): number {
  return Math.min(PROBE_TIMEOUT_SECONDS, configuredSeconds);
}

/** Probe tool used when the caller does not supply the real tool set. */
const PROBE_TOOL: LlmToolDef = {
  type: "function",
  function: {
    name: "cinemaitor_connection_probe",
    description: "Internal no-op used by the LLM connection test.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

/**
 * Connection check used by the test endpoint.
 *
 * The completion deliberately goes out with the CONFIGURED max_tokens rather
 * than a small fixed one. `max_tokens` is a per-request cap the endpoint may
 * refuse outright — a value that fills the model's whole context window is
 * rejected by strict gateways — and every real request sends the configured
 * value. Hardcoding 16 here meant a broken setting produced a green test and
 * then a failure on the first actual prompt.
 *
 * The tool probe is a second, ADVISORY request: every Model Copilot turn
 * carries a `tools` array, so a model that rejects one cannot drive the
 * copilot even though plain chat and assist still work. Reporting it without
 * failing the check keeps the test honest for both kinds of consumer. It runs
 * on its own short timeout so the endpoint's worst case stays one configured
 * timeout plus a minute, not two full timeouts.
 */
export async function testLlmConnection(
  toolDefs?: LlmToolDef[],
): Promise<
  | {
    ok: true;
    latencyMs: number;
    model: string;
    content: string;
    tools: LlmToolSupport;
  }
  | { ok: false; error: AppError }
> {
  let result: LlmChatResult;
  try {
    result = await chatLlm({
      messages: [
        { role: "user", content: "Reply with exactly: OK" },
      ],
    });
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err };
    throw err;
  }
  const tools = await probeToolSupport(
    toolDefs ?? [PROBE_TOOL],
    probeTimeoutFor(getLlmSettings().timeoutSeconds),
  );
  return {
    ok: true,
    latencyMs: result.latencyMs,
    model: result.model,
    content: (result.content ?? "").trim(),
    tools,
  };
}

/**
 * Sends one tool-bearing completion. Only the endpoint REJECTING the request
 * counts as unsupported — whether the model chose to call the tool says nothing
 * about capability, and neither does a timeout, an auth failure or a dropped
 * connection. Collapsing those into "this model has no tool calling" would be a
 * confidently wrong diagnosis, and the slow models most likely to time out here
 * are exactly the ones it would fire on.
 *
 * The probe sends a small `max_tokens` so `tools` is the only variable
 * separating it from the gate request: a refusal then means the tool array was
 * refused, not that the prompt outgrew the context window.
 */
async function probeToolSupport(
  tools: LlmToolDef[],
  timeoutSeconds: number,
): Promise<LlmToolSupport> {
  try {
    await chatLlm({
      messages: [
        { role: "user", content: "List the registered models." },
      ],
      maxTokens: 64,
      timeoutSeconds,
      tools,
    });
    return { supported: true };
  } catch (err) {
    // Only a request the endpoint refused is evidence about tool support.
    if (!(err instanceof AppError) || err.code !== ERROR_CODES.LLM_BAD_RESPONSE) {
      return { supported: true, inconclusive: true };
    }
    // Report the refusal as a refusal, with the endpoint's own reason attached:
    // a 400 may mean "no tool calling" or something else entirely, and the
    // detail is what lets the admin tell which.
    const reason = (err.details || err.message).trim();
    return { supported: false, error: reason.slice(0, 300) };
  }
}
