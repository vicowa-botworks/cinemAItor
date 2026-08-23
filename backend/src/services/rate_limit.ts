/**
 * Fixed-window in-memory rate limiter.
 *
 * Buckets are keyed by an arbitrary string (the middleware uses
 * `auth:<client-ip>:<pathname>`). A bucket resets once `windowMs` has
 * elapsed. The map is pruned opportunistically so idle clients cannot grow
 * it without bound.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 4096;

export interface LimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function tryHit(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): LimitResult {
  if (buckets.size > MAX_BUCKETS) {
    prune(now, windowMs);
  }
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > max) {
    const retryAfterMs = Math.max(0, bucket.windowStart + windowMs - now);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function prune(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) buckets.delete(key);
  }
}

/** Tests only: drop every bucket so suites share no limiter state. */
export function resetRateLimiter(): void {
  buckets.clear();
}
