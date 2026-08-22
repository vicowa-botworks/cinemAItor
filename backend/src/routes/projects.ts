import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  createProject,
  deleteProject,
  getProjectAccessible,
  getProjectById,
  hasProjectPermission,
  listProjects,
  type ProjectInput,
  type ProjectUpdates,
  updateProject,
} from "@cinemaItor/db/projects.ts";
import { applyTemplateStructure, getTemplate } from "@cinemaItor/db/templates.ts";
import { badRequest, forbidden, notFound, unauthorized } from "@cinemaItor/errors.ts";

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value) {
    throw badRequest(`${key} must be a string`);
  }
  return value;
}

function nullableString(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw badRequest(`${key} must be a string or null`);
  }
  return value;
}

function positiveInteger(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw badRequest(`${key} must be a positive integer`);
  }
  return value;
}

function positiveNumber(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw badRequest(`${key} must be a positive number`);
  }
  return value;
}

function modelPreferences(
  body: Record<string, unknown>,
): string | null | undefined {
  const value = body.default_model_preferences;
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    try {
      JSON.parse(value);
    } catch {
      throw badRequest("default_model_preferences must be valid JSON");
    }
    return value;
  }
  if (typeof value === "object") return JSON.stringify(value);
  throw badRequest("default_model_preferences must be an object or JSON string");
}

function requireName(body: Record<string, unknown>): string {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw badRequest("name is required");
  if (name.length > 200) throw badRequest("name must be at most 200 characters");
  return name;
}

function validateProjectInput(body: Record<string, unknown>): ProjectInput {
  return {
    name: requireName(body),
    description: optionalString(body, "description"),
    aspect_ratio: optionalString(body, "aspect_ratio"),
    frame_rate: positiveNumber(body, "frame_rate"),
    resolution_width: positiveInteger(body, "resolution_width"),
    resolution_height: positiveInteger(body, "resolution_height"),
    color_space: optionalString(body, "color_space"),
    audio_sample_rate: positiveInteger(body, "audio_sample_rate"),
    default_export_preset_id: optionalString(body, "default_export_preset_id"),
    default_model_preferences_json: modelPreferences(body),
    template_id: optionalString(body, "template_id"),
  };
}

function validateProjectUpdates(
  body: Record<string, unknown>,
): ProjectUpdates {
  const updates: ProjectUpdates = {};

  if ("name" in body) updates.name = requireName(body);
  if ("description" in body) updates.description = nullableString(body, "description");
  if ("aspect_ratio" in body) updates.aspect_ratio = optionalString(body, "aspect_ratio");
  if ("frame_rate" in body) updates.frame_rate = positiveNumber(body, "frame_rate");
  if ("resolution_width" in body) {
    updates.resolution_width = positiveInteger(body, "resolution_width");
  }
  if ("resolution_height" in body) {
    updates.resolution_height = positiveInteger(body, "resolution_height");
  }
  if ("color_space" in body) {
    updates.color_space = optionalString(body, "color_space");
  }
  if ("audio_sample_rate" in body) {
    updates.audio_sample_rate = positiveInteger(body, "audio_sample_rate");
  }
  if ("default_export_preset_id" in body) {
    updates.default_export_preset_id = nullableString(body, "default_export_preset_id");
  }
  if ("default_model_preferences" in body) {
    updates.default_model_preferences_json = modelPreferences(body);
  }
  if ("template_id" in body) {
    updates.template_id = nullableString(body, "template_id");
  }

  if (Object.keys(updates).length === 0) {
    throw badRequest("No valid project fields to update");
  }
  return updates;
}

export const projectRouter = new Router()
  .get("/api/v1/projects", authMiddleware, (ctx, _next) => {
    const userId = (ctx as AuthedContext).userId;
    if (!userId) throw unauthorized("Authentication required");
    ctx.response.body = listProjects(userId);
  })
  .post("/api/v1/projects", authMiddleware, async (ctx, _next) => {
    const userId = (ctx as AuthedContext).userId;
    if (!userId) throw unauthorized("Authentication required");
    const input = validateProjectInput(await readJsonBody(ctx));
    // An explicit template must exist before the project is created, and its
    // structure is materialized right after (compensated by project removal
    // if materialization fails).
    const template = input.template_id ? getTemplate(input.template_id) : undefined;
    if (input.template_id && !template) {
      throw badRequest(`unknown template_id: ${input.template_id}`);
    }
    const project = createProject(input, userId);
    if (template) {
      try {
        applyTemplateStructure(userId, project.id, template);
      } catch (error) {
        deleteProject(project.id, userId);
        throw error;
      }
    }
    ctx.response.status = 201;
    ctx.response.body = project;
  })
  .get("/api/v1/projects/:id", authMiddleware, (ctx, _next) => {
    const userId = (ctx as AuthedContext).userId;
    if (!userId) throw unauthorized("Authentication required");
    const project = getProjectAccessible(ctx.params.id, userId);
    if (!project) throw notFound("Project not found");
    ctx.response.body = project;
  })
  .patch("/api/v1/projects/:id", authMiddleware, async (ctx, _next) => {
    const userId = (ctx as AuthedContext).userId;
    if (!userId) throw unauthorized("Authentication required");

    const existing = getProjectById(ctx.params.id);
    if (!existing || existing.status === "deleted") {
      throw notFound("Project not found");
    }
    if (!hasProjectPermission(userId, ctx.params.id, "write")) {
      throw forbidden();
    }

    const updates = validateProjectUpdates(await readJsonBody(ctx));
    const project = updateProject(ctx.params.id, userId, updates);
    if (!project) throw notFound("Project not found");
    ctx.response.body = project;
  })
  .delete("/api/v1/projects/:id", authMiddleware, (ctx, _next) => {
    const userId = (ctx as AuthedContext).userId;
    if (!userId) throw unauthorized("Authentication required");

    const existing = getProjectById(ctx.params.id);
    if (!existing || existing.status === "deleted") {
      throw notFound("Project not found");
    }
    if (!hasProjectPermission(userId, ctx.params.id, "admin")) {
      throw forbidden();
    }

    const deleted = deleteProject(ctx.params.id, userId);
    if (!deleted) throw notFound("Project not found");
    ctx.response.body = { message: "Project deleted" };
  });
