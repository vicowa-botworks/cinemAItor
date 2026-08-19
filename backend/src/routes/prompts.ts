import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  getLatestPromptVersionFor,
  getPromptVersion,
  listPromptVersions,
  restorePromptVersion,
  savePromptVersion,
} from "@cinemaItor/db/prompt_versions.ts";
import { listReferencesForSource } from "@cinemaItor/db/references.ts";
import { badRequest, notFound, unauthorized } from "@cinemaItor/errors.ts";

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

function nonEmptyString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${key} is required`);
  }
  return value;
}

function rolesMap(body: Record<string, unknown>): Record<string, string> {
  const value = body.roles;
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("roles must be an object mapping slug to role");
  }
  const roles: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "string" || !v) {
      throw badRequest(`roles.${k} must be a non-empty string`);
    }
    roles[k] = v;
  }
  return roles;
}

function maxContentLength(body: Record<string, unknown>, max = 100_000): void {
  const value = body.content;
  if (typeof value === "string" && value.length > max) {
    throw badRequest(`content must be at most ${max} characters`);
  }
}

function promptDetail(version: {
  id: string;
  scope_type: string;
  version_number: number;
}): Record<string, unknown> {
  return {
    ...version,
    references: listReferencesForSource(version.scope_type, version.id),
  };
}

interface ParamContext extends AuthedContext {
  params: { scope_type?: string; scope_id?: string; id?: string };
}

function requireScopeParams(ctx: ParamContext): {
  scope_type: string;
  scope_id: string;
} {
  const scopeType = ctx.params.scope_type ?? "";
  const scopeId = ctx.params.scope_id ?? "";
  if (!scopeType || !scopeId) throw notFound("Prompt scope not found");
  return { scope_type: scopeType, scope_id: scopeId };
}

function requireIdParam(ctx: ParamContext): string {
  const id = ctx.params.id ?? "";
  if (!id) throw notFound("Prompt version not found");
  return id;
}

export const promptRouter = new Router()
  .post("/api/v1/prompts", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const scopeType = nonEmptyString(body, "scope_type");
    const scopeId = nonEmptyString(body, "scope_id");
    maxContentLength(body);
    const saved = await savePromptVersion(
      userId,
      scopeType,
      scopeId,
      body.content as string,
      rolesMap(body),
    );
    ctx.response.status = saved.duplicate ? 200 : 201;
    ctx.response.body = {
      version: saved.version,
      duplicate: saved.duplicate,
      warnings: saved.warnings,
      references: saved.references,
    };
  })
  .get(
    "/api/v1/prompts/:scope_type/:scope_id",
    authMiddleware,
    (ctx, _next) => {
      const userId = requireUserId(ctx);
      const { scope_type, scope_id } = requireScopeParams(ctx);
      const versions = listPromptVersions(scope_type, scope_id, userId);
      ctx.response.body = versions;
    },
  )
  .get(
    "/api/v1/prompts/:scope_type/:scope_id/latest",
    authMiddleware,
    (ctx, _next) => {
      const userId = requireUserId(ctx);
      const { scope_type, scope_id } = requireScopeParams(ctx);
      const latest = getLatestPromptVersionFor(scope_type, scope_id, userId);
      if (!latest) throw notFound("No prompt versions for this scope");
      ctx.response.body = promptDetail(latest);
    },
  )
  .get("/api/v1/prompts/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const version = getPromptVersion(requireIdParam(ctx), userId);
    if (!version) throw notFound("Prompt version not found");
    ctx.response.body = promptDetail(version);
  })
  .post("/api/v1/prompts/:id/restore", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const existing = getPromptVersion(requireIdParam(ctx), userId);
    if (!existing) throw notFound("Prompt version not found");

    const saved = await restorePromptVersion(userId, existing.id);
    ctx.response.status = saved.duplicate ? 200 : 201;
    ctx.response.body = {
      version: saved.version,
      duplicate: saved.duplicate,
      warnings: saved.warnings,
      references: saved.references,
    };
  });
