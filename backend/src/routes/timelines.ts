import { Router } from "@oak/oak/router";
import type { Context, Next } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  createItem,
  createMarker,
  createSnapshot,
  createTimeline,
  createTrack,
  DEFAULT_TRANSITION_DURATION,
  deleteItem,
  deleteMarker,
  deleteTimeline,
  deleteTrack,
  DUCK_DB_MAX,
  DUCK_DB_MIN,
  duplicateItem,
  GAIN_DB_MAX,
  GAIN_DB_MIN,
  getTimeline,
  type ItemInput,
  listItems,
  listMarkers,
  listSnapshots,
  listTimelines,
  listTracks,
  MAX_ITEMS_PER_TIMELINE,
  MAX_TRACKS,
  replaceTimelineState,
  restoreSnapshot,
  type SnapshotData,
  type Timeline,
  type TimelineItem,
  type TimelineMarker,
  type Track,
  TRACK_TYPES,
  type TrackInput,
  updateItem,
  updateTimeline,
  updateTrack,
  validateItemFx,
  validatePlacement,
  validateTextOverlay,
  validateVersionForTrack,
  VIDEO_TRACK_TYPES,
} from "@cinemaItor/db/timelines.ts";
import { listPanels, listStoryboards } from "@cinemaItor/db/storyboards.ts";
import { generateAudio } from "@cinemaItor/services/creative_generation.ts";
import { type ScoreInput, suggestScore } from "@cinemaItor/services/score_suggestion.ts";
import { badRequest, notFound, unauthorized } from "@cinemaItor/errors.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { deviceProperty, errorResponses, ref } from "@cinemaItor/openapi/types.ts";

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

/** Like optionalString but `null` is accepted (clears the field on updates). */
function optionalNullableString(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw badRequest(`${key} must be a string`);
  return value;
}

/** Like optionalNumber but `null` is accepted (clears the field on updates). */
function optionalNullableNumber(
  body: Record<string, unknown>,
  key: string,
): number | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${key} must be a number`);
  }
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
  const value = optionalNullableJsonObject(body, key);
  return value === null ? undefined : value;
}

function optionalNullableJsonObject(
  body: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${key} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function optionalNullableJsonArray(
  body: Record<string, unknown>,
  key: string,
): unknown[] | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) throw badRequest(`${key} must be a JSON array`);
  return value;
}

function itemInputFrom(body: Record<string, unknown>, partial = false): Partial<ItemInput> {
  return {
    track_id: partial ? optionalString(body, "track_id") : (body.track_id as string),
    asset_version_id: optionalNullableString(body, "asset_version_id"),
    text: optionalNullableString(body, "text"),
    text_style: optionalNullableJsonObject(body, "text_style"),
    start_time: optionalNumber(body, "start_time"),
    end_time: optionalNumber(body, "end_time"),
    source_offset: optionalNumber(body, "source_offset"),
    speed: optionalNumber(body, "speed"),
    transform: optionalJsonObject(body, "transform"),
    fade_in: optionalNullableNumber(body, "fade_in"),
    fade_out: optionalNullableNumber(body, "fade_out"),
    transition: optionalNullableString(body, "transition"),
    transition_duration: optionalNullableNumber(body, "transition_duration"),
    effect_chain: optionalNullableJsonArray(body, "effect_chain"),
    color_grade: optionalNullableJsonObject(body, "color_grade"),
    audio_settings: optionalJsonObject(body, "audio_settings"),
    notes: optionalString(body, "notes"),
  };
}

function requireTimeline(id: string, userId: number, required: "read" | "write" = "write") {
  const timeline = getTimeline(id, userId, required);
  if (!timeline) throw notFound("Timeline not found");
  return timeline;
}

// ---------------------------------------------------------------------------
// Full-state restore (undo/redo + external editors)
// ---------------------------------------------------------------------------

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(o: Record<string, unknown>, key: string, label: string): string {
  const value = o[key];
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function requireNumber(o: Record<string, unknown>, key: string, label: string): number {
  const value = o[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw badRequest(`${label}.${key} must be a finite number`);
  }
  return value;
}

function requireBool(o: Record<string, unknown>, key: string, label: string): boolean {
  const value = o[key];
  if (typeof value !== "boolean") throw badRequest(`${label}.${key} must be a boolean`);
  return value;
}

const ITEM_STATUSES = ["active", "muted", "archived"] as const;

function parseStateTrack(
  row: unknown,
  index: number,
  timelineId: string,
): Track {
  const o = asRecord(row, `tracks[${index}]`);
  const trackType = requireString(o, "track_type", `tracks[${index}]`);
  if (!(TRACK_TYPES as readonly string[]).includes(trackType)) {
    throw badRequest(`tracks[${index}].track_type must be one of: ${TRACK_TYPES.join(", ")}`);
  }
  const gainDb = optionalNumber(o, "gain_db") ?? 0;
  if (gainDb < GAIN_DB_MIN || gainDb > GAIN_DB_MAX) {
    throw badRequest(
      `tracks[${index}].gain_db must be a number between ${GAIN_DB_MIN} and ${GAIN_DB_MAX}`,
    );
  }
  const duckDb = optionalNumber(o, "duck_db") ?? 0;
  if (duckDb < DUCK_DB_MIN || duckDb > DUCK_DB_MAX) {
    throw badRequest(
      `tracks[${index}].duck_db must be a number between ${DUCK_DB_MIN} and ${DUCK_DB_MAX}`,
    );
  }
  return {
    id: requireString(o, "id", `tracks[${index}]`),
    timeline_id: timelineId,
    track_type: trackType,
    name: optionalString(o, "name") ?? trackType,
    track_order: requireNumber(o, "track_order", `tracks[${index}]`),
    locked: requireBool(o, "locked", `tracks[${index}]`),
    muted: requireBool(o, "muted", `tracks[${index}]`),
    gain_db: gainDb,
    duck_db: duckDb,
  };
}

function parseStateItem(
  row: unknown,
  index: number,
  timelineId: string,
  trackById: Map<string, Track>,
): TimelineItem {
  const label = `items[${index}]`;
  const o = asRecord(row, label);
  const trackId = requireString(o, "track_id", label);
  const track = trackById.get(trackId);
  if (!track) throw badRequest(`${label}.track_id references an unknown track`);
  const start_time = requireNumber(o, "start_time", label);
  const end_time = requireNumber(o, "end_time", label);
  const source_offset = optionalNumber(o, "source_offset") ?? 0;
  const speed = optionalNumber(o, "speed") ?? 1;
  validatePlacement({ start_time, end_time, source_offset, speed });

  const transition = optionalNullableString(o, "transition");
  const transition_duration = optionalNullableNumber(o, "transition_duration");
  const fade_in = optionalNullableNumber(o, "fade_in");
  const fade_out = optionalNullableNumber(o, "fade_out");
  const color_grade = optionalNullableJsonObject(o, "color_grade");
  validateItemFx(
    { transition, transition_duration, fade_in, fade_out, color_grade },
    end_time - start_time,
  );

  const item_text = optionalNullableString(o, "item_text");
  const text_style = optionalNullableJsonObject(o, "text_style");
  // `text`/`text_style` must be absent (not null) on media tracks, matching
  // the single-item create/update validation contract.
  validateTextOverlay(track, {
    text: item_text === null ? undefined : item_text,
    text_style: text_style === null ? undefined : text_style,
  });

  const status = optionalString(o, "status") ?? "active";
  if (!(ITEM_STATUSES as readonly string[]).includes(status)) {
    throw badRequest(`${label}.status must be one of: ${ITEM_STATUSES.join(", ")}`);
  }
  const asset_version_id = optionalNullableString(o, "asset_version_id") ?? null;
  if (asset_version_id !== null) {
    validateVersionForTrack(track.track_type, asset_version_id);
  }
  return {
    id: requireString(o, "id", label),
    timeline_id: timelineId,
    track_id: trackId,
    asset_version_id,
    item_text: item_text ?? null,
    text_style: text_style ?? null,
    start_time,
    end_time,
    source_offset,
    speed,
    transform: optionalNullableJsonObject(o, "transform") ?? null,
    fade_in: fade_in ?? null,
    fade_out: fade_out ?? null,
    transition: transition ?? null,
    transition_duration: transition_duration ?? DEFAULT_TRANSITION_DURATION,
    effect_chain: optionalNullableJsonArray(o, "effect_chain") ?? null,
    color_grade: color_grade ?? null,
    audio_settings: optionalNullableJsonObject(o, "audio_settings") ?? null,
    notes: optionalNullableString(o, "notes") ?? null,
    status,
    created_at: optionalString(o, "created_at") ?? new Date().toISOString(),
    updated_at: optionalString(o, "updated_at") ?? new Date().toISOString(),
  };
}

function parseStateMarker(row: unknown, index: number, timelineId: string): TimelineMarker {
  const label = `markers[${index}]`;
  const o = asRecord(row, label);
  const time = requireNumber(o, "time", label);
  if (time < 0) throw badRequest(`${label}.time must be >= 0`);
  return {
    id: requireString(o, "id", label),
    timeline_id: timelineId,
    time,
    label: optionalNullableString(o, "label") ?? null,
    notes: optionalNullableString(o, "notes") ?? null,
    created_at: optionalString(o, "created_at") ?? new Date().toISOString(),
  };
}

function timelineStateFromBody(body: Record<string, unknown>, timelineId: string): SnapshotData {
  const tracksRaw = body["tracks"];
  const itemsRaw = body["items"];
  const markersRaw = body["markers"];
  if (!Array.isArray(tracksRaw)) throw badRequest("tracks must be an array");
  if (!Array.isArray(itemsRaw)) throw badRequest("items must be an array");
  if (!Array.isArray(markersRaw)) throw badRequest("markers must be an array");
  if (tracksRaw.length > MAX_TRACKS) {
    throw badRequest(`A timeline can hold at most ${MAX_TRACKS} tracks`);
  }
  if (itemsRaw.length > MAX_ITEMS_PER_TIMELINE) {
    throw badRequest(`A timeline can hold at most ${MAX_ITEMS_PER_TIMELINE} items`);
  }

  const duration = optionalNumber(body, "duration") ?? 0;
  if (duration < 0) throw badRequest("duration must be >= 0");

  const tracks = tracksRaw.map((row, i) => parseStateTrack(row, i, timelineId));
  const trackById = new Map<string, Track>();
  for (const track of tracks) {
    if (trackById.has(track.id)) {
      throw badRequest(`tracks contain duplicate track id "${track.id}"`);
    }
    trackById.set(track.id, track);
  }
  const items = itemsRaw.map((row, i) => parseStateItem(row, i, timelineId, trackById));
  const itemIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) {
      throw badRequest(`items contain duplicate item id "${item.id}"`);
    }
    itemIds.add(item.id);
  }
  const markers = markersRaw.map((row, i) => parseStateMarker(row, i, timelineId));
  const markerIds = new Set<string>();
  for (const marker of markers) {
    if (markerIds.has(marker.id)) {
      throw badRequest(`markers contain duplicate marker id "${marker.id}"`);
    }
    markerIds.add(marker.id);
  }
  return {
    duration,
    settings: optionalNullableJsonObject(body, "settings") ?? null,
    tracks,
    items,
    markers,
  };
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
      gain_db: optionalNumber(body, "gain_db"),
      duck_db: optionalNumber(body, "duck_db"),
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
          gain_db: optionalNumber(body, "gain_db"),
          duck_db: optionalNumber(body, "duck_db"),
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
  .post("/api/v1/timelines/:id/state", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const timelineId = param(ctx as ParamsContext, "id");
    requireTimeline(timelineId, userId);
    replaceTimelineState(timelineId, userId, timelineStateFromBody(body, timelineId));
    ctx.response.body = timelineDetail(timelineId, userId);
  })
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
  )
  // -----------------------------------------------------------------------
  // Score suggestion (MS-8): deterministic analysis of the assembled cut
  // into a synthesized music prompt; POST enqueues a music generation job.
  // -----------------------------------------------------------------------
  .get(
    "/api/v1/timelines/:id/score-suggestion",
    authMiddleware,
    (ctx: Context, _next: Next) => {
      const userId = requireUserId(ctx);
      const timelineId = param(ctx as ParamsContext, "id");
      const timeline = requireTimeline(timelineId, userId, "read");
      const suggestion = suggestScore(loadScoreInput(timeline, userId));
      ctx.response.body = {
        timeline_id: timeline.id,
        project_id: timeline.project_id,
        suggestion,
      };
    },
  )
  .post(
    "/api/v1/timelines/:id/score",
    authMiddleware,
    async (ctx: Context, _next: Next) => {
      const userId = requireUserId(ctx);
      const timelineId = param(ctx as ParamsContext, "id");
      const timeline = requireTimeline(timelineId, userId, "write");
      const input = loadScoreInput(timeline, userId);
      if (input.video_item_count === 0) {
        throw badRequest(
          "Timeline has no video items — assemble a cut before suggesting a score",
        );
      }
      const suggestion = suggestScore(input);
      const body = await readOptionalBody(ctx);
      const prompt = optionalString(body, "prompt") ?? suggestion.prompt;
      const modelId = optionalString(body, "model_id");
      const job = generateAudio(userId, {
        kind: "music",
        prompt,
        project_id: timeline.project_id,
        model_id: modelId,
        device: body.device,
      });
      ctx.response.status = 202;
      ctx.response.body = {
        timeline_id: timeline.id,
        suggestion,
        job,
      };
    },
  );

/** Cut inputs for the score suggestion: timeline items by track kind + the
 * project's storyboard panels (mood / lighting / time of day / music cues). */
function loadScoreInput(timeline: Timeline, userId: number): ScoreInput {
  const tracksById = new Map(
    listTracks(timeline.id, userId).map((t: Track) => [t.id, t]),
  );
  let videoItemCount = 0;
  let musicItemCount = 0;
  let dialogueItemCount = 0;
  for (const item of listItems(timeline.id, userId)) {
    const track = tracksById.get(item.track_id);
    if (!track || track.muted) continue;
    const trackType = track.track_type;
    if (VIDEO_TRACK_TYPES.includes(trackType as (typeof VIDEO_TRACK_TYPES)[number])) {
      videoItemCount += 1;
    } else if (trackType === "music") {
      musicItemCount += 1;
    } else if (trackType === "dialogue") {
      dialogueItemCount += 1;
    }
  }
  const boards = listStoryboards(userId, { project_id: timeline.project_id });
  const panels = boards.flatMap((board) =>
    listPanels(board.id, userId).map((p) => ({
      panel_order: p.panel_order,
      time_of_day: p.time_of_day,
      lighting: p.lighting,
      mood: p.mood,
      music_cue: p.music_cue,
    }))
  );
  return {
    timeline_duration: timeline.duration,
    video_item_count: videoItemCount,
    music_item_count: musicItemCount,
    dialogue_item_count: dialogueItemCount,
    panels,
  };
}

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/timelines": {
    summary: "List accessible timelines",
    parameters: {
      project_id: { schema: { type: "string" } },
    },
    responses: {
      200: {
        description: "The timelines",
        schema: { type: "array", items: ref("Timeline") },
      },
      ...errorResponses(401),
    },
  },
  "POST /api/v1/timelines": {
    summary: "Create a timeline",
    requestBody: {
      schema: {
        type: "object",
        required: ["project_id", "name"],
        properties: {
          project_id: { type: "string" },
          name: { type: "string" },
          settings: { type: "object", additionalProperties: true },
        },
      },
    },
    responses: {
      201: {
        description: "The timeline",
        schema: ref("Timeline"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "GET /api/v1/timelines/{id}": {
    summary: "Get a timeline with tracks (with items) and markers",
    responses: {
      200: {
        description: "The full timeline detail",
        schema: ref("TimelineDetail"),
      },
      ...errorResponses(401, 404),
    },
  },
  "PATCH /api/v1/timelines/{id}": {
    summary: "Update a timeline",
    requestBody: {
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          duration: { type: "number", minimum: 0 },
          settings: { type: "object", additionalProperties: true },
        },
      },
    },
    responses: {
      200: {
        description: "The updated timeline",
        schema: ref("Timeline"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "DELETE /api/v1/timelines/{id}": {
    summary: "Delete a timeline",
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
  "POST /api/v1/timelines/{id}/tracks": {
    summary: "Add a track",
    requestBody: { schema: ref("TrackInput") },
    responses: {
      201: { description: "The track", schema: ref("Track") },
      ...errorResponses(400, 401, 404),
    },
  },
  "PATCH /api/v1/timelines/{id}/tracks/{trackId}": {
    summary: "Update a track (lock/mute, mixer gain/ducking, reorder)",
    requestBody: { schema: ref("TrackUpdateInput") },
    responses: {
      200: {
        description: "The updated track",
        schema: ref("Track"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "DELETE /api/v1/timelines/{id}/tracks/{trackId}": {
    summary: "Remove a track (and its items)",
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
  "POST /api/v1/timelines/{id}/items": {
    summary: "Place an item on a track",
    description: "track_id, asset_version_id, start_time and end_time are required. " +
      "Media-kind matching is enforced: video tracks need video assets, " +
      "audio tracks need audio assets, text/subtitle tracks carry inline " +
      "text.",
    requestBody: { schema: ref("ItemInput") },
    responses: {
      201: {
        description: "The placed item",
        schema: ref("TimelineItem"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "PATCH /api/v1/timelines/{id}/items/{itemId}": {
    summary: "Update an item (move/trim/speed/fades/grade/transition)",
    requestBody: { schema: ref("ItemUpdateInput") },
    responses: {
      200: {
        description: "The updated item",
        schema: ref("TimelineItem"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "POST /api/v1/timelines/{id}/items/{itemId}/duplicate": {
    summary: "Duplicate an item (optionally at a new position)",
    requestBody: {
      schema: {
        type: "object",
        properties: {
          at_time: { type: "number", minimum: 0 },
        },
      },
    },
    responses: {
      201: {
        description: "The new item",
        schema: ref("TimelineItem"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "DELETE /api/v1/timelines/{id}/items/{itemId}": {
    summary: "Remove an item",
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
  "POST /api/v1/timelines/{id}/markers": {
    summary: "Add a marker",
    requestBody: {
      schema: {
        type: "object",
        required: ["time"],
        properties: {
          time: { type: "number", minimum: 0 },
          label: { type: "string" },
          notes: { type: "string" },
        },
      },
    },
    responses: {
      201: {
        description: "The marker",
        schema: ref("TimelineMarker"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "GET /api/v1/timelines/{id}/markers": {
    summary: "List a timeline's markers",
    responses: {
      200: {
        description: "The markers",
        schema: { type: "array", items: ref("TimelineMarker") },
      },
      ...errorResponses(401, 404),
    },
  },
  "DELETE /api/v1/timelines/{id}/markers/{markerId}": {
    summary: "Remove a marker",
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
  "POST /api/v1/timelines/{id}/state": {
    summary: "Atomic full-state restore (backs the editor's undo/redo)",
    description: "Replaces duration/settings/tracks/items/markers in one " +
      "transaction, with per-row validation like the item routes. " +
      "Duplicate ids are rejected. Media-kind matching is enforced on " +
      "every item.",
    requestBody: { schema: ref("TimelineState") },
    responses: {
      200: {
        description: "The full timeline detail after the restore",
        schema: ref("TimelineDetail"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "POST /api/v1/timelines/{id}/snapshots": {
    summary: "Create a full-state snapshot",
    requestBody: {
      schema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          notes: { type: "string" },
        },
      },
    },
    responses: {
      201: {
        description: "The snapshot",
        schema: ref("TimelineSnapshot"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "GET /api/v1/timelines/{id}/snapshots": {
    summary: "List a timeline's snapshots",
    responses: {
      200: {
        description: "The snapshots",
        schema: { type: "array", items: ref("TimelineSnapshot") },
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/timelines/{id}/snapshots/{snapshotId}/restore": {
    summary: "Restore a snapshot",
    responses: {
      200: {
        description: "The full timeline detail after the restore",
        schema: ref("TimelineDetail"),
      },
      ...errorResponses(401, 404),
    },
  },
  "GET /api/v1/timelines/{id}/score-suggestion": {
    summary: "Deterministic music-score suggestion (MS-8)",
    description: "Analyzes the assembled cut (duration in 5s steps, dominant time-" +
      "of-day/lighting/mood, music cues, dialogue/existing-music presence) " +
      "and synthesizes a music prompt. Read-only.",
    responses: {
      200: {
        description: "The suggestion",
        schema: {
          type: "object",
          required: ["timeline_id", "project_id", "suggestion"],
          properties: {
            timeline_id: { type: "string" },
            project_id: { type: "string" },
            suggestion: { $ref: "#/components/schemas/ScoreSuggestion" },
          },
        },
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/timelines/{id}/score": {
    summary: "Generate a score from the suggestion (music job)",
    description: "Uses the suggested prompt (or a client-supplied one) and enqueues " +
      "a normal music job; candidates land on a fresh score asset. " +
      "Fails with 400 if the timeline has no video items.",
    requestBody: {
      schema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          model_id: { type: "string" },
          device: deviceProperty(),
        },
      },
    },
    responses: {
      202: {
        description: "The suggestion and the queued music job",
        schema: {
          type: "object",
          required: ["timeline_id", "suggestion", "job"],
          properties: {
            timeline_id: { type: "string" },
            suggestion: { $ref: "#/components/schemas/ScoreSuggestion" },
            job: {
              type: "object",
              required: ["job_id", "job_type", "asset_id", "model_id"],
              properties: {
                job_id: { type: "string" },
                job_type: { type: "string" },
                asset_id: { type: "string" },
                model_id: { type: "string" },
              },
            },
          },
        },
      },
      ...errorResponses(400, 401, 404, 503),
    },
  },
};
