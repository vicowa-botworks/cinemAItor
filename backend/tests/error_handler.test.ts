import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { AppError, ERROR_CODES, errorHandler } from "../src/errors.ts";
import type { Logger } from "../src/logger.ts";

interface Logged {
  level: "warn" | "error";
  msg: string;
  extra?: Record<string, unknown>;
}

/** Logger double that records what the error handler logs. */
function recordingLogger(): { logger: Logger; logged: Logged[] } {
  const logged: Logged[] = [];
  const record = (level: Logged["level"]) => (msg: string, extra?: Record<string, unknown>) => {
    logged.push({ level, msg, extra });
  };
  const logger = {
    debug: () => {},
    info: () => {},
    warn: record("warn"),
    error: record("error"),
    child: () => logger,
  } as unknown as Logger;
  return { logger, logged };
}

type Handler = (ctx: unknown, next: () => Promise<unknown>) => Promise<void>;

interface FakeResponse {
  status?: number;
  body?: { error?: { code?: string; details?: string } };
}

/**
 * Drives the handler with a minimal context: it only reads request.method and
 * request.url.pathname and writes response.status/body.
 */
async function handleFailure(
  err: unknown,
  logger: Logger,
  response: FakeResponse = {},
): Promise<FakeResponse> {
  const ctx = {
    request: { method: "POST", url: { pathname: "/api/v1/llm/agent" } },
    response,
  };
  // A synchronous throw is enough: the handler awaits next() inside its try.
  await (errorHandler(logger) as unknown as Handler)(ctx, () => {
    throw err;
  });
  return response;
}

describe("error handler diagnostics", () => {
  it("logs the upstream details, not just the status it summarised", async () => {
    const { logger, logged } = recordingLogger();
    const err = new AppError(
      ERROR_CODES.LLM_BAD_RESPONSE,
      "The LLM endpoint returned an unexpected response: HTTP 504",
      { status: 502, details: "<html>504 Gateway Time-out</html>" },
    );

    const response = await handleFailure(err, logger);

    assertEquals(logged.length, 1);
    assertEquals(logged[0].level, "error");
    assertEquals(logged[0].extra?.code, ERROR_CODES.LLM_BAD_RESPONSE);
    // The whole point: the durable row names who refused and why, so a bare
    // "HTTP 504" no longer has to be reproduced to be diagnosed.
    assertEquals(logged[0].extra?.details, "<html>504 Gateway Time-out</html>");
    // The response body keeps carrying it too (that is what the UI shows).
    assertEquals(response.body?.error?.details, "<html>504 Gateway Time-out</html>");
  });

  it("omits the details key when the error carries none", async () => {
    const { logger, logged } = recordingLogger();
    const err = new AppError(ERROR_CODES.NOT_FOUND, "no such project", {
      status: 404,
    });

    await handleFailure(err, logger);

    assertEquals(logged.length, 0);

    const { logger: logger2, logged: logged2 } = recordingLogger();
    await handleFailure(
      new AppError(ERROR_CODES.STORAGE_ERROR, "disk full", { status: 500 }),
      logger2,
    );
    assertEquals(logged2.length, 1);
    assert(!("details" in (logged2[0].extra ?? {})));
  });

  it("keeps the tail of an oversized details (a log ends with its failure)", async () => {
    const { logger, logged } = recordingLogger();
    const noise = "x".repeat(20_000);
    const err = new AppError(ERROR_CODES.RENDER_FAILED, "ffmpeg failed", {
      status: 500,
      details: `${noise}\nffmpeg error: invalid input found`,
    });

    await handleFailure(err, logger);

    const details = logged[0].extra?.details as string;
    assert(details.endsWith("ffmpeg error: invalid input found"));
    assert(details.startsWith("…"));
    assert(details.length < noise.length);
  });

  it("does not log client errors", async () => {
    const { logger, logged } = recordingLogger();
    const response = await handleFailure(
      new AppError(ERROR_CODES.VALIDATION, "bad field", {
        status: 400,
        details: "field must be a string",
      }),
      logger,
      {},
    );

    assertEquals(logged.length, 0);
    assertEquals(response.status, 400);
  });
});
