import { Router } from "@oak/oak/router";
import type { Context, Next } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  createItem,
  createMarker,
  createSnapshot,
  createTimeline,
  createTrack,
  deleteItem,
  deleteMarker,
  deleteTimeline,
  deleteTrack,
  duplicateItem,
  getTimeline,
  type ItemInput,
  listItems,
  listMarkers,
  listSnapshots,
  listTimelines,
  listTracks,
  restoreSnapshot,
  type TrackInput,
  updateItem,
  updateTimeline,
  updateTrack,
} from "@cinemaItor/db/timelines.ts";
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
  params: {
    id?: string;
    trackId?: string;
    itemId?: string;
    markerId?: string;
    snapshotId?: string;
  };
}

function param(
  ctx: ParamsContext,
  key: "id" | "trackId" | "itemId" | "markerId" | "snapshotId",
): string {
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

function optionalBool(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw badRequest(`${key} must be a boolean`);
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

function optionalJsonArray(body: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw badRequest(`${key} must be a JSON array`);
  return value;
}

function itemInputFrom(body: Record<string, unknown>, partial = false): Partial<ItemInput> {
  return {
    track_id: partial ? optionalString(body, "track_id") : (body.track_id as string),
    asset_version_id: partial
      ? optionalString(body, "asset_version_id")
      : (body.asset_version_id as string),
    start_time: optionalNumber(body, "start_time"),
    end_time: optionalNumber(body, "end_time"),
    source_offset: optionalNumber(body, "source_offset"),
    speed: optionalNumber(body, "speed"),
    transform: optionalJsonObject(body, "transform"),
    fade_in: optionalNumber(body, "fade_in"),
    fade_out: optionalNumber(body, "fade_out"),
    transition: optionalString(body, "transition"),
    effect_chain: optionalJsonArray(body, "effect_chain"),
    color_grade: optionalJsonObject(body, "color_grade"),
    audio_settings: optionalJsonObject(body, "audio_settings"),
    notes: optionalString(body, "notes"),
  };
}

function requireTimeline(id: string, userId: number, required: "read" | "write" = "write") {
  const timeline = getTimeline(id, userId, required);
  if (!timeline) throw notFound("Timeline not found");
  return timeline;
}

function timelineDetail(timelineId: string, userId: number) {
  const timeline = requireTimeline(timelineId, userId, "read");
  return {
    timeline,
    tracks: listTracks(timelineId, userId).map((track) => ({
      ...track,
      items: listItems(timelineId, userId).filter((i) => i.track_id === track.id),
    })),
    markers: listMarkers(timelineId, userId),
  };
}

export const timelineRouter = new Router()
  .get("/api/v1/timelines", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    ctx.response.body = listTimelines(userId, {
      project_id: search.searchParams.get("project_id") ?? undefined,
    });
  })
  .post("/api/v1/timelines", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const timeline = createTimeline(userId, {
      project_id: optionalString(body, "project_id") ?? "",
      name: optionalString(body, "name") ?? "",
      settings: optionalJsonObject(body, "settings"),
    });
    ctx.response.status = 201;
    ctx.response.body = timeline;
  })
  .get("/api/v1/timelines/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    ctx.response.body = timelineDetail(param(ctx as ParamsContext, "id"), userId);
  })
  .patch("/api/v1/timelines/:id", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readOptionalBody(ctx);
    const id = param(ctx as ParamsContext, "id");
    const timeline = updateTimeline(userId, id, {
      name: optionalString(body, "name"),
      duration: optionalNumber(body, "duration"),
      settings: optionalJsonObject(body, "settings"),
    });
    if (!timeline) throw notFound("Timeline not found");
    ctx.response.body = timeline;
  })
  .delete("/api/v1/timelines/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    if (!deleteTimeline(userId, param(ctx as ParamsContext, "id"))) {
      throw notFound("Timeline not found");
    }
    ctx.response.body = { deleted: true };
  })
  .post("/api/v1/timelines/:id/tracks", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const input: TrackInput = {
      track_type: optionalString(body, "track_type") ?? "",
      name: optionalString(body, "name") ?? "",
      track_order: optionalInt(body, "track_order"),
      locked: optionalBool(body, "locked"),
      muted: optionalBool(body, "muted"),
    };
    const track = createTrack(userId, param(ctx as ParamsContext, "id"), input);
    ctx.response.status = 201;
    ctx.response.body = track;
  })
  .patch(
    "/api/v1/timelines/:id/tracks/:trackId",
    authMiddleware,
    async (ctx: Context, _next: Next) => {
      const userId = requireUserId(ctx);
      const body = await readOptionalBody(ctx);
      const timelineId = param(ctx as ParamsContext, "id");
      const trackId = param(ctx as ParamsContext, "trackId");
      requireTimeline(timelineId, userId);
      const track = updateTrack(
        userId,
        timelineId,
        trackId,
        {
          name: optionalString(body, "name"),
          track_order: optionalInt(body, "track_order"),
          locked: optionalBool(body, "locked"),
          muted: optionalBool(body, "muted"),
        },
      );
      if (!track) throw notFound("Track not found");
      ctx.response.body = track;
    },
  )
  .delete(
    "/api/v1/timelines/:id/tracks/:trackId",
    authMiddleware,
    (ctx, _next) => {
      const userId = requireUserId(ctx);
      const timelineId = param(ctx as ParamsContext, "id");
      requireTimeline(timelineId, userId);
      if (
        !deleteTrack(userId, timelineId, param(ctx as ParamsContext, "trackId"))
      ) {
        throw notFound("Track not found");
      }
      ctx.response.body = { deleted: true };
    },
  )
  .post("/api/v1/timelines/:id/items", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const timelineId = param(ctx as ParamsContext, "id");
    requireTimeline(timelineId, userId);
    if (
      body.track_id === undefined || body.asset_version_id === undefined ||
      body.start_time === undefined || body.end_time === undefined
    ) {
      throw badRequest(
        "track_id, asset_version_id, start_time and end_time are required",
      );
    }
    const item = createItem(
      userId,
      timelineId,
      itemInputFrom(body) as ItemInput,
    );
    ctx.response.status = 201;
    ctx.response.body = item;
  })
  .patch(
    "/api/v1/timelines/:id/items/:itemId",
    authMiddleware,
    async (ctx: Context, _next: Next) => {
      const userId = requireUserId(ctx);
      const body = await readOptionalBody(ctx);
      const timelineId = param(ctx as ParamsContext, "id");
      requireTimeline(timelineId, userId);
      const item = updateItem(
        userId,
        timelineId,
        param(ctx as ParamsContext, "itemId"),
        { ...itemInputFrom(body, true), status: optionalString(body, "status") },
      );
      if (!item) throw notFound("Item not found");
      ctx.response.body = item;
    },
  )
  .post(
    "/api/v1/timelines/:id/items/:itemId/duplicate",
    authMiddleware,
    async (ctx: Context, _next: Next) => {
      const userId = requireUserId(ctx);
      const body = await readOptionalBody(ctx);
      const timelineId = param(ctx as ParamsContext, "id");
      requireTimeline(timelineId, userId);
      const item = duplicateItem(
        userId,
        timelineId,
        param(ctx as ParamsContext, "itemId"),
        optionalNumber(body, "at_time"),
      );
      ctx.response.status = 201;
      ctx.response.body = item;
    },
  )
  .delete(
    "/api/v1/timelines/:id/items/:itemId",
    authMiddleware,
    (ctx, _next) => {
      const userId = requireUserId(ctx);
      const timelineId = param(ctx as ParamsContext, "id");
      requireTimeline(timelineId, userId);
      if (
        !deleteItem(userId, timelineId, param(ctx as ParamsContext, "itemId"))
      ) {
        throw notFound("Item not found");
      }
      ctx.response.body = { deleted: true };
    },
  )
  .post("/api/v1/timelines/:id/markers", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const timelineId = param(ctx as ParamsContext, "id");
    requireTimeline(timelineId, userId);
    const time = optionalNumber(body, "time");
    if (time === undefined) throw badRequest("time is required");
    const marker = createMarker(userId, timelineId, {
      time,
      label: optionalString(body, "label"),
      notes: optionalString(body, "notes"),
    });
    ctx.response.status = 201;
    ctx.response.body = marker;
  })
  .get("/api/v1/timelines/:id/markers", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const timelineId = param(ctx as ParamsContext, "id");
    requireTimeline(timelineId, userId, "read");
    ctx.response.body = listMarkers(timelineId, userId);
  })
  .delete(
    "/api/v1/timelines/:id/markers/:markerId",
    authMiddleware,
    (ctx, _next) => {
      const userId = requireUserId(ctx);
      const timelineId = param(ctx as ParamsContext, "id");
      requireTimeline(timelineId, userId);
      if (
        !deleteMarker(userId, timelineId, param(ctx as ParamsContext, "markerId"))
      ) {
        throw notFound("Marker not found");
      }
      ctx.response.body = { deleted: true };
    },
  )
  .post("/api/v1/timelines/:id/snapshots", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const timelineId = param(ctx as ParamsContext, "id");
    requireTimeline(timelineId, userId);
    const snapshot = createSnapshot(userId, timelineId, {
      name: optionalString(body, "name") ?? "",
      notes: optionalString(body, "notes"),
    });
    ctx.response.status = 201;
    ctx.response.body = snapshot;
  })
  .get("/api/v1/timelines/:id/snapshots", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const timelineId = param(ctx as ParamsContext, "id");
    requireTimeline(timelineId, userId, "read");
    ctx.response.body = listSnapshots(timelineId, userId);
  })
  .post(
    "/api/v1/timelines/:id/snapshots/:snapshotId/restore",
    authMiddleware,
    (ctx: Context, _next: Next) => {
      const userId = requireUserId(ctx);
      const timelineId = param(ctx as ParamsContext, "id");
      requireTimeline(timelineId, userId);
      restoreSnapshot(
        userId,
        timelineId,
        param(ctx as ParamsContext, "snapshotId"),
      );
      ctx.response.body = timelineDetail(timelineId, userId);
    },
  );
