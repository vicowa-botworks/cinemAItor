import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import * as schema from "../src/db/schema.ts";
import { hashPassword } from "../src/services/password.ts";
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServerRow,
  listMcpServers,
  patchMcpServer,
} from "../src/db/mcp.ts";
import {
  mcpCallTool,
  mcpCatalog,
  mcpCloseAll,
  mcpGetTools,
  mcpServerStatus,
  parseQualifiedToolName,
  qualifiedToolName,
} from "../src/services/mcp.ts";
import { type AppError, ERROR_CODES } from "../src/errors.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

const FAKE_SERVER = new URL("./mcp_fake/server.mjs", import.meta.url).pathname;

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

function deleteReq(path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { method: "DELETE", headers: headers(token) });
}

function fakeCommand(extraArgs: string[] = []): { command: string; args: string[] } {
  return {
    command: Deno.execPath(),
    args: ["run", "--quiet", "--no-check", FAKE_SERVER, ...extraArgs],
  };
}

function registerServer(
  body: Record<string, unknown>,
): Promise<Response> {
  return post("/api/v1/mcp/servers", body, adminToken);
}

/** Start a test server, wait for readiness, and bootstrap an admin. */
function withAdminServer<T>(fn: () => Promise<T>): Promise<T> {
  return withServer(async (base) => {
    baseUrl = base;
    const health = await fetchWithRetry(`${base}/api/v1/health`);
    assertEquals(health.status, 200);
    const res = await post("/api/v1/auth/bootstrap", {
      email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
      password: "password123",
      display_name: "Studio Admin",
    });
    assertEquals(res.status, 201);
    adminToken = ((await res.json()) as { token: string }).token;
    return fn();
  });
}

async function makeUser(): Promise<void> {
  const hash = await hashPassword("password123");
  schema.createUser("user@example.com", hash, "Regular User");
  const login = await post("/api/v1/auth/login", {
    email: "user@example.com",
    password: "password123",
  });
  assertEquals(login.status, 200);
  userToken = ((await login.json()) as { token: string }).token;
}

describe("mcp name slugs and qualified tool names", () => {
  it("builds and parses unambiguous qualified tool names", () => {
    assertEquals(qualifiedToolName("fake-mcp", "echo"), "mcp__fake-mcp__echo");
    assertEquals(parseQualifiedToolName("mcp__fake-mcp__echo"), {
      server: "fake-mcp",
      tool: "echo",
    });
    assertEquals(parseQualifiedToolName("mcp__a__b__c"), { server: "a", tool: "b__c" });
    assertEquals(parseQualifiedToolName("mcp__a"), null);
    assertEquals(parseQualifiedToolName("mcp___tool"), null);
    assertEquals(parseQualifiedToolName("mcp__a__"), null);
    assertEquals(parseQualifiedToolName("mcp__a__bad/name"), null);
    assertEquals(parseQualifiedToolName("not-an-mcp-tool"), null);
  });
});

describe("mcp registry repository", () => {
  let adminId: number;

  beforeEach(() => {
    freshMemoryDb();
    adminId = schema.createUser("admin@example.com", "hash123", "Admin", "admin");
  });

  afterEach(() => {
    closeDb();
  });

  it("slugifies names and rejects unusable ones", () => {
    const view = createMcpServer(adminId, {
      name: "My Fake MCP!",
      transport: "stdio",
      command: "deno",
    });
    assertEquals(view.id, "my-fake-mcp");

    assertThrows(
      () => createMcpServer(adminId, { name: "   ", transport: "stdio", command: "deno" }),
      Error,
      "must be 1-64 chars",
    );
    assertThrows(
      () => createMcpServer(adminId, { name: "___", transport: "stdio", command: "deno" }),
      Error,
      "at least one alphanumeric",
    );
  });

  it("collisions on the slug are conflicts", () => {
    createMcpServer(adminId, { name: "Dup Server", transport: "stdio", command: "deno" });
    assertThrows(
      () => createMcpServer(adminId, { name: "dup-server", transport: "stdio", command: "deno" }),
      Error,
      "already exists",
    );
  });

  it("masks header secrets in the public view", () => {
    const view = createMcpServer(adminId, {
      name: "Remote",
      transport: "http",
      url: "http://127.0.0.1:9/mcp",
      headers: { Authorization: "Bearer topsecret" },
    });
    assertEquals(view.header_names, ["Authorization"]);
    assertEquals(view.headers_set, true);
    assertEquals(view.command, null);
    assertEquals(JSON.stringify(view).includes("topsecret"), false);
    const row = getMcpServerRow("remote");
    assert(row);
    assertEquals(
      (JSON.parse(row.headers_json ?? "{}") as Record<string, string>).Authorization,
      "Bearer topsecret",
    );
  });

  it("switching transport clears the inactive transport's fields", () => {
    createMcpServer(adminId, {
      name: "Switcher",
      transport: "stdio",
      command: "deno",
      args: ["run"],
    });
    const patched = patchMcpServer("switcher", {
      transport: "http",
      url: "http://127.0.0.1:9/mcp",
    });
    assertEquals(patched.view.transport, "http");
    assertEquals(patched.view.command, null);
    assertEquals(patched.view.args, []);
    assertEquals(patched.transportChanged, true);
    const back = patchMcpServer("switcher", {
      transport: "stdio",
      command: "deno",
    });
    assertEquals(back.view.url, null);
  });

  it("name is immutable; delete removes the row", () => {
    createMcpServer(adminId, { name: "Gone", transport: "stdio", command: "deno" });
    assertThrows(
      () => patchMcpServer("gone", { name: "Renamed" }),
      Error,
      "not patchable",
    );
    assertEquals(deleteMcpServer("gone"), true);
    assertEquals(listMcpServers().length, 0);
    assertEquals(deleteMcpServer("gone"), false);
  });
});

describe("mcp registry api", () => {
  afterEach(async () => {
    await mcpCloseAll();
    closeDb();
  });

  it("registers, lists, patches and deletes servers (masking secrets)", async () => {
    freshMemoryDb();
    await withAdminServer(async () => {
      await makeUser();
      const created = await registerServer({
        name: "Fake MCP",
        description: "test server",
        transport: "stdio",
        ...fakeCommand(),
        env: { FOO: "bar" },
        timeout_seconds: 120,
      });
      assertEquals(created.status, 201);
      const body = (await created.json()) as Record<string, unknown>;
      assertEquals(body.id, "fake-mcp");
      assertEquals(body.env_set, true);
      assertEquals(body.status, {
        state: "idle",
        last_error: null,
        tool_count: 0,
        tools_fetched_at: null,
      });

      const remote = await registerServer({
        name: "Remote",
        transport: "http",
        url: "http://127.0.0.1:9/mcp",
        headers: { Authorization: "Bearer topsecret" },
      });
      assertEquals(remote.status, 201);
      const remoteBody = (await remote.json()) as Record<string, unknown>;
      assertEquals(remoteBody.id, "remote");
      assertEquals(remoteBody.header_names, ["Authorization"]);
      assertEquals(remoteBody.headers_set, true);
      assertEquals(remoteBody.command, null);

      const list = await get("/api/v1/mcp/servers", adminToken);
      assertEquals(list.status, 200);
      const listJson = JSON.stringify(await list.json());
      assertEquals(listJson.includes("topsecret"), false, "header values must be masked");

      const patched = await patch("/api/v1/mcp/servers/remote", {
        description: "updated",
        timeout_seconds: 300,
      }, adminToken);
      assertEquals(patched.status, 200);
      const patchedBody = (await patched.json()) as Record<string, unknown>;
      assertEquals(patchedBody.description, "updated");
      assertEquals(patchedBody.timeout_seconds, 300);

      const renamed = await patch("/api/v1/mcp/servers/remote", { name: "Nope" }, adminToken);
      assertEquals(renamed.status, 400);

      const del = await deleteReq("/api/v1/mcp/servers/remote", adminToken);
      assertEquals(del.status, 204);
      const list2 = (await (await get("/api/v1/mcp/servers", adminToken)).json()) as unknown[];
      assertEquals(list2.length, 1);
      const delAgain = await deleteReq("/api/v1/mcp/servers/remote", adminToken);
      assertEquals(delAgain.status, 404);
    });
  });

  it("validates registration input", async () => {
    freshMemoryDb();
    await withAdminServer(async () => {
      const cases: Array<[Record<string, unknown>, string]> = [
        [{}, "name is required"],
        [{ name: "  ", transport: "stdio", command: "deno" }, "must be 1-64 chars"],
        [{ name: "X", transport: "grpc" }, "transport must be"],
        [{ name: "X", transport: "stdio" }, "need a command"],
        [{ name: "X", transport: "stdio", command: "  " }, "must be 1-512 chars"],
        [{ name: "X", transport: "http" }, "need a url"],
        [{ name: "X", transport: "http", url: "ftp://nope" }, "http:// or https://"],
        [
          { name: "X", transport: "stdio", command: "c", timeout_seconds: 1 },
          "between 5 and 3600",
        ],
        [
          { name: "X", transport: "stdio", command: "c", timeout_seconds: 99999 },
          "between 5 and 3600",
        ],
        [
          { name: "X", transport: "stdio", command: "c", args: "nope" },
          "array of strings",
        ],
        [
          { name: "X", transport: "stdio", command: "c", enabled: "yes" },
          "must be a boolean",
        ],
        [
          { name: "X", transport: "stdio", command: "c", env: { A: 5 } },
          "env.A must be a string",
        ],
        [
          { name: "X", transport: "stdio", command: "c", env: "nope" },
          "JSON object of strings",
        ],
      ];
      for (const [body, message] of cases) {
        const res = await registerServer(body);
        assertEquals(res.status, 400, JSON.stringify(body));
        const err = (await res.json()) as { error: { message: string } };
        assertEquals(err.error.message.includes(message), true, JSON.stringify(body));
      }
      const dup = await registerServer({ name: "Dup", transport: "stdio", command: "deno" });
      assertEquals(dup.status, 201);
      const dup2 = await registerServer({ name: "dup", transport: "stdio", command: "deno" });
      assertEquals(dup2.status, 409);
    });
  });

  it("rejects non-admins and anonymous callers", async () => {
    freshMemoryDb();
    await withAdminServer(async () => {
      await makeUser();
      assertEquals((await get("/api/v1/mcp/servers", userToken)).status, 403);
      assertEquals(
        (await post("/api/v1/mcp/servers", {
          name: "X",
          transport: "stdio",
          command: "deno",
        }, userToken)).status,
        403,
      );
      assertEquals(
        (await patch("/api/v1/mcp/servers/x", { enabled: false }, userToken)).status,
        403,
      );
      assertEquals((await deleteReq("/api/v1/mcp/servers/x", userToken)).status, 403);
      assertEquals((await post("/api/v1/mcp/servers/x/test", {}, userToken)).status, 403);
      assertEquals((await get("/api/v1/mcp/servers/x/tools", userToken)).status, 403);
      assertEquals((await get("/api/v1/mcp/servers")).status, 401);
    });
  });
});

describe("mcp api connections and tools", () => {
  afterEach(async () => {
    await mcpCloseAll();
    closeDb();
  });

  it("tests a reachable stdio server and lists its tools", async () => {
    freshMemoryDb();
    await withAdminServer(async () => {
      const created = await registerServer({
        name: "Fake MCP",
        transport: "stdio",
        ...fakeCommand(),
      });
      assertEquals(created.status, 201);

      const test = await post("/api/v1/mcp/servers/fake-mcp/test", {}, adminToken);
      assertEquals(test.status, 200);
      const testBody = (await test.json()) as {
        ok: boolean;
        tools: Array<Record<string, unknown>>;
      };
      assertEquals(testBody.ok, true);
      assertEquals(testBody.tools.length, 4);
      const echo = testBody.tools.find((t) => t.tool === "echo");
      assert(echo);
      assertEquals(echo.name, "mcp__fake-mcp__echo");
      assertEquals(echo.read_only_hint, true);
      const boom = testBody.tools.find((t) => t.tool === "boom");
      assert(boom);
      assertEquals(boom.read_only_hint, false);
      const echoSchema = echo.input_schema as Record<string, unknown>;
      assertEquals((echoSchema.properties as Record<string, unknown>).text, {
        type: "string",
      });

      const tools = await get("/api/v1/mcp/servers/fake-mcp/tools", adminToken);
      assertEquals(tools.status, 200);
      const toolsBody = (await tools.json()) as { tools: unknown[] };
      assertEquals(toolsBody.tools.length, 4);

      const list = (await (await get("/api/v1/mcp/servers", adminToken)).json()) as Array<
        Record<string, unknown>
      >;
      const entry = list.find((s) => s.id === "fake-mcp");
      assert(entry);
      const status = entry.status as Record<string, unknown>;
      assertEquals(status.state, "connected");
      assertEquals(status.last_error, null);
      assertEquals(status.tool_count, 4);
      assert(status.tools_fetched_at);
    });
  });

  it("maps unreachable servers to MCP_UNREACHABLE (502)", async () => {
    freshMemoryDb();
    await withAdminServer(async () => {
      const missing = await registerServer({
        name: "Missing",
        transport: "stdio",
        command: "/definitely/not/a/binary",
      });
      assertEquals(missing.status, 201);
      const test1 = await post("/api/v1/mcp/servers/missing/test", {}, adminToken);
      assertEquals(test1.status, 502);
      const err1 = (await test1.json()) as { error: { code: string; message: string } };
      assertEquals(err1.error.code, ERROR_CODES.MCP_UNREACHABLE);

      const failing = await registerServer({
        name: "Failing",
        transport: "stdio",
        ...fakeCommand(["--fail"]),
      });
      assertEquals(failing.status, 201);
      const test2 = await post("/api/v1/mcp/servers/failing/test", {}, adminToken);
      assertEquals(test2.status, 502);
      const err2 = (await test2.json()) as { error: { code: string; details?: string } };
      assertEquals(err2.error.code, ERROR_CODES.MCP_UNREACHABLE);
      // The child's stderr tail is captured for diagnostics instead of
      // being inherited into the backend log.
      assert(err2.error.details?.includes("exiting before handshake"));

      const status = mcpServerStatus("failing");
      assertEquals(status.state, "error");
      assert(status.last_error);
    });
  });

  it("maps a silent server to MCP_TIMEOUT (504) on connect", { timeout: 20_000 }, async () => {
    freshMemoryDb();
    await withAdminServer(async () => {
      const hanging = await registerServer({
        name: "Hanging",
        transport: "stdio",
        ...fakeCommand(["--hang"]),
        timeout_seconds: 5,
      });
      assertEquals(hanging.status, 201);
      const test = await post("/api/v1/mcp/servers/hanging/test", {}, adminToken);
      assertEquals(test.status, 504);
      const err = (await test.json()) as { error: { code: string; message: string } };
      assertEquals(err.error.code, ERROR_CODES.MCP_TIMEOUT);
      assertEquals(err.error.message.includes("timed out"), true);
    });
  });

  it("patching transport fields closes the live connection; delete closes it too", async () => {
    freshMemoryDb();
    await withAdminServer(async () => {
      await registerServer({ name: "Fake MCP", transport: "stdio", ...fakeCommand() });
      const test = await post("/api/v1/mcp/servers/fake-mcp/test", {}, adminToken);
      assertEquals(test.status, 200);
      assertEquals(mcpServerStatus("fake-mcp").state, "connected");

      const patched = await patch(
        "/api/v1/mcp/servers/fake-mcp",
        fakeCommand(["--fail"]),
        adminToken,
      );
      assertEquals(patched.status, 200);
      assertEquals(mcpServerStatus("fake-mcp").state, "idle");
      const test2 = await post("/api/v1/mcp/servers/fake-mcp/test", {}, adminToken);
      assertEquals(test2.status, 502);

      const del = await deleteReq("/api/v1/mcp/servers/fake-mcp", adminToken);
      assertEquals(del.status, 204);
      assertEquals(mcpServerStatus("fake-mcp").state, "idle");
    });
  });

  it("reconnects after a failed connection", async () => {
    freshMemoryDb();
    await withAdminServer(async () => {
      await registerServer({
        name: "Fake MCP",
        transport: "stdio",
        ...fakeCommand(["--fail"]),
      });
      const test1 = await post("/api/v1/mcp/servers/fake-mcp/test", {}, adminToken);
      assertEquals(test1.status, 502);

      const patched = await patch("/api/v1/mcp/servers/fake-mcp", fakeCommand(), adminToken);
      assertEquals(patched.status, 200);
      const test2 = await post("/api/v1/mcp/servers/fake-mcp/test", {}, adminToken);
      assertEquals(test2.status, 200);
      const body = (await test2.json()) as { ok: boolean };
      assertEquals(body.ok, true);
    });
  });
});

describe("mcp service (in-process)", () => {
  let adminId: number;

  beforeEach(() => {
    freshMemoryDb();
    adminId = schema.createUser("admin@example.com", "hash123", "Admin", "admin");
  });

  afterEach(async () => {
    await mcpCloseAll();
    closeDb();
  });

  it("calls tools: result conversion and error mapping", async () => {
    const cmd = fakeCommand();
    createMcpServer(adminId, {
      name: "Fake MCP",
      transport: "stdio",
      command: cmd.command,
      args: cmd.args,
    });

    const echo = await mcpCallTool("mcp__fake-mcp__echo", { text: "hi" });
    assertEquals(echo, { result: "echo:hi", is_error: false });

    const structured = await mcpCallTool("mcp__fake-mcp__structured", { value: 21 });
    assertEquals(structured, { result: { doubled: 42 }, is_error: false });

    const boom = await mcpCallTool("mcp__fake-mcp__boom", {});
    assertEquals(boom, { result: "boom-done", is_error: false });

    let badErr: AppError | undefined;
    try {
      await mcpCallTool("not-an-mcp-tool", {});
    } catch (e) {
      badErr = e as AppError;
    }
    assert(badErr);
    assertEquals(badErr.code, ERROR_CODES.VALIDATION);
    assertEquals(badErr.status, 400);

    let nfErr: AppError | undefined;
    try {
      await mcpCallTool("mcp__nope__echo", {});
    } catch (e) {
      nfErr = e as AppError;
    }
    assert(nfErr);
    assertEquals(nfErr.code, ERROR_CODES.NOT_FOUND);
    assertEquals(nfErr.status, 404);
  });

  it(
    "maps tool timeouts to MCP_TIMEOUT and reconnects afterwards",
    { timeout: 20_000 },
    async () => {
      const cmd = fakeCommand();
      createMcpServer(adminId, {
        name: "Slow",
        transport: "stdio",
        command: cmd.command,
        args: cmd.args,
        timeout_seconds: 5,
      });
      await mcpCallTool("mcp__slow__echo", { text: "warm" });
      let err: AppError | undefined;
      try {
        await mcpCallTool("mcp__slow__slowpoke", {});
      } catch (e) {
        err = e as AppError;
      }
      assert(err);
      assertEquals(err.code, ERROR_CODES.MCP_TIMEOUT);
      assertEquals(err.status, 504);
      // The connection is reset after a failure; the next call reconnects.
      const again = await mcpCallTool("mcp__slow__echo", { text: "back" });
      assertEquals(again, { result: "echo:back", is_error: false });
    },
  );

  it("keeps broken servers isolated and reports them in the catalog", async () => {
    const cmd = fakeCommand();
    createMcpServer(adminId, {
      name: "Fake MCP",
      transport: "stdio",
      command: cmd.command,
      args: cmd.args,
    });
    const failCmd = fakeCommand(["--fail"]);
    createMcpServer(adminId, {
      name: "Failing",
      transport: "stdio",
      command: failCmd.command,
      args: failCmd.args,
    });

    const tools = await mcpGetTools("fake-mcp", true);
    assertEquals(tools.length, 4);

    const catalog = await mcpCatalog();
    assertEquals(catalog.length, 2);
    const fake = catalog.find((e) => e.server.id === "fake-mcp");
    assert(fake);
    assertEquals(fake.state, "connected");
    assertEquals(fake.tools.length, 4);
    const failing = catalog.find((e) => e.server.id === "failing");
    assert(failing);
    assertEquals(failing.state, "error");
    assert(failing.last_error);
  });

  it("the 60 s cache serves repeated catalog reads without reconnecting", async () => {
    const cmd = fakeCommand();
    createMcpServer(adminId, {
      name: "Fake MCP",
      transport: "stdio",
      command: cmd.command,
      args: cmd.args,
    });
    const first = await mcpGetTools("fake-mcp");
    assertEquals(first.length, 4);
    const firstFetchedAt = mcpServerStatus("fake-mcp").tools_fetched_at;
    assert(firstFetchedAt);
    const second = await mcpGetTools("fake-mcp");
    assertEquals(second, first);
    assertEquals(mcpServerStatus("fake-mcp").tools_fetched_at, firstFetchedAt);
  });
});
