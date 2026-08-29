import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { hashPassword } from "../src/services/password.ts";
import {
  deleteConversation,
  getConversation,
  listConversations,
  logAgentTurn,
  logProposalEvent,
} from "../src/db/llm_conversations.ts";
import { resetProposals } from "../src/services/llm_agent.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

interface ScriptedResponse {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; args: unknown }>;
}

function startScriptedLlm(): { url: string; shutdown: () => void; reset: () => void } {
  let callIndex = 0;
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1" }, (req: Request) => {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return Response.json({ error: "not found" }, { status: 404 });
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
    reset: () => {
      callIndex = 0;
    },
  };
}

let llm: { url: string; shutdown: () => void; reset: () => void };
let script: ScriptedResponse[];
let adminToken = "";

describe("llm conversations (repository)", () => {
  beforeEach(() => {
    freshMemoryDb();
  });

  afterEach(() => {
    closeDb();
  });

  const userA = async () =>
    createUser("a@example.com", await hashPassword("password123"), "User A");
  const userB = async () =>
    createUser("b@example.com", await hashPassword("password123"), "User B");

  function turn(conversationId: string, userId: number, title = "hello copilot"): void {
    logAgentTurn({
      conversationId,
      userId,
      isAdmin: userId === 1,
      title,
      model: "fake-model",
      userMessage: { content: `user says ${title}`, synthetic: false },
      assistantMessage: {
        content: "assistant reply",
        steps: [{ tool: "list_models", status: "executed", summary: "1 model" }],
        proposals: [],
      },
    });
  }

  function expectNotFound(fn: () => unknown): void {
    try {
      fn();
    } catch (err) {
      assertEquals((err as Error).message, "Conversation not found");
      return;
    }
    throw new Error("expected not-found error");
  }

  it("logs a turn as user + assistant rows and upserts the conversation", async () => {
    const uid = await userA();
    turn("conv-1", uid);
    turn("conv-1", uid, "second turn title");

    const list = listConversations(uid, true);
    assertEquals(list.length, 1);
    assertEquals(list[0].id, "conv-1");
    assertEquals(list[0].title, "hello copilot");
    assertEquals(list[0].message_count, 4);
    assertEquals(list[0].model, "fake-model");

    const detail = getConversation("conv-1", uid, true);
    assertEquals(detail.messages.length, 4);
    const roles = detail.messages.map((m) => m.role);
    assertEquals(roles, ["user", "assistant", "user", "assistant"]);
    assertEquals(detail.messages[0].content, "user says hello copilot");
    assertEquals(
      (detail.messages[1].steps as Array<Record<string, unknown>>)[0].tool,
      "list_models",
    );
    assertEquals(detail.messages[2].content, "user says second turn title");
  });

  it("records proposal outcomes as event rows", async () => {
    const uid = await userA();
    turn("conv-1", uid);
    logProposalEvent("conv-1", uid, true, "prop-1", "approved");

    const detail = getConversation("conv-1", uid, true);
    const event = detail.messages.at(-1);
    assertEquals(event?.role, "event");
    assertEquals(event?.content, "approved");
    assertEquals(event?.proposal_id, "prop-1");
    assertEquals(detail.messages.length, 3);
  });

  it("keeps conversations private between users", async () => {
    const uidA = await userA();
    const uidB = await userB();
    turn("conv-a", uidA, "A's conversation");

    assertEquals(listConversations(uidB, false).length, 0);
    expectNotFound(() => getConversation("conv-a", uidB, false));
    // Owner can still see their own.
    assertEquals(listConversations(uidA, false).length, 1);
  });

  it("admins see all conversations; only owners/admins delete", async () => {
    const uidA = await userA();
    const uidB = await userB();
    turn("conv-a", uidA);
    turn("conv-b", uidB);

    // uidA is treated as admin here (the isAdmin flag drives the repo).
    const adminList = listConversations(uidA, true);
    assertEquals(adminList.map((c) => c.id).sort(), ["conv-a", "conv-b"]);
    // Owner can delete their own…
    deleteConversation("conv-b", uidB, false);
    expectNotFound(() => getConversation("conv-b", uidA, true));
    // …and a non-owner non-admin cannot delete someone else's.
    expectNotFound(() => deleteConversation("conv-a", uidB, false));
  });

  it("deleting a conversation removes its messages", async () => {
    const uid = await userA();
    turn("conv-1", uid);
    deleteConversation("conv-1", uid, true);
    assertEquals(listConversations(uid, true).length, 0);
    expectNotFound(() => getConversation("conv-1", uid, true));
  });
});

describe("llm conversations (routes)", () => {
  let baseUrl = "";

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

  function del(path: string, token?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, { method: "DELETE", headers: headers(token) });
  }

  async function setLlmEndpoint(): Promise<void> {
    const res = await put("/api/v1/llm/settings", {
      enabled: true,
      base_url: llm.url,
      model: "fake-model",
    }, adminToken);
    assertEquals(res.status, 200);
  }

  /** One agent turn that ends in a register_model proposal; returns its id. */
  async function makeProposal(conversationId: string, name = "conv_model"): Promise<string> {
    llm.reset();
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
      conversation_id: conversationId,
    }, adminToken);
    assertEquals(res.status, 200);
    const body = (await res.json()) as { proposals: Array<{ id: string }> };
    assertEquals(body.proposals.length, 1);
    return body.proposals[0].id;
  }

  beforeEach(async () => {
    script = [];
    llm = startScriptedLlm();
    freshMemoryDb();
    resetProposals();
    await withServer(async (base) => {
      const health = await fetchWithRetry(`${base}/api/v1/health`);
      assertEquals(health.status, 200);
      const res = await fetch(`${base}/api/v1/auth/bootstrap`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Studio Admin",
        }),
      });
      assertEquals(res.status, 201);
      adminToken = ((await res.json()) as { token: string }).token;
    });
  });

  afterEach(() => {
    llm.shutdown();
    closeDb();
  });

  it("logs an agent turn when conversation_id is present", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      script = [{ content: "Here is a plan." }];
      const res = await post("/api/v1/llm/agent", {
        history: [
          { role: "user", content: "plan my first render" },
          { role: "assistant", content: "sure" },
          { role: "user", content: "use the mock model" },
        ],
        conversation_id: "route-conv",
      }, adminToken);
      assertEquals(res.status, 200);

      const listRes = await get("/api/v1/llm/conversations", adminToken);
      assertEquals(listRes.status, 200);
      const list = (await listRes.json()) as {
        conversations: Array<{ id: string; title: string; message_count: number }>;
      };
      assertEquals(list.conversations.length, 1);
      assertEquals(list.conversations[0].id, "route-conv");
      // Title comes from the FIRST user message of the conversation.
      assertEquals(list.conversations[0].title, "plan my first render");
      assertEquals(list.conversations[0].message_count, 2);

      const detailRes = await get("/api/v1/llm/conversations/route-conv", adminToken);
      assertEquals(detailRes.status, 200);
      const detail = (await detailRes.json()) as {
        conversation: { messages: Array<{ role: string; content: string }> };
      };
      assertEquals(detail.conversation.messages[0].role, "user");
      assertEquals(detail.conversation.messages[0].content, "use the mock model");
      assertEquals(detail.conversation.messages[1].role, "assistant");
      assertEquals(detail.conversation.messages[1].content, "Here is a plan.");
    });
  });

  it("logs synthetic follow-up turns with the synthetic flag", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      script = [{ content: "Continuing…" }];
      const res = await post("/api/v1/llm/agent", {
        history: [
          { role: "user", content: "install the model" },
          {
            role: "user",
            content: "Proposal approved: install_model succeeded",
            synthetic: true,
          },
        ],
        conversation_id: "route-conv-syn",
      }, adminToken);
      assertEquals(res.status, 200);

      const detailRes = await get("/api/v1/llm/conversations/route-conv-syn", adminToken);
      const detail = (await detailRes.json()) as {
        conversation: { messages: Array<{ role: string; synthetic: boolean }> };
      };
      const userRows = detail.conversation.messages.filter((m) => m.role === "user");
      assertEquals(userRows.length, 1);
      assertEquals(userRows[0].synthetic, true);
    });
  });

  it("does not log turns without a conversation_id", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      script = [{ content: "ok" }];
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "hello" }],
      }, adminToken);
      assertEquals(res.status, 200);

      const listRes = await get("/api/v1/llm/conversations", adminToken);
      const list = (await listRes.json()) as { conversations: unknown[] };
      assertEquals(list.conversations.length, 0);
    });
  });

  it("rejects a malformed conversation_id", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "hello" }],
        conversation_id: 42,
      }, adminToken);
      assertEquals(res.status, 400);
    });
  });

  it("logs proposal approve and reject outcomes as events", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      const approved = await makeProposal("route-conv-outcome", "conv_model_a");
      const rejected = await makeProposal("route-conv-outcome", "conv_model_b");

      const approveRes = await post(`/api/v1/llm/proposals/${approved}/approve`, {}, adminToken);
      assertEquals(approveRes.status, 200);
      const rejectRes = await post(`/api/v1/llm/proposals/${rejected}/reject`, {}, adminToken);
      assertEquals(rejectRes.status, 200);

      const detailRes = await get("/api/v1/llm/conversations/route-conv-outcome", adminToken);
      const detail = (await detailRes.json()) as {
        conversation: {
          messages: Array<{ role: string; content: string; proposal_id: string | null }>;
        };
      };
      const events = detail.conversation.messages.filter((m) => m.role === "event");
      assertEquals(events.length, 2);
      assertEquals(events[0].content, "approved");
      assertEquals(events[0].proposal_id, approved);
      assertEquals(events[1].content, "rejected");
      assertEquals(events[1].proposal_id, rejected);
    });
  });

  it("keeps conversation endpoints ownership-gated", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      // Second, non-admin user.
      const email = `user.${Math.random().toString(36).slice(2)}@example.com`;
      await createUser(email, await hashPassword("password123"), "Regular User");
      const loginRes = await post("/api/v1/auth/login", { email, password: "password123" });
      assertEquals(loginRes.status, 200);
      const userToken = ((await loginRes.json()) as { token: string }).token;

      script = [{ content: "ok" }];
      const res = await post("/api/v1/llm/agent", {
        history: [{ role: "user", content: "a question" }],
        conversation_id: "owned-by-user",
      }, userToken);
      assertEquals(res.status, 200);

      // The user sees only their own conversation.
      const userList = (await (await get("/api/v1/llm/conversations", userToken)).json()) as {
        conversations: Array<{ id: string }>;
      };
      assertEquals(userList.conversations.map((c) => c.id), ["owned-by-user"]);

      // The admin sees it too and can fetch the user's detail.
      const adminList = (await (await get("/api/v1/llm/conversations", adminToken)).json()) as {
        conversations: Array<{ id: string }>;
      };
      assertEquals(adminList.conversations.map((c) => c.id), ["owned-by-user"]);
      const detailRes = await get("/api/v1/llm/conversations/owned-by-user", adminToken);
      assertEquals(detailRes.status, 200);

      // Unknown ids 404; owners can delete their own.
      const foreignDelete = await del("/api/v1/llm/conversations/does-not-exist", userToken);
      assertEquals(foreignDelete.status, 404);
      const ownDelete = await del("/api/v1/llm/conversations/owned-by-user", userToken);
      assertEquals(ownDelete.status, 204);
      const gone = await get("/api/v1/llm/conversations/owned-by-user", adminToken);
      assertEquals(gone.status, 404);
    });
  });

  it("lists proposals with conversation_id so the UI can correlate", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      await setLlmEndpoint();
      const proposalId = await makeProposal("route-conv-corr");
      const listRes = await get("/api/v1/llm/proposals", adminToken);
      const list = (await listRes.json()) as {
        proposals: Array<{ id: string; conversation_id?: string }>;
      };
      const mine = list.proposals.find((p) => p.id === proposalId);
      assertEquals(mine?.conversation_id, "route-conv-corr");
    });
  });
});
