import type { Context, Middleware, Next } from "@oak/oak";
import type { Logger } from "./logger.ts";

export const ERROR_CODES = {
  VALIDATION: "VALIDATION",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  EMAIL_NOT_CONFIRMED: "EMAIL_NOT_CONFIRMED",
  MISSING_FILE: "MISSING_FILE",
  CORRUPT_FILE: "CORRUPT_FILE",
  MODEL_MISSING: "MODEL_MISSING",
  MODEL_UNHEALTHY: "MODEL_UNHEALTHY",
  GENERATION_FAILED: "GENERATION_FAILED",
  RENDER_FAILED: "RENDER_FAILED",
  STORAGE_ERROR: "STORAGE_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: string;
    traceId: string;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: string;
  readonly traceId: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; details?: string; cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? 500;
    this.details = options.details;
    this.traceId = crypto.randomUUID();
  }
}

export function badRequest(message: string, details?: string): AppError {
  return new AppError(ERROR_CODES.VALIDATION, message, {
    status: 400,
    details,
  });
}

export function unauthorized(message = "Authentication required"): AppError {
  return new AppError(ERROR_CODES.AUTH_REQUIRED, message, { status: 401 });
}

export function forbidden(message = "Permission denied"): AppError {
  return new AppError(ERROR_CODES.PERMISSION_DENIED, message, { status: 403 });
}

export function notFound(message: string): AppError {
  return new AppError(ERROR_CODES.NOT_FOUND, message, { status: 404 });
}

export function conflict(message: string, details?: string): AppError {
  return new AppError(ERROR_CODES.CONFLICT, message, { status: 409, details });
}

export function tooManyRequests(message: string): AppError {
  return new AppError(ERROR_CODES.RATE_LIMITED, message, { status: 429 });
}

export function serviceUnavailable(message: string, details?: string): AppError {
  return new AppError(ERROR_CODES.STORAGE_ERROR, message, {
    status: 503,
    details,
  });
}

export function toApiError(
  err: unknown,
): { status: number; body: ApiErrorBody } {
  const appErr = err instanceof AppError ? err : new AppError(
    ERROR_CODES.INTERNAL,
    "Internal server error",
    { cause: err },
  );
  return {
    status: appErr.status,
    body: appErrToBody(appErr),
  };
}

export function appErrToBody(err: AppError): ApiErrorBody {
  return {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      traceId: err.traceId,
    },
  };
}

export function errorHandler(logger: Logger): Middleware {
  return async (ctx: Context, next: Next) => {
    try {
      await next();
    } catch (err) {
      const { status, body } = toApiError(err);
      if (status >= 500) {
        logger.error("request failed", {
          code: body.error.code,
          message: body.error.message,
          traceId: body.error.traceId,
          method: ctx.request.method,
          path: ctx.request.url.pathname,
          cause: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
      }
      ctx.response.status = status;
      ctx.response.body = body;
    }
  };
}
