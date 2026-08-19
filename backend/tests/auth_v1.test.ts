import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb, getDb } from "../src/db/database.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

interface UserBody {
  token: string;
  user: { id: number; email: string; display_name: string; role: string };
}

let baseUrl = "";

function post(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function get(path: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, { headers });
}

async function bootstrap(email: string, password: string): Promise<UserBody> {
  const res = await post(
    "/api/v1/auth/bootstrap",
    { email, password, display_name: "Studio Owner" },
  );
  assertEquals(res.status, 201);
  return (await res.json()) as UserBody;
}

describe("auth v1", () => {
  beforeEach(() => {
    freshMemoryDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("bootstraps the first user as admin", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await fetchWithRetry(`${baseUrl}/api/v1/health`);
        assertEquals(res.status, 200);
        const { token, user } = await bootstrap(
          "owner@example.com",
          "password123",
        );
        assert(token.length > 0);
        assertEquals(user.role, "admin");

        const me = await get("/api/v1/auth/me", token);
        assertEquals(me.status, 200);
        const meBody = (await me.json()) as Record<string, unknown>;
        assertEquals(meBody.email, "owner@example.com");
        assertEquals(meBody.role, "admin");
      })();
    });
  });

  it("rejects a second bootstrap", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        await bootstrap("first@example.com", "password123");
        const res = await post(
          "/api/v1/auth/bootstrap",
          {
            email: "second@example.com",
            password: "password123",
            display_name: "X",
          },
        );
        assertEquals(res.status, 409);
        const body = (await res.json()) as { error: { code: string } };
        assertEquals(body.error.code, "CONFLICT");
      })();
    });
  });

  it("logs in and out with session revocation", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const first = await bootstrap("login@example.com", "password123");

        const badLogin = await post(
          "/api/v1/auth/login",
          { email: "login@example.com", password: "wrongpass1" },
        );
        assertEquals(badLogin.status, 401);

        const loginRes = await post(
          "/api/v1/auth/login",
          { email: "login@example.com", password: "password123" },
        );
        assertEquals(loginRes.status, 200);
        const second = (await loginRes.json()) as UserBody;
        assert(second.token !== first.token);

        const me = await get("/api/v1/auth/me", second.token);
        assertEquals(me.status, 200);

        const logout = await post("/api/v1/auth/logout", {}, first.token);
        assertEquals(logout.status, 204);

        const revoked = await get("/api/v1/auth/me", first.token);
        assertEquals(revoked.status, 401);

        const stillValid = await get("/api/v1/auth/me", second.token);
        assertEquals(stillValid.status, 200);
      })();
    });
  });

  it("requires authentication for me", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const res = await get("/api/v1/auth/me");
        assertEquals(res.status, 401);
      })();
    });
  });

  it("audits bootstrap/login/logout", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        await bootstrap("audit@example.com", "password123");
        const loginRes = await post(
          "/api/v1/auth/login",
          { email: "audit@example.com", password: "password123" },
        );
        const second = (await loginRes.json()) as UserBody;
        await post("/api/v1/auth/logout", {}, second.token);

        const db = getDb();
        const rows = db
          .prepare("SELECT action FROM audit_logs ORDER BY created_at, id")
          .all() as unknown as { action: string }[];
        const actions = rows.map((r) => r.action);
        assert(actions.includes("user.bootstrap"));
        assert(actions.includes("auth.login"));
        assert(actions.includes("auth.logout"));
      })();
    });
  });

  it("keeps demo register endpoint working", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const res = await post(
          "/api/auth/register",
          {
            email: "demo@example.com",
            password: "password123",
            display_name: "Demo",
          },
        );
        assertEquals(res.status, 201);
        const body = (await res.json()) as UserBody;
        assertEquals(body.user.role, "user");

        const me = await get("/api/auth/me", body.token);
        assertEquals(me.status, 200);
      })();
    });
  });
});
