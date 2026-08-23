import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { closeDb, getDb } from "../src/db/database.ts";
import { resetRateLimiter, tryHit } from "../src/services/rate_limit.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

describe("rate limiter (unit)", () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it("allows up to max hits inside one window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      const r = tryHit("k", 3, 60_000, t0 + i);
      assertEquals(r.allowed, true);
      assertEquals(r.retryAfterSeconds, 0);
    }
    const denied = tryHit("k", 3, 60_000, t0 + 3);
    assertEquals(denied.allowed, false);
    assertEquals(denied.retryAfterSeconds, 60);
  });

  it("resets the window once windowMs has elapsed", () => {
    const t0 = 1_000_000;
    tryHit("k", 1, 10_000, t0);
    assertEquals(tryHit("k", 1, 10_000, t0 + 1).allowed, false);
    const renewed = tryHit("k", 1, 10_000, t0 + 10_000);
    assertEquals(renewed.allowed, true);
    assertEquals(renewed.retryAfterSeconds, 0);
  });

  it("keeps buckets isolated per key", () => {
    const t0 = 1_000_000;
    tryHit("a", 1, 60_000, t0);
    assertEquals(tryHit("a", 1, 60_000, t0).allowed, false);
    assertEquals(tryHit("b", 1, 60_000, t0).allowed, true);
  });

  it("caps retryAfterSeconds at a minimum of one second", () => {
    const t0 = 1_000_000;
    tryHit("k", 1, 1_000, t0);
    // 999ms into a 1s window: retry after would be <1s.
    const denied = tryHit("k", 1, 1_000, t0 + 999);
    assertEquals(denied.allowed, false);
    assertEquals(denied.retryAfterSeconds, 1);
  });
});

interface UserBody {
  token: string;
  user: { id: number; email: string };
}

let baseUrl = "";
function setLimits(max: number, windowSeconds: number): void {
  Deno.env.set("AUTH_RATE_LIMIT_MAX", String(max));
  Deno.env.set("AUTH_RATE_LIMIT_WINDOW_SECONDS", String(windowSeconds));
}

async function bootstrap(
  email: string,
  password: string,
): Promise<UserBody> {
  const res = await fetch(`${baseUrl}/api/v1/auth/bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      display_name: "RL",
    }),
  });
  assertEquals(res.status, 201);
  return (await res.json()) as UserBody;
}

function login(email: string, password: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

describe("rate limiter (auth routes)", () => {
  let email: string;

  beforeEach(async () => {
    freshMemoryDb();
    resetRateLimiter();
    setLimits(3, 60);
    await withServer(async (base) => {
      baseUrl = base;
      await fetchWithRetry(`${baseUrl}/api/v1/health`);
      email = `rl.${Math.random().toString(36).slice(2)}@example.com`;
      await bootstrap(email, "password123");
    });
  });

  afterEach(() => {
    Deno.env.delete("AUTH_RATE_LIMIT_MAX");
    Deno.env.delete("AUTH_RATE_LIMIT_WINDOW_SECONDS");
    closeDb();
    getDb(":memory:");
  });

  it("rejects login attempts beyond the budget with 429 + Retry-After", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const one = await login(email, "wrong-password");
      assertEquals(one.status, 401);
      const two = await login(email, "wrong-password");
      assertEquals(two.status, 401);
      const three = await login(email, "wrong-password");
      assertEquals(three.status, 401);
      const fourth = await login(email, "wrong-password");
      assertEquals(fourth.status, 429);
      const retryAfter = fourth.headers.get("retry-after");
      assertEquals(retryAfter !== null, true);
      const body = (await fourth.json()) as {
        error: { code: string; message: string };
      };
      assertEquals(body.error.code, "RATE_LIMITED");
      const ok = await login(email, "password123");
      assertEquals(ok.status, 429, "the bucket blocks even correct passwords");
    });
  });

  it("keeps separate budgets per auth endpoint", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const bootstrapTaken = await fetch(`${baseUrl}/api/v1/auth/bootstrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `other.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Other",
        }),
      });
      assertEquals(
        bootstrapTaken.status,
        409,
        "bootstrap still reachable (own budget); only users already exist",
      );
      const legacy = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `reg.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Reg",
        }),
      });
      assertEquals(legacy.status, 201, "register uses its own budget");
    });
  });
});
