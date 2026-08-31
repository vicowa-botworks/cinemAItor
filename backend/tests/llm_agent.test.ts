import { dirname, join } from "@std/path";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists, assertMatch, assertNotEquals } from "@std/assert";
import { closeDb, getDb } from "../src/db/database.ts";
import { BENCHMARK_JOB_TYPE, createJob } from "../src/db/jobs.ts";
import {
  registerModel as dbRegisterModel,
  setModelInstalled,
  updateModel as dbUpdateModel,
} from "../src/db/models.ts";
import { createUser } from "../src/db/schema.ts";
import { hashPassword } from "../src/services/password.ts";
import { storageLayout } from "../src/storage/paths.ts";
import { modelDir } from "../src/services/model_files.ts";
import {
  claimsProposalReply,
  copilotSystemPrompt,
  createProposal,
  rejectProposal,
  resetProposals,
} from "../src/services/llm_agent.ts";
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

  it("approve normalizes HF dashed task types in a register_model proposal", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint(llm.url);
      // The copilot's context carries HF's dashed pipeline tags, so the LLM
      // may propose dashed task types; approval must normalize to canonical.
      script = [
        {
          toolCalls: [{
            id: "call_dashed",
            name: "register_model",
            args: {
              name: "Dashed Tasks",
              backend: "mock",
              task_types: ["image-to-image", "text_to_image"],
            },
          }],
        },
        { content: "ok" },
      ];
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "register the dashed model" }],
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
        result: { model: { task_types: string[] } };
      };
      assertEquals(approvedBody.result.model.task_types, ["image_to_image", "text_to_image"]);

      const list = await get("/api/v1/models", adminToken);
      const models = (await list.json()) as Array<Record<string, unknown>>;
      const stored = models.find((m) => m.name === "Dashed Tasks");
      assertEquals(stored?.task_types, ["image_to_image", "text_to_image"]);
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
              args: {
                repo_id: "acme/flux-test",
                task_types: ["text_to_image"],
                default_settings: { command: "flux-runner" },
              },
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
          "update_model",
          "write_model_file",
          "install_model_deps",
          "install_model",
          "remove_model",
        ]
      ) {
        assertEquals(names.includes(mutating), false, mutating);
      }
      assertEquals(names.includes("list_models"), true);
      assertEquals(names.includes("model_files"), true);

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

  it("truncates after 16 tool iterations", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint(llm.url);
      script = Array.from({ length: 17 }, (_, i) => ({
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
      assertEquals(body.iterations, 16);
      assertEquals(body.truncated, true);
      assertMatch(body.reply, /stopped after 16 tool iterations/);
      assertEquals(body.steps.length, 16);
      assertEquals(llm.requests.length, 16);
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

// ---------------------------------------------------------------------------
// Runtime tools: write_model_file, install_model_deps, update_model,
// model_files — the copilot's local_cli setup path.
// ---------------------------------------------------------------------------

/**
 * Fake `python3` for install_model_deps tests: `python3 -m venv <dir>`
 * creates a fake venv whose bin/python is itself a fake pip runner, and
 * `... -m pip install ...` echoes each requirement.
 */
const FAKE_PYTHON_SH = `#!/usr/bin/env bash
if [ "$2" = "venv" ]; then
  dir="$3"
  mkdir -p "$dir/bin"
  cat > "$dir/bin/python" <<'INNER'
#!/usr/bin/env bash
for pkg in "\${@:5}"; do echo "Collecting $pkg"; done
exit 0
INNER
  chmod +x "$dir/bin/python"
  exit 0
fi
for pkg in "\${@:5}"; do echo "Collecting $pkg"; done
exit 0
`;

/** Like FAKE_PYTHON_SH, but the venv's pip install sleeps ~0.5 s. */
const FAKE_PYTHON_SLOW_SH = `#!/usr/bin/env bash
if [ "$2" = "venv" ]; then
  dir="$3"
  mkdir -p "$dir/bin"
  cat > "$dir/bin/python" <<'INNER'
#!/usr/bin/env bash
sleep 0.5
for pkg in "\${@:5}"; do echo "Collecting $pkg"; done
exit 0
INNER
  chmod +x "$dir/bin/python"
  exit 0
fi
for pkg in "\${@:5}"; do echo "Collecting $pkg"; done
exit 0
`;

describe("llm agent runtime tools", () => {
  let appDataDir = "";
  let fakePython = "";
  const oldVenvPython = Deno.env.get("MODEL_VENV_PYTHON");

  /** One agent turn that ends in a proposal for the given tool; returns its id. */
  async function makeProposalFor(tool: string, args: unknown): Promise<string> {
    script = [
      { toolCalls: [{ id: `call_${tool}`, name: tool, args }] },
      { content: "ok" },
    ];
    const res = await post("/api/v1/llm/agent", {
      history: [{ role: "user", content: `use ${tool}` }],
    }, adminToken);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { proposals: Array<{ id: string }> };
    assertEquals(body.proposals.length, 1);
    return body.proposals[0].id;
  }

  async function approve(id: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await post(`/api/v1/llm/proposals/${id}/approve`, {}, adminToken);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function registerModel(name: string, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await post("/api/v1/models", {
      name,
      version: "1.0.0",
      backend: "mock",
      task_types: ["text_to_image"],
      ...extra,
    }, adminToken);
    assertEquals(res.status, 201);
    return ((await res.json()) as { id: string }).id;
  }

  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_agent_rt_" });
    Deno.env.set("APP_DATA_DIR", appDataDir);
    script = [];
    llm = startScriptedLlm();
    freshMemoryDb();
    resetProposals();
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
      await setLlmEndpoint(llm.url);
    });
  });

  afterEach(async () => {
    llm.shutdown();
    closeDb();
    if (oldVenvPython === undefined) Deno.env.delete("MODEL_VENV_PYTHON");
    else Deno.env.set("MODEL_VENV_PYTHON", oldVenvPython);
    if (fakePython) await Deno.remove(dirname(fakePython), { recursive: true });
    fakePython = "";
    await Deno.remove(appDataDir, { recursive: true });
  });

  it("model_files is read-only and reports an empty runtime for a fresh model", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const id = await registerModel("Fresh Model");
      script = [
        { toolCalls: [{ id: "call_files", name: "model_files", args: { model_id: id } }] },
        { content: "No files yet." },
      ];
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "what files does it have?" }],
      }, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as { steps: Array<{ status: string }> };
      assertEquals(body.steps[0].status, "ok");
      // The tool result reached the LLM on the next call.
      assertEquals(llm.requests.length, 2);
      const toolMsg = (llm.requests[1].messages as Array<Record<string, unknown>>)
        .find((m) => m.role === "tool");
      const report = JSON.parse(String(toolMsg?.content)) as {
        files: unknown[];
        has_weights: boolean;
        has_venv: boolean;
      };
      assertEquals(report.files, []);
      assertEquals(report.has_weights, false);
      assertEquals(report.has_venv, false);
    });
  });

  it("write_model_file proposal writes the script on approval; bad names 400", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const id = await registerModel("Scripted Model");
      const dir = modelDir(storageLayout(appDataDir), id);
      const content = "import sys\nprint('runner', sys.argv)\n";

      const okId = await makeProposalFor("write_model_file", {
        model_id: id,
        filename: "runner.py",
        content,
      });
      const ok = await approve(okId);
      assertEquals(ok.status, 200);
      const result = ok.body.result as { path: string; bytes: number };
      assert(result.path.startsWith(`${dir}/runner.py`));
      assertEquals(result.bytes, content.length);
      assertEquals(await Deno.readTextFile(join(dir, "runner.py")), content);

      // Path traversal is rejected and the proposal stays pending.
      const badId = await makeProposalFor("write_model_file", {
        model_id: id,
        filename: "../evil.py",
        content: "x",
      });
      assertEquals((await approve(badId)).status, 400);
      const rejected = await post(`/api/v1/llm/proposals/${badId}/reject`, {}, adminToken);
      assertEquals(rejected.status, 200);

      // App-owned files are reserved.
      for (const reserved of ["model.bin", "model.bin.verified", ".venv"]) {
        const resId = await makeProposalFor("write_model_file", {
          model_id: id,
          filename: reserved,
          content: "x",
        });
        assertEquals((await approve(resId)).status, 400);
        assertEquals(
          (await post(`/api/v1/llm/proposals/${resId}/reject`, {}, adminToken)).status,
          200,
        );
      }
    });
  });

  it("install_model_deps builds a .venv and reuses it on the second run", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const id = await registerModel("Venv Model");
      const dir = modelDir(storageLayout(appDataDir), id);
      const binDir = Deno.makeTempDirSync({ prefix: "fakepy_" });
      fakePython = join(binDir, "python3");
      await Deno.writeTextFile(fakePython, FAKE_PYTHON_SH);
      await Deno.chmod(fakePython, 0o755);
      Deno.env.set("MODEL_VENV_PYTHON", fakePython);

      const first = await makeProposalFor("install_model_deps", {
        model_id: id,
        packages: ["torch", "diffusers==0.32.0"],
      });
      const ok1 = await approve(first);
      assertEquals(ok1.status, 200);
      const result1 = ok1.body.result as {
        venv_python: string;
        created_venv: boolean;
        output_tail: string;
      };
      assertEquals(result1.venv_python, join(dir, ".venv", "bin", "python"));
      assertEquals(result1.created_venv, true);
      assertExists(result1.venv_python);
      assertMatch(result1.output_tail, /Collecting torch/);
      assertMatch(result1.output_tail, /Collecting diffusers==0\.32\.0/);

      const second = await makeProposalFor("install_model_deps", {
        model_id: id,
        packages: ["accelerate"],
      });
      const ok2 = await approve(second);
      assertEquals(ok2.status, 200);
      assertEquals(
        (ok2.body.result as { created_venv: boolean }).created_venv,
        false,
      );

      // pip option injection is rejected before anything runs.
      const bad = await makeProposalFor("install_model_deps", {
        model_id: id,
        packages: ["--index-url", "http://evil.example"],
      });
      const okBad = await approve(bad);
      assertEquals(okBad.status, 400);
      assertMatch(
        String((okBad.body.error as { message?: string }).message ?? ""),
        /invalid pip requirement/,
      );
      assertEquals(
        (await post(`/api/v1/llm/proposals/${bad}/reject`, {}, adminToken)).status,
        200,
      );
    });
  });

  it("a duplicate approve 409s while the approved tool is still executing", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const id = await registerModel("Slow Install");
      const binDir = Deno.makeTempDirSync({ prefix: "fakepy_slow_" });
      fakePython = join(binDir, "python3");
      await Deno.writeTextFile(fakePython, FAKE_PYTHON_SLOW_SH);
      await Deno.chmod(fakePython, 0o755);
      Deno.env.set("MODEL_VENV_PYTHON", fakePython);

      const pid = await makeProposalFor("install_model_deps", {
        model_id: id,
        packages: ["requests"],
      });
      const first = post(`/api/v1/llm/proposals/${pid}/approve`, {}, adminToken);
      // The fake pip install sleeps ~0.5 s, so the approval is in flight
      // well before the duplicate lands.
      await new Promise((r) => setTimeout(r, 200));
      const dup = await post(`/api/v1/llm/proposals/${pid}/approve`, {}, adminToken);
      assertEquals(dup.status, 409);
      assertMatch(
        String(((await dup.json()) as { error?: { message?: string } }).error?.message ?? ""),
        /in progress/,
      );
      // Rejecting an in-flight proposal is refused the same way.
      assertEquals(
        (await post(`/api/v1/llm/proposals/${pid}/reject`, {}, adminToken)).status,
        409,
      );
      // The original approval still completes.
      const res = await first;
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        proposal: { status: string; in_flight: boolean };
      };
      assertEquals(body.proposal.status, "approved");
      assertEquals(body.proposal.in_flight, false);
    });
  });

  it("GET /proposals lists the caller's proposals with live status", async () => {
    const email = `user.${Math.random().toString(36).slice(2)}@example.com`;
    createUser(email, await hashPassword("password123"), "Regular User");
    await withServer(async (base) => {
      baseUrl = base;
      const login = await post("/api/v1/auth/login", { email, password: "password123" });
      const userToken = ((await login.json()) as { token: string }).token;

      const id = await registerModel("Listed Model");
      const pid = await makeProposalFor("write_model_file", {
        model_id: id,
        filename: "runner.py",
        content: "print('hi')\n",
      });

      // The creator sees the pending proposal.
      const res = await get("/api/v1/llm/proposals", adminToken);
      assertEquals(res.status, 200);
      const list = (await res.json()) as {
        proposals: Array<Record<string, unknown>>;
      };
      const p = list.proposals.find((x) => x.id === pid);
      assertExists(p);
      assertEquals(p.status, "pending");
      assertEquals(p.tool, "write_model_file");

      // Other users do not see proposals that are not theirs.
      const other = await get("/api/v1/llm/proposals", userToken);
      assertEquals(other.status, 200);
      const otherList = (await other.json()) as {
        proposals: Array<Record<string, unknown>>;
      };
      assertEquals(otherList.proposals.some((x) => x.id === pid), false);

      // After approval the list reflects the settled state + result.
      const ok = await approve(pid);
      assertEquals(ok.status, 200);
      const after = (await (await get("/api/v1/llm/proposals", adminToken)).json()) as {
        proposals: Array<Record<string, unknown>>;
      };
      const p2 = after.proposals.find((x) => x.id === pid);
      assertExists(p2);
      assertEquals(p2.status, "approved");
      assertEquals(p2.in_flight, false);
      assertExists(p2.result);
    });
  });

  it("update_model proposal patches settings and task types; invalid settings 400", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const id = await registerModel("Patch Me", {
        backend: "local_cli",
        default_settings: { command: "python3" },
      });

      const okId = await makeProposalFor("update_model", {
        model_id: id,
        task_types: ["text_to_image", "image_to_image"],
        default_settings: {
          command: "/opt/venvs/flux/bin/python",
          args: ["runner.py", "--prompt", "{prompt}", "--seed", "{seed}", "--output", "{output}"],
        },
      });
      const ok = await approve(okId);
      assertEquals(ok.status, 200);
      const fetched = await get(`/api/v1/models/${id}`, adminToken);
      const model = (await fetched.json()) as {
        task_types: string[];
        default_settings: Record<string, unknown>;
      };
      assertEquals(model.task_types, ["text_to_image", "image_to_image"]);
      assertEquals(
        (model.default_settings as { command: string }).command,
        "/opt/venvs/flux/bin/python",
      );

      // Re-validation on settings touch: a local_cli command that is not a
      // non-blank string is refused, proposal stays pending.
      const badId = await makeProposalFor("update_model", {
        model_id: id,
        default_settings: { command: "   " },
      });
      const okBad = await approve(badId);
      assertEquals(okBad.status, 400);
      assertEquals(
        (await post(`/api/v1/llm/proposals/${badId}/reject`, {}, adminToken)).status,
        200,
      );
    });
  });

  async function setAutoApprove(id: string, on: boolean): Promise<void> {
    const res = await fetch(`${baseUrl}/api/v1/models/${id}`, {
      method: "PATCH",
      headers: headers(adminToken),
      body: JSON.stringify({ agent_auto_approve: on }),
    });
    assertEquals(res.status, 200);
  }

  /** One agent turn with the given tool calls; returns the parsed response. */
  async function agentTurn(
    calls: Array<{ id: string; name: string; args: unknown }>,
    content: string,
  ): Promise<Record<string, unknown>> {
    script = [
      { toolCalls: calls },
      { content: "done" },
    ];
    const res = await post("/api/v1/llm/agent", {
      history: [{ role: "user", content }],
    }, adminToken);
    assertEquals(res.status, 200);
    return (await res.json()) as Record<string, unknown>;
  }

  function stepsOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
    return body.steps as Array<Record<string, unknown>>;
  }

  it("auto-approval executes model-scoped tools in-loop", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const id = await registerModel("Auto Model");
      await setAutoApprove(id, true);
      const body = await agentTurn(
        [{
          id: "call_upd",
          name: "update_model",
          args: { model_id: id, task_types: ["text_to_image", "text_to_video"] },
        }],
        "add a video task type",
      );
      const steps = stepsOf(body);
      assertEquals(steps.length, 1);
      assertEquals(steps[0].status, "ok");
      assertMatch(String(steps[0].summary), /^auto-approved \(/);
      const proposals = body.proposals as Array<Record<string, unknown>>;
      assertEquals(proposals.length, 1);
      assertEquals(proposals[0].status, "approved");
      const fetched = await get(`/api/v1/models/${id}`, adminToken);
      const model = (await fetched.json()) as { task_types: string[] };
      assertEquals(model.task_types, ["text_to_image", "text_to_video"]);
    });
  });

  it("never auto-approves non-scoped tools even with the flag on", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const id = await registerModel("Guard Model");
      await setAutoApprove(id, true);
      const body = await agentTurn(
        [{ id: "call_inst", name: "install_model", args: { model_id: id } }],
        "install it",
      );
      const steps = stepsOf(body);
      assertEquals(steps[0].status, "proposal");
      assertMatch(String(steps[0].summary), /awaiting user approval/);
      const proposals = body.proposals as Array<Record<string, unknown>>;
      assertEquals(proposals[0].status, "pending");
    });
  });

  it("run_smoke_test auto-runs the CLI and reports the failure tail", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const binDir = Deno.makeTempDirSync({ prefix: "smoke_fail_" });
      const failSh = join(binDir, "fail.sh");
      await Deno.writeTextFile(
        failSh,
        "#!/usr/bin/env bash\necho \"ModuleNotFoundError: No module named 'torch'\" >&2\nexit 3\n",
      );
      await Deno.chmod(failSh, 0o755);
      const id = await registerModel("Smoke Model", {
        backend: "local_cli",
        default_settings: {
          command: failSh,
          args: ["--prompt", "{prompt}", "--output", "{output}"],
        },
      });
      assertExists(setModelInstalled(id, "a".repeat(64)));
      await setAutoApprove(id, true);
      const body = await agentTurn(
        [{ id: "call_smoke", name: "run_smoke_test", args: { model_id: id, timeout_seconds: 10 } }],
        "smoke test it",
      );
      const steps = stepsOf(body);
      assertEquals(steps[0].status, "ok");
      assertMatch(String(steps[0].summary), /smoke test failed \(exit 3/);
      assertMatch(String(steps[0].summary), /torch/);
      // The failure tail is also what the LLM reads in the tool result.
      const toolMsg = (llm.requests[1].messages as Array<Record<string, unknown>>)
        .find((m) => m.role === "tool");
      assertMatch(String(toolMsg?.content), /ModuleNotFoundError/);
      await Deno.remove(binDir, { recursive: true });
    });
  });

  it("run_smoke_test success and started_ok semantics", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const binDir = Deno.makeTempDirSync({ prefix: "smoke_ok_" });
      const okSh = join(binDir, "ok.sh");
      await Deno.writeTextFile(
        okSh,
        "#!/usr/bin/env bash\nout=''\nwhile [ $# -gt 0 ]; do\n" +
          '  case "$1" in\n    --output) out="$2"; shift 2 ;;\n    *) shift ;;\n  esac\ndone\n' +
          "printf 'fake' > \"$out\"\nexit 0\n",
      );
      await Deno.chmod(okSh, 0o755);
      const hangSh = join(binDir, "hang.sh");
      await Deno.writeTextFile(hangSh, "#!/usr/bin/env bash\nsleep 30\n");
      await Deno.chmod(hangSh, 0o755);

      const okId = await registerModel("Smoke OK", {
        backend: "local_cli",
        default_settings: {
          command: okSh,
          args: ["--prompt", "{prompt}", "--output", "{output}"],
        },
      });
      assertExists(setModelInstalled(okId, "b".repeat(64)));
      await setAutoApprove(okId, true);
      const okBody = await agentTurn(
        [{
          id: "call_smoke_ok",
          name: "run_smoke_test",
          args: { model_id: okId, timeout_seconds: 10 },
        }],
        "smoke test it",
      );
      assertEquals(stepsOf(okBody)[0].status, "ok");
      assertMatch(String(stepsOf(okBody)[0].summary), /smoke test passed in/);

      const hangId = await registerModel("Smoke Hang", {
        backend: "local_cli",
        default_settings: {
          command: hangSh,
          args: ["--prompt", "{prompt}", "--output", "{output}"],
        },
      });
      assertExists(setModelInstalled(hangId, "c".repeat(64)));
      await setAutoApprove(hangId, true);
      const hangBody = await agentTurn(
        [{
          id: "call_smoke_hang",
          name: "run_smoke_test",
          args: { model_id: hangId, timeout_seconds: 1 },
        }],
        "smoke test it",
      );
      assertEquals(stepsOf(hangBody)[0].status, "ok");
      assertMatch(String(stepsOf(hangBody)[0].summary), /startup healthy/);
      await Deno.remove(binDir, { recursive: true });
    });
  });

  it("a failed auto-approval leaves the proposal pending for manual retry", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const id = await registerModel("Broken Model", {
        backend: "local_cli",
        default_settings: { command: "/nonexistent/smoke-python", args: ["--output", "{output}"] },
      });
      assertExists(setModelInstalled(id, "d".repeat(64)));
      await setAutoApprove(id, true);
      const body = await agentTurn(
        [{ id: "call_smoke_bad", name: "run_smoke_test", args: { model_id: id } }],
        "test it",
      );
      const steps = stepsOf(body);
      assertEquals(steps[0].status, "error");
      assertMatch(String(steps[0].summary), /auto-approval failed/);
      const list = await get("/api/v1/llm/proposals", adminToken);
      const proposals = ((await list.json()) as { proposals: Array<Record<string, unknown>> })
        .proposals.filter((p) => p.tool === "run_smoke_test");
      assertEquals(proposals.length, 1);
      assertEquals(proposals[0].status, "pending");
    });
  });

  it("run_benchmark enqueues once and refuses a second run while one is open", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const id = await registerModel("Bench Model");
      assertExists(setModelInstalled(id, "e".repeat(64)));
      await setAutoApprove(id, true);
      const body = await agentTurn(
        [{ id: "call_bench", name: "run_benchmark", args: { model_id: id } }],
        "benchmark it",
      );
      const steps = stepsOf(body);
      assertEquals(steps[0].status, "ok");
      assertMatch(String(steps[0].summary), /benchmark enqueued \(job /);
      // Pin the benchmark job in a live running state (valid lease) so the
      // duplicate guard is deterministic — the runner leaves it alone.
      createJob(1, { job_type: BENCHMARK_JOB_TYPE, model_id: id });
      getDb()
        .prepare(
          `UPDATE generation_jobs SET status = 'running', lease_owner = 'test',
             lease_expires_at = ? WHERE model_id = ? AND job_type = ?`,
        )
        .run(new Date(Date.now() + 60_000).toISOString(), id, BENCHMARK_JOB_TYPE);
      const body2 = await agentTurn(
        [{ id: "call_bench2", name: "run_benchmark", args: { model_id: id } }],
        "benchmark it again",
      );
      const steps2 = stepsOf(body2);
      assertEquals(steps2[0].status, "error");
      assertMatch(String(steps2[0].summary), /already running \(job /);
    });
  });

  it("run_benchmark refuses uninstalled and non-benchmarkable models", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const uninstalled = await registerModel("Uninstalled Model");
      await setAutoApprove(uninstalled, true);
      const body = await agentTurn(
        [{ id: "call_bench3", name: "run_benchmark", args: { model_id: uninstalled } }],
        "benchmark it",
      );
      assertEquals(stepsOf(body)[0].status, "error");
      assertMatch(String(stepsOf(body)[0].summary), /not installed/);

      const noTasks = await registerModel("NoBench Model", {
        task_types: ["image_to_image"],
      });
      assertExists(setModelInstalled(noTasks, "f".repeat(64)));
      await setAutoApprove(noTasks, true);
      const body2 = await agentTurn(
        [{ id: "call_bench4", name: "run_benchmark", args: { model_id: noTasks } }],
        "benchmark it",
      );
      assertEquals(stepsOf(body2)[0].status, "error");
      assertMatch(String(stepsOf(body2)[0].summary), /no benchmarkable task types/);
    });
  });

  it("logs an auto_approved event on the conversation", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const id = await registerModel("Log Model");
      await setAutoApprove(id, true);
      const conversationId = `auto-approve-${Date.now()}`;
      script = [
        {
          toolCalls: [
            { id: "call_upd2", name: "update_model", args: { model_id: id, enabled: false } },
          ],
        },
        { content: "done" },
      ];
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "disable the model" }],
        conversation_id: conversationId,
      }, adminToken);
      assertEquals(res.status, 200);
      const convRes = await get(`/api/v1/llm/conversations/${conversationId}`, adminToken);
      assertEquals(convRes.status, 200);
      const conv = (await convRes.json()) as {
        conversation: { messages: Array<{ role: string; content: string }> };
      };
      const events = conv.conversation.messages.filter((m) => m.role === "event");
      assertEquals(events.length, 1);
      assertEquals(events[0].content, "auto_approved");
    });
  });

  it("non-admins never see the runtime mutating tools", async () => {
    const email = `user.${Math.random().toString(36).slice(2)}@example.com`;
    createUser(email, await hashPassword("password123"), "Regular User");
    await withServer(async (base) => {
      baseUrl = base;
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
      const names = toolNamesInRequest(0);
      for (
        const mutating of [
          "update_model",
          "write_model_file",
          "install_model_deps",
          "run_smoke_test",
          "run_benchmark",
        ]
      ) {
        assertEquals(names.includes(mutating), false, mutating);
      }
      assertEquals(names.includes("model_files"), true);
    });
  });
});

describe("copilot system prompt", () => {
  beforeEach(() => {
    Deno.env.set("APP_DATA_DIR", Deno.makeTempDirSync({ prefix: "cinemaitor_copilot_prompt_" }));
    freshMemoryDb();
    resetProposals();
  });

  afterEach(() => {
    closeDb();
  });

  it("calibrates the model on the approval flow", async () => {
    const prompt = await copilotSystemPrompt(1, true);
    assertMatch(prompt, /approves each proposal AFTER your turn ends/);
    assertMatch(prompt, /continue the plan and propose the next steps/);
    assertMatch(prompt, /Do not re-propose a pending step with identical arguments/);
    assertMatch(prompt, /propose the CORRECTED version as a new proposal/);
  });

  it("lists the caller's pending proposals live", async () => {
    // No pending proposals: the section says so.
    const empty = await copilotSystemPrompt(1, true);
    assertMatch(empty, /No proposals are currently pending/);

    // A pending proposal for the same user is listed with its tool + args.
    createProposal(
      "write_model_file",
      { model_id: "m1", filename: "runner.py", content: "print('hi')\n" },
      1,
    );
    const prompt = await copilotSystemPrompt(1, true);
    assertMatch(prompt, /Pending proposals awaiting the user's decision/);
    assertMatch(prompt, /write_model_file/);
    assertMatch(prompt, /runner\.py/);

    // Other users do not see proposals that are not theirs.
    const other = await copilotSystemPrompt(2, false);
    assertMatch(other, /No proposals are currently pending/);

    // Admins see everyone's pending proposals.
    const admin = await copilotSystemPrompt(2, true);
    assertMatch(admin, /write_model_file/);
  });

  it("keeps the local_cli setup playbook", async () => {
    const prompt = await copilotSystemPrompt(1, true);
    assertMatch(prompt, /write_model_file/);
    assertMatch(prompt, /install_model_deps/);
    assertMatch(prompt, /venv python path/);
  });

  it("lists flagged models in the auto-approval section (admins only)", async () => {
    const plain = await copilotSystemPrompt(1, true);
    assert(!plain.includes("Agent auto-approval is ON"));

    const m = dbRegisterModel(1, {
      name: "Auto Model",
      version: "1.0",
      backend: "mock",
      task_types: ["text_to_image"],
    });
    assertExists(dbUpdateModel(1, m.id, { agent_auto_approve: true }));
    const admin = await copilotSystemPrompt(1, true);
    assertMatch(admin, /Agent auto-approval is ON for/);
    assertMatch(admin, new RegExp(m.id));
    assertMatch(admin, /run_smoke_test it, read the/);
    assertMatch(admin, /must have called the matching mutating tool in this same turn/);

    // Non-admins never see the section: their tools always go through a
    // pending proposal, so auto-approval cannot apply to them.
    const user = await copilotSystemPrompt(1, false);
    assert(!user.includes("Agent auto-approval is ON"));
  });
});

describe("claimsProposalReply", () => {
  it("detects proposal-claim phrasing", () => {
    assert(claimsProposalReply("I've proposed running a smoke test to validate the fix."));
    assert(claimsProposalReply("I proposed updating the runner script."));
    assert(claimsProposalReply("I have proposed the next step."));
    assert(claimsProposalReply("I've created a proposal for the venv install."));
    assert(claimsProposalReply("The proposal is pending — you can approve it."));
    assert(claimsProposalReply("I've proposed installing the dependencies."));
  });

  it("ignores honest negatives and ordinary replies", () => {
    assert(!claimsProposalReply("The model is registered and installed."));
    assert(!claimsProposalReply("There are no pending proposals."));
    assert(!claimsProposalReply("I did not propose anything — I need the repo ID first."));
    assert(!claimsProposalReply("All done, the plan is complete."));
    assert(!claimsProposalReply(""));
  });
});

describe("proposal deduplication", () => {
  beforeEach(() => resetProposals());

  it("returns the existing pending proposal for identical args", () => {
    const first = createProposal(
      "write_model_file",
      { model_id: "m", filename: "runner.py", content: "x" },
      1,
      "conv1",
    );
    assertEquals(first.duplicate, false);
    // Key order must not matter for the identity comparison.
    const second = createProposal(
      "write_model_file",
      { content: "x", filename: "runner.py", model_id: "m" },
      1,
      "conv1",
    );
    assertEquals(second.duplicate, true);
    assertEquals(second.proposal.id, first.proposal.id);
  });

  it("allows different args and different conversations", () => {
    createProposal(
      "write_model_file",
      { model_id: "m", filename: "r.py", content: "x" },
      1,
      "conv1",
    );
    const otherArgs = createProposal(
      "write_model_file",
      { model_id: "m", filename: "r.py", content: "y" },
      1,
      "conv1",
    );
    assertEquals(otherArgs.duplicate, false);
    const otherConv = createProposal(
      "write_model_file",
      { model_id: "m", filename: "r.py", content: "x" },
      1,
      "conv2",
    );
    assertEquals(otherConv.duplicate, false);
  });

  it("does not dedupe once the first proposal resolved", () => {
    const first = createProposal("update_model", { model_id: "m", enabled: true }, 1, "conv1");
    rejectProposal(first.proposal.id, true);
    const again = createProposal("update_model", { model_id: "m", enabled: true }, 1, "conv1");
    assertEquals(again.duplicate, false);
    assertNotEquals(again.proposal.id, first.proposal.id);
  });
});

describe("llm agent claim-verification nudge", () => {
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

  it("nudges once when a reply claims a proposal that was never created", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint(llm.url);
      script = [
        { content: "I've proposed running a smoke test to validate the fix." },
        {
          toolCalls: [{
            id: "call_smoke",
            name: "run_smoke_test",
            args: { model_id: "smoke_nudge_model" },
          }],
        },
        { content: "Done — the smoke test proposal is ready for approval." },
      ];
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "fix the model" }],
      }, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        reply: string;
        steps: Array<{ tool: string; status: string }>;
        proposals: Array<{ id: string; tool: string }>;
      };
      assertEquals(body.proposals.length, 1);
      assertEquals(body.proposals[0].tool, "run_smoke_test");
      assertEquals(body.steps.length, 1);
      assertEquals(body.steps[0].status, "proposal");
      // The second LLM request carries the verification nudge.
      const second = llm.requests[1].messages as Array<{ role: string; content?: string }>;
      const last = second[second.length - 1];
      assertEquals(last.role, "user");
      assertMatch(String(last.content), /no proposal was created this turn/);
      assertEquals(llm.requests.length, 3);
    });
  });

  it("nudges at most once when the copilot reports it cannot create the proposal", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint(llm.url);
      script = [
        { content: "I've proposed running a smoke test." },
        { content: "Actually I could not create it — the model is not installed yet." },
      ];
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "fix the model" }],
      }, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        reply: string;
        steps: unknown[];
        proposals: unknown[];
      };
      assertEquals(body.proposals.length, 0);
      assertEquals(body.steps.length, 0);
      assertMatch(body.reply, /not installed/);
      // Two LLM calls: the claimed turn + one nudge pass. No loop.
      assertEquals(llm.requests.length, 2);
    });
  });
});
