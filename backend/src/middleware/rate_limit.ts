import type { Context, Middleware } from "@oak/oak";
import { tooManyRequests } from "@cinemaItor/errors.ts";
import { loadConfig } from "@cinemaItor/config.ts";
import { tryHit } from "@cinemaItor/services/rate_limit.ts";

/**
 * Fixed-window rate limiter for credential endpoints (login / bootstrap /
 * register). Buckets are keyed by client IP + pathname so one client cannot
 * hammer the auth endpoints, while different endpoints keep separate budgets.
 * Rejects with 429 + Retry-After.
 */
export const authRateLimitMiddleware: Middleware = async (ctx, next) => {
  const config = loadConfig();
  const key = `auth:${clientIp(ctx)}:${ctx.request.url.pathname}`;
  const result = tryHit(
    key,
    config.authRateLimitMax,
    config.authRateLimitWindowSeconds * 1000,
  );
  if (!result.allowed) {
    ctx.response.headers.set("Retry-After", String(result.retryAfterSeconds));
    throw tooManyRequests(
      `Too many auth attempts; retry in ${result.retryAfterSeconds}s`,
    );
  }
  await next();
};

export function clientIp(ctx: Context): string {
  const forwarded = ctx.request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    if (first) return first;
  }
  const addr = (ctx as { remoteAddr?: { hostname: string; port: number } })
    .remoteAddr;
  return addr ? `${addr.hostname}:${addr.port}` : "unknown";
}
