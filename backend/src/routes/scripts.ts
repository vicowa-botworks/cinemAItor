import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  attachScriptPrompt,
  createMovieScript,
  deleteMovieScript,
  getMovieScript,
  listMovieScripts,
  listScriptVersions,
  type MovieScript,
  restoreScriptVersion,
  scriptPrompt,
  updateMovieScript,
} from "@cinemaItor/db/movie_scripts.ts";
import { badRequest, notFound, unauthorized } from "@cinemaItor/errors.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { errorResponses, ref } from "@cinemaItor/openapi/types.ts";

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

interface ParamsContext extends AuthedContext {
  params: { id?: string; versionId?: string };
}

function idParam(ctx: ParamsContext, key: "id" | "versionId"): string {
  const value = ctx.params[key] ?? "";
  if (!value) throw notFound("Not found");
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw badRequest(`${key} must be a string`);
  return value;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (value === undefined) throw badRequest(`${key} is required`);
  if (typeof value !== "string") throw badRequest(`${key} must be a string`);
  return value;
}

interface MovieScriptDetail {
  script: MovieScript;
  prompt: ReturnType<typeof scriptPrompt>;
  versions: ReturnType<typeof listScriptVersions>;
}

function scriptDetail(userId: number, id: string): MovieScriptDetail {
  const script = getMovieScript(id, userId);
  if (!script) throw notFound("Script not found");
  return {
    script,
    prompt: scriptPrompt(id, userId),
    versions: listScriptVersions(id, userId),
  };
}

export const scriptsRouter = new Router()
  .get("/api/v1/scripts", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    ctx.response.body = listMovieScripts(userId, {
      project_id: search.searchParams.get("project_id") ?? undefined,
    });
  })
  .post("/api/v1/scripts", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx).catch(() => ({} as Record<string, unknown>));
    const script = createMovieScript(userId, {
      project_id: optionalString(body, "project_id") ?? "",
      name: optionalString(body, "name") ?? "",
    });
    ctx.response.status = 201;
    ctx.response.body = script;
  })
  .get("/api/v1/scripts/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    ctx.response.body = scriptDetail(userId, idParam(ctx, "id"));
  })
  .patch("/api/v1/scripts/:id", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const script = updateMovieScript(userId, idParam(ctx, "id"), {
      name: optionalString(body, "name"),
      status: optionalString(body, "status"),
    });
    if (!script) throw notFound("Script not found");
    ctx.response.body = script;
  })
  .delete("/api/v1/scripts/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    if (!deleteMovieScript(userId, idParam(ctx, "id"))) {
      throw notFound("Script not found");
    }
    ctx.response.body = { deleted: true };
  })
  .post("/api/v1/scripts/:id/versions", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    await attachScriptPrompt(userId, idParam(ctx, "id"), requiredString(body, "content"));
    ctx.response.body = scriptDetail(userId, idParam(ctx, "id"));
  })
  .get("/api/v1/scripts/:id/versions", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const id = idParam(ctx, "id");
    if (!getMovieScript(id, userId)) throw notFound("Script not found");
    ctx.response.body = listScriptVersions(id, userId);
  })
  .post("/api/v1/scripts/:id/versions/:versionId/restore", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const id = idParam(ctx, "id");
    restoreScriptVersion(userId, id, idParam(ctx, "versionId"));
    ctx.response.body = scriptDetail(userId, id);
  });

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/scripts": {
    summary: "List accessible movie scripts",
    parameters: {
      project_id: { schema: { type: "string" } },
    },
    responses: {
      200: {
        description: "The movie scripts",
        schema: { type: "array", items: ref("MovieScript") },
      },
      ...errorResponses(401),
    },
  },
  "POST /api/v1/scripts": {
    summary: "Create a movie script",
    requestBody: {
      schema: {
        type: "object",
        required: ["project_id", "name"],
        properties: {
          project_id: { type: "string" },
          name: { type: "string" },
        },
      },
    },
    responses: {
      201: {
        description: "The movie script",
        schema: ref("MovieScript"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "GET /api/v1/scripts/{id}": {
    summary: "Get a movie script with its current text and version history",
    responses: {
      200: {
        description: "The script detail",
        schema: ref("MovieScriptDetail"),
      },
      ...errorResponses(401, 404),
    },
  },
  "PATCH /api/v1/scripts/{id}": {
    summary: "Update a movie script (name / status)",
    requestBody: {
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          status: { type: "string" },
        },
      },
    },
    responses: {
      200: {
        description: "The updated movie script",
        schema: ref("MovieScript"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "DELETE /api/v1/scripts/{id}": {
    summary: "Delete a movie script (soft delete)",
    responses: {
      200: {
        description: "Deletion confirmation",
        schema: {
          type: "object",
          properties: { deleted: { type: "boolean" } },
          required: ["deleted"],
        },
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/scripts/{id}/versions": {
    summary: "Save the script's text as a new version (manual edit or pasted content)",
    requestBody: {
      schema: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string", maxLength: 200000 },
        },
      },
    },
    responses: {
      200: {
        description: "The refreshed script detail",
        schema: ref("MovieScriptDetail"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "GET /api/v1/scripts/{id}/versions": {
    summary: "List a script's text versions (edit + generation history), newest first",
    responses: {
      200: {
        description: "The versions",
        schema: { type: "array", items: ref("PromptVersion") },
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/scripts/{id}/versions/{versionId}/restore": {
    summary: "Restore a historical version as a new version",
    responses: {
      200: {
        description: "The refreshed script detail",
        schema: ref("MovieScriptDetail"),
      },
      ...errorResponses(401, 404),
    },
  },
};
