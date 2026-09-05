import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertMatch } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { hashPassword } from "../src/services/password.ts";
import { getVramUnloadSettings, updateVramUnloadSettings } from "../src/db/vram_unload_settings.ts";
import {
  freeComfyui,
  freeLlama,
  type FreeResult,
  getLlamaLoadedModels,
  invalidateVramServicesCache,
} from "../src/services/vram_free.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

// ---------------------------------------------------------------------------
// Fake local GPU-service HTTP server — stands in for ComfyUI (/free) and a
// llama.cpp router (/v1/models, /models/unload) so the exact unload contract
// can be asserted without touching a real machine.
// ---------------------------------------------------------------------------

interface FakeSvcState {
  models: Array<{ id: string; status?: { value?: string } }>;
  modelsStatus: number;
  comfyStatus: number;
  failModels: Set<string>;
  freeCalls: number;
  freeBody: unknown;
  unloadCalls: string[]; // one entry per /models/unload body's model id
}

function freshSvcState(): FakeSvcState {
  return {
    models: [
      { id: "model-a", status: { value: "loaded" } },
      { id: "model-b", status: { value: "unloaded" } },
      { id: "model-c" }, // no status → treated as not loaded
    ],
    modelsStatus: 200,
    comfyStatus: 200,
    failModels: new Set(),
    freeCalls: 0,
    freeBody: null,
    unloadCalls: [],
  };
}

function startFakeSvc(state: FakeSvcState): { url: string; shutdown: () => void } {
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1" },
    async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "v1" && parts[1] === "models" && req.method === "GET") {
        if (state.modelsStatus !== 200) {
          return Response.json({ error: "nope" }, { status: state.modelsStatus });
        }
        return Response.json({ data: state.models });
      }
      if (parts.length === 1 && parts[0] === "free" && req.method === "POST") {
        state.freeCalls += 1;
        state.freeBody = JSON.parse(await req.text() || "null");
        if (state.comfyStatus !== 200) {
          return Response.json({ error: "free failed" }, { status: state.comfyStatus });
        }
        return Response.json({ ok: true });
      }
      if (parts[0] === "models" && parts[1] === "unload" && req.method === "POST") {
        const body = (JSON.parse(await req.text() || "{}")) as { model?: string };
        state.unloadCalls.push(body.model ?? "");
        if (body.model && state.failModels.has(body.model)) {
          return Response.json({ error: "not loaded" }, { status: 400 });
        }
        return Response.json({ success: true });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  );
  const addr = server.addr;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    shutdown: () => server.shutdown(),
  };
}

// ---------------------------------------------------------------------------
// HTTP contract — the exact unload endpoints the app relies on.
// ---------------------------------------------------------------------------

describe("vram_free service (HTTP contract)", () => {
  let state: FakeSvcState;
  let fake: { url: string; shutdown: () => void };

  beforeEach(() => {
    state = freshSvcState();
    fake = startFakeSvc(state);
  });

  afterEach(() => {
    fake.shutdown();
  });

  it("getLlamaLoadedModels returns only models whose status is 'loaded'", async () => {
    assertEquals(await getLlamaLoadedModels(fake.url), ["model-a"]);
  });

  it("getLlamaLoadedModels returns [] on a non-OK or unreachable endpoint", async () => {
    state.modelsStatus = 500;
    assertEquals(await getLlamaLoadedModels(fake.url), []);
    // A closed port (the server was already shut down by a sibling) also [].
    const dead = fake.url.replace(/:\d+$/, ":1");
    assertEquals(await getLlamaLoadedModels(dead), []);
  });

  it("freeComfyui posts /free with unload_models and reports success", async () => {
    const res: FreeResult = await freeComfyui(fake.url);
    assertEquals(res, { kind: "comfyui", ok: true, detail: "models unloaded" });
    assertEquals(state.freeCalls, 1);
    assertEquals(state.freeBody, { unload_models: true });
  });

  it("freeComfyui reports a non-OK response as a failure", async () => {
    state.comfyStatus = 500;
    const res = await freeComfyui(fake.url);
    assertEquals(res.ok, false);
    assertMatch(res.detail, /HTTP 500/);
  });

  it("freeComfyui reports an unreachable endpoint as a failure", async () => {
    const dead = fake.url.replace(/:\d+$/, ":1");
    const res = await freeComfyui(dead);
    assertEquals(res.ok, false);
    assertMatch(res.detail, /unreachable/);
  });

  it("freeLlama with no loaded models is a no-op success", async () => {
    const res = await freeLlama(fake.url, []);
    assertEquals(res, { kind: "llama-server", ok: true, detail: "no models loaded" });
    assertEquals(state.unloadCalls, []);
  });

  it("freeLlama posts /models/unload for each model", async () => {
    const res = await freeLlama(fake.url, ["model-a", "model-b"]);
    assertEquals(res.ok, true);
    assertEquals(state.unloadCalls, ["model-a", "model-b"]);
    assertMatch(res.detail, /model-a unloaded/);
    assertMatch(res.detail, /model-b unloaded/);
  });

  it("freeLlama marks the whole result failed when one model fails", async () => {
    state.failModels = new Set(["model-b"]);
    const res = await freeLlama(fake.url, ["model-a", "model-b"]);
    assertEquals(res.ok, false);
    assertMatch(res.detail, /model-a unloaded/);
    assertMatch(res.detail, /model-b failed/);
  });
});

// ---------------------------------------------------------------------------
// Settings — defaults and partial updates (in-memory DB).
// ---------------------------------------------------------------------------

describe("vram_free settings", () => {
  afterEach(() => {
    closeDb();
  });

  it("defaults: master off, both targets on", () => {
    freshMemoryDb();
    assertEquals(getVramUnloadSettings(), {
      enabled: false,
      targets: { comfyui: true, llama: true },
    });
  });

  it("updateVramUnloadSettings applies a partial patch and returns the new view", () => {
    freshMemoryDb();
    const v1 = updateVramUnloadSettings({ enabled: true });
    assertEquals(v1, { enabled: true, targets: { comfyui: true, llama: true } });
    const v2 = updateVramUnloadSettings({ llama: false });
    assertEquals(v2, { enabled: true, targets: { comfyui: true, llama: false } });
    // Re-reading gives the same view.
    assertEquals(getVramUnloadSettings(), v2);
  });
});

// ---------------------------------------------------------------------------
// Routes — auth gating, settings shape, and a safe (no-op) free.
// ---------------------------------------------------------------------------

describe("vram_free routes", () => {
  let baseUrl = "";
  let adminToken = "";
  let userToken = "";

  function headers(token?: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  function post(path: string, body: unknown, token?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    });
  }

  function get(path: string, token?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, { headers: headers(token) });
  }

  function patch(path: string, body: unknown, token?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: "PATCH",
      headers: headers(token),
      body: JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    freshMemoryDb();
    invalidateVramServicesCache();
    await withServer(async (base) => {
      baseUrl = base;
      // Wait for the freshly-spun app to accept connections (listen is async).
      const health = await fetchWithRetry(`${base}/api/v1/health`);
      assertEquals(health.status, 200);
      const b = await post("/api/v1/auth/bootstrap", {
        email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
        password: "password123",
        display_name: "Studio Admin",
      });
      assertEquals(b.status, 201);
      adminToken = ((await b.json()) as { token: string }).token;
      const email = `user.${Math.random().toString(36).slice(2)}@example.com`;
      createUser(email, await hashPassword("password123"), "Regular User");
      const login = await post("/api/v1/auth/login", {
        email,
        password: "password123",
      });
      assertEquals(login.status, 200);
      userToken = ((await login.json()) as { token: string }).token;
    });
  });

  afterEach(() => {
    closeDb();
    invalidateVramServicesCache();
  });

  it("all four routes require authentication", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      assertEquals((await get("/api/v1/models/vram-unload")).status, 401);
      assertEquals((await patch("/api/v1/models/vram-unload", {})).status, 401);
      assertEquals((await get("/api/v1/models/vram-unload/services")).status, 401);
      assertEquals((await post("/api/v1/models/vram-unload/free", {})).status, 401);
    });
  });

  it("the settings GET is readable by any authenticated user", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get("/api/v1/models/vram-unload", userToken);
      assertEquals(res.status, 200);
      assertEquals((await res.json()) as Record<string, unknown>, {
        enabled: false,
        targets: { comfyui: true, llama: true },
      });
    });
  });

  it("the settings PATCH is admin-only and validates booleans", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      assertEquals(
        (await patch("/api/v1/models/vram-unload", { enabled: true }, userToken)).status,
        403,
      );
      assertEquals((await patch("/api/v1/models/vram-unload", {}, adminToken)).status, 400);
      assertEquals(
        (await patch("/api/v1/models/vram-unload", { enabled: "yes" }, adminToken)).status,
        400,
      );
      const res = await patch(
        "/api/v1/models/vram-unload",
        { enabled: true, llama: false },
        adminToken,
      );
      assertEquals(res.status, 200);
      assertEquals((await res.json()) as Record<string, unknown>, {
        enabled: true,
        targets: { comfyui: true, llama: false },
      });
    });
  });

  it("services + free are admin-only", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      assertEquals((await get("/api/v1/models/vram-unload/services", userToken)).status, 403);
      assertEquals((await post("/api/v1/models/vram-unload/free", {}, userToken)).status, 403);
    });
  });

  it("services returns a stable report shape", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get("/api/v1/models/vram-unload/services", adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        platform: string;
        services: Array<{ kind: string; endpoint: string; unloadable: boolean }>;
        detected_at: string;
      };
      assert(typeof body.platform === "string");
      assert(Array.isArray(body.services));
      assert(typeof body.detected_at === "string");
      for (const svc of body.services) {
        assert(svc.kind === "comfyui" || svc.kind === "llama-server");
        assert(typeof svc.unloadable === "boolean");
      }
    });
  });

  it("free is a guaranteed no-op when both targets are disabled", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      // Disable both targets so nothing real can be freed, whatever is running.
      const off = await patch(
        "/api/v1/models/vram-unload",
        { comfyui: false, llama: false },
        adminToken,
      );
      assertEquals(off.status, 200);
      const res = await post("/api/v1/models/vram-unload/free", {}, adminToken);
      assertEquals(res.status, 200);
      assertEquals((await res.json()) as Record<string, unknown>, { results: [] });
    });
  });

  it("free rejects an invalid targets list before doing anything", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      assertEquals(
        (await post("/api/v1/models/vram-unload/free", { targets: ["bogus"] }, adminToken)).status,
        400,
      );
      assertEquals(
        (await post("/api/v1/models/vram-unload/free", { targets: "comfyui" }, adminToken)).status,
        400,
      );
    });
  });
});
