import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { hashPassword } from "../src/services/password.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";
import { probeTimeoutFor } from "../src/services/llm_client.ts";

interface FakeLlmState {
  status: number;
  reply: string;
  model: string;
  delayMs: number;
  toolCalls: unknown[];
  lastAuth: string | null;
  lastBody: Record<string, unknown> | null;
  calls: number;
  /** Every request body in order (the connection test now sends two). */
  bodies: Record<string, unknown>[];
  /** When > 0, a request carrying `tools` fails with this status. */
  toolStatus: number;
  /** Error message served for a rejected tool request. */
  toolError: string;
  /** Delay (ms) applied only to tool-bearing requests. */
  toolDelayMs: number;
}

function freshState(): FakeLlmState {
  return {
    status: 200,
    reply: "OK",
    model: "fake-model",
    delayMs: 0,
    toolCalls: [],
    lastAuth: null,
    lastBody: null,
    calls: 0,
    bodies: [],
    toolStatus: 0,
    toolError: "this model does not support tools",
    toolDelayMs: 0,
  };
}

function startFakeLlm(state: FakeLlmState): {
  url: string;
  shutdown: () => void;
} {
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1" },
    async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        state.calls += 1;
        state.lastAuth = req.headers.get("authorization");
        state.lastBody = (await req.json()) as Record<string, unknown>;
        state.bodies.push(state.lastBody);
        if (state.delayMs > 0) {
          await new Promise((r) => setTimeout(r, state.delayMs));
        }
        if (state.status !== 200) {
          return Response.json(
            { error: { message: "fake llm failure" } },
            { status: state.status },
          );
        }
        if (state.toolStatus > 0 && Array.isArray(state.lastBody.tools)) {
          return Response.json(
            { error: { message: state.toolError } },
            { status: state.toolStatus },
          );
        }
        if (state.toolDelayMs > 0 && Array.isArray(state.lastBody.tools)) {
          await new Promise((r) => setTimeout(r, state.toolDelayMs));
        }
        const message: Record<string, unknown> = {
          role: "assistant",
          content: state.reply,
        };
        if (state.toolCalls.length > 0) message.tool_calls = state.toolCalls;
        return Response.json({
          id: "chatcmpl-fake",
          model: state.model,
          choices: [{ index: 0, message, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  );
  const addr = server.addr;
  return {
    url: `http://127.0.0.1:${addr.port}/v1`,
    shutdown: () => server.shutdown(),
  };
}

let baseUrl = "";
let adminToken = "";
let userToken = "";
let fake: { url: string; shutdown: () => void };
let state: FakeLlmState;

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function post(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function get(path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: headers(token) });
}

function put(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

async function setLlmEndpoint(): Promise<void> {
  const res = await put("/api/v1/llm/settings", {
    enabled: true,
    base_url: fake.url,
    model: "fake-model",
  }, adminToken);
  assertEquals(res.status, 200);
}

describe("llm api", () => {
  beforeEach(async () => {
    state = freshState();
    fake = startFakeLlm(state);
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
    fake.shutdown();
    closeDb();
  });

  it("requires authentication", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      assertEquals((await get("/api/v1/llm/settings")).status, 401);
      assertEquals((await get("/api/v1/llm/status")).status, 401);
      assertEquals((await post("/api/v1/llm/chat", {})).status, 401);
    });
  });

  it("settings are admin-only", async () => {
    const email = `user.${Math.random().toString(36).slice(2)}@example.com`;
    createUser(email, await hashPassword("password123"), "Regular User");
    await withServer(async (base) => {
      baseUrl = base;
      const login = await post("/api/v1/auth/login", {
        email,
        password: "password123",
      });
      userToken = ((await login.json()) as { token: string }).token;

      assertEquals((await get("/api/v1/llm/settings", userToken)).status, 403);
      assertEquals(
        (await put("/api/v1/llm/settings", { enabled: true }, userToken))
          .status,
        403,
      );
      assertEquals((await post("/api/v1/llm/test", {}, userToken)).status, 403);
      // Non-admins can still read the coarse status and use chat.
      assertEquals((await get("/api/v1/llm/status", userToken)).status, 200);
    });
  });

  it("returns the masked settings view", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await put("/api/v1/llm/settings", {
        enabled: true,
        base_url: fake.url,
        api_key: "sekret",
        model: "fake-model",
        temperature: "0.5",
        max_tokens: "128",
        timeout_seconds: 30,
      }, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assertEquals(body, {
        enabled: true,
        baseUrl: fake.url,
        apiKeySet: true,
        model: "fake-model",
        temperature: "0.5",
        maxTokens: "128",
        timeoutSeconds: 30,
        configured: true,
      });
      const getRes = await get("/api/v1/llm/settings", adminToken);
      const getBody = (await getRes.json()) as Record<string, unknown>;
      assert(!JSON.stringify(getBody).includes("sekret"));
      assertEquals(getBody.apiKeySet, true);
    });
  });

  it("validates settings updates", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const cases: Array<[Record<string, unknown>, string]> = [
        [{}, "no fields"],
        [{ enabled: "yes" }, "enabled type"],
        [{ base_url: "not a url" }, "bad url"],
        [{ base_url: "ftp://x" }, "bad scheme"],
        [{ model: "" }, "empty model"],
        [{ temperature: "99" }, "temperature range"],
        [{ max_tokens: "0" }, "max tokens range"],
        [{ timeout_seconds: 0 }, "timeout range"],
        [{ timeout_seconds: 3601 }, "timeout range upper"],
        [{ bogus: 1 }, "unknown key"],
      ];
      for (const [body, label] of cases) {
        const res = await put("/api/v1/llm/settings", body, adminToken);
        assertEquals(res.status, 400, label);
      }
    });
  });

  it("accepts a timeout at the 3600 s cap", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await put("/api/v1/llm/settings", { timeout_seconds: 3600 }, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assertEquals(body.timeoutSeconds, 3600);
    });
  });

  it("reports coarse status for any authenticated user", async () => {
    const email = `user.${Math.random().toString(36).slice(2)}@example.com`;
    createUser(email, await hashPassword("password123"), "Regular User");
    await withServer(async (base) => {
      baseUrl = base;
      const login = await post("/api/v1/auth/login", {
        email,
        password: "password123",
      });
      userToken = ((await login.json()) as { token: string }).token;

      const offRes = await get("/api/v1/llm/status", userToken);
      const off = (await offRes.json()) as { configured: boolean };
      assertEquals(off, { configured: false });

      await setLlmEndpoint();
      const onRes = await get("/api/v1/llm/status", userToken);
      const on = (await onRes.json()) as { configured: boolean };
      assertEquals(on, { configured: true });
    });
  });

  it("connection test: 503 when unconfigured", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await post("/api/v1/llm/test", {}, adminToken);
      assertEquals(res.status, 503);
      const body = (await res.json()) as { error: { code: string } };
      assertEquals(body.error.code, "LLM_NOT_CONFIGURED");
    });
  });

  it("connection test: success reports latency and model", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      state.reply = "OK";
      const res = await post("/api/v1/llm/test", {}, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        latency_ms: number;
        model: string;
        content: string;
        tools: { supported: boolean; error?: string };
      };
      assertEquals(body.ok, true);
      assert(body.latency_ms >= 0);
      assertEquals(body.model, "fake-model");
      assertEquals(body.content, "OK");
      assertEquals(body.tools.supported, true);
      // The configured model name is sent in the request body.
      assertEquals(state.bodies[0]?.model, "fake-model");
      // Second request: the advisory tool probe, carrying the copilot's own
      // tool set rather than a placeholder.
      assertEquals(state.calls, 2);
      const probe = state.bodies[1];
      assert(Array.isArray(probe?.tools), "the probe request must carry tools");
      const names = (probe?.tools as { function: { name: string } }[])
        .map((t) => t.function.name);
      assert(
        names.includes("list_models"),
        `probe must carry the copilot's tools, got: ${names.join(", ")}`,
      );
    });
  });

  it("connection test: sends the configured max_tokens, not a fixed small one", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await put("/api/v1/llm/settings", {
        enabled: true,
        base_url: fake.url,
        model: "fake-model",
        max_tokens: "262144",
      }, adminToken);
      const res = await post("/api/v1/llm/test", {}, adminToken);
      assertEquals(res.status, 200);
      // A cap the endpoint refuses (e.g. one filling the whole context window)
      // has to fail the test, so the test must send what real requests send.
      assertEquals(state.bodies[0]?.max_tokens, 262144);
    });
  });

  it("connection test: surfaces the upstream reason for a rejected request", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      state.status = 400;
      const res = await post("/api/v1/llm/test", {}, adminToken);
      assertEquals(res.status, 502);
      const body = (await res.json()) as {
        error: { code: string; details?: string };
      };
      assertEquals(body.error.code, "LLM_BAD_RESPONSE");
      // The gateway's own explanation is the actionable half — a bare status
      // code tells the user nothing.
      assert(
        body.error.details?.includes("fake llm failure"),
        `expected the upstream reason in details, got: ${body.error.details}`,
      );
    });
  });

  it("connection test: a rejected tool probe warns without failing the test", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      state.toolStatus = 400;
      const res = await post("/api/v1/llm/test", {}, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        tools: { supported: boolean; error?: string };
      };
      // Chat and prompt-enhance work without tools, so the check stays green —
      // but the copilot's dependency on tools must be reported.
      assertEquals(body.ok, true);
      assertEquals(body.tools.supported, false);
      assert(
        body.tools.error?.includes("does not support tools"),
        `expected the probe reason, got: ${body.tools.error}`,
      );
    });
  });

  it("connection test: a slow probe is inconclusive, not a refusal", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await put("/api/v1/llm/settings", {
        enabled: true,
        base_url: fake.url,
        model: "fake-model",
        timeout_seconds: 1,
      }, adminToken);
      // Only the tool-bearing request stalls, so the gate still passes.
      state.toolDelayMs = 1500;
      const res = await post("/api/v1/llm/test", {}, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        ok: boolean;
        tools: { supported: boolean; inconclusive?: boolean; error?: string };
      };
      assertEquals(body.ok, true);
      // A timeout says nothing about tool support. Reporting it as a refusal
      // would be a confidently wrong diagnosis, and slow local models -- the
      // ones most likely to stall -- would get it most often.
      assertEquals(body.tools.supported, true);
      assertEquals(body.tools.inconclusive, true);
      assertEquals(body.tools.error, undefined);
    });
  });

  it("connection test: the probe isolates tools with a small max_tokens", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await put("/api/v1/llm/settings", {
        enabled: true,
        base_url: fake.url,
        model: "fake-model",
        max_tokens: "32768",
      }, adminToken);
      await post("/api/v1/llm/test", {}, adminToken);
      // The gate carries the configured cap; the probe does not, so `tools` is
      // the only difference between the two requests and a probe refusal means
      // the tool array was refused rather than the prompt outgrowing the
      // context window.
      assertEquals(state.bodies[0]?.max_tokens, 32768);
      assertEquals(state.bodies[1]?.max_tokens, 64);
    });
  });

  it("connection test: maps endpoint auth failure to 502 LLM_AUTH_FAILED", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      state.status = 401;
      const res = await post("/api/v1/llm/test", {}, adminToken);
      assertEquals(res.status, 502);
      const body = (await res.json()) as { error: { code: string } };
      assertEquals(body.error.code, "LLM_AUTH_FAILED");
    });
  });

  it("connection test: maps unknown model to 502 LLM_MODEL_NOT_FOUND", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      state.status = 404;
      const res = await post("/api/v1/llm/test", {}, adminToken);
      assertEquals(res.status, 502);
      const body = (await res.json()) as { error: { code: string } };
      assertEquals(body.error.code, "LLM_MODEL_NOT_FOUND");
    });
  });

  it("connection test: unreachable endpoint maps to 502 LLM_UNREACHABLE", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await put("/api/v1/llm/settings", {
        enabled: true,
        base_url: "http://127.0.0.1:1/v1",
        model: "fake-model",
      }, adminToken);
      const res = await post("/api/v1/llm/test", {}, adminToken);
      assertEquals(res.status, 502);
      const body = (await res.json()) as { error: { code: string } };
      assertEquals(body.error.code, "LLM_UNREACHABLE");
    });
  });

  it("chat: 503 when unconfigured", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await post("/api/v1/llm/chat", {
        messages: [{ role: "user", content: "hi" }],
      }, adminToken);
      assertEquals(res.status, 503);
    });
  });

  it("chat: validates the message list", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      const bad: Array<Record<string, unknown>> = [
        { messages: [] },
        { messages: "nope" },
        { messages: [{ role: "tool", content: "x" }] },
        { messages: [{ role: "user" }] },
        { messages: Array.from({ length: 33 }, () => ({ role: "user", content: "x" })) },
      ];
      for (const body of bad) {
        const res = await post("/api/v1/llm/chat", body, adminToken);
        assertEquals(res.status, 400);
      }
    });
  });

  it("chat: returns content, model and usage; sends the bearer key", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await put("/api/v1/llm/settings", {
        enabled: true,
        base_url: fake.url,
        api_key: "llm-key",
        model: "fake-model",
      }, adminToken);
      state.reply = "Hello from the LLM";
      const res = await post("/api/v1/llm/chat", {
        messages: [
          { role: "system", content: "You are terse." },
          { role: "user", content: "hi" },
        ],
        temperature: 0.3,
        max_tokens: 64,
      }, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        content: string;
        model: string;
        usage: Record<string, number>;
      };
      assertEquals(body.content, "Hello from the LLM");
      assertEquals(body.model, "fake-model");
      assertEquals(body.usage, {
        prompt_tokens: 3,
        completion_tokens: 5,
        total_tokens: 8,
      });
      assertEquals(state.lastAuth, "Bearer llm-key");
      assertEquals(state.lastBody?.temperature, 0.3);
      assertEquals(state.lastBody?.max_tokens, 64);
      const sentMessages = state.lastBody?.messages as Array<{ role: string; content: string }>;
      assertEquals(sentMessages.length, 2);
      assertEquals(sentMessages[0].role, "system");
    });
  });

  it("chat: a model override reaches the endpoint", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      const res = await post("/api/v1/llm/chat", {
        messages: [{ role: "user", content: "hi" }],
        model: "other-model",
      }, adminToken);
      assertEquals(res.status, 200);
      assertEquals(state.lastBody?.model, "other-model");
    });
  });

  it("chat: endpoint failure maps to 502 LLM_BAD_RESPONSE", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      state.status = 500;
      const res = await post("/api/v1/llm/chat", {
        messages: [{ role: "user", content: "hi" }],
      }, adminToken);
      assertEquals(res.status, 502);
      const body = (await res.json()) as { error: { code: string } };
      assertEquals(body.error.code, "LLM_BAD_RESPONSE");
    });
  });

  it("chat: slow endpoint maps to 504 LLM_TIMEOUT", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await put("/api/v1/llm/settings", {
        enabled: true,
        base_url: fake.url,
        model: "fake-model",
        timeout_seconds: 1,
      }, adminToken);
      state.delayMs = 1500;
      const res = await post("/api/v1/llm/chat", {
        messages: [{ role: "user", content: "hi" }],
      }, adminToken);
      assertEquals(res.status, 504);
      const body = (await res.json()) as { error: { code: string } };
      assertEquals(body.error.code, "LLM_TIMEOUT");
    });
  });

  describe("assist", () => {
    async function registerTestModel(
      overrides: Record<string, unknown> = {},
    ): Promise<{ id: string }> {
      const res = await post("/api/v1/models", {
        name: "Test T2V",
        version: "1.0",
        backend: "mock",
        task_types: ["text_to_video"],
        enabled: true,
        ...overrides,
      }, adminToken);
      assertEquals(res.status, 201);
      return (await res.json()) as { id: string };
    }

    async function registerAssistSkill(
      overrides: Record<string, unknown> = {},
    ): Promise<{ id: string }> {
      const res = await post("/api/v1/skills", {
        id: "t2v-tips",
        definition: {
          name: "T2V tips",
          version: "1",
          steps: [{ type: "sfx", prompt: "placeholder step" }],
          assistant: {
            model_task_types: ["text_to_video"],
            guidance: "Use motion verbs and camera language.",
            examples: [{ prompt: "A crane shot over a rainy street", notes: "works" }],
            ...overrides,
          },
        },
      }, adminToken);
      assertEquals(res.status, 201);
      return (await res.json()) as { id: string };
    }

    function lastSystemPrompt(): string {
      const messages = state.lastBody?.messages as Array<{
        role: string;
        content: string;
      }>;
      assertEquals(messages.length, 2);
      assertEquals(messages[0].role, "system");
      return messages[0].content;
    }

    it("requires authentication", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        const res = await post("/api/v1/llm/assist", {
          purpose: "write_script",
          context: "A heist in space.",
        });
        assertEquals(res.status, 401);
      });
    });

    it("503 when the LLM is not configured", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        const res = await post("/api/v1/llm/assist", {
          purpose: "write_script",
          context: "A heist in space.",
        }, adminToken);
        assertEquals(res.status, 503);
        const body = (await res.json()) as { error: { code: string } };
        assertEquals(body.error.code, "LLM_NOT_CONFIGURED");
      });
    });

    it("validates purpose, context and options", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        const bad: Array<Record<string, unknown>> = [
          { purpose: "write_song", context: "x" },
          { purpose: "write_script" },
          { purpose: "write_script", context: "   " },
          { purpose: "write_script", context: 42 },
          { purpose: "write_script", context: "x".repeat(32_001) },
          { purpose: "write_script", context: "x", model_id: "m1" },
          { purpose: "write_script", context: "x", skill_id: "s1" },
          { purpose: "write_script", context: "x", max_tokens: 0 },
          { purpose: "write_script", context: "x", model_id: "" },
        ];
        for (const body of bad) {
          const res = await post("/api/v1/llm/assist", body, adminToken);
          assertEquals(res.status, 400, JSON.stringify(body).slice(0, 80));
        }
      });
    });

    it("rejects unknown or disabled models and skills without an assistant block", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        const res = await post("/api/v1/skills", {
          id: "plain-skill",
          definition: {
            name: "Plain",
            version: "1",
            steps: [{ type: "sfx", prompt: "placeholder step" }],
          },
        }, adminToken);
        assertEquals(res.status, 201);

        const disabled = await registerTestModel({ name: "Disabled T2V", enabled: false });
        const cases: Array<Record<string, unknown>> = [
          { purpose: "enhance_prompt", context: "a cat", model_id: "does-not-exist" },
          { purpose: "enhance_prompt", context: "a cat", model_id: disabled.id },
          { purpose: "enhance_prompt", context: "a cat", skill_id: "nope" },
          { purpose: "enhance_prompt", context: "a cat", skill_id: "plain-skill" },
        ];
        for (const body of cases) {
          const res = await post("/api/v1/llm/assist", body, adminToken);
          assertEquals(res.status, 400, JSON.stringify(body));
        }
      });
    });

    it("rejects model+skill pairs with no overlapping task types", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        const model = await registerTestModel();
        const skill = await registerAssistSkill({
          model_task_types: ["text_to_image"],
        });
        const res = await post("/api/v1/llm/assist", {
          purpose: "enhance_prompt",
          context: "a cat",
          model_id: model.id,
          skill_id: skill.id,
        }, adminToken);
        assertEquals(res.status, 400);
        const body = (await res.json()) as { error: { message: string } };
        assert(body.error.message.includes("overlap"));
      });
    });

    it("honors a skill's model_ids scope in enhance_prompt", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        const model = await registerTestModel();
        const other = await registerTestModel({ name: "Other T2V", version: "2.0" });
        const scoped = await registerAssistSkill({ model_ids: [other.id] });

        // Rejected for a model the skill is not scoped to.
        const rejected = await post("/api/v1/llm/assist", {
          purpose: "enhance_prompt",
          context: "a cat",
          model_id: model.id,
          skill_id: scoped.id,
        }, adminToken);
        assertEquals(rejected.status, 400);
        const rejectedBody = (await rejected.json()) as { error: { message: string } };
        assert(rejectedBody.error.message.includes("applies to model(s)"));

        // Accepted for the model it names.
        state.reply = "A crane shot over a rainy street at night.";
        const allowed = await post("/api/v1/llm/assist", {
          purpose: "enhance_prompt",
          context: "a cat",
          model_id: other.id,
          skill_id: scoped.id,
        }, adminToken);
        assertEquals(allowed.status, 200);
      });
    });

    it("write_script: returns the purpose and content, composes the system prompt", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        state.reply = "INT. SPACE STATION - NIGHT\n\nA crew plans a heist.";
        const res = await post("/api/v1/llm/assist", {
          purpose: "write_script",
          context: "A heist in space, keep it to three scenes.",
        }, adminToken);
        assertEquals(res.status, 200);
        const body = (await res.json()) as { purpose: string; content: string };
        assertEquals(body.purpose, "write_script");
        assertEquals(body.content, "INT. SPACE STATION - NIGHT\n\nA crew plans a heist.");
        const system = lastSystemPrompt();
        assert(system.includes("Fountain-lite"));
        const messages = state.lastBody?.messages as Array<{ content: string }>;
        assertEquals(messages[1].content, "A heist in space, keep it to three scenes.");
      });
    });

    it("extend_script: revises an existing screenplay, composing the extend prompt", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        state.reply = "INT. DOCKS - DAWN\n\nThe crew revises the plan.";
        const context =
          "INT. DOCKS - NIGHT\n\nA crew plans a heist.\n\nPlease continue this with a dawn scene.";
        const res = await post("/api/v1/llm/assist", {
          purpose: "extend_script",
          context,
        }, adminToken);
        assertEquals(res.status, 200);
        const body = (await res.json()) as { purpose: string; content: string };
        assertEquals(body.purpose, "extend_script");
        assertEquals(body.content, "INT. DOCKS - DAWN\n\nThe crew revises the plan.");
        const system = lastSystemPrompt();
        assert(system.includes("Fountain-lite"));
        assert(system.includes("existing"));
        const messages = state.lastBody?.messages as Array<{ content: string }>;
        assertEquals(messages[1].content, context);
      });
    });

    it("design_scene: fixed answer shape in the system prompt", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        state.reply = "## Overview\n\nA quiet scene.";
        const res = await post("/api/v1/llm/assist", {
          purpose: "design_scene",
          context: "The hero finds the letter.",
        }, adminToken);
        assertEquals(res.status, 200);
        const system = lastSystemPrompt();
        for (
          const heading of [
            "## Overview",
            "## Mood & Tone",
            "## Shots",
            "## Lighting",
            "## Time of day",
            "## Dialogue",
          ]
        ) {
          assert(system.includes(heading), heading);
        }
      });
    });

    it("enhance_prompt: injects the model metadata into the system prompt", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        const model = await registerTestModel({
          name: "MotionDiff v2",
          version: "2.1",
          known_limitations: ["max 8 seconds"],
          default_settings: { fps: 24, resolution: "1280x720" },
        });
        state.reply = "A cinematic crane shot of a rainy street.";
        const res = await post("/api/v1/llm/assist", {
          purpose: "enhance_prompt",
          context: "a cat on a roof",
          model_id: model.id,
        }, adminToken);
        assertEquals(res.status, 200);
        const body = (await res.json()) as { purpose: string; content: string };
        assertEquals(body.purpose, "enhance_prompt");
        const system = lastSystemPrompt();
        assert(system.includes("MotionDiff v2"));
        assert(system.includes("text_to_video"));
        assert(system.includes("max 8 seconds"));
        assert(system.includes("fps"));
      });
    });

    it("enhance_prompt: injects the skill assistant block", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        const skill = await registerAssistSkill();
        state.reply = "A crane shot over a rainy street at night.";
        const res = await post("/api/v1/llm/assist", {
          purpose: "enhance_prompt",
          context: "a cat on a roof",
          skill_id: skill.id,
        }, adminToken);
        assertEquals(res.status, 200);
        const system = lastSystemPrompt();
        assert(system.includes("Use motion verbs and camera language."));
        assert(system.includes("A crane shot over a rainy street"));
        assert(system.includes("(why: works)"));
      });
    });

    it("enhance_prompt: re-appends @references the model drops", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        state.reply = "A cinematic shot of a rainy street at night.";
        const res = await post("/api/v1/llm/assist", {
          purpose: "enhance_prompt",
          context: "A rainy street with @hero_red_jacket walking, behind @alley_cat",
        }, adminToken);
        assertEquals(res.status, 200);
        const body = (await res.json()) as { content: string };
        assert(body.content.includes("@hero_red_jacket"));
        assert(body.content.includes("@alley_cat"));
        assert(body.content.trimEnd().endsWith("@hero_red_jacket @alley_cat"));
      });
    });

    it("enhance_prompt: keeps content untouched when all references survive", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        state.reply = "A rainy street at night, @hero_red_jacket walks past @alley_cat.";
        const res = await post("/api/v1/llm/assist", {
          purpose: "enhance_prompt",
          context: "A rainy street with @hero_red_jacket, behind @alley_cat",
        }, adminToken);
        assertEquals(res.status, 200);
        const body = (await res.json()) as { content: string };
        assertEquals(body.content, state.reply);
      });
    });

    it("forwards max_tokens and maps endpoint failures", async () => {
      await withServer(async (base) => {
        baseUrl = base;
        await setLlmEndpoint();
        const res = await post("/api/v1/llm/assist", {
          purpose: "write_script",
          context: "A heist in space.",
          max_tokens: 400,
        }, adminToken);
        assertEquals(res.status, 200);
        assertEquals(state.lastBody?.max_tokens, 400);

        state.status = 500;
        const failed = await post("/api/v1/llm/assist", {
          purpose: "write_script",
          context: "A heist in space.",
        }, adminToken);
        assertEquals(failed.status, 502);
        const body = (await failed.json()) as { error: { code: string } };
        assertEquals(body.error.code, "LLM_BAD_RESPONSE");
      });
    });
  });

  it("health check still works with the llm router mounted", async () => {
    await withServer(async (base) => {
      const health = await fetchWithRetry(`${base}/api/v1/health`);
      assertEquals(health.status, 200);
    });
  });
});

describe("llm connection test probe budget", () => {
  it("caps the probe at its own short timeout", () => {
    // The probe only asks whether the endpoint accepts a `tools` array, which
    // is a fast answer. On the configured timeout it would double the
    // worst-case wall time of a synchronous endpoint (default 300s, max 3600s)
    // for information an admin cannot act on any faster.
    assertEquals(probeTimeoutFor(300), 60);
    assertEquals(probeTimeoutFor(3600), 60);
  });

  it("never extends a shorter configured timeout", () => {
    assertEquals(probeTimeoutFor(15), 15);
    assertEquals(probeTimeoutFor(60), 60);
  });
});
