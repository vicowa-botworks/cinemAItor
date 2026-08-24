import { Router } from "@oak/oak/router";
import type { Context, Next } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  getReviewDecision,
  listCandidatesForJob,
  type ReviewDecision,
  setReviewDecision,
} from "@cinemaItor/db/reviews.ts";
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
  if (body.type() !== "json") return {};
  return await body.json() as Record<string, unknown>;
}

async function optionalNotes(ctx: Context): Promise<string | undefined> {
  const body = await readJsonBody(ctx);
  const notes = body.notes;
  if (notes !== undefined && typeof notes !== "string") {
    throw badRequest("notes must be a string");
  }
  return notes as string | undefined;
}

interface ParamsContext extends AuthedContext {
  params: { jobId?: string; versionId?: string };
}

function param(ctx: ParamsContext, key: "jobId" | "versionId"): string {
  const value = ctx.params[key] ?? "";
  if (!value) throw notFound("Not found");
  return value;
}

function makeDecisionRoute(decision: ReviewDecision) {
  return async (ctx: Context, _next: Next) => {
    const userId = requireUserId(ctx);
    const versionId = param(ctx as ParamsContext, "versionId");
    const notes = await optionalNotes(ctx);
    const row = setReviewDecision(userId, versionId, decision, notes);
    if (!row) throw notFound("Review decision not recorded");
    ctx.response.body = row;
  };
}

export const reviewRouter = new Router()
  .get("/api/v1/review/jobs/:jobId/candidates", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const jobId = param(ctx as ParamsContext, "jobId");
    const { job, candidates } = listCandidatesForJob(jobId, userId);
    ctx.response.body = {
      job: {
        id: job.id,
        job_type: job.job_type,
        status: job.status,
        progress: job.progress,
        prompt_text: job.prompt_text,
        seed: job.seed,
        settings: job.settings,
        model_id: job.model_id,
        asset_id: job.asset_id,
        created_at: job.created_at,
        finished_at: job.finished_at,
      },
      candidates,
    };
  })
  .post(
    "/api/v1/review/candidates/:versionId/approve",
    authMiddleware,
    makeDecisionRoute("approved"),
  )
  .post(
    "/api/v1/review/candidates/:versionId/reject",
    authMiddleware,
    makeDecisionRoute("rejected"),
  )
  .post("/api/v1/review/candidates/:versionId/shortlist", authMiddleware, async (
    ctx: Context,
    _next: Next,
  ) => {
    const userId = requireUserId(ctx);
    const versionId = param(ctx as ParamsContext, "versionId");
    const notes = await optionalNotes(ctx);
    const current = getReviewDecision(versionId);
    const toggledOff = current?.decision === "shortlisted";
    const row = setReviewDecision(
      userId,
      versionId,
      toggledOff ? null : "shortlisted",
      notes,
    );
    if (!toggledOff && !row) throw notFound("Review decision not recorded");
    ctx.response.body = { decision: row, toggled_off: toggledOff };
  });

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/review/jobs/{jobId}/candidates": {
    summary: "List the candidate versions of a job for review",
    responses: {
      200: {
        description: "Job summary and its candidates",
        schema: {
          type: "object",
          required: ["job", "candidates"],
          properties: {
            job: {
              type: "object",
              required: ["id", "job_type", "status", "progress"],
              properties: {
                id: { type: "string" },
                job_type: { type: "string" },
                status: { type: "string" },
                progress: { type: "number" },
                prompt_text: { type: ["string", "null"] },
                seed: { type: ["string", "null"] },
                settings: { type: "object", additionalProperties: true },
                model_id: { type: ["string", "null"] },
                asset_id: { type: ["string", "null"] },
                created_at: { type: "string" },
                finished_at: { type: ["string", "null"] },
              },
            },
            candidates: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "asset_version",
                  "asset",
                  "candidate_index",
                  "candidate_count",
                  "decision",
                ],
                properties: {
                  asset_version: { $ref: "#/components/schemas/AssetVersion" },
                  asset: {
                    type: "object",
                    required: ["id", "unique_slug", "display_name", "asset_type", "status"],
                    properties: {
                      id: { type: "string" },
                      unique_slug: { type: "string" },
                      display_name: { type: "string" },
                      asset_type: { type: "string" },
                      status: { type: "string" },
                    },
                  },
                  candidate_index: { type: "integer" },
                  candidate_count: { type: "integer" },
                  decision: { $ref: "#/components/schemas/ReviewDecision" },
                },
              },
            },
          },
        },
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/review/candidates/{versionId}/approve": {
    summary: "Approve a candidate (promotes it to the asset's active version)",
    requestBody: { schema: ref("ReviewNotesRequest") },
    responses: {
      200: {
        description: "The recorded decision",
        schema: ref("ReviewDecision"),
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "POST /api/v1/review/candidates/{versionId}/reject": {
    summary: "Reject a candidate",
    requestBody: { schema: ref("ReviewNotesRequest") },
    responses: {
      200: {
        description: "The recorded decision",
        schema: ref("ReviewDecision"),
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "POST /api/v1/review/candidates/{versionId}/shortlist": {
    summary: "Toggle a candidate's shortlist flag",
    description: "Shortlisting is a toggle: shortlisting an already-shortlisted " +
      "candidate clears the decision.",
    requestBody: { schema: ref("ReviewNotesRequest") },
    responses: {
      200: {
        description: "The resulting decision (null when toggled off)",
        schema: {
          type: "object",
          required: ["decision", "toggled_off"],
          properties: {
            decision: { $ref: "#/components/schemas/ReviewDecision" },
            toggled_off: { type: "boolean" },
          },
        },
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
};
