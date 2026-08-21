import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { api } from "../src/api.js";
import { JobEventClient } from "../src/job-events.js";

class FakeWebSocket {
  static instances = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    FakeWebSocket.instances.push(this);
    this._autoOpen = setTimeout(() => {
      if (this.readyState === FakeWebSocket.CONNECTING) {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
      }
    }, 0);
  }

  send(data) {
    this.sent.push(String(data));
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    clearTimeout(this._autoOpen);
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateDrop() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    clearTimeout(this._autoOpen);
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateMessage(value) {
    this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) });
  }
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(condition, timeoutMs = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await tick(1);
  }
}

describe("job-events client", () => {
  let clients = [];

  beforeEach(() => {
    FakeWebSocket.instances = [];
    clients = [];
    globalThis.WebSocket = FakeWebSocket;
    globalThis.location = { protocol: "http:", hostname: "127.0.0.1" };
    api.setToken("test-token");
  });

  afterEach(() => {
    for (const client of clients) client.close();
  });

  function makeClient(options = {}) {
    const client = new JobEventClient({ reconnectBaseMs: 5, ...options });
    clients.push(client);
    return client;
  }

  it("opens a socket with the token when a listener subscribes", async () => {
    const client = makeClient();
    const unsubscribe = client.subscribe(() => {});
    await waitFor(() => FakeWebSocket.instances.length === 1);
    const ws = FakeWebSocket.instances[0];
    assertStringIncludes(ws.url, "ws://127.0.0.1:8123/ws/v1/jobs?token=test-token");
    await waitFor(() => ws.readyState === FakeWebSocket.OPEN);

    unsubscribe();
    assertEquals(ws.readyState, FakeWebSocket.CLOSED);
    assertEquals(client.connected, false);
  });

  it("does not connect when no token is set", async () => {
    api.setToken(null);
    const client = makeClient();
    client.subscribe(() => {});
    await tick(20);
    assertEquals(FakeWebSocket.instances.length, 0);
  });

  it("dispatches parsed messages to every listener, in order", async () => {
    const client = makeClient();
    const calls = [];
    client.subscribe(() => {
      throw new Error("broken listener");
    });
    client.subscribe((m) => calls.push(["a", m]));
    client.subscribe((m) => calls.push(["b", m]));
    await waitFor(() => FakeWebSocket.instances.length === 1);
    const ws = FakeWebSocket.instances[0];
    await waitFor(() => ws.readyState === FakeWebSocket.OPEN);

    const message = { kind: "progress", jobId: "job-1", progress: 7 };
    ws.simulateMessage(message);
    ws.simulateMessage("not json");

    assertEquals(calls, [
      ["a", message],
      ["b", message],
    ]);
  });

  it("reconnects after a dropped socket while subscribed", async () => {
    const client = makeClient();
    client.subscribe(() => {});
    await waitFor(() => FakeWebSocket.instances.length === 1);
    const first = FakeWebSocket.instances[0];
    await waitFor(() => first.readyState === FakeWebSocket.OPEN);

    first.simulateDrop();
    await waitFor(() => FakeWebSocket.instances.length === 2);
    assertEquals(client.connected, true);
  });

  it("does not reconnect after the last listener unsubscribes", async () => {
    const client = makeClient();
    const unsubscribe = client.subscribe(() => {});
    await waitFor(() => FakeWebSocket.instances.length === 1);
    const first = FakeWebSocket.instances[0];
    await waitFor(() => first.readyState === FakeWebSocket.OPEN);

    unsubscribe();
    await tick(50);
    assertEquals(FakeWebSocket.instances.length, 1);
    assertEquals(first.readyState, FakeWebSocket.CLOSED);
  });
});
