import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

interface AuthBody {
  token: string;
  user: {
    id: number;
    email: string;
    display_name: string;
    role: string;
    must_change_password: boolean;
  };
}

interface UserRow {
  id: number;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
}

let baseUrl = "";

function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function bootstrap(email: string, password: string): Promise<AuthBody> {
  const res = await req(
    "POST",
    "/api/v1/auth/bootstrap",
    { email, password, display_name: "Studio Owner" },
  );
  assertEquals(res.status, 201);
  return (await res.json()) as AuthBody;
}

async function login(email: string, password: string): Promise<AuthBody> {
  const res = await req(
    "POST",
    "/api/v1/auth/login",
    { email, password },
  );
  assertEquals(res.status, 200);
  return (await res.json()) as AuthBody;
}

describe("user management api", () => {
  beforeEach(() => {
    freshMemoryDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("setup-status is unregistered on a fresh db and registered after bootstrap", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const before = await req("GET", "/api/v1/auth/setup-status");
        assertEquals(before.status, 200);
        assertEquals(
          (await before.json()) as Record<string, unknown>,
          { registered: false },
        );

        await bootstrap("owner@example.com", "password123");
        const after = await req("GET", "/api/v1/auth/setup-status");
        assertEquals(after.status, 200);
        assertEquals(
          (await after.json()) as Record<string, unknown>,
          { registered: true },
        );
      })();
    });
  });

  it("admin creates a user who can log in; duplicate email conflicts", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");

        const created = await req(
          "POST",
          "/api/v1/users",
          {
            email: "crew@example.com",
            display_name: "Crew",
            password: "temp-pass-123",
            must_change_password: true,
          },
          admin.token,
        );
        assertEquals(created.status, 201);
        const createdBody = (await created.json()) as { user: UserRow };
        assertEquals(createdBody.user.email, "crew@example.com");
        assertEquals(createdBody.user.role, "user");
        assertEquals(createdBody.user.is_active, true);
        assertEquals(createdBody.user.must_change_password, true);
        assert(!("password_hash" in createdBody.user));

        const user = await login("crew@example.com", "temp-pass-123");
        assertEquals(user.user.email, "crew@example.com");
        assertEquals(user.user.must_change_password, true);

        const dup = await req(
          "POST",
          "/api/v1/users",
          {
            email: "crew@example.com",
            display_name: "Dup",
            password: "another-pass",
          },
          admin.token,
        );
        assertEquals(dup.status, 409);
      })();
    });
  });

  it("validates create user input", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");

        const short = await req(
          "POST",
          "/api/v1/users",
          { email: "a@b.c", display_name: "A", password: "short" },
          admin.token,
        );
        assertEquals(short.status, 400);

        const missing = await req(
          "POST",
          "/api/v1/users",
          { email: "a@b.c", password: "long-enough" },
          admin.token,
        );
        assertEquals(missing.status, 400);

        const badRole = await req(
          "POST",
          "/api/v1/users",
          {
            email: "a@b.c",
            display_name: "A",
            password: "long-enough",
            role: "superadmin",
          },
          admin.token,
        );
        assertEquals(badRole.status, 400);
      })();
    });
  });

  it("requires admin for all user management endpoints", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");
        const created = await req(
          "POST",
          "/api/v1/users",
          { email: "crew@example.com", display_name: "Crew", password: "temp-pass-123" },
          admin.token,
        );
        assertEquals(created.status, 201);
        const crew = (await login("crew@example.com", "temp-pass-123")).token;

        assertEquals((await req("GET", "/api/v1/users", undefined, crew)).status, 403);
        assertEquals(
          (await req("POST", "/api/v1/users", {
            email: "x@y.z",
            display_name: "X",
            password: "long-enough",
          }, crew)).status,
          403,
        );
        assertEquals((await req("PATCH", "/api/v1/users/2", { role: "admin" }, crew)).status, 403);
        assertEquals((await req("DELETE", "/api/v1/users/2", undefined, crew)).status, 403);
        assertEquals((await req("GET", "/api/v1/users/settings", undefined, crew)).status, 403);
        assertEquals(
          (await req("PATCH", "/api/v1/users/settings", { registration_enabled: false }, crew))
            .status,
          403,
        );

        assertEquals((await req("GET", "/api/v1/users")).status, 401);
        assertEquals((await req("POST", "/api/v1/users", {})).status, 401);
      })();
    });
  });

  it("lists users for admin", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");
        await req(
          "POST",
          "/api/v1/users",
          { email: "crew@example.com", display_name: "Crew", password: "temp-pass-123" },
          admin.token,
        );

        const res = await req("GET", "/api/v1/users", undefined, admin.token);
        assertEquals(res.status, 200);
        const body = (await res.json()) as { users: UserRow[] };
        assertEquals(body.users.length, 2);
        const roles = body.users.map((u) => u.role);
        assert(roles.includes("admin") && roles.includes("user"));
      })();
    });
  });

  it("promotes and demotes admins; protects the last active admin", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");
        await req(
          "POST",
          "/api/v1/users",
          { email: "second@example.com", display_name: "Second", password: "temp-pass-123" },
          admin.token,
        );

        // The bootstrap user is the only active admin, so demoting (or
        // deleting) them is blocked.
        const demoteLast = await req(
          "PATCH",
          "/api/v1/users/1",
          { role: "user" },
          admin.token,
        );
        assertEquals(demoteLast.status, 409);

        // Promote the second user first.
        const promote = await req(
          "PATCH",
          "/api/v1/users/2",
          { role: "admin" },
          admin.token,
        );
        assertEquals(promote.status, 200);
        const promoted = (await promote.json()) as { user: UserRow };
        assertEquals(promoted.user.role, "admin");

        // Now the original admin can be demoted.
        const demote = await req(
          "PATCH",
          "/api/v1/users/1",
          { role: "user" },
          admin.token,
        );
        assertEquals(demote.status, 200);
        assertEquals(((await demote.json()) as { user: UserRow }).user.role, "user");

        // The promoted admin is now the only active admin: demoting/deleting
        // themselves is blocked.
        const secondLogin = await login("second@example.com", "temp-pass-123");
        const selfDemote = await req(
          "PATCH",
          "/api/v1/users/2",
          { role: "user" },
          secondLogin.token,
        );
        assertEquals(selfDemote.status, 409);
        const selfDelete = await req(
          "DELETE",
          "/api/v1/users/2",
          undefined,
          secondLogin.token,
        );
        assertEquals(selfDelete.status, 409);
      })();
    });
  });

  it("deactivating a user kills their sessions; reactivation restores access", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");
        await req(
          "POST",
          "/api/v1/users",
          { email: "crew@example.com", display_name: "Crew", password: "temp-pass-123" },
          admin.token,
        );
        const crew = await login("crew@example.com", "temp-pass-123");

        const off = await req(
          "PATCH",
          "/api/v1/users/2",
          { is_active: false },
          admin.token,
        );
        assertEquals(off.status, 200);
        assertEquals(((await off.json()) as { user: UserRow }).user.is_active, false);

        const me = await req("GET", "/api/v1/auth/me", undefined, crew.token);
        assertEquals(me.status, 401);

        const relogin = await req(
          "POST",
          "/api/v1/auth/login",
          { email: "crew@example.com", password: "temp-pass-123" },
        );
        assertEquals(relogin.status, 401);

        const on = await req(
          "PATCH",
          "/api/v1/users/2",
          { is_active: true },
          admin.token,
        );
        assertEquals(on.status, 200);
        const restored = await req("GET", "/api/v1/auth/me", undefined, crew.token);
        assertEquals(restored.status, 200);
      })();
    });
  });

  it("delete is a soft delete and cannot be applied to oneself", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");
        await req(
          "POST",
          "/api/v1/users",
          { email: "crew@example.com", display_name: "Crew", password: "temp-pass-123" },
          admin.token,
        );

        const selfDelete = await req("DELETE", "/api/v1/users/1", undefined, admin.token);
        assertEquals(selfDelete.status, 409);

        const del = await req("DELETE", "/api/v1/users/2", undefined, admin.token);
        assertEquals(del.status, 204);

        const list = (await (
          await req("GET", "/api/v1/users", undefined, admin.token)
        ).json()) as { users: UserRow[] };
        const crew = list.users.find((u) => u.id === 2)!;
        assertEquals(crew.is_active, false);

        const relogin = await req(
          "POST",
          "/api/v1/auth/login",
          { email: "crew@example.com", password: "temp-pass-123" },
        );
        assertEquals(relogin.status, 401);
      })();
    });
  });

  it("password reset assigns a new password and forces a change", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");
        await req(
          "POST",
          "/api/v1/users",
          { email: "crew@example.com", display_name: "Crew", password: "temp-pass-123" },
          admin.token,
        );

        const reset = await req(
          "PATCH",
          "/api/v1/users/2",
          { password: "brand-new-456" },
          admin.token,
        );
        assertEquals(reset.status, 200);
        const body = (await reset.json()) as { user: UserRow };
        assertEquals(body.user.must_change_password, true);

        const oldLogin = await req(
          "POST",
          "/api/v1/auth/login",
          { email: "crew@example.com", password: "temp-pass-123" },
        );
        assertEquals(oldLogin.status, 401);
        await login("crew@example.com", "brand-new-456");
      })();
    });
  });

  it("users can change their own password; the flag is cleared", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");
        await req(
          "POST",
          "/api/v1/users",
          { email: "crew@example.com", display_name: "Crew", password: "temp-pass-123" },
          admin.token,
        );
        const crew = await login("crew@example.com", "temp-pass-123");
        assertEquals(crew.user.must_change_password, true);

        const wrong = await req(
          "PUT",
          "/api/v1/auth/password",
          { current_password: "nope-nope-1", new_password: "new-pass-123" },
          crew.token,
        );
        assertEquals(wrong.status, 401);

        const changed = await req(
          "PUT",
          "/api/v1/auth/password",
          { current_password: "temp-pass-123", new_password: "new-pass-123" },
          crew.token,
        );
        assertEquals(changed.status, 200);
        const changedBody = (await changed.json()) as {
          user: { must_change_password: boolean };
        };
        assertEquals(changedBody.user.must_change_password, false);

        const oldLogin = await req(
          "POST",
          "/api/v1/auth/login",
          { email: "crew@example.com", password: "temp-pass-123" },
        );
        assertEquals(oldLogin.status, 401);
        await login("crew@example.com", "new-pass-123");
      })();
    });
  });

  it("registration toggle gates self-registration (both auth surfaces)", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");

        const initial = await req("GET", "/api/v1/users/settings", undefined, admin.token);
        assertEquals(initial.status, 200);
        assertEquals(
          (await initial.json()) as Record<string, unknown>,
          { registration_enabled: true },
        );

        // Enabled by default.
        const reg = await req(
          "POST",
          "/api/auth/register",
          { email: "late@example.com", password: "password123", display_name: "Late" },
        );
        assertEquals(reg.status, 201);

        const off = await req(
          "PATCH",
          "/api/v1/users/settings",
          { registration_enabled: false },
          admin.token,
        );
        assertEquals(off.status, 200);
        assertEquals(
          (await off.json()) as Record<string, unknown>,
          { registration_enabled: false },
        );

        const blocked = await req(
          "POST",
          "/api/auth/register",
          { email: "blocked@example.com", password: "password123", display_name: "B" },
        );
        assertEquals(blocked.status, 403);

        const on = await req(
          "PATCH",
          "/api/v1/users/settings",
          { registration_enabled: true },
          admin.token,
        );
        assertEquals(on.status, 200);
        const allowed = await req(
          "POST",
          "/api/auth/register",
          { email: "late2@example.com", password: "password123", display_name: "L2" },
        );
        assertEquals(allowed.status, 201);
      })();
    });
  });

  it("admin-provisioned users default to must_change_password=true", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        await fetchWithRetry(`${baseUrl}/api/v1/health`);
        const admin = await bootstrap("owner@example.com", "password123");
        const created = await req(
          "POST",
          "/api/v1/users",
          { email: "crew@example.com", display_name: "Crew", password: "temp-pass-123" },
          admin.token,
        );
        assertEquals(created.status, 201);
        assertEquals(
          ((await created.json()) as { user: UserRow }).user.must_change_password,
          true,
        );

        const explicit = await req(
          "POST",
          "/api/v1/users",
          {
            email: "opt@example.com",
            display_name: "Opt",
            password: "temp-pass-123",
            must_change_password: false,
          },
          admin.token,
        );
        assertEquals(
          ((await explicit.json()) as { user: UserRow }).user.must_change_password,
          false,
        );
      })();
    });
  });
});
