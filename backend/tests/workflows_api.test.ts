import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertMatch } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { hashPassword } from "../src/services/password.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

let baseUrl = "";
let adminToken = "";
let appDataDir = "";

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

function del(path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: "DELETE", headers: headers(token) });
}

// A minimal ComfyUI API-format prompt graph.
const GRAPH = {
  "3": { class_type: "KSampler", inputs: { seed: 42, model: ["4", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd.x.safetensors" } },
};

describe("workflows api", () => {
  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_workflows_api_" });
    Deno.env.set("APP_DATA_DIR", appDataDir);
    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(health.status, 200);
      const res = await post("/api/v1/auth/bootstrap", {
        email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
        password: "password123",
        display_name: "Studio Admin",
      });
      assertEquals(res.status, 201);
      adminToken = ((await res.json()) as { token: string }).token;
    });
  });

  afterEach(() => {
    closeDb();
    Deno.env.delete("APP_DATA_DIR");
    Deno.removeSync(appDataDir, { recursive: true });
  });

  it("requires authentication", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        assertEquals((await get("/api/v1/workflows")).status, 401);
        assertEquals((await post("/api/v1/workflows", { content: GRAPH })).status, 401);
      })();
    }));

  it("is admin-only", async () => {
    const email = `user.${Math.random().toString(36).slice(2)}@example.com`;
    const userId = createUser(email, await hashPassword("password123"), "Regular User");
    assertEquals(userId > 0, true);
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const login = await post("/api/v1/auth/login", { email, password: "password123" });
        assertEquals(login.status, 200);
        const userToken = ((await login.json()) as { token: string }).token;
        assertEquals((await get("/api/v1/workflows", userToken)).status, 403);
        assertEquals((await post("/api/v1/workflows", { content: GRAPH }, userToken)).status, 403);
        assertEquals((await del("/api/v1/workflows/wf_x", userToken)).status, 403);
      })();
    });
  });

  it("saves, lists, reads and deletes a workflow", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const created = await post(
          "/api/v1/workflows",
          { content: GRAPH, filename: "a.json" },
          adminToken,
        );
        assertEquals(created.status, 201);
        const summary = (await created.json()) as { id: string; name: string; node_count: number };
        assertMatch(summary.id, /^wf_/);
        assertEquals(summary.node_count, 2);
        assertEquals(summary.name, "a");

        const listed = await get("/api/v1/workflows", adminToken);
        assertEquals(listed.status, 200);
        const listBody = (await listed.json()) as Array<{ id: string }>;
        assertEquals(listBody.length, 1);
        assertEquals(listBody[0].id, summary.id);

        const detailRes = await get(`/api/v1/workflows/${summary.id}`, adminToken);
        assertEquals(detailRes.status, 200);
        const detail = (await detailRes.json()) as {
          node_count: number;
          nodes: Array<{ id: string; class_type: string | null; inputs: Record<string, unknown> }>;
        };
        assertEquals(detail.node_count, 2);
        const sampler = detail.nodes.find((n) => n.id === "3");
        assertEquals(sampler!.class_type, "KSampler");
        assertEquals(sampler!.inputs["model"], "[link]");

        const deleted = await del(`/api/v1/workflows/${summary.id}`, adminToken);
        assertEquals(deleted.status, 204);
        assertEquals((await get(`/api/v1/workflows/${summary.id}`, adminToken)).status, 404);
        assertEquals((await del(`/api/v1/workflows/${summary.id}`, adminToken)).status, 404);
      })();
    });
  });

  it("rejects invalid workflow content", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        // Missing content.
        assertEquals((await post("/api/v1/workflows", {}, adminToken)).status, 400);
        // UI-format (nodes array) gets an actionable 400.
        const ui = await post(
          "/api/v1/workflows",
          { content: { nodes: [], links: [] } },
          adminToken,
        );
        assertEquals(ui.status, 400);
        const uiBody = (await ui.json()) as { error: { message: string } };
        assertMatch(uiBody.error.message, /API Format/);
        // Not a valid JSON object.
        assertEquals(
          (await post("/api/v1/workflows", { content: [1, 2, 3] }, adminToken)).status,
          400,
        );
      })();
    });
  });

  it("registers a model whose workflow_ref resolves to the stored graph", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const created = await post("/api/v1/workflows", { content: GRAPH }, adminToken);
        assertEquals(created.status, 201);
        const wf = (await created.json()) as { id: string };
        const model = await post("/api/v1/models", {
          name: "flux-comfy",
          version: "1.0.0",
          backend: "comfyui",
          task_types: ["text_to_image"],
          default_settings: { endpoint: "http://127.0.0.1:8188", workflow_ref: wf.id },
        }, adminToken);
        assertEquals(model.status, 201);
        const modelBody = (await model.json()) as { default_settings: Record<string, unknown> };
        assertEquals(modelBody.default_settings["workflow"], GRAPH);
        assertEquals(modelBody.default_settings["workflow_ref"], undefined);
      })();
    });
  });
});
