import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createApp } from "../src/server.ts";
import { loadConfig } from "../src/config.ts";
import { registerModel } from "../src/db/models.ts";
import { claimJob, createJob, finishJob, retryJob, updateJobProgress } from "../src/db/jobs.ts";
import { fetchWithRetry, freshMemoryDb } from "./helpers/http.ts";

type Message = Record<string, unknown>;
type App = Awaited<ReturnType<typeof createApp>>;

function connectWs(url: string): {
  ws: WebSocket;
  messages: Message[];
  opened: Promise<void>;
} {
  const ws = new WebSocket(url);
  const messages: Message[] = [];
  ws.onmessage = (event) => {
    try {
      messages.push(JSON.parse(String(event.data)) as Message);
    } catch {
      // non-JSON frames are ignored
    }
  };
  const opened = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`handshake failed for ${url}`));
    setTimeout(() => reject(new Error(`handshake timed out for ${url}`)), 5000);
  });
  return { ws, messages, opened };
}

async function nextMessage(
  ws: WebSocket,
  messages: Message[],
  matches: (m: Message) => boolean,
  timeoutMs = 5000,
): Promise<Message> {
  const start = Date.now();
  for (;;) {
    const i = messages.findIndex(matches);
    if (i !== -1) return messages.splice(i, 1)[0];
    if (ws.readyState === WebSocket.CLOSED && Date.now() - start > 200) {
      throw new Error(
        `socket closed while waiting for a matching message (got: ${JSON.stringify(messages)})`,
      );
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for a matching message (got: ${JSON.stringify(messages)})`,
      );
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("ws /ws/v1/jobs", () => {
  let app: App | null = null;
  let abort: AbortController;
  let port = 0;
  let baseUrl = "";
  let ownerToken = "";
  let ownerId: number;
  let appDataDir = "";

  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_ws_jobs_" });
    Deno.env.set("APP_DATA_DIR", appDataDir);
    freshMemoryDb();

    const probe = await Deno.listen({ port: 0 });
    port = (probe.addr as Deno.NetAddr).port;
    await probe.close();

    const serverApp = createApp(loadConfig());
    app = serverApp;
    abort = new AbortController();
    serverApp.listen({ port, signal: abort.signal });
    // Stop the runners so queued jobs stay put until the test drives them.
    await serverApp.jobRunner?.stop();
    await serverApp.renderRunner?.stop();

    baseUrl = `http://127.0.0.1:${port}`;
    const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
    assertEquals(health.status, 200);

    const res = await fetch(`${baseUrl}/api/v1/auth/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `ws.${Date.now()}@example.com`,
        password: "password123",
        display_name: "WS Admin",
      }),
    });
    assertEquals(res.status, 201);
    const user = (await res.json()) as { token: string; user: { id: number } };
    ownerToken = user.token;
    ownerId = user.user.id;
  });

  afterEach(async () => {
    abort.abort();
    await app?.jobRunner?.stop();
    await app?.renderRunner?.stop();
    app = null;
    closeDb();
    Deno.removeSync(appDataDir, { recursive: true });
  });

  it("rejects the handshake without a token", async () => {
    const { ws, opened } = connectWs(`ws://127.0.0.1:${port}/ws/v1/jobs`);
    await assertRejects(async () => await opened, Error, "handshake failed");
    ws.close();
  });

  it("rejects the handshake with an invalid token", async () => {
    const { ws, opened } = connectWs(
      `ws://127.0.0.1:${port}/ws/v1/jobs?token=not-a-real-token`,
    );
    await assertRejects(async () => await opened, Error, "handshake failed");
    ws.close();
  });

  it("streams status and progress updates for a job", async () => {
    const { ws, messages, opened } = connectWs(
      `ws://127.0.0.1:${port}/ws/v1/jobs?token=${encodeURIComponent(ownerToken)}`,
    );
    await opened;

    const modelId = registerModel(ownerId, {
      name: "ws-mock-t2i",
      version: "1.0",
      backend: "mock",
      task_types: ["text_to_image"],
      enabled: true,
    }).id;
    const job = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: modelId,
    });
    assertEquals(
      await nextMessage(
        ws,
        messages,
        (m) => m.kind === "status" && m.status === "queued",
      ),
      { kind: "status", jobId: job.id, status: "queued" },
    );

    const claimed = claimJob("ws-test-owner", 120);
    assertEquals(claimed?.id, job.id);
    assertEquals(
      await nextMessage(
        ws,
        messages,
        (m) => m.kind === "status" && m.status === "running",
      ),
      { kind: "status", jobId: job.id, status: "running" },
    );

    updateJobProgress(job.id, 42);
    assertEquals(
      await nextMessage(ws, messages, (m) => m.kind === "progress"),
      { kind: "progress", jobId: job.id, progress: 42 },
    );

    finishJob(job.id, "succeeded");
    assertEquals(
      await nextMessage(
        ws,
        messages,
        (m) => m.kind === "status" && m.status === "succeeded",
      ),
      { kind: "status", jobId: job.id, status: "succeeded" },
    );

    retryJob(job.id);
    const requeued = await nextMessage(
      ws,
      messages,
      (m) => m.kind === "status" && m.status === "queued",
    );
    assertEquals(requeued, { kind: "status", jobId: job.id, status: "queued" });

    ws.close();
  });
});
