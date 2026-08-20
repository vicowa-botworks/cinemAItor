import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  createScene,
  createShot,
  creativePromptFor,
  deleteScene,
  deleteShot,
  getScene,
  getShot,
  listScenes,
  listShots,
  type SceneInput,
  type ShotInput,
  updateScene,
  updateShot,
} from "@cinemaItor/db/scenes.ts";
import { batchGenerateScene, generateScene } from "@cinemaItor/services/creative_generation.ts";
import { badRequest, notFound, unauthorized } from "@cinemaItor/errors.ts";

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

function readOptionalBody(ctx: Context): Promise<Record<string, unknown>> {
  return readJsonBody(ctx).catch(() => ({} as Record<string, unknown>));
}

interface ParamsContext extends AuthedContext {
  params: { id?: string; shotId?: string };
}

function idParam(ctx: ParamsContext, key: "id" | "shotId"): string {
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

function optionalNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${key} must be a number`);
  }
  return value;
}

function optionalInt(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`${key} must be an integer`);
  }
  return value;
}

function optionalJsonObject(
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

function sceneWithPrompt(userId: number, sceneId: string) {
  const scene = getScene(sceneId, userId);
  if (!scene) throw notFound("Scene not found");
  return { ...scene, prompt: creativePromptFor("scene", sceneId, userId) };
}

function shotWithPrompt(userId: number, shotId: string) {
  const shot = getShot(shotId, userId);
  if (!shot) throw notFound("Shot not found");
  return { ...shot, prompt: creativePromptFor("shot", shotId, userId) };
}

export const sceneRouter = new Router()
  .get("/api/v1/scenes", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    const scenes = listScenes(userId, {
      project_id: search.searchParams.get("project_id") ?? undefined,
      storyboard_id: search.searchParams.get("storyboard_id") ?? undefined,
    });
    ctx.response.body = scenes;
  })
  .post("/api/v1/scenes", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readOptionalBody(ctx);
    const input: SceneInput = {
      project_id: optionalString(body, "project_id") ?? "",
      name: optionalString(body, "name") ?? "",
      storyboard_id: optionalString(body, "storyboard_id"),
      description: optionalString(body, "description"),
      prompt: optionalString(body, "prompt"),
      status: optionalString(body, "status"),
      target_duration: optionalNumber(body, "target_duration"),
      aspect_ratio_override: optionalString(body, "aspect_ratio_override"),
      frame_rate_override: optionalNumber(body, "frame_rate_override"),
      notes: optionalString(body, "notes"),
      audio_plan: optionalJsonObject(body, "audio_plan"),
    };
    const scene = await createScene(userId, input);
    ctx.response.status = 201;
    ctx.response.body = sceneWithPrompt(userId, scene.id);
  })
  .get("/api/v1/scenes/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const scene = getScene(idParam(ctx, "id"), userId);
    if (!scene) throw notFound("Scene not found");
    ctx.response.body = {
      scene: sceneWithPrompt(userId, scene.id),
      shots: listShots(scene.id, userId).map((s) => shotWithPrompt(userId, s.id)),
    };
  })
  .patch("/api/v1/scenes/:id", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readOptionalBody(ctx);
    const scene = await updateScene(userId, idParam(ctx, "id"), {
      name: optionalString(body, "name"),
      description: optionalString(body, "description"),
      prompt: optionalString(body, "prompt"),
      status: optionalString(body, "status"),
      target_duration: optionalNumber(body, "target_duration"),
      aspect_ratio_override: optionalString(body, "aspect_ratio_override"),
      frame_rate_override: optionalNumber(body, "frame_rate_override"),
      notes: optionalString(body, "notes"),
      audio_plan: optionalJsonObject(body, "audio_plan"),
    });
    if (!scene) throw notFound("Scene not found");
    ctx.response.body = sceneWithPrompt(userId, scene.id);
  })
  .delete("/api/v1/scenes/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    if (!deleteScene(userId, idParam(ctx, "id"))) {
      throw notFound("Scene not found");
    }
    ctx.response.body = { deleted: true };
  })
  .get("/api/v1/scenes/:id/shots", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    if (!getScene(idParam(ctx, "id"), userId)) throw notFound("Scene not found");
    ctx.response.body = listShots(idParam(ctx, "id"), userId).map((s) =>
      shotWithPrompt(userId, s.id)
    );
  })
  .post("/api/v1/scenes/:id/shots", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const input: ShotInput = {
      shot_order: optionalInt(body, "shot_order") ?? 0,
      name: optionalString(body, "name"),
      prompt: optionalString(body, "prompt"),
      duration: optionalNumber(body, "duration"),
      camera_settings: optionalJsonObject(body, "camera_settings"),
      status: optionalString(body, "status"),
      notes: optionalString(body, "notes"),
    };
    const shot = await createShot(userId, idParam(ctx, "id"), input);
    ctx.response.status = 201;
    ctx.response.body = shotWithPrompt(userId, shot.id);
  })
  .patch("/api/v1/scenes/:id/shots/:shotId", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readOptionalBody(ctx);
    const shot = await updateShot(userId, idParam(ctx, "shotId"), {
      name: optionalString(body, "name"),
      prompt: optionalString(body, "prompt"),
      duration: optionalNumber(body, "duration"),
      camera_settings: optionalJsonObject(body, "camera_settings"),
      status: optionalString(body, "status"),
      notes: optionalString(body, "notes"),
    });
    if (!shot) throw notFound("Shot not found");
    ctx.response.body = shotWithPrompt(userId, shot.id);
  })
  .delete("/api/v1/scenes/:id/shots/:shotId", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    if (!deleteShot(userId, idParam(ctx, "shotId"))) {
      throw notFound("Shot not found");
    }
    ctx.response.body = { deleted: true };
  })
  .post("/api/v1/scenes/:id/generate", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readOptionalBody(ctx);
    const result = generateScene(userId, idParam(ctx, "id"), {
      model_id: optionalString(body, "model_id"),
      seed: optionalString(body, "seed"),
      settings: optionalJsonObject(body, "settings"),
    });
    ctx.response.status = 202;
    ctx.response.body = result;
  })
  .post("/api/v1/scenes/:id/batch-generate", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readOptionalBody(ctx);
    const result = batchGenerateScene(userId, idParam(ctx, "id"), {
      model_id: optionalString(body, "model_id"),
      seed: optionalString(body, "seed"),
      settings: optionalJsonObject(body, "settings"),
    });
    ctx.response.status = 202;
    ctx.response.body = result;
  });
