import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  bulkCreateScenes,
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
  type ScriptSceneInput,
  type ShotInput,
  updateScene,
  updateShot,
} from "@cinemaItor/db/scenes.ts";
import { getAssetVersion } from "@cinemaItor/db/assets.ts";
import { getProjectAccessible } from "@cinemaItor/db/projects.ts";
import { getLatestPromptVersionFor } from "@cinemaItor/db/prompt_versions.ts";
import { listPanels, listStoryboards } from "@cinemaItor/db/storyboards.ts";
import { batchGenerateScene, generateScene } from "@cinemaItor/services/creative_generation.ts";
import { analyzeContinuity, type ContinuityInput } from "@cinemaItor/services/continuity.ts";
import { badRequest, notFound, unauthorized } from "@cinemaItor/errors.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { deviceProperty, errorResponses, ref } from "@cinemaItor/openapi/types.ts";

function loadContinuityInput(projectId: string, userId: number): ContinuityInput {
  const boards = listStoryboards(userId, { project_id: projectId });
  const panels = boards.flatMap((board) =>
    listPanels(board.id, userId).map((p) => ({
      id: p.id,
      storyboard_name: board.name,
      panel_order: p.panel_order,
      time_of_day: p.time_of_day,
      lighting: p.lighting,
      linked_scene_id: p.linked_scene_id,
      linked_shot_id: p.linked_shot_id,
      prompt_created_at: getLatestPromptVersionFor("storyboard_panel", p.id, userId)?.created_at ??
        null,
      clip_created_at: p.generated_clip_asset_version_id
        ? getAssetVersion(p.generated_clip_asset_version_id)?.created_at ?? null
        : null,
    }))
  );
  const scenes = listScenes(userId, { project_id: projectId });
  const shots = scenes.flatMap((scene) =>
    listShots(scene.id, userId).map((s) => ({
      id: s.id,
      scene_id: scene.id,
      shot_order: s.shot_order,
      name: s.name,
      duration: s.duration,
      prompt_created_at: getLatestPromptVersionFor("shot", s.id, userId)?.created_at ?? null,
      clip_created_at: s.generated_asset_version_id
        ? getAssetVersion(s.generated_asset_version_id)?.created_at ?? null
        : null,
    }))
  );
  return {
    panels,
    scenes: scenes.map((s) => ({
      id: s.id,
      name: s.name,
      target_duration: s.target_duration,
    })),
    shots,
  };
}

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
  .post("/api/v1/projects/:id/scenes/from-script", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const projectId = idParam(ctx, "id");
    const body = await readJsonBody(ctx);
    if (!Array.isArray(body.scenes)) {
      throw badRequest("scenes must be an array");
    }
    const created = await bulkCreateScenes(userId, projectId, body.scenes as ScriptSceneInput[]);
    ctx.response.status = 201;
    ctx.response.body = { created: created.map((scene) => sceneWithPrompt(userId, scene.id)) };
  })
  .get("/api/v1/projects/:id/continuity", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const projectId = idParam(ctx, "id");
    if (!getProjectAccessible(projectId, userId, "read")) {
      throw notFound("Project not found");
    }
    const issues = analyzeContinuity(loadContinuityInput(projectId, userId));
    ctx.response.body = {
      project_id: projectId,
      generated_at: new Date().toISOString(),
      issue_count: issues.length,
      issues,
    };
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
      device: body.device,
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
      device: body.device,
      settings: optionalJsonObject(body, "settings"),
    });
    ctx.response.status = 202;
    ctx.response.body = result;
  });

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/scenes": {
    summary: "List accessible scenes",
    parameters: {
      project_id: { schema: { type: "string" } },
      storyboard_id: { schema: { type: "string" } },
    },
    responses: {
      200: {
        description: "The scenes",
        schema: { type: "array", items: ref("Scene") },
      },
      ...errorResponses(401),
    },
  },
  "POST /api/v1/scenes": {
    summary: "Create a scene",
    requestBody: { schema: ref("SceneInput") },
    responses: {
      201: {
        description: "The scene with its prompt",
        schema: ref("SceneWithPrompt"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "POST /api/v1/projects/{id}/scenes/from-script": {
    summary: "Bulk-create draft scenes from a parsed script (SCN-015)",
    description: "Accepts pre-parsed screenplay scenes (see the Fountain-lite " +
      "parser in the frontend) and creates them as draft scenes with " +
      "prompts. At most 200 entries.",
    requestBody: {
      schema: {
        type: "object",
        required: ["scenes"],
        properties: {
          scenes: {
            type: "array",
            items: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                prompt: { type: "string" },
                notes: { type: "string" },
              },
            },
          },
        },
      },
    },
    responses: {
      201: {
        description: "The created scenes with prompts",
        schema: {
          type: "object",
          required: ["created"],
          properties: {
            created: {
              type: "array",
              items: { $ref: "#/components/schemas/SceneWithPrompt" },
            },
          },
        },
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "GET /api/v1/projects/{id}/continuity": {
    summary: "Project continuity report (MS-8)",
    description: "Deterministic read-only analysis over the project's panels, " +
      "scenes and shots: link mismatches, time-of-day/lighting jumps, " +
      "stale clips, duration mismatches, unlinked panels.",
    responses: {
      200: {
        description: "The continuity report",
        schema: {
          type: "object",
          required: ["project_id", "generated_at", "issue_count", "issues"],
          properties: {
            project_id: { type: "string" },
            generated_at: { type: "string" },
            issue_count: { type: "integer" },
            issues: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "rule",
                  "severity",
                  "object_type",
                  "object_id",
                  "object_label",
                  "message",
                ],
                properties: {
                  rule: { type: "string" },
                  severity: { type: "string", enum: ["error", "warning", "info"] },
                  object_type: { type: "string", enum: ["panel", "scene", "shot"] },
                  object_id: { type: "string" },
                  object_label: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
      },
      ...errorResponses(401, 404),
    },
  },
  "GET /api/v1/scenes/{id}": {
    summary: "Get a scene with its shots and prompts",
    responses: {
      200: {
        description: "The scene and its shots",
        schema: {
          type: "object",
          required: ["scene", "shots"],
          properties: {
            scene: { $ref: "#/components/schemas/SceneWithPrompt" },
            shots: {
              type: "array",
              items: { $ref: "#/components/schemas/ShotWithPrompt" },
            },
          },
        },
      },
      ...errorResponses(401, 404),
    },
  },
  "PATCH /api/v1/scenes/{id}": {
    summary: "Update a scene",
    requestBody: { schema: ref("SceneInput") },
    responses: {
      200: {
        description: "The scene with its prompt",
        schema: ref("SceneWithPrompt"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "DELETE /api/v1/scenes/{id}": {
    summary: "Delete a scene",
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
  "GET /api/v1/scenes/{id}/shots": {
    summary: "List a scene's shots (with prompts)",
    responses: {
      200: {
        description: "The shots, ordered",
        schema: {
          type: "array",
          items: { $ref: "#/components/schemas/ShotWithPrompt" },
        },
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/scenes/{id}/shots": {
    summary: "Create a shot",
    requestBody: { schema: ref("ShotInput") },
    responses: {
      201: {
        description: "The shot with its prompt",
        schema: ref("ShotWithPrompt"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "PATCH /api/v1/scenes/{id}/shots/{shotId}": {
    summary: "Update a shot",
    requestBody: { schema: ref("ShotInput") },
    responses: {
      200: {
        description: "The shot with its prompt",
        schema: ref("ShotWithPrompt"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "DELETE /api/v1/scenes/{id}/shots/{shotId}": {
    summary: "Delete a shot",
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
  "POST /api/v1/scenes/{id}/generate": {
    summary: "Generate one clip for a scene (i2v/t2v, job queue)",
    requestBody: {
      schema: {
        type: "object",
        properties: {
          model_id: { type: "string" },
          seed: { type: "string" },
          device: deviceProperty(),
          settings: { type: "object", additionalProperties: true },
        },
      },
    },
    responses: {
      202: {
        description: "The queued job and its target",
        schema: ref("CreativeGenerateResult"),
      },
      ...errorResponses(400, 401, 404, 503),
    },
  },
  "POST /api/v1/scenes/{id}/batch-generate": {
    summary: "Generate clips for all of a scene's shots (job queue)",
    requestBody: {
      schema: {
        type: "object",
        properties: {
          model_id: { type: "string" },
          seed: { type: "string" },
          device: deviceProperty(),
          settings: { type: "object", additionalProperties: true },
        },
      },
    },
    responses: {
      202: {
        description: "The queued jobs and their targets",
        schema: ref("CreativeBatchGenerateResult"),
      },
      ...errorResponses(400, 401, 404, 503),
    },
  },
};
