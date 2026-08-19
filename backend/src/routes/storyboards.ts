import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  createPanel,
  createStoryboard,
  creativePrompt,
  deletePanel,
  deleteStoryboard,
  getPanel,
  getStoryboard,
  listPanels,
  listStoryboards,
  type PanelInput,
  updatePanel,
  updateStoryboard,
} from "@cinemaItor/db/storyboards.ts";
import { generatePanelPreview } from "@cinemaItor/services/creative_generation.ts";
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

interface ParamsContext extends AuthedContext {
  params: { id?: string; panelId?: string };
}

function idParam(ctx: ParamsContext, key: "id" | "panelId"): string {
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

function panelWithPrompt(userId: number, panelId: string) {
  const panel = getPanel(panelId, userId);
  if (!panel) throw notFound("Panel not found");
  return { ...panel, prompt: creativePrompt("storyboard_panel", panelId, userId) };
}

export const storyboardRouter = new Router()
  .get("/api/v1/storyboards", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    const boards = listStoryboards(userId, {
      project_id: search.searchParams.get("project_id") ?? undefined,
    });
    ctx.response.body = boards;
  })
  .post("/api/v1/storyboards", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx).catch(() => ({} as Record<string, unknown>));
    const board = createStoryboard(userId, {
      project_id: optionalString(body, "project_id") ?? "",
      name: optionalString(body, "name") ?? "",
      status: optionalString(body, "status"),
    });
    ctx.response.status = 201;
    ctx.response.body = board;
  })
  .get("/api/v1/storyboards/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const board = getStoryboard(idParam(ctx, "id"), userId);
    if (!board) throw notFound("Storyboard not found");
    const panels = listPanels(board.id, userId).map((p) => ({
      ...p,
      prompt: creativePrompt("storyboard_panel", p.id, userId),
    }));
    ctx.response.body = { storyboard: board, panels };
  })
  .patch("/api/v1/storyboards/:id", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const board = updateStoryboard(userId, idParam(ctx, "id"), {
      name: optionalString(body, "name"),
      status: optionalString(body, "status"),
    });
    if (!board) throw notFound("Storyboard not found");
    ctx.response.body = board;
  })
  .delete("/api/v1/storyboards/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    if (!deleteStoryboard(userId, idParam(ctx, "id"))) {
      throw notFound("Storyboard not found");
    }
    ctx.response.body = { deleted: true };
  })
  .get("/api/v1/storyboards/:id/panels", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    if (!getStoryboard(idParam(ctx, "id"), userId)) {
      throw notFound("Storyboard not found");
    }
    ctx.response.body = listPanels(idParam(ctx, "id"), userId).map((p) => ({
      ...p,
      prompt: creativePrompt("storyboard_panel", p.id, userId),
    }));
  })
  .post("/api/v1/storyboards/:id/panels", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const input: PanelInput = {
      panel_order: optionalInt(body, "panel_order") ?? 0,
      shot_number: optionalString(body, "shot_number"),
      description: optionalString(body, "description"),
      prompt: optionalString(body, "prompt"),
      duration: optionalNumber(body, "duration"),
      camera_settings: optionalJsonObject(body, "camera_settings"),
      mood: optionalString(body, "mood"),
      lighting: optionalString(body, "lighting"),
      time_of_day: optionalString(body, "time_of_day"),
      dialogue: optionalString(body, "dialogue"),
      voiceover: optionalString(body, "voiceover"),
      music_cue: optionalString(body, "music_cue"),
      sfx: optionalString(body, "sfx"),
      transition: optionalString(body, "transition"),
      notes: optionalString(body, "notes"),
      status: optionalString(body, "status"),
    };
    const panel = await createPanel(userId, idParam(ctx, "id"), input);
    ctx.response.status = 201;
    ctx.response.body = panelWithPrompt(userId, panel.id);
  })
  .patch("/api/v1/storyboards/:id/panels/:panelId", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const panel = await updatePanel(userId, idParam(ctx, "panelId"), {
      shot_number: optionalString(body, "shot_number"),
      description: optionalString(body, "description"),
      prompt: optionalString(body, "prompt"),
      duration: optionalNumber(body, "duration"),
      camera_settings: optionalJsonObject(body, "camera_settings"),
      mood: optionalString(body, "mood"),
      lighting: optionalString(body, "lighting"),
      time_of_day: optionalString(body, "time_of_day"),
      dialogue: optionalString(body, "dialogue"),
      voiceover: optionalString(body, "voiceover"),
      music_cue: optionalString(body, "music_cue"),
      sfx: optionalString(body, "sfx"),
      transition: optionalString(body, "transition"),
      notes: optionalString(body, "notes"),
      status: optionalString(body, "status"),
      linked_scene_id: optionalString(body, "linked_scene_id"),
      linked_shot_id: optionalString(body, "linked_shot_id"),
    });
    if (!panel) throw notFound("Panel not found");
    ctx.response.body = panelWithPrompt(userId, panel.id);
  })
  .delete(
    "/api/v1/storyboards/:id/panels/:panelId",
    authMiddleware,
    (ctx, _next) => {
      const userId = requireUserId(ctx);
      if (!deletePanel(userId, idParam(ctx, "panelId"))) {
        throw notFound("Panel not found");
      }
      ctx.response.body = { deleted: true };
    },
  )
  .post(
    "/api/v1/storyboards/:id/panels/:panelId/generate-preview",
    authMiddleware,
    async (ctx, _next) => {
      const userId = requireUserId(ctx);
      const body = await readJsonBody(ctx).catch(() => ({} as Record<string, unknown>));
      const result = generatePanelPreview(userId, idParam(ctx, "panelId"), {
        model_id: optionalString(body, "model_id"),
        seed: optionalString(body, "seed"),
        settings: optionalJsonObject(body, "settings"),
      });
      ctx.response.status = 202;
      ctx.response.body = result;
    },
  );
