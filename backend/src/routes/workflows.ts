import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { errorResponses, type OperationMeta, ref } from "@cinemaItor/openapi/types.ts";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { badRequest, forbidden, notFound, unauthorized } from "@cinemaItor/errors.ts";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflowContent,
  getWorkflowDetail,
  listWorkflows,
  patchWorkflow,
  type WorkflowCreateRequest,
} from "@cinemaItor/db/workflows.ts";
import { getUserById } from "@cinemaItor/db/schema.ts";

/**
 * Saved ComfyUI workflows (data, not context). A model's default_settings can
 * reference one by id via `workflow_ref` instead of inlining the full prompt
 * graph. All endpoints are admin-gated: workflows are a model-management
 * resource and the only consumer (the Model Copilot / model manager UI) is
 * admin-scoped. The copilot's own list_workflows/get_workflow tools read the
 * repository in-process, so they are not affected by these HTTP permissions.
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
    throw forbidden("Admin role required for workflow management");
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
  if (!id) throw notFound("Workflow not found");
  return id;
}

function parseCreateRequest(body: Record<string, unknown>): WorkflowCreateRequest {
  if (body["content"] === undefined) throw badRequest("content is required", "content");
  const request: WorkflowCreateRequest = { content: body["content"] };
  if (body["name"] !== undefined) {
    if (typeof body["name"] !== "string") throw badRequest("name must be a string", "name");
    request.name = body["name"];
  }
  if (body["filename"] !== undefined) {
    if (typeof body["filename"] !== "string") {
      throw badRequest("filename must be a string", "filename");
    }
    request.filename = body["filename"];
  }
  return request;
}

async function handleCreate(ctx: Context): Promise<void> {
  const userId = requireAdmin(ctx);
  const body = await readJsonBody(ctx);
  const request = parseCreateRequest(body);
  const workflow = createWorkflow(userId, request);
  ctx.response.status = 201;
  ctx.response.body = workflow;
}

function handleList(ctx: Context): void {
  requireAdmin(ctx);
  ctx.response.body = listWorkflows();
}

function handleGet(ctx: Context): void {
  requireAdmin(ctx);
  const id = requireIdParam(ctx);
  ctx.response.body = getWorkflowDetail(id);
}

async function handlePatch(ctx: Context): Promise<void> {
  requireAdmin(ctx);
  const id = requireIdParam(ctx);
  const body = await readJsonBody(ctx);
  const workflow = patchWorkflow(id, body["patches"]);
  ctx.response.body = workflow;
}

function handleRaw(ctx: Context): void {
  requireAdmin(ctx);
  const id = requireIdParam(ctx);
  ctx.response.body = JSON.parse(getWorkflowContent(id)) as Record<string, unknown>;
}

function handleDelete(ctx: Context): void {
  requireAdmin(ctx);
  const id = requireIdParam(ctx);
  if (!deleteWorkflow(id)) throw notFound(`Unknown workflow id '${id}'`);
  ctx.response.status = 204;
}

export const router = new Router();
router
  .post("/api/v1/workflows", authMiddleware, handleCreate)
  .get("/api/v1/workflows", authMiddleware, handleList)
  .get("/api/v1/workflows/:id", authMiddleware, handleGet)
  .get("/api/v1/workflows/:id/raw", authMiddleware, handleRaw)
  .patch("/api/v1/workflows/:id", authMiddleware, handlePatch)
  .delete("/api/v1/workflows/:id", authMiddleware, handleDelete);

export const openApiOps: Record<string, OperationMeta> = {
  "POST /api/v1/workflows": {
    summary: "Save a ComfyUI workflow (API-format prompt graph)",
    description: "Stores a ComfyUI API-format workflow as data. Returns its id, which a model's " +
      "default_settings can reference via `workflow_ref`. Admin only.",
    adminOnly: true,
    requestBody: { schema: ref("WorkflowCreateRequest") },
    responses: {
      "201": { description: "Workflow saved", schema: ref("Workflow") },
      ...errorResponses(400, 401, 403),
    },
  },
  "GET /api/v1/workflows": {
    summary: "List saved workflows",
    adminOnly: true,
    responses: {
      "200": {
        description: "Saved workflows, newest first",
        schema: { type: "array", items: ref("Workflow") },
      },
      ...errorResponses(401, 403),
    },
  },
  "GET /api/v1/workflows/{id}": {
    summary: "Get a saved workflow's structure",
    description:
      "Returns the workflow summary plus a compact per-node preview (class_type + input " +
      "previews) for reasoning about the graph without the full JSON.",
    adminOnly: true,
    responses: {
      "200": { description: "Workflow detail", schema: ref("WorkflowDetail") },
      ...errorResponses(401, 403, 404),
    },
  },
  "GET /api/v1/workflows/{id}/raw": {
    summary: "Get a saved workflow's full JSON",
    description: "Returns the stored API-format prompt graph verbatim (for download/export).",
    adminOnly: true,
    responses: {
      "200": { description: "The workflow's prompt graph", schema: { type: "object" } },
      ...errorResponses(401, 403, 404),
    },
  },
  "PATCH /api/v1/workflows/{id}": {
    summary: "Patch a saved workflow's node inputs",
    description:
      "Applies node-level input edits (create or overwrite a node's input value) to a stored " +
      "workflow. Target nodes/inputs from the compact GET preview — the full graph is never " +
      "resubmitted. After patching, re-point a model via default_settings.workflow_ref to " +
      "re-bake the updated graph.",
    adminOnly: true,
    requestBody: { schema: ref("WorkflowPatchRequest") },
    responses: {
      "200": { description: "Workflow updated", schema: ref("Workflow") },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "DELETE /api/v1/workflows/{id}": {
    summary: "Delete a saved workflow",
    adminOnly: true,
    responses: {
      "204": { description: "Workflow deleted" },
      ...errorResponses(401, 403, 404),
    },
  },
};
