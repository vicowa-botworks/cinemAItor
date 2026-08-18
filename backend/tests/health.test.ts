import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { closeDb, getDb } from "../src/db/database.ts";
import { createApp } from "../src/server.ts";
import { loadConfig } from "../src/config.ts";

async function fetchWithRetry(url: string, attempts = 50): Promise<Response> {
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

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
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
  }
}

describe("health endpoint", () => {
  beforeEach(() => {
    closeDb();
    getDb(":memory:");
  });

  afterEach(() => {
    closeDb();
  });

  it("returns ok with version", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assertEquals(body.status, "ok");
      assertEquals(body.name, "cinemaItor");
      assertEquals(typeof body.version, "string");
    });
  });
});
