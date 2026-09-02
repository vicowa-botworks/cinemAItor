import { Writable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getMcpServerRow, listMcpServers, type McpServerRow } from "@cinemaItor/db/mcp.ts";
import { AppError, ERROR_CODES, notFound } from "@cinemaItor/errors.ts";

// MCP client (Workstream 17): manages live connections to registered MCP
// servers (services on npm:@modelcontextprotocol/sdk) and exposes their tools
// to the Model Copilot under qualified names mcp__<server>__<tool>.
//
// Design constraints (see docs/mcp.md):
//  - lazy connect on first use, reconnect on failure (a failed request
//    invalidates the session, so the next use reconnects);
//  - tool catalog cached per server for 60 s;
//  - one in-flight request per server (stdio is a single JSON-RPC session);
//  - mcpCloseAll() on SIGTERM/SIGINT so stdio children never leak.

export const MCP_PREFIX = "mcp__";
export const MCP_CATALOG_TTL_MS = 60_000;
const MCP_MAX_TOOL_NAME_LEN = 64;
const MCP_CLOSE_TIMEOUT_MS = 3000;
// McpError code for ErrorCode.RequestTimeout in the MCP SDK.
const MCP_REQUEST_TIMEOUT_CODE = -32001;

export type McpConnectionState = "idle" | "connecting" | "connected" | "error";

export interface McpToolInfo {
  /** Qualified name: mcp__<server>__<tool> */
  name: string;
  /** The server id this tool came from. */
  server: string;
  /** The raw tool name as declared by the MCP server. */
  tool: string;
  description: string;
  /** The tool's JSON Schema input (passed through to the LLM). */
  input_schema: Record<string, unknown>;
  /** The server's declared readOnlyHint annotation. */
  read_only_hint: boolean;
}

export interface McpServerStatus {
  state: McpConnectionState;
  last_error: string | null;
  tool_count: number;
  tools_fetched_at: string | null;
}

export interface McpCatalogEntry {
  server: { id: string; name: string; auto_approve: boolean };
  state: McpConnectionState;
  last_error: string | null;
  tools: McpToolInfo[];
}

export interface McpCallResult {
  result: unknown;
  is_error: boolean;
}

const STDERR_TAIL_MAX = 4096;
const STDERR_DECODER = new TextDecoder();

interface McpConnection {
  client: Client | null;
  state: McpConnectionState;
  last_error: string | null;
  tools: McpToolInfo[];
  toolsFetchedAt: number | null;
  chain: Promise<unknown>;
  /** Last 4 KiB of the current stdio child's stderr (diagnostics only). */
  stderrTail: string;
}

const connections = new Map<string, McpConnection>();

function getConn(serverId: string): McpConnection {
  let conn = connections.get(serverId);
  if (!conn) {
    conn = {
      client: null,
      state: "idle",
      last_error: null,
      tools: [],
      toolsFetchedAt: null,
      chain: Promise.resolve(),
      stderrTail: "",
    };
    connections.set(serverId, conn);
  }
  return conn;
}

/** Consumes a stdio child's stderr (so the pipe never backpressures the
 *  child) without forwarding it to the backend log; only the last
 *  STDERR_TAIL_MAX bytes are kept for connect-failure diagnostics. */
function makeStderrSink(conn: McpConnection): Writable {
  return new Writable({
    write(chunk: Uint8Array, _encoding: BufferEncoding, callback: () => void) {
      conn.stderrTail = (conn.stderrTail + STDERR_DECODER.decode(chunk)).slice(-STDERR_TAIL_MAX);
      callback();
    },
  });
}

export function qualifiedToolName(serverId: string, tool: string): string {
  return `${MCP_PREFIX}${serverId}__${tool}`;
}

/** Parse a qualified mcp tool name. Server ids are underscore-free slugs, so
 *  the first "__" after the mcp__ prefix unambiguously ends the server id. */
export function parseQualifiedToolName(
  name: string,
): { server: string; tool: string } | null {
  if (typeof name !== "string" || !name.startsWith(MCP_PREFIX)) return null;
  const rest = name.slice(MCP_PREFIX.length);
  const sep = rest.indexOf("__");
  if (sep <= 0) return null;
  const server = rest.slice(0, sep);
  const tool = rest.slice(sep + 2);
  if (tool.length === 0 || tool.length > 128) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(tool)) return null;
  return { server, tool };
}

function isMcpTimeoutError(err: unknown): boolean {
  return typeof err === "object" && err !== null &&
    "code" in err && (err as { code: unknown }).code === MCP_REQUEST_TIMEOUT_CODE;
}

function shortMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

/** Map a transport/protocol failure to the API error contract: 504 when the
 *  server did not answer in time, 502 when it is unreachable or misbehaving.
 *  `stderrTail` (stdio children) is included so a dead-on-arrival server is
 *  debuggable without console access. */
export function mapMcpError(err: unknown, context: string, stderrTail?: string): AppError {
  if (err instanceof AppError) return err;
  const errorText = shortMessage(err);
  const details = stderrTail ? `${errorText} | stderr: ${stderrTail}` : errorText;
  if (isMcpTimeoutError(err) || /timed? ?out/i.test(shortMessage(err))) {
    return new AppError(ERROR_CODES.MCP_TIMEOUT, `${context}: timed out`, {
      status: 504,
      details,
    });
  }
  return new AppError(
    ERROR_CODES.MCP_UNREACHABLE,
    `${context}: ${errorText}`,
    { status: 502, details },
  );
}

async function connectToServer(row: McpServerRow): Promise<Client> {
  const timeoutMs = row.timeout_seconds * 1000;
  const client = new Client(
    { name: "cinemaitor", version: "1.0.0" },
    { capabilities: {} },
  );
  let transport: StdioClientTransport | StreamableHTTPClientTransport;
  if (row.transport === "stdio") {
    let args: string[] = [];
    let env: Record<string, string> = {};
    if (row.args_json) {
      try {
        args = JSON.parse(row.args_json) as string[];
      } catch {
        args = [];
      }
    }
    if (row.env_json) {
      try {
        env = JSON.parse(row.env_json) as Record<string, string>;
      } catch {
        env = {};
      }
    }
    if (!row.command) throw notFound(`MCP server '${row.id}' has no command`);
    const conn = getConn(row.id);
    conn.stderrTail = "";
    transport = new StdioClientTransport({
      command: row.command,
      args,
      env: { ...Deno.env.toObject(), ...env },
      // Consumed (not inherited) so a chatty child can never flood the
      // backend log; the last 4 KiB is kept for connect-failure diagnostics.
      stderr: makeStderrSink(conn),
    });
  } else {
    if (!row.url) throw notFound(`MCP server '${row.id}' has no url`);
    let headers: Record<string, string> = {};
    if (row.headers_json) {
      try {
        headers = JSON.parse(row.headers_json) as Record<string, string>;
      } catch {
        headers = {};
      }
    }
    transport = new StreamableHTTPClientTransport(new URL(row.url), {
      requestInit: { headers },
    });
  }
  await client.connect(transport, { timeout: timeoutMs });
  return client;
}

async function resetConn(conn: McpConnection): Promise<void> {
  const client = conn.client;
  conn.client = null;
  if (client) {
    try {
      await client.close();
    } catch {
      // The transport may already be dead; the next use reconnects.
    }
  }
}

/** Run `fn` against a live connection for the server: connects lazily,
 *  serializes per-server, and on any failure resets the connection (the next
 *  use reconnects) and maps the error to MCP_UNREACHABLE/MCP_TIMEOUT. */
function withClient(
  serverId: string,
  fn: (client: Client, row: McpServerRow) => Promise<unknown>,
): Promise<unknown> {
  const row = getMcpServerRow(serverId);
  if (!row) throw notFound(`Unknown MCP server '${serverId}'`);
  const conn = getConn(serverId);
  const run = async (): Promise<unknown> => {
    if (!conn.client || conn.state !== "connected") {
      await resetConn(conn);
      conn.state = "connecting";
      try {
        conn.client = await connectToServer(row);
        conn.state = "connected";
        conn.last_error = null;
      } catch (err) {
        conn.state = "error";
        conn.last_error = shortMessage(err);
        throw mapMcpError(err, `connect to MCP server '${row.id}'`, conn.stderrTail);
      }
    }
    try {
      return await fn(conn.client!, row);
    } catch (err) {
      // A failed request may have broken the session (the stdio child died,
      // the HTTP stream closed) — force a reconnect on the next use.
      await resetConn(conn);
      conn.state = "error";
      conn.last_error = shortMessage(err);
      throw mapMcpError(err, `call on MCP server '${row.id}'`);
    }
  };
  const prev = conn.chain;
  const result = prev.then(run, run);
  conn.chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function convertCallResult(result: {
  content?: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
}): McpCallResult {
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return { result: result.structuredContent, is_error: result.isError === true };
  }
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else parts.push(`[${String(block.type)}]`);
  }
  return { result: parts.join("\n"), is_error: result.isError === true };
}

/** Connect (if needed) and fetch the server's tool catalog, refreshing the
 *  per-server cache. Throws MCP_UNREACHABLE/MCP_TIMEOUT on failure. */
export async function mcpRefreshTools(serverId: string): Promise<McpToolInfo[]> {
  const tools = (await withClient(serverId, async (client, row) => {
    const result = await client.listTools(undefined, {
      timeout: row.timeout_seconds * 1000,
    });
    const conn = getConn(serverId);
    const list: McpToolInfo[] = [];
    for (const t of result.tools) {
      const name = qualifiedToolName(row.id, t.name);
      if (name.length > MCP_MAX_TOOL_NAME_LEN) continue;
      const annotations = t.annotations as { readOnlyHint?: unknown } | undefined;
      list.push({
        name,
        server: row.id,
        tool: t.name,
        description: typeof t.description === "string" ? t.description : "",
        input_schema: (t.inputSchema ?? {}) as Record<string, unknown>,
        read_only_hint: annotations?.readOnlyHint === true,
      });
    }
    conn.tools = list;
    conn.toolsFetchedAt = Date.now();
    return list;
  })) as McpToolInfo[];
  return tools;
}

/** The server's tool catalog: the 60 s cache when fresh, else a refresh. */
export function mcpGetTools(serverId: string, force = false): Promise<McpToolInfo[]> {
  const row = getMcpServerRow(serverId);
  if (!row) throw notFound(`Unknown MCP server '${serverId}'`);
  const conn = getConn(serverId);
  if (
    !force && conn.state === "connected" && conn.toolsFetchedAt !== null &&
    Date.now() - conn.toolsFetchedAt < MCP_CATALOG_TTL_MS
  ) {
    return Promise.resolve(conn.tools);
  }
  return mcpRefreshTools(serverId);
}

/** Live status of one server's connection (no I/O — reads the cached state). */
export function mcpServerStatus(serverId: string): McpServerStatus {
  const conn = connections.get(serverId);
  return {
    state: conn?.state ?? "idle",
    last_error: conn?.last_error ?? null,
    tool_count: conn?.tools.length ?? 0,
    tools_fetched_at: conn?.toolsFetchedAt ? new Date(conn.toolsFetchedAt).toISOString() : null,
  };
}

/** Cached catalog over every enabled server (stale entries report their
 *  cached tools + state; a failure on one server never fails the others). */
export async function mcpCatalog(): Promise<McpCatalogEntry[]> {
  const servers = listMcpServers().filter((v) => v.enabled);
  const entries = await Promise.all(servers.map(async (view) => {
    const conn = connections.get(view.id);
    const fresh = conn?.state === "connected" && conn.toolsFetchedAt !== null &&
      Date.now() - (conn.toolsFetchedAt as number) < MCP_CATALOG_TTL_MS;
    let tools = conn?.tools ?? [];
    let state = conn?.state ?? "idle";
    let lastError = conn?.last_error ?? null;
    if (!fresh) {
      try {
        tools = await mcpRefreshTools(view.id);
        state = "connected";
        lastError = null;
      } catch (err) {
        state = "error";
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    return {
      server: { id: view.id, name: view.name, auto_approve: view.auto_approve },
      state,
      last_error: lastError,
      tools,
    };
  }));
  return entries;
}

/** Call a tool by its qualified name. `args` is the tool's JSON object
 *  arguments. Throws MCP_UNREACHABLE/MCP_TIMEOUT on transport failure and
 *  VALIDATION for a malformed qualified name; the tool's own error (isError)
 *  is reported in the result, not as an HTTP error. */
export async function mcpCallTool(
  qualifiedName: string,
  args: Record<string, unknown> = {},
): Promise<McpCallResult> {
  const parsed = parseQualifiedToolName(qualifiedName);
  if (!parsed) {
    throw new AppError(
      ERROR_CODES.VALIDATION,
      `Not an MCP tool name (expected mcp__<server>__<tool>): '${qualifiedName}'`,
      { status: 400 },
    );
  }
  const row = getMcpServerRow(parsed.server);
  if (!row) throw notFound(`Unknown MCP server '${parsed.server}'`);
  const result = (await withClient(parsed.server, (client, r) =>
    client.callTool(
      { name: parsed.tool, arguments: args },
      undefined,
      { timeout: r.timeout_seconds * 1000 },
    ))) as {
      content?: Array<Record<string, unknown>>;
      structuredContent?: unknown;
      isError?: boolean;
    };
  return convertCallResult(result);
}

/** Close one server's connection (config changed / server deleted), waiting
 *  for the transport close so no in-flight request outlives the response. */
export async function mcpCloseConnection(serverId: string): Promise<void> {
  const conn = connections.get(serverId);
  if (!conn) return;
  conn.state = "idle";
  conn.last_error = null;
  conn.tools = [];
  conn.toolsFetchedAt = null;
  await resetConn(conn);
}

/** Close every connection (process shutdown) with a bounded wait. */
export async function mcpCloseAll(): Promise<void> {
  const conns = [...connections.values()];
  connections.clear();
  await Promise.race([
    Promise.allSettled(conns.map((conn) => resetConn(conn))),
    new Promise((resolve) => setTimeout(resolve, MCP_CLOSE_TIMEOUT_MS)),
  ]);
}
