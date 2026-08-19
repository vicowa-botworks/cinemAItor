import type { LogLevel } from "./config.ts";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

export function createLogger(
  minLevel: LogLevel = "info",
  context: Record<string, unknown> = {},
): Logger {
  return makeLogger(minLevel, context);
}

function makeLogger(
  minLevel: LogLevel,
  context: Record<string, unknown>,
): Logger {
  function log(
    level: LogLevel,
    msg: string,
    extra?: Record<string, unknown>,
    toStderr = false,
  ): void {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...context,
      ...extra,
    };
    const line = JSON.stringify(entry);
    const bytes = new TextEncoder().encode(line + "\n");
    try {
      if (toStderr) {
        Deno.stderr.writeSync(bytes);
      } else {
        Deno.stdout.writeSync(bytes);
      }
    } catch {
      // Logging must never break a request (e.g. captured stdio in tests).
    }
  }

  return {
    debug: (msg, extra) => log("debug", msg, extra),
    info: (msg, extra) => log("info", msg, extra),
    warn: (msg, extra) => log("warn", msg, extra),
    error: (msg, extra) => log("error", msg, extra, true),
    child: (ctx) => makeLogger(minLevel, { ...context, ...ctx }),
  };
}
