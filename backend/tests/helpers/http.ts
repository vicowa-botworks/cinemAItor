import { closeDb, getDb } from "../../src/db/database.ts";
import { createApp } from "../../src/server.ts";
import { loadConfig } from "../../src/config.ts";
import { resetRateLimiter } from "../../src/services/rate_limit.ts";

// Ensure JWT_SECRET is set for tests (config.ts requires it at load time)
if (!Deno.env.get("JWT_SECRET")) {
  Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
}

export function freshMemoryDb(): void {
  closeDb();
  getDb(":memory:");
  resetRateLimiter();
}

export async function fetchWithRetry(
  url: string,
  attempts = 50,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`Could not reach ${url}: ${lastErr}`);
}

export async function withServer<T>(
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const probe = await Deno.listen({ port: 0 });
  const port = (probe.addr as Deno.NetAddr).port;
  await probe.close();

  const serverApp = createApp(loadConfig());
  const abort = new AbortController();
  serverApp.listen({ port, signal: abort.signal });
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    // Oak 17 has no public shutdown(); aborting the signal releases the
    // underlying listener so the test process can exit cleanly.
    abort.abort();
    // Stop this app's job/render runners so a later test (fresh in-memory
    // DB, new temp app data) is not touched by a leaked polling tick.
    await serverApp.jobRunner?.stop();
    await serverApp.renderRunner?.stop();
  }
}
