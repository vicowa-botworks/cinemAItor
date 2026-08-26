import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertMatch } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { hashPassword } from "../src/services/password.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

// Scripted fake LLM: each call pops the next response (tool call or final
// content); an exhausted queue repeats the last response.
interface ScriptedResponse {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; args: unknown }>;
}

interface RecordedRequest {
  messages: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>> | undefined;
}

interface ScriptedLlm {
  url: string;
  shutdown: () => void;
  requests: RecordedRequest[];
}

function startScriptedLlm(): ScriptedLlm {
  let callIndex = 0;
  let lastScript: ScriptedResponse[] | null = null;
  const requests: RecordedRequest[] = [];
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1" }, async (req: Request) => {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const body = (await req.json()) as Record<string, unknown>;
    requests.push({
      messages: body.messages as Array<Record<string, unknown>>,
      tools: body.tools as Array<Record<string, unknown>> | undefined,
    });
    if (script !== lastScript) {
      callIndex = 0;
      lastScript = script;
    }
    const scripted = script[callIndex] ?? script[script.length - 1] ?? { content: "OK" };
    callIndex += 1;
    const message: Record<string, unknown> = {
      role: "assistant",
      content: scripted.content ?? null,
    };
    if (scripted.toolCalls?.length) {
      message.tool_calls = scripted.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
      }));
    }
    return Response.json({
      id: "chatcmpl-fake",
      model: "fake-model",
      choices: [{ index: 0, message, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    });
  });
  return {
    url: `http://127.0.0.1:${server.addr.port}/v1`,
    shutdown: () => server.shutdown(),
    requests,
  };
}

let baseUrl = "";
let adminToken = "";
let llm: ScriptedLlm;
let script: ScriptedResponse[];

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

function put(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

async function setLlmEndpoint(url: string): Promise<void> {
  const res = await put("/api/v1/llm/settings", {
    enabled: true,
    base_url: url,
    model: "fake-model",
  }, adminToken);
  assertEquals(res.status, 200);
}

function toolNamesInRequest(index: number): string[] {
  const tools = llm.requests[index].tools;
  if (!tools) return [];
  return tools.map((t) => (t.function as { name: string }).name);
}

/** One agent turn that ends in a register_model proposal; returns its id. */
async function makeProposal(name: string, token: string): Promise<string> {
  script = [
    {
      toolCalls: [{
        id: `call_${name.replace(/\W/g, "_")}`,
        name: "register_model",
        args: { name, backend: "mock", task_types: ["text_to_image"] },
      }],
    },
    { content: "ok" },
  ];
  const res = await post("/api/v1/llm/agent", {
    history: [{ role: "user", content: `register ${name}` }],
  }, token);
  assertEquals(res.status, 200);
  const body = (await res.json()) as { proposals: Array<{ id: string }> };
  assertEquals(body.proposals.length, 1);
  return body.proposals[0].id;
}

describe("llm agent", () => {
  beforeEach(async () => {
    script = [];
    llm = startScriptedLlm();
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
    llm.shutdown();
    closeDb();
  });

  it("503 when the LLM endpoint is not configured", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "hello" }],
      }, adminToken);
      assertEquals(res.status, 503);
    });
  });

  it("rejects invalid history", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint(llm.url);
      for (
        const bad of [
          { history: "nope" },
          { history: [] },
          { history: [{ role: "system", content: "x" }] },
          { history: [{ role: "user", content: "  " }] },
          { history: Array.from({ length: 33 }, (_, i) => ({ role: "user", content: `m${i}` })) },
        ]
      ) {
        const res = await post("/api/v1/llm/agent", bad, adminToken);
        assertEquals(res.status, 400, JSON.stringify(bad));
      }
    });
  });

  it("auto-executes read-only tools and returns the reply", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint(llm.url);
      script = [
        { toolCalls: [{ id: "call_1", name: "list_skills", args: { assistant_only: false } }] },
        { content: "There are 3 system skills." },
      ];
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "list the skills" }],
      }, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assertEquals(body.reply, "There are 3 system skills.");
      const steps = body.steps as Array<Record<string, unknown>>;
      assertEquals(steps.length, 1);
      assertEquals(steps[0].tool, "list_skills");
      assertEquals(steps[0].status, "ok");
      // Second LLM call carried the tool result as a tool-role message.
      assertEquals(llm.requests.length, 2);
      const secondMessages = llm.requests[1].messages;
      const toolMsg = secondMessages.find((m) => m.role === "tool");
      assertEquals(toolMsg?.tool_call_id, "call_1");
      assertMatch(String(toolMsg?.content), /sys-t2v-prompting/);
    });
  });

  it("mutating tools create a proposal and do not execute", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint(llm.url);
      const id = await makeProposal("Copilot Model", adminToken);
      // Not executed yet.
      const list = await get("/api/v1/models", adminToken);
      const models = (await list.json()) as Array<Record<string, unknown>>;
      assertEquals(models.some((m) => m.name === "Copilot Model"), false);
      // The stored proposal is pending, then closes on reject.
      const rejected = (await (await post(`/api/v1/llm/proposals/${id}/reject`, {}, adminToken))
        .json()) as { proposal: Record<string, unknown> };
      assertEquals(rejected.proposal.status, "rejected");
      assertEquals(
        (rejected.proposal.args as Record<string, unknown>).name as string,
        "Copilot Model",
      );
    });
  });

  it("approve executes the stored call; reject closes it", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint(llm.url);
      const approveId = await makeProposal("Approve Me", adminToken);
      const rejectId = await makeProposal("Reject Me", adminToken);

      const approved = await post(`/api/v1/llm/proposals/${approveId}/approve`, {}, adminToken);
      assertEquals(approved.status, 200);
      const approvedBody = (await approved.json()) as Record<string, unknown>;
      assertEquals((approvedBody.proposal as Record<string, unknown>).status, "approved");
      assertEquals(
        ((approvedBody.result as Record<string, unknown>).model as Record<string, unknown>).name,
        "Approve Me",
      );

      const rejected = await post(`/api/v1/llm/proposals/${rejectId}/reject`, {}, adminToken);
      assertEquals(rejected.status, 200);
      assertEquals(
        ((await rejected.json()) as { proposal: { status: string } }).proposal.status,
        "rejected",
      );

      const list = await get("/api/v1/models", adminToken);
      const models = (await list.json()) as Array<Record<string, unknown>>;
      assertEquals(models.some((m) => m.name === "Approve Me"), true);
      assertEquals(models.some((m) => m.name === "Reject Me"), false);

      // Non-pending proposals refuse further action.
      assertEquals(
        (await post(`/api/v1/llm/proposals/${approveId}/approve`, {}, adminToken)).status,
        409,
      );
      assertEquals(
        (await post(`/api/v1/llm/proposals/${rejectId}/reject`, {}, adminToken)).status,
        409,
      );
      // Unknown proposal ids 404.
      assertEquals(
        (await post("/api/v1/llm/proposals/nope/approve", {}, adminToken)).status,
        404,
      );
    });
  });

  it("register_model_from_huggingface proposal registers on approval", async () => {
    // Fake HuggingFace endpoint (repo metadata + file tree), following the
    // fake-HF pattern from huggingface.test.ts: the base carries the /api
    // prefix and the repo id is two path segments, <owner>/<name> (the live
    // HF API rejects a percent-encoded slash).
    const hf = Deno.serve({ port: 0, hostname: "127.0.0.1" }, (req: Request) => {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);
      const notFound = () => Response.json({ error: "Not found" }, { status: 404 });
      if (parts[0] !== "api" || parts[1] !== "models") return notFound();
      const repoId = `${decodeURIComponent(parts[2] ?? "")}/${decodeURIComponent(parts[3] ?? "")}`;
      if (repoId !== "acme/flux-test") return notFound();
      if (parts.length === 4) {
        return Response.json({
          id: "acme/flux-test",
          likes: 5,
          downloads: 100,
          pipeline_tag: "text-to-image",
          tags: ["license:apache-2.0"],
        });
      }
      if (parts.length === 6 && parts[4] === "tree" && parts[5] === "main") {
        // Live HF tree entries are keyed by `path`, never `name`.
        return Response.json([
          { path: "model.safetensors", size: 5_000_000_000, type: "file" },
        ]);
      }
      return notFound();
    });
    const oldHfBase = Deno.env.get("HF_API_BASE");
    const oldHfPublicBase = Deno.env.get("HF_PUBLIC_BASE");
    Deno.env.set("HF_API_BASE", `http://127.0.0.1:${hf.addr.port}/api`);
    // README fetches go to the public site base — point it at the fake too so
    // the test never touches the real huggingface.co.
    Deno.env.set("HF_PUBLIC_BASE", `http://127.0.0.1:${hf.addr.port}`);
    try {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint(llm.url);
        script = [
          {
            toolCalls: [{
              id: "call_hf",
              name: "register_model_from_huggingface",
              args: { repo_id: "acme/flux-test", task_types: ["text_to_image"] },
            }],
          },
          { content: "I propose to register the Flux repo." },
        ];
        const res = await post("/api/v1/llm/agent", {
          history: [{ role: "user", content: "register acme/flux-test" }],
        }, adminToken);
        assertEquals(res.status, 200);
        const body = (await res.json()) as { proposals: Array<{ id: string }> };
        assertEquals(body.proposals.length, 1);

        const approved = await post(
          `/api/v1/llm/proposals/${body.proposals[0].id}/approve`,
          {},
          adminToken,
        );
        assertEquals(approved.status, 200);
        const approvedBody = (await approved.json()) as {
          result: { model: { id: string; repository_url: string } };
        };
        assertEquals(approvedBody.result.model.id, "flux_test");
        assertMatch(
          approvedBody.result.model.repository_url,
          /acme\/flux-test\/resolve\/main\/model\.safetensors/,
        );
      });
    } finally {
      if (oldHfBase === undefined) Deno.env.delete("HF_API_BASE");
      else Deno.env.set("HF_API_BASE", oldHfBase);
      if (oldHfPublicBase === undefined) Deno.env.delete("HF_PUBLIC_BASE");
      else Deno.env.set("HF_PUBLIC_BASE", oldHfPublicBase);
      hf.shutdown();
    }
  });

  it("non-admins get the read-only tool schema and no proposals", async () => {
    const email = `user.${Math.random().toString(36).slice(2)}@example.com`;
    createUser(email, await hashPassword("password123"), "Regular User");
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint(llm.url);
      const login = await post("/api/v1/auth/login", { email, password: "password123" });
      const userToken = ((await login.json()) as { token: string }).token;

      script = [
        { toolCalls: [{ id: "call_1", name: "list_models", args: {} }] },
        { content: "No models yet." },
      ];
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "list models" }],
      }, userToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assertEquals(body.reply, "No models yet.");

      // Schema carried to the LLM: read-only tools only.
      const names = toolNamesInRequest(0);
      for (
        const mutating of [
          "register_model",
          "register_model_from_huggingface",
          "install_model",
          "remove_model",
        ]
      ) {
        assertEquals(names.includes(mutating), false, mutating);
      }
      assertEquals(names.includes("list_models"), true);

      // A mutating call that slips through is refused, not proposed.
      script = [
        {
          toolCalls: [{
            id: "call_2",
            name: "register_model",
            args: { name: "Sneaky", backend: "mock", task_types: ["text_to_image"] },
          }],
        },
        { content: "Sorry." },
      ];
      const res2 = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "register something" }],
      }, userToken);
      const body2 = (await res2.json()) as {
        steps: Array<{ status: string; summary: string }>;
        proposals: unknown[];
      };
      assertEquals(body2.steps[0].status, "error");
      assertMatch(body2.steps[0].summary, /admin role/);
      assertEquals(body2.proposals.length, 0);

      // Proposals are admin-only even with a valid pending id.
      const adminProposal = await makeProposal("Admin One", adminToken);
      assertEquals(
        (await post(`/api/v1/llm/proposals/${adminProposal}/approve`, {}, userToken)).status,
        403,
      );
    });
  });

  it("truncates after 8 tool iterations", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint(llm.url);
      script = Array.from({ length: 9 }, (_, i) => ({
        toolCalls: [{ id: `call_${i}`, name: "list_models", args: {} }],
      }));
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "loop forever" }],
      }, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        iterations: number;
        truncated: boolean;
        reply: string;
        steps: unknown[];
      };
      assertEquals(body.iterations, 8);
      assertEquals(body.truncated, true);
      assertMatch(body.reply, /stopped after 8 tool iterations/);
      assertEquals(body.steps.length, 8);
      assertEquals(llm.requests.length, 8);
    });
  });

  it("invalid tool arguments produce an error step, not a crash", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint(llm.url);
      script = [
        { toolCalls: [{ id: "call_1", name: "model_info", args: "not-json" }] },
        { content: "That model does not exist." },
      ];
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "tell me about model x" }],
      }, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as { steps: Array<{ tool: string; status: string }> };
      assertEquals(body.steps[0].tool, "model_info");
      assertEquals(body.steps[0].status, "error");
    });
  });

  it("comfyui_status probes the runtime", async () => {
    const comfyHits: string[] = [];
    const comfy = Deno.serve({ port: 0, hostname: "127.0.0.1" }, (req: Request) => {
      const url = new URL(req.url);
      comfyHits.push(url.pathname);
      if (url.pathname === "/system_stats") {
        return Response.json({
          queue_running: [{ prompt_id: "p1" }],
          queue_pending: [],
          devices: [{ name: "NVIDIA X", vram_total: 8 * 1024 ** 3, vram_free: 4 * 1024 ** 3 }],
        });
      }
      return Response.json({ error: "nope" }, { status: 404 });
    });
    try {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint(llm.url);
        script = [
          {
            toolCalls: [{
              id: "call_1",
              name: "comfyui_status",
              args: { endpoint: `http://127.0.0.1:${comfy.addr.port}` },
            }],
          },
          { content: "ComfyUI is up with 1 job running." },
        ];
        const res = await post("/api/v1/llm/agent", {
          history: [{ role: "user", content: "is comfy running?" }],
        }, adminToken);
        assertEquals(res.status, 200);
        const body = (await res.json()) as { steps: Array<{ status: string; summary: string }> };
        assertEquals(body.steps[0].status, "ok");
        assertMatch(body.steps[0].summary, /ComfyUI reachable/);
        assertEquals(comfyHits, ["/system_stats"]);
      });
    } finally {
      comfy.shutdown();
    }
  });
});
