import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { getUserById } from "@cinemaItor/db/schema.ts";
import { getDb } from "@cinemaItor/db/database.ts";
import { getProjectAccessible } from "@cinemaItor/db/projects.ts";
import {
  cancelRenderJob,
  createPreset,
  createRenderJob,
  getRenderJob,
  listPresets,
  listRenderEvents,
  type PresetInput,
} from "@cinemaItor/db/renders.ts";
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
    throw forbidden("Admin role required for preset management");
  }
  return userId;
}

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") return {};
  return (await body.json()) as Record<string, unknown>;
}

interface ParamsContext extends AuthedContext {
  params: { id?: string };
}

function idParam(ctx: ParamsContext): string {
  const value = ctx.params.id ?? "";
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

function renderJobBody(job: ReturnType<typeof getRenderJob>) {
  if (!job) return undefined;
  return {
    id: job.id,
    project_id: job.project_id,
    timeline_id: job.timeline_id,
    preset_id: job.preset_id,
    engine: job.engine,
    status: job.status,
    progress: job.progress,
    error_text: job.error_text,
    output_path: job.output_path,
    validation_report: job.validation_report,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
  };
}

export const renderRouter = new Router()
  .get("/api/v1/render-presets", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    ctx.response.body = listPresets();
  })
  .post("/api/v1/render-presets", authMiddleware, async (ctx, _next) => {
    const userId = requireAdmin(ctx);
    const body = await readJsonBody(ctx);
    const input: PresetInput = {
      name: optionalString(body, "name") ?? "",
      kind: (body.kind as "draft" | "final") ?? "final",
      output_format: optionalString(body, "output_format") ?? "",
      resolution: optionalString(body, "resolution"),
      frame_rate: optionalNumber(body, "frame_rate"),
      codec: optionalString(body, "codec"),
      audio_codec: optionalString(body, "audio_codec"),
      bitrate: optionalString(body, "bitrate"),
      settings: optionalJsonObject(body, "settings"),
    };
    const preset = createPreset(userId, input);
    ctx.response.status = 201;
    ctx.response.body = preset;
  })
  .post("/api/v1/renders", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const job = createRenderJob(userId, {
      project_id: optionalString(body, "project_id") ?? "",
      timeline_id: optionalString(body, "timeline_id") ?? "",
      preset_id: optionalString(body, "preset_id"),
    });
    ctx.response.status = 202;
    ctx.response.body = renderJobBody(job);
  })
  .get("/api/v1/renders/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const job = getRenderJob(idParam(ctx as ParamsContext), userId);
    if (!job) throw notFound("Render job not found");
    ctx.response.body = renderJobBody(job);
  })
  .get("/api/v1/renders/:id/log", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const id = idParam(ctx as ParamsContext);
    const events = listRenderEvents(id, userId);
    ctx.response.body = events;
  })
  .post("/api/v1/renders/:id/cancel", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const id = idParam(ctx as ParamsContext);
    const existing = getRenderJob(id, userId);
    if (!existing) throw notFound("Render job not found");
    const job = cancelRenderJob(id);
    if (!job) throw notFound("Render job not found");
    if (job.status === "cancelled" || job.status === "cancelling") {
      ctx.response.body = renderJobBody(job);
    } else {
      ctx.response.status = 202;
      ctx.response.body = renderJobBody(job);
    }
  })
  .get("/api/v1/exports", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    const params = search.searchParams;
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (params.get("project_id")) {
      clauses.push("project_id = ?");
      values.push(params.get("project_id"));
    }
    if (params.get("render_job_id")) {
      clauses.push("render_job_id = ?");
      values.push(params.get("render_job_id"));
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = (
      getDb()
        .prepare(
          `SELECT * FROM exports ${where}
           ORDER BY created_at DESC
           LIMIT 200`,
        )
        .all as (...values: unknown[]) => unknown[]
    )(...values) as Record<string, unknown>[];

    // Scope to projects this user can read.
    const visible = rows.filter((row) =>
      getProjectAccessible(row.project_id as string, userId, "read") !== undefined
    );
    ctx.response.body = visible.map((row) => ({
      id: row.id as string,
      project_id: row.project_id as string,
      render_job_id: row.render_job_id as string,
      asset_id: (row.asset_id as string | null) ?? null,
      asset_version_id: (row.asset_version_id as string | null) ?? null,
      file_path: row.file_path as string,
      format: row.format as string,
      settings: row.settings_json ? JSON.parse(row.settings_json as string) : null,
      created_at: row.created_at as string,
    }));
  });
