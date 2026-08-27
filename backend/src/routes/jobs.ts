import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  createJob,
  type CreateJobInput,
  finishJob,
  getJob,
  JOB_STATUSES,
  type JobStatus,
  listJobEvents,
  listJobs,
  MODEL_TASK_TYPES,
  retryJob,
} from "@cinemaItor/db/jobs.ts";
import { canonicalTaskType, getModel } from "@cinemaItor/db/models.ts";
import {
  getAssetById,
  getAssetVersionByNumber,
  hasAssetPermission,
} from "@cinemaItor/db/assets.ts";
import { badRequest, notFound, unauthorized } from "@cinemaItor/errors.ts";
import { getUserById } from "@cinemaItor/db/schema.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { errorResponses, ref } from "@cinemaItor/openapi/types.ts";
import { verifyToken } from "@cinemaItor/services/jwt.ts";
import { isSessionValid } from "@cinemaItor/services/sessions.ts";
import { subscribeJobEvents } from "@cinemaItor/services/job_events.ts";

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

interface ParamContext extends AuthedContext {
  params: { id?: string };
}

function requireIdParam(ctx: ParamContext): string {
  const id = ctx.params.id ?? "";
  if (!id) throw notFound("Job not found");
  return id;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 100_000) {
    throw badRequest(`${key} must be a string of at most 100000 characters`);
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

function validateSettings(body: Record<string, unknown>): Record<string, unknown> {
  const settings = jsonObject(body, "settings") ?? {};
  const candidates = settings.candidates;
  if (
    candidates !== undefined &&
    (typeof candidates !== "number" || !Number.isInteger(candidates) ||
      candidates < 1 || candidates > 8)
  ) {
    throw badRequest("settings.candidates must be an integer between 1 and 8");
  }
  return settings;
}

function validateInputVersions(
  userId: number,
  body: Record<string, unknown>,
): CreateJobInput["input_asset_versions"] {
  const value = body.input_asset_versions;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw badRequest("input_asset_versions must be an array");
  }
  return value.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw badRequest(`input_asset_versions[${i}] must be an object`);
    }
    const e = entry as Record<string, unknown>;
    const assetId = e.asset_id;
    const versionNumber = e.version_number;
    if (typeof assetId !== "string" || !assetId) {
      throw badRequest(`input_asset_versions[${i}].asset_id is required`);
    }
    if (
      typeof versionNumber !== "number" || !Number.isInteger(versionNumber) ||
      versionNumber <= 0
    ) {
      throw badRequest(
        `input_asset_versions[${i}].version_number must be a positive integer`,
      );
    }
    const asset = getAssetById(assetId);
    if (!asset || asset.status === "deleted") {
      throw badRequest(`input_asset_versions[${i}]: asset not found`);
    }
    if (!hasAssetPermission(userId, assetId, "read")) {
      throw badRequest(`input_asset_versions[${i}]: no read access to asset`);
    }
    if (!getAssetVersionByNumber(assetId, versionNumber)) {
      throw badRequest(
        `input_asset_versions[${i}]: version ${versionNumber} does not exist`,
      );
    }
    return { asset_id: assetId, version_number: versionNumber as number };
  });
}

/**
 * WS handshake auth. Browsers cannot set the Authorization header on a
 * WebSocket, so the bearer token travels as a `?token=` query param and is
 * verified through the same path as the auth middleware.
 */
async function authenticateQueryToken(token: string | null): Promise<number> {
  if (!token) throw unauthorized("Authentication required");
  const payload = await verifyToken(token);
  if (!payload) throw unauthorized("Invalid or expired token");
  const user = getUserById(payload.sub);
  if (!user || !user.is_active) throw unauthorized("User not found or inactive");
  if (!payload.jti || !isSessionValid(payload.jti)) {
    throw unauthorized("Session revoked or expired");
  }
  return user.id;
}

export const jobRouter = new Router()
  .get("/ws/v1/jobs", async (ctx, _next) => {
    if (!ctx.isUpgradable) throw badRequest("WebSocket upgrade required");
    const search = ctx.request.url as unknown as URL;
    await authenticateQueryToken(search.searchParams.get("token"));
    const ws = ctx.upgrade();
    const unsubscribe = subscribeJobEvents((message) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    });
    // The client is read-only; inbound frames are ignored.
    ws.onmessage = () => {};
    ws.onclose = () => unsubscribe();
  })
  .get("/api/v1/jobs", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    const params = search.searchParams;
    const status = params.get("status") ?? undefined;
    if (status && !JOB_STATUSES.includes(status as JobStatus)) {
      throw badRequest(`status must be one of: ${JOB_STATUSES.join(", ")}`);
    }
    const limitRaw = params.get("limit");
    const jobs = listJobs({
      status: status as JobStatus | undefined,
      project_id: params.get("project_id") ?? undefined,
      model_id: params.get("model_id") ?? undefined,
      job_type: params.get("job_type") ?? undefined,
      limit: limitRaw ? Number(limitRaw) : undefined,
    });
    ctx.response.body = jobs;
  })
  .post("/api/v1/jobs", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);

    // Accept canonical task types plus HF-style dashed aliases (normalized).
    const rawJobType = body.job_type;
    const jobType = typeof rawJobType === "string" ? canonicalTaskType(rawJobType) : null;
    if (!jobType) {
      throw badRequest(`job_type must be one of: ${MODEL_TASK_TYPES.join(", ")}`);
    }
    const modelId = body.model_id;
    if (typeof modelId !== "string" || !modelId) {
      throw badRequest("model_id is required");
    }
    const model = getModel(modelId);
    if (!model) throw badRequest("Model not found");
    if (!model.enabled) throw badRequest("Model is disabled");
    if (!model.task_types.includes(jobType)) {
      throw badRequest(
        `Model '${model.name}' does not support task '${jobType}' (supports: ${
          model.task_types.join(", ")
        })`,
      );
    }

    const assetId = optionalString(body, "asset_id");
    if (assetId) {
      const asset = getAssetById(assetId);
      if (!asset || asset.status === "deleted") {
        throw badRequest("asset_id does not reference an existing asset");
      }
      if (!hasAssetPermission(userId, assetId, "write")) {
        throw badRequest("No write access to the target asset");
      }
    }

    const promptText = optionalString(body, "prompt_text");
    if (!promptText && !jobType.startsWith("image")) {
      throw badRequest("prompt_text is required for this job type");
    }

    const job = createJob(userId, {
      project_id: optionalString(body, "project_id"),
      asset_id: assetId,
      scene_id: optionalString(body, "scene_id"),
      shot_id: optionalString(body, "shot_id"),
      storyboard_panel_id: optionalString(body, "storyboard_panel_id"),
      prompt_version_id: optionalString(body, "prompt_version_id"),
      job_type: jobType,
      model_id: modelId,
      model_version: optionalString(body, "model_version"),
      prompt_text: promptText,
      negative_prompt: optionalString(body, "negative_prompt"),
      seed: optionalString(body, "seed"),
      settings: validateSettings(body),
      input_asset_versions: validateInputVersions(userId, body),
    });
    ctx.response.status = 201;
    ctx.response.body = { job };
  })
  .get("/api/v1/jobs/:id", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const job = getJob(requireIdParam(ctx));
    if (!job) throw notFound("Job not found");
    ctx.response.body = job;
  })
  .post("/api/v1/jobs/:id/cancel", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const id = requireIdParam(ctx);
    const job = getJob(id);
    if (!job) throw notFound("Job not found");

    if (job.status === "queued") {
      finishJob(id, "cancelled", { progress: 0 });
    } else if (job.status === "running") {
      finishJob(id, "cancelling");
    } else {
      throw badRequest(`Job cannot be cancelled (status: ${job.status})`);
    }
    const updated = getJob(id);
    if (!updated) throw notFound("Job not found");
    ctx.response.body = updated;
  })
  .post("/api/v1/jobs/:id/retry", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const id = requireIdParam(ctx);
    const job = getJob(id);
    if (!job) throw notFound("Job not found");
    const retried = retryJob(id);
    if (!retried) throw notFound("Job not found");
    ctx.response.body = retried;
  })
  .get("/api/v1/jobs/:id/events", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const id = requireIdParam(ctx);
    const job = getJob(id);
    if (!job) throw notFound("Job not found");
    ctx.response.body = listJobEvents(id);
  });

export const openApiOps: Record<string, OperationMeta> = {
  "GET /ws/v1/jobs": {
    summary: "Job event stream (WebSocket)",
    description: "Not a plain HTTP GET: upgrade to a WebSocket with the bearer " +
      "token as a `?token=` query parameter (browsers cannot set the " +
      "Authorization header on a socket). The server pushes job progress " +
      "and status frames plus render progress; the client is read-only.",
    responses: {
      200: {
        description: "WebSocket upgrade. Frames are JSON: job + render progress/status events",
      },
      401: {
        description: "Missing or invalid token in the query string",
        schema: ref("Error"),
      },
      400: {
        description: "Not a WebSocket upgrade request",
        schema: ref("Error"),
      },
    },
  },
  "GET /api/v1/jobs": {
    summary: "List generation jobs",
    parameters: {
      status: {
        schema: {
          type: "string",
          enum: [
            "queued",
            "running",
            "cancelling",
            "succeeded",
            "failed",
            "cancelled",
          ],
        },
      },
      project_id: { schema: { type: "string" } },
      model_id: { schema: { type: "string" } },
      job_type: {
        schema: {
          type: "string",
          enum: [
            "text_to_image",
            "image_to_image",
            "image_to_video",
            "text_to_video",
            "audio",
            "music",
            "voice",
            "transcribe",
            "proxy",
            "audio_cleanup",
          ],
        },
      },
      limit: { schema: { type: "integer", minimum: 1 } },
    },
    responses: {
      200: {
        description: "Jobs, newest first",
        schema: { type: "array", items: ref("Job") },
      },
      ...errorResponses(400, 401),
    },
  },
  "POST /api/v1/jobs": {
    summary: "Queue a model generation job",
    description: "The model must exist, be enabled, and support the job_type. " +
      "prompt_text is required for non-image tasks. The runner resolves " +
      "inputs and merges the model's default settings.",
    requestBody: { schema: ref("JobCreateRequest") },
    responses: {
      201: {
        description: "The queued job",
        schema: {
          type: "object",
          required: ["job"],
          properties: { job: { $ref: "#/components/schemas/Job" } },
        },
      },
      ...errorResponses(400, 401),
    },
  },
  "GET /api/v1/jobs/{id}": {
    summary: "Get one job",
    responses: {
      200: { description: "The job", schema: ref("Job") },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/jobs/{id}/cancel": {
    summary: "Cancel a queued or running job",
    description: "Queued jobs are cancelled immediately; running jobs move to " +
      "cancelling and settle on the next progress poll.",
    responses: {
      200: {
        description: "The job after the cancel request",
        schema: ref("Job"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "POST /api/v1/jobs/{id}/retry": {
    summary: "Re-queue a terminal job",
    responses: {
      200: {
        description: "The job after the retry",
        schema: ref("Job"),
      },
      ...errorResponses(401, 404),
    },
  },
  "GET /api/v1/jobs/{id}/events": {
    summary: "List a job's event log",
    responses: {
      200: {
        description: "Events, oldest first",
        schema: { type: "array", items: ref("JobEvent") },
      },
      ...errorResponses(401, 404),
    },
  },
};
