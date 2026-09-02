import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { errorResponses, type OperationMeta, ref } from "@cinemaItor/openapi/types.ts";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { badRequest, forbidden, notFound, unauthorized } from "@cinemaItor/errors.ts";
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServerView,
  listMcpServers,
  type McpServerCreateRequest,
  type McpServerPatchRequest,
  patchMcpServer,
} from "@cinemaItor/db/mcp.ts";
import {
  mcpCloseConnection,
  mcpGetTools,
  mcpRefreshTools,
  mcpServerStatus,
} from "@cinemaItor/services/mcp.ts";
import { getUserById } from "@cinemaItor/db/schema.ts";
import { logAudit } from "@cinemaItor/services/audit.ts";

/**
 * MCP tool server registry (Workstream 17). All endpoints are admin-gated:
 * an MCP server is a trusted, model-management resource — its tools reach
 * the Model Copilot (and, on auto-approve servers, execute without approval).
 * Test/tools endpoints connect live to the registered server, so their
 * failures map to 502 MCP_UNREACHABLE / 504 MCP_TIMEOUT.
 */

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

function requireAdmin(ctx: Context): number {
  const userId = requireUserId(ctx);
  const user = getUserById(userId);
  if (!user || user.role !== "admin") {
    throw forbidden("Admin role required for MCP server management");
  }
  return userId;
}

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") throw badRequest("Request body must be JSON");
  return (await body.json()) as Record<string, unknown>;
}

function requireIdParam(ctx: Context): string {
  const id = (ctx as { params?: { id?: string } }).params?.id ?? "";
  if (!id) throw notFound("MCP server not found");
  return id;
}

async function handleCreate(ctx: Context): Promise<void> {
  const userId = requireAdmin(ctx);
  const body = await readJsonBody(ctx);
  const view = createMcpServer(userId, body as unknown as McpServerCreateRequest);
  logAudit(userId, "mcp.server_create", "mcp_server", view.id);
  ctx.response.status = 201;
  ctx.response.body = { ...view, status: mcpServerStatus(view.id) };
}

function handleList(ctx: Context): void {
  requireAdmin(ctx);
  ctx.response.body = listMcpServers().map((view) => ({
    ...view,
    status: mcpServerStatus(view.id),
  }));
}

async function handlePatch(ctx: Context): Promise<void> {
  const userId = requireAdmin(ctx);
  const id = requireIdParam(ctx);
  const body = await readJsonBody(ctx);
  const { view, transportChanged } = patchMcpServer(id, body as McpServerPatchRequest);
  if (transportChanged) await mcpCloseConnection(view.id);
  logAudit(userId, "mcp.server_update", "mcp_server", view.id);
  ctx.response.body = { ...view, status: mcpServerStatus(view.id) };
}

async function handleDelete(ctx: Context): Promise<void> {
  const userId = requireAdmin(ctx);
  const id = requireIdParam(ctx);
  if (!deleteMcpServer(id)) throw notFound(`Unknown MCP server '${id}'`);
  await mcpCloseConnection(id);
  logAudit(userId, "mcp.server_delete", "mcp_server", id);
  ctx.response.status = 204;
}

async function handleTest(ctx: Context): Promise<void> {
  const userId = requireAdmin(ctx);
  const id = requireIdParam(ctx);
  getMcpServerView(id);
  const tools = await mcpRefreshTools(id);
  logAudit(userId, "mcp.server_test", "mcp_server", id);
  ctx.response.body = { ok: true, tools };
}

async function handleTools(ctx: Context): Promise<void> {
  requireAdmin(ctx);
  const id = requireIdParam(ctx);
  getMcpServerView(id);
  const tools = await mcpGetTools(id, true);
  ctx.response.body = { tools };
}

export const router = new Router();
router
  .get("/api/v1/mcp/servers", authMiddleware, handleList)
  .post("/api/v1/mcp/servers", authMiddleware, handleCreate)
  .patch("/api/v1/mcp/servers/:id", authMiddleware, handlePatch)
  .delete("/api/v1/mcp/servers/:id", authMiddleware, handleDelete)
  .post("/api/v1/mcp/servers/:id/test", authMiddleware, handleTest)
  .get("/api/v1/mcp/servers/:id/tools", authMiddleware, handleTools);

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/mcp/servers": {
    summary: "List registered MCP tool servers",
    description: "Every registered MCP server with its live connection status (state, " +
      "last error, cached tool count). Header values are never included — " +
      "only header names and a set flag. Admin only.",
    adminOnly: true,
    responses: {
      "200": {
        description: "Registered MCP servers, newest first",
        schema: { type: "array", items: ref("McpServer") },
      },
      ...errorResponses(401, 403),
    },
  },
  "POST /api/v1/mcp/servers": {
    summary: "Register an MCP tool server",
    description: "Registers a stdio (spawned command + argv, no shell) or http " +
      "(Streamable HTTP endpoint) MCP server. The id is derived from the " +
      "name (slug). The server is not contacted at registration — use the " +
      "test endpoint to verify it. Admin only.",
    adminOnly: true,
    requestBody: { schema: ref("McpServerCreateRequest") },
    responses: {
      "201": { description: "Server registered", schema: ref("McpServer") },
      ...errorResponses(400, 401, 403, 409),
    },
  },
  "PATCH /api/v1/mcp/servers/{id}": {
    summary: "Update an MCP server's configuration",
    description: "Updates any of description/transport/command/args/env/url/headers/" +
      "timeout_seconds/enabled/auto_approve (name is immutable — the id is " +
      "derived from it). A change to the transport fields closes the live " +
      "connection so the next use reconnects with the new config. Admin only.",
    adminOnly: true,
    requestBody: { schema: ref("McpServerPatchRequest") },
    responses: {
      "200": { description: "Server updated", schema: ref("McpServer") },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "DELETE /api/v1/mcp/servers/{id}": {
    summary: "Remove an MCP server",
    description: "Deletes the registration and closes its live connection.",
    adminOnly: true,
    responses: {
      "204": { description: "Server removed" },
      ...errorResponses(401, 403, 404),
    },
  },
  "POST /api/v1/mcp/servers/{id}/test": {
    summary: "Test an MCP server connection",
    description: "Connects to the server (spawning it for stdio) and lists its tools. " +
      "A reachable server returns its tool catalog; failures map to 502 " +
      "MCP_UNREACHABLE (spawn/connect/protocol failure) or 504 MCP_TIMEOUT. " +
      "Admin only.",
    adminOnly: true,
    responses: {
      "200": { description: "Server reachable", schema: ref("McpTestResult") },
      ...errorResponses(401, 403, 404, 502, 504),
    },
  },
  "GET /api/v1/mcp/servers/{id}/tools": {
    summary: "List an MCP server's tools",
    description: "The server's tool catalog (refreshed from the server, not the cache): " +
      "qualified names, JSON Schema inputs, and each tool's readOnlyHint. " +
      "Failures map like the test endpoint. Admin only.",
    adminOnly: true,
    responses: {
      "200": { description: "Tool catalog", schema: ref("McpToolsResult") },
      ...errorResponses(401, 403, 404, 502, 504),
    },
  },
};
