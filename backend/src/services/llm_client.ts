import { getLlmSettings, isLlmConfigured } from "@cinemaItor/db/llm_settings.ts";
import { AppError, ERROR_CODES } from "@cinemaItor/errors.ts";

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
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
    messages: options.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
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

/** Minimal completion used by the connection test endpoint. */
export async function testLlmConnection(): Promise<
  | { ok: true; latencyMs: number; model: string; content: string }
  | { ok: false; error: AppError }
> {
  try {
    const result = await chatLlm({
      messages: [
        { role: "user", content: "Reply with exactly: OK" },
      ],
      maxTokens: 16,
    });
    return {
      ok: true,
      latencyMs: result.latencyMs,
      model: result.model,
      content: (result.content ?? "").trim(),
    };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err };
    throw err;
  }
}
