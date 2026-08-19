import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { storageLayout } from "@cinemaItor/storage/paths.ts";
import { loadConfig } from "@cinemaItor/config.ts";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { getUserById } from "@cinemaItor/db/schema.ts";
import {
  deleteModel,
  getModel,
  listModels,
  MODEL_SOURCES,
  registerModel,
  type RegisterModelInput,
  setModelHealth,
  setModelInstalled,
  updateModel,
  type UpdateModelInput,
} from "@cinemaItor/db/models.ts";
import {
  installFromLocal,
  installFromUrl,
  removeModelFiles,
  verifyModelFile,
} from "@cinemaItor/services/model_files.ts";
import { checkModelHealth } from "@cinemaItor/services/model_health.ts";
import { detectHardware, modelRequirementWarnings } from "@cinemaItor/services/hardware.ts";
import { badRequest, forbidden, notFound, unauthorized } from "@cinemaItor/errors.ts";

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

function requireAdmin(ctx: Context): number {
  const userId = requireUserId(ctx);
  const user = getUserById(userId);
  if (!user || user.role !== "admin") {
    throw forbidden("Admin role required for model management");
  }
  return userId;
}

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

interface ParamContext extends AuthedContext {
  params: { id?: string };
}

function requireIdParam(ctx: ParamContext): string {
  const id = ctx.params.id ?? "";
  if (!id) throw notFound("Model not found");
  return id;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalInt(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw badRequest(`${key} must be a non-negative integer`);
  }
  return value;
}

function stringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw badRequest(`${key} must be an array of strings`);
  }
  return value;
}

function numberArray(body: Record<string, unknown>, key: string): number[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "number" || v < 0)) {
    throw badRequest(`${key} must be an array of non-negative numbers`);
  }
  return value;
}

function jsonObject(
  body: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${key} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function optionalBool(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw badRequest(`${key} must be a boolean`);
  return value;
}

function layout() {
  return storageLayout(loadConfig().appDataDir);
}

export const modelRouter = new Router()
  .get("/api/v1/models", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    const params = search.searchParams;
    const enabledParam = params.get("enabled");
    const models = listModels({
      enabled: enabledParam === "true" ? true : enabledParam === "false" ? false : undefined,
      task_type: params.get("task_type") ?? undefined,
      query: params.get("query") ?? undefined,
    });
    ctx.response.body = models;
  })
  .post("/api/v1/models", authMiddleware, async (ctx, _next) => {
    const userId = requireAdmin(ctx);
    const body = await readJsonBody(ctx);
    const input: RegisterModelInput = {
      name: optionalString(body, "name") ?? "",
      version: optionalString(body, "version") ?? "",
      backend: optionalString(body, "backend") as RegisterModelInput["backend"],
      source: optionalString(body, "source") as RegisterModelInput["source"],
      repository_url: optionalString(body, "repository_url"),
      source_path: optionalString(body, "source_path"),
      license: optionalString(body, "license"),
      task_types: stringArray(body, "task_types"),
      input_types: stringArray(body, "input_types"),
      output_types: stringArray(body, "output_types"),
      supported_resolutions: stringArray(body, "supported_resolutions"),
      supported_frame_rates: numberArray(body, "supported_frame_rates"),
      supported_duration: numberArray(body, "supported_duration"),
      vram_requirement_mb: optionalInt(body, "vram_requirement_mb"),
      ram_requirement_mb: optionalInt(body, "ram_requirement_mb"),
      dependencies: stringArray(body, "dependencies"),
      default_settings: jsonObject(body, "default_settings"),
      known_limitations: stringArray(body, "known_limitations"),
      enabled: optionalBool(body, "enabled"),
    };
    if (
      input.source !== undefined &&
      !MODEL_SOURCES.includes(input.source as (typeof MODEL_SOURCES)[number])
    ) {
      throw badRequest(`source must be one of: ${MODEL_SOURCES.join(", ")}`);
    }
    const model = registerModel(userId, input);
    ctx.response.status = 201;
    ctx.response.body = model;
  })
  .get("/api/v1/models/hardware", authMiddleware, async (ctx, _next) => {
    requireUserId(ctx);
    const hardware = await detectHardware();
    const warnings = (
      await Promise.all(
        listModels({ enabled: true }).map((m) => modelRequirementWarnings(m, hardware)),
      )
    ).flat();
    ctx.response.body = { hardware, warnings };
  })
  .get("/api/v1/models/:id", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const model = getModel(requireIdParam(ctx));
    if (!model) throw notFound("Model not found");
    ctx.response.body = model;
  })
  .patch("/api/v1/models/:id", authMiddleware, async (ctx, _next) => {
    const userId = requireAdmin(ctx);
    const id = requireIdParam(ctx);
    if (!getModel(id)) throw notFound("Model not found");
    const body = await readJsonBody(ctx);
    const patch: UpdateModelInput = {
      name: optionalString(body, "name"),
      version: optionalString(body, "version"),
      license: optionalString(body, "license"),
      backend: optionalString(body, "backend") as UpdateModelInput["backend"],
      repository_url: optionalString(body, "repository_url"),
      source_path: optionalString(body, "source_path"),
      task_types: stringArray(body, "task_types"),
      input_types: stringArray(body, "input_types"),
      output_types: stringArray(body, "output_types"),
      supported_resolutions: stringArray(body, "supported_resolutions"),
      supported_frame_rates: numberArray(body, "supported_frame_rates"),
      supported_duration: numberArray(body, "supported_duration"),
      vram_requirement_mb: optionalInt(body, "vram_requirement_mb"),
      ram_requirement_mb: optionalInt(body, "ram_requirement_mb"),
      dependencies: stringArray(body, "dependencies"),
      default_settings: jsonObject(body, "default_settings"),
      known_limitations: stringArray(body, "known_limitations"),
      enabled: optionalBool(body, "enabled"),
    };
    const updated = updateModel(userId, id, patch);
    if (!updated) throw notFound("Model not found");
    ctx.response.body = updated;
  })
  .delete("/api/v1/models/:id", authMiddleware, async (ctx, _next) => {
    const userId = requireAdmin(ctx);
    const id = requireIdParam(ctx);
    const model = getModel(id);
    if (!model) throw notFound("Model not found");
    deleteModel(userId, id);
    await removeModelFiles(layout(), id);
    ctx.response.body = { deleted: true, id };
  })
  .post("/api/v1/models/:id/install", authMiddleware, async (ctx, _next) => {
    requireAdmin(ctx);
    const id = requireIdParam(ctx);
    const model = getModel(id);
    if (!model) throw notFound("Model not found");

    const body = await readJsonBody(ctx);
    const sourcePath = optionalString(body, "source_path") ?? model.source_path ?? undefined;
    const repositoryUrl = optionalString(body, "repository_url") ?? model.repository_url ??
      undefined;
    const consent = optionalBool(body, "consent");

    const lay = layout();
    let result;
    if (sourcePath) {
      result = await installFromLocal(lay, id, sourcePath);
    } else if (repositoryUrl) {
      // MOD-013: network model sources require explicit consent.
      if (consent !== true) {
        throw badRequest(
          "Installing from a network source requires explicit consent (consent: true)",
          "consent",
        );
      }
      result = await installFromUrl(lay, id, repositoryUrl, loadConfig().uploadMaxBytes);
    } else if (model.source === "mock" || model.backend === "mock") {
      setModelInstalled(id, model.file_hash ?? "");
      result = { fileHash: model.file_hash ?? "", fileBytes: 0 };
    } else {
      throw badRequest(
        "No installation source: provide source_path or repository_url on the model",
      );
    }

    const installed = setModelInstalled(id, result.fileHash);
    if (!installed) throw notFound("Model not found");
    ctx.response.status = 201;
    ctx.response.body = { model: installed, install: result };
  })
  .post("/api/v1/models/:id/verify", authMiddleware, async (ctx, _next) => {
    requireUserId(ctx);
    const id = requireIdParam(ctx);
    const model = getModel(id);
    if (!model) throw notFound("Model not found");

    const lay = layout();
    const result = await verifyModelFile(lay, id, model.file_hash);
    let storedModel = model;
    if (result.valid && !model.file_hash && result.fileHash) {
      storedModel = setModelInstalled(id, result.fileHash) ?? model;
    }
    ctx.response.body = { ...result, model: storedModel };
  })
  .post("/api/v1/models/:id/health-check", authMiddleware, async (ctx, _next) => {
    requireUserId(ctx);
    const id = requireIdParam(ctx);
    const model = getModel(id);
    if (!model) throw notFound("Model not found");

    const result = await checkModelHealth(layout(), model);
    const updated = setModelHealth(
      id,
      result.status,
      result.status === "ok" ? null : result.message,
    );
    if (!updated) throw notFound("Model not found");
    ctx.response.body = { ...result, model: updated };
  });
