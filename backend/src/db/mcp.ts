import { getDb } from "./database.ts";
import { badRequest, conflict, notFound } from "../errors.ts";

// MCP (Model Context Protocol) tool server registry (Workstream 17).
// Admins register external MCP servers; the Model Copilot client service
// (services/mcp.ts) connects to them and exposes their tools alongside the
// built-in ones. Transport details: stdio = spawned command (argv, no shell);
// http = MCP Streamable HTTP endpoint. Header values (potential secrets) are
// never returned by the API views — only names + a set flag.

export type McpTransport = "stdio" | "http";

export interface McpServerRow {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  command: string | null;
  args_json: string | null;
  env_json: string | null;
  url: string | null;
  headers_json: string | null;
  timeout_seconds: number;
  enabled: number;
  auto_approve: number;
  created_by: number;
  created_at: string;
  updated_at: string;
}

/** API-visible shape of an MCP server row (header values masked). */
export interface McpServerView {
  id: string;
  name: string;
  description: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  env_set: boolean;
  url: string | null;
  header_names: string[];
  headers_set: boolean;
  timeout_seconds: number;
  enabled: boolean;
  auto_approve: boolean;
  created_at: string;
  updated_at: string;
}

export interface McpServerCreateRequest {
  name: unknown;
  description?: unknown;
  transport: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  headers?: unknown;
  timeout_seconds?: unknown;
  enabled?: unknown;
  auto_approve?: unknown;
}

export interface McpServerPatchRequest {
  name?: unknown;
  description?: unknown;
  transport?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  headers?: unknown;
  timeout_seconds?: unknown;
  enabled?: unknown;
  auto_approve?: unknown;
}

export interface McpServerPatchResult {
  view: McpServerView;
  /** True when a field affecting the live connection changed (the caller
   *  closes the connection so the next use reconnects with the new config). */
  transportChanged: boolean;
}

const NAME_MAX_LEN = 64;
const DESCRIPTION_MAX_LEN = 500;
const COMMAND_MAX_LEN = 512;
const ARG_MAX_LEN = 512;
const ARGS_MAX_ITEMS = 128;
const URL_MAX_LEN = 2048;
const ENV_MAX_KEYS = 64;
const ENV_VALUE_MAX_LEN = 4096;
const HEADER_MAX_KEYS = 32;
const HEADER_NAME_MAX_LEN = 128;
const HEADER_VALUE_MAX_LEN = 4096;
const TIMEOUT_MIN = 5;
const TIMEOUT_MAX = 3600;
const TIMEOUT_DEFAULT = 120;

function nowIso(): string {
  return new Date().toISOString();
}

/** Slug for the server id: lowercase, non-alphanumeric runs collapsed to a
 *  single "-". Deliberately no underscores — the qualified tool-name separator
 *  is "__", and an underscore-free server id keeps the prefix unambiguous. */
export function slugifyServerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string`, field);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, field);
}

function parseBool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw badRequest(`${field} must be a boolean`, field);
  }
  return value;
}

function parseStringArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxItemLen: number,
): string[] {
  if (!Array.isArray(value)) {
    throw badRequest(`${field} must be an array of strings`, field);
  }
  if (value.length > maxItems) {
    throw badRequest(`${field} has at most ${maxItems} entries`, field);
  }
  return value.map((item, i) => {
    if (typeof item !== "string" || item.length === 0 || item.length > maxItemLen) {
      throw badRequest(
        `${field}[${i}] must be a non-empty string of at most ${maxItemLen} chars`,
        field,
      );
    }
    return item;
  });
}

function parseStringMap(
  value: unknown,
  field: string,
  maxKeys: number,
  maxNameLen: number,
  maxValueLen: number,
): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${field} must be a JSON object of strings`, field);
  }
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key.length === 0 || key.length > maxNameLen) {
      throw badRequest(`${field} keys must be 1-${maxNameLen} chars`, field);
    }
    if (typeof v !== "string" || v.length > maxValueLen) {
      throw badRequest(
        `${field}.${key} must be a string of at most ${maxValueLen} chars`,
        field,
      );
    }
    out[key] = v;
  }
  if (Object.keys(out).length > maxKeys) {
    throw badRequest(`${field} has at most ${maxKeys} entries`, field);
  }
  return out;
}

function parseTimeout(value: unknown): number {
  if (value === undefined) return TIMEOUT_DEFAULT;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest("timeout_seconds must be an integer", "timeout_seconds");
  }
  if (value < TIMEOUT_MIN || value > TIMEOUT_MAX) {
    throw badRequest(
      `timeout_seconds must be between ${TIMEOUT_MIN} and ${TIMEOUT_MAX}`,
      "timeout_seconds",
    );
  }
  return value;
}

function parseTransport(value: unknown): McpTransport {
  const t = optionalString(value, "transport");
  if (t !== "stdio" && t !== "http") {
    throw badRequest("transport must be 'stdio' or 'http'", "transport");
  }
  return t;
}

/** Transport fields (or undefined when the client omitted them). */
export interface ParsedMcpTransportFields {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

function parseTransportFields(
  transport: McpTransport,
  req: {
    command?: unknown;
    args?: unknown;
    env?: unknown;
    url?: unknown;
    headers?: unknown;
  },
): ParsedMcpTransportFields {
  const out: ParsedMcpTransportFields = {};
  if (transport === "stdio") {
    if (req.command !== undefined) {
      out.command = requireString(req.command, "command").trim();
      if (out.command.length === 0 || out.command.length > COMMAND_MAX_LEN) {
        throw badRequest(`command must be 1-${COMMAND_MAX_LEN} chars`, "command");
      }
    }
    if (req.args !== undefined) {
      out.args = parseStringArray(req.args, "args", ARGS_MAX_ITEMS, ARG_MAX_LEN);
    }
    if (req.env !== undefined) {
      if (req.env === null) out.env = {};
      else out.env = parseStringMap(req.env, "env", ENV_MAX_KEYS, 128, ENV_VALUE_MAX_LEN);
    }
  } else {
    if (req.url !== undefined) {
      out.url = requireString(req.url, "url");
      if (out.url.length === 0 || out.url.length > URL_MAX_LEN) {
        throw badRequest(`url must be 1-${URL_MAX_LEN} chars`, "url");
      }
      if (!/^https?:\/\/\S+$/.test(out.url)) {
        throw badRequest("url must be an http:// or https:// URL", "url");
      }
    }
    if (req.headers !== undefined) {
      if (req.headers === null) out.headers = {};
      else {
        out.headers = parseStringMap(
          req.headers,
          "headers",
          HEADER_MAX_KEYS,
          HEADER_NAME_MAX_LEN,
          HEADER_VALUE_MAX_LEN,
        );
      }
    }
  }
  return out;
}

/** Validate the full (merged) transport config of one server. */
function validateMergedTransport(
  transport: McpTransport,
  command: string | null,
  url: string | null,
): void {
  if (transport === "stdio") {
    if (!command || command.length === 0) {
      throw badRequest("stdio servers need a command", "command");
    }
  } else if (!url || url.length === 0) {
    throw badRequest("http servers need a url", "url");
  }
}

function readJsonStringArray(
  row: McpServerRow,
  field: "args" | "env" | "headers",
): string[] | Record<string, string> | null {
  const raw = field === "args" ? row.args_json : field === "env" ? row.env_json : row.headers_json;
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (field === "args") {
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    }
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, string> : {};
  } catch {
    return field === "args" ? [] : {};
  }
}

export function toMcpServerView(row: McpServerRow): McpServerView {
  const args = readJsonStringArray(row, "args");
  const env = readJsonStringArray(row, "env");
  const headers = readJsonStringArray(row, "headers");
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    transport: row.transport,
    command: row.command,
    args: (Array.isArray(args) ? args : []) as string[],
    env_set: (env as Record<string, string> | null) !== null &&
      Object.keys(env as Record<string, string>).length > 0,
    url: row.url,
    header_names: headers === null ? [] : Object.keys(headers as Record<string, string>),
    headers_set: (headers as Record<string, string> | null) !== null &&
      Object.keys(headers as Record<string, string>).length > 0,
    timeout_seconds: row.timeout_seconds,
    enabled: row.enabled === 1,
    auto_approve: row.auto_approve === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getMcpServerRow(id: string): McpServerRow | undefined {
  const row = getDb()
    .prepare("SELECT * FROM mcp_servers WHERE id = ?")
    .get(id.trim()) as McpServerRow | undefined;
  return row;
}

export function getMcpServerView(id: string): McpServerView {
  const row = getMcpServerRow(id);
  if (!row) throw notFound(`Unknown MCP server '${id}'`);
  return toMcpServerView(row);
}

export function listMcpServers(): McpServerView[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM mcp_servers ORDER BY created_at DESC, rowid DESC`,
    )
    .all() as unknown as McpServerRow[];
  return rows.map(toMcpServerView);
}

export function createMcpServer(
  userId: number,
  req: McpServerCreateRequest,
): McpServerView {
  if (req.name === undefined) throw badRequest("name is required", "name");
  const name = requireString(req.name, "name").trim();
  if (name.length === 0 || name.length > NAME_MAX_LEN) {
    throw badRequest(`name must be 1-${NAME_MAX_LEN} chars`, "name");
  }
  const id = slugifyServerName(name);
  if (id.length === 0 || id.length > NAME_MAX_LEN) {
    throw badRequest(
      `name must contain at least one alphanumeric character`,
      "name",
    );
  }
  if (getMcpServerRow(id) !== undefined) {
    throw conflict(`An MCP server named '${name}' (id '${id}') already exists`);
  }
  const description = optionalString(req.description, "description")?.trim() ?? "";
  if (description.length > DESCRIPTION_MAX_LEN) {
    throw badRequest(`description is at most ${DESCRIPTION_MAX_LEN} chars`, "description");
  }
  const transport = parseTransport(req.transport);
  const fields = parseTransportFields(transport, req);
  if (transport === "stdio" && fields.command === undefined) {
    throw badRequest("stdio servers need a command", "command");
  }
  if (transport === "http" && fields.url === undefined) {
    throw badRequest("http servers need a url", "url");
  }
  const timeout = parseTimeout(req.timeout_seconds);
  const enabled = req.enabled === undefined ? true : parseBool(req.enabled, "enabled");
  const autoApprove = req.auto_approve === undefined
    ? false
    : parseBool(req.auto_approve, "auto_approve");
  const now = nowIso();
  const stmt = getDb().prepare(
    `INSERT INTO mcp_servers (
       id, name, description, transport, command, args_json, env_json,
       url, headers_json, timeout_seconds, enabled, auto_approve,
       created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(
    id,
    name,
    description,
    transport,
    fields.command ?? null,
    fields.args ? JSON.stringify(fields.args) : null,
    fields.env ? JSON.stringify(fields.env) : null,
    fields.url ?? null,
    fields.headers ? JSON.stringify(fields.headers) : null,
    timeout,
    enabled ? 1 : 0,
    autoApprove ? 1 : 0,
    userId,
    now,
    now,
  );
  return toMcpServerView(getMcpServerRow(id)!);
}

export function patchMcpServer(
  id: string,
  req: McpServerPatchRequest,
): McpServerPatchResult {
  const row = getMcpServerRow(id);
  if (!row) throw notFound(`Unknown MCP server '${id}'`);
  if (req.name !== undefined) {
    throw badRequest("name is not patchable (the id is derived from it)", "name");
  }
  const description = req.description === undefined
    ? row.description
    : requireString(req.description, "description").trim();
  if (description.length > DESCRIPTION_MAX_LEN) {
    throw badRequest(`description is at most ${DESCRIPTION_MAX_LEN} chars`, "description");
  }
  const transport = req.transport === undefined ? row.transport : parseTransport(req.transport);
  const fields = parseTransportFields(transport, req);
  // When the transport switches, drop the previous transport's fields so the
  // stored row only ever carries config for its active transport.
  const command = transport === "stdio" ? (fields.command ?? row.command) : null;
  const url = transport === "http" ? (fields.url ?? row.url) : null;
  const argsDropped = transport === "http";
  const urlDropped = transport === "stdio";
  validateMergedTransport(transport, command, url);
  const args = argsDropped ? [] : fields.args ??
    (row.args_json ? (JSON.parse(row.args_json) as string[]) : []);
  const env = argsDropped ? {} : fields.env ??
    (row.env_json ? (JSON.parse(row.env_json) as Record<string, string>) : {});
  const headers = urlDropped ? {} : fields.headers ??
    (row.headers_json ? (JSON.parse(row.headers_json) as Record<string, string>) : {});
  const timeout = req.timeout_seconds === undefined
    ? row.timeout_seconds
    : parseTimeout(req.timeout_seconds);
  const enabled = req.enabled === undefined ? row.enabled === 1 : parseBool(req.enabled, "enabled");
  const autoApprove = req.auto_approve === undefined
    ? row.auto_approve === 1
    : parseBool(req.auto_approve, "auto_approve");
  const transportChanged = req.transport !== undefined ||
    fields.command !== undefined || fields.args !== undefined ||
    fields.env !== undefined || fields.url !== undefined ||
    fields.headers !== undefined;
  const now = nowIso();
  const stmt = getDb().prepare(
    `UPDATE mcp_servers SET
       description = ?, transport = ?, command = ?, args_json = ?, env_json = ?,
       url = ?, headers_json = ?, timeout_seconds = ?, enabled = ?, auto_approve = ?,
       updated_at = ?
     WHERE id = ?`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(
    description,
    transport,
    command,
    JSON.stringify(args),
    JSON.stringify(env),
    url,
    JSON.stringify(headers),
    timeout,
    enabled ? 1 : 0,
    autoApprove ? 1 : 0,
    now,
    row.id,
  );
  return { view: toMcpServerView(getMcpServerRow(row.id)!), transportChanged };
}

export function deleteMcpServer(id: string): boolean {
  const changes = getDb().prepare("DELETE FROM mcp_servers WHERE id = ?").run(
    id.trim(),
  ) as unknown as number;
  return changes > 0;
}
