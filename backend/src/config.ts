export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppConfig {
  port: number;
  dbPath: string;
  appDataDir: string;
  jwtSecret: string;
  logLevel: LogLevel;
  ffmpegPath: string;
  ffprobePath: string;
  uploadMaxBytes: number;
  jobConcurrencyGpu: number;
  jobConcurrencyCpu: number;
  authRateLimitMax: number;
  authRateLimitWindowSeconds: number;
}

export const APP_NAME = "cinemaItor";
export const APP_VERSION = "0.1.0";

interface EnvLike {
  get(key: string): string | undefined;
}

export function loadConfig(env: EnvLike = Deno.env): AppConfig {
  const port = intEnv(env, "PORT", 8123, 1, 65535);
  const logLevel = env.get("LOG_LEVEL")?.toLowerCase() as LogLevel | undefined;
  if (logLevel !== undefined && !isLogLevel(logLevel)) {
    throw new Error(
      `Invalid LOG_LEVEL: ${logLevel}. Expected debug, info, warn or error.`,
    );
  }
  const uploadMaxBytes = intEnv(
    env,
    "UPLOAD_MAX_SIZE",
    2 * 1024 * 1024 * 1024,
    1,
  );
  const jobConcurrencyGpu = intEnv(env, "JOB_CONCURRENCY_GPU", 1, 1);
  const jobConcurrencyCpu = intEnv(env, "JOB_CONCURRENCY_CPU", 2, 1);
  const authRateLimitMax = intEnv(env, "AUTH_RATE_LIMIT_MAX", 20, 1);
  const authRateLimitWindowSeconds = intEnv(
    env,
    "AUTH_RATE_LIMIT_WINDOW_SECONDS",
    60,
    1,
  );
  const jwtSecret = env.get("JWT_SECRET") ?? "";
  if (!jwtSecret) {
    throw new Error(
      "JWT_SECRET environment variable is required. Set it before starting the server.",
    );
  }

  return {
    port,
    dbPath: env.get("DB_PATH") ?? "./cinemaItor.db",
    appDataDir: env.get("APP_DATA_DIR") ?? "./app_data",
    jwtSecret,
    logLevel: logLevel ?? "info",
    ffmpegPath: env.get("FFMPEG_PATH") ?? "ffmpeg",
    ffprobePath: env.get("FFPROBE_PATH") ?? "ffprobe",
    uploadMaxBytes,
    jobConcurrencyGpu,
    jobConcurrencyCpu,
    authRateLimitMax,
    authRateLimitWindowSeconds,
  };
}

function isLogLevel(value: string): value is LogLevel {
  return ["debug", "info", "warn", "error"].includes(value);
}

function intEnv(
  env: EnvLike,
  key: string,
  fallback: number,
  min?: number,
  max?: number,
): number {
  const raw = env.get(key);
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be an integer, got: ${raw}`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`${key} must be >= ${min}, got: ${value}`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`${key} must be <= ${max}, got: ${value}`);
  }
  return value;
}
