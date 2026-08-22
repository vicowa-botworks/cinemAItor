import { getDb } from "./database.ts";
import { badRequest, notFound } from "../errors.ts";
import { getProjectAccessible } from "./projects.ts";
import { getAssetById, getAssetVersion } from "./assets.ts";

export const TRACK_TYPES = [
  "video",
  "dialogue",
  "voiceover",
  "music",
  "sfx",
  "ambience",
  "overlay",
  "text",
  "subtitle",
  "effect",
  "transition",
] as const;
export type TrackType = (typeof TRACK_TYPES)[number];

export const MAX_TRACKS = 32;
export const MAX_ITEMS_PER_TIMELINE = 1024;

/** Gain range in dB for tracks and version audio adjustments. */
export const GAIN_DB_MIN = -60;
export const GAIN_DB_MAX = 24;

/** Ducking reduction range in dB (0 = off; applied to music under dialogue). */
export const DUCK_DB_MIN = 0;
export const DUCK_DB_MAX = 60;

function requireGainDb(gainDb: number | undefined, field: string): void {
  if (
    gainDb !== undefined &&
    (typeof gainDb !== "number" || !Number.isFinite(gainDb) ||
      gainDb < GAIN_DB_MIN || gainDb > GAIN_DB_MAX)
  ) {
    throw badRequest(`${field} must be a number between ${GAIN_DB_MIN} and ${GAIN_DB_MAX}`);
  }
}

function requireDuckDb(duckDb: number | undefined, field: string): void {
  if (
    duckDb !== undefined &&
    (typeof duckDb !== "number" || !Number.isFinite(duckDb) ||
      duckDb < DUCK_DB_MIN || duckDb > DUCK_DB_MAX)
  ) {
    throw badRequest(`${field} must be a number between ${DUCK_DB_MIN} and ${DUCK_DB_MAX}`);
  }
}

export interface Timeline {
  id: string;
  project_id: string;
  name: string;
  duration: number;
  settings: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface Track {
  id: string;
  timeline_id: string;
  track_type: string;
  name: string;
  track_order: number;
  locked: boolean;
  muted: boolean;
  /** Per-track audio gain in dB (basic mixer); 0 is neutral. */
  gain_db: number;
  /** Ducking reduction in dB while dialogue sounds (music tracks); 0 is off. */
  duck_db: number;
}

export interface TimelineItem {
  id: string;
  timeline_id: string;
  track_id: string;
  asset_version_id: string | null;
  /** Inline text payload for items on text/subtitle tracks (rendered as overlay). */
  item_text: string | null;
  text_style: Record<string, unknown> | null;
  start_time: number;
  end_time: number;
  source_offset: number;
  speed: number;
  transform: Record<string, unknown> | null;
  fade_in: number | null;
  fade_out: number | null;
  transition: string | null;
  transition_duration: number;
  effect_chain: unknown[] | null;
  color_grade: Record<string, unknown> | null;
  audio_settings: Record<string, unknown> | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TimelineMarker {
  id: string;
  timeline_id: string;
  time: number;
  label: string | null;
  notes: string | null;
  created_at: string;
}

export interface TimelineSnapshot {
  id: string;
  timeline_id: string;
  name: string;
  notes: string | null;
  created_at: string;
  created_by_user_id: number | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value as string) as T;
  } catch {
    return fallback;
  }
}

export function rowToTimeline(row: Record<string, unknown>): Timeline {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    duration: asNum(row.duration) ?? 0,
    settings: parseJson<Record<string, unknown> | null>(row.settings_json, null),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function rowToTrack(row: Record<string, unknown>): Track {
  return {
    id: row.id as string,
    timeline_id: row.timeline_id as string,
    track_type: row.track_type as string,
    name: row.name as string,
    track_order: Number(row.track_order),
    locked: Boolean(row.locked),
    muted: Boolean(row.muted),
    gain_db: asNum(row.gain_db) ?? 0,
    duck_db: asNum(row.duck_db) ?? 0,
  };
}

export function rowToItem(row: Record<string, unknown>): TimelineItem {
  return {
    id: row.id as string,
    timeline_id: row.timeline_id as string,
    track_id: row.track_id as string,
    asset_version_id: (row.asset_version_id as string | null) ?? null,
    item_text: (row.item_text as string | null) ?? null,
    text_style: parseJson<Record<string, unknown> | null>(row.text_style_json, null),
    start_time: asNum(row.start_time) ?? 0,
    end_time: asNum(row.end_time) ?? 0,
    source_offset: asNum(row.source_offset) ?? 0,
    speed: asNum(row.speed) ?? 1,
    transform: parseJson<Record<string, unknown> | null>(row.transform_json, null),
    fade_in: asNum(row.fade_in),
    fade_out: asNum(row.fade_out),
    transition: (row.transition as string | null) ?? null,
    transition_duration: asNum(row.transition_duration) ?? 0.5,
    effect_chain: parseJson<unknown[] | null>(row.effect_chain_json, null),
    color_grade: parseJson<Record<string, unknown> | null>(row.color_grade_json, null),
    audio_settings: parseJson<Record<string, unknown> | null>(
      row.audio_settings_json,
      null,
    ),
    notes: (row.notes as string | null) ?? null,
    status: row.status as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function logAudit(
  userId: number,
  action: string,
  timelineId: string,
  data: Record<string, unknown> = {},
): void {
  const db = getDb();
  (db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, data_json, created_at)
     VALUES (?, ?, ?, 'timeline', ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    userId,
    action,
    timelineId,
    JSON.stringify(data),
    nowIso(),
  );
}

// ---------------------------------------------------------------------------
// Timelines
// ---------------------------------------------------------------------------

export function getTimeline(
  id: string,
  userId: number,
  required: "read" | "write" = "read",
): Timeline | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM timelines WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  const timeline = rowToTimeline(row);
  return getProjectAccessible(timeline.project_id, userId, required) ? timeline : undefined;
}

export function listTimelines(
  userId: number,
  filter: { project_id?: string } = {},
): Timeline[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.project_id) {
    clauses.push("project_id = ?");
    params.push(filter.project_id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = (
    db.prepare(`SELECT * FROM timelines ${where} ORDER BY name`).all as (
      ...values: unknown[]
    ) => unknown[]
  )(...params) as Record<string, unknown>[];
  return rows
    .map(rowToTimeline)
    .filter((t) => getProjectAccessible(t.project_id, userId, "read") !== undefined);
}

export function createTimeline(
  userId: number,
  input: { project_id: string; name: string; settings?: Record<string, unknown> },
): Timeline {
  if (!input.name?.trim()) throw badRequest("name is required");
  const project = getProjectAccessible(input.project_id, userId, "write");
  if (!project) throw notFound("Project not found");

  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  (db.prepare(
    `INSERT INTO timelines (id, project_id, name, duration, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    project.id,
    input.name.trim(),
    input.settings ? JSON.stringify(input.settings) : null,
    now,
    now,
  );
  logAudit(userId, "timeline.create", id, { name: input.name });
  return getTimeline(id, userId) as Timeline;
}

export function updateTimeline(
  userId: number,
  id: string,
  patch: {
    name?: string;
    duration?: number;
    settings?: Record<string, unknown>;
  },
): Timeline | undefined {
  const timeline = getTimeline(id, userId, "write");
  if (!timeline) return undefined;
  if (
    patch.duration !== undefined &&
    (typeof patch.duration !== "number" || patch.duration < 0)
  ) {
    throw badRequest("duration must be a non-negative number");
  }
  const db = getDb();
  (db.prepare(
    `UPDATE timelines
     SET name = ?, duration = ?, settings_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(
    patch.name ?? timeline.name,
    patch.duration ?? timeline.duration,
    JSON.stringify(patch.settings ?? timeline.settings),
    nowIso(),
    id,
  );
  logAudit(userId, "timeline.update", id, {});
  return getTimeline(id, userId);
}

export function deleteTimeline(userId: number, id: string): boolean {
  const timeline = getTimeline(id, userId, "write");
  if (!timeline) return false;
  getDb().prepare("DELETE FROM timelines WHERE id = ?").run(id);
  logAudit(userId, "timeline.delete", id, {});
  return true;
}

/** Timeline duration tracks the furthest item end time. */
export function recomputeTimelineDuration(timelineId: string): void {
  const db = getDb();
  const row = db.prepare(
    "SELECT MAX(end_time) AS max_end FROM timeline_items WHERE timeline_id = ?",
  ).get(timelineId) as unknown as { max_end: number | null };
  const duration = Math.max(0, row.max_end ?? 0);
  db.prepare("UPDATE timelines SET duration = ?, updated_at = ? WHERE id = ?")
    .run(duration, nowIso(), timelineId);
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export function getTrack(
  timelineId: string,
  trackId: string,
  userId: number,
  required: "read" | "write" = "read",
): Track | undefined {
  if (!getTimeline(timelineId, userId, required)) return undefined;
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM tracks WHERE id = ? AND timeline_id = ?",
  ).get(trackId, timelineId) as Record<string, unknown> | undefined;
  return row ? rowToTrack(row) : undefined;
}

export function listTracks(timelineId: string, userId: number): Track[] {
  if (!getTimeline(timelineId, userId, "read")) return [];
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM tracks WHERE timeline_id = ? ORDER BY track_order",
  ).all(timelineId) as Record<string, unknown>[];
  return rows.map(rowToTrack);
}

export interface TrackInput {
  track_type: string;
  name: string;
  track_order?: number;
  locked?: boolean;
  muted?: boolean;
  gain_db?: number;
  duck_db?: number;
}

export function createTrack(
  userId: number,
  timelineId: string,
  input: TrackInput,
): Track {
  const timeline = getTimeline(timelineId, userId, "write");
  if (!timeline) throw notFound("Timeline not found");
  if (!TRACK_TYPES.includes(input.track_type as TrackType)) {
    throw badRequest(`track_type must be one of: ${TRACK_TYPES.join(", ")}`);
  }
  if (!input.name?.trim()) throw badRequest("name is required");
  requireGainDb(input.gain_db, "gain_db");
  requireDuckDb(input.duck_db, "duck_db");

  const db = getDb();
  const count = (
    db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE timeline_id = ?")
      .get(timelineId) as unknown as { n: number }
  ).n;
  if (count >= MAX_TRACKS) {
    throw badRequest(`A timeline can hold at most ${MAX_TRACKS} tracks`);
  }

  let order: number;
  if (input.track_order !== undefined) {
    if (
      typeof input.track_order !== "number" || !Number.isInteger(input.track_order) ||
      input.track_order < 1
    ) {
      throw badRequest("track_order must be a positive integer");
    }
    const clash = db.prepare(
      "SELECT id FROM tracks WHERE timeline_id = ? AND track_order = ?",
    ).get(timelineId, input.track_order);
    if (clash) {
      throw badRequest(`A track already exists at position ${input.track_order}`);
    }
    order = input.track_order;
  } else {
    const maxRow = db.prepare(
      "SELECT COALESCE(MAX(track_order), 0) AS n FROM tracks WHERE timeline_id = ?",
    ).get(timelineId) as unknown as { n: number };
    order = maxRow.n + 1;
  }

  const id = crypto.randomUUID();
  (db.prepare(
    `INSERT INTO tracks (id, timeline_id, track_type, name, track_order, locked, muted, gain_db, duck_db)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    timelineId,
    input.track_type,
    input.name.trim(),
    order,
    input.locked ? 1 : 0,
    input.muted ? 1 : 0,
    input.gain_db ?? 0,
    input.duck_db ?? 0,
  );
  logAudit(userId, "track.create", timelineId, { track_id: id });
  return getTrack(timelineId, id, userId) as Track;
}

export function updateTrack(
  userId: number,
  timelineId: string,
  trackId: string,
  patch: {
    name?: string;
    track_order?: number;
    locked?: boolean;
    muted?: boolean;
    gain_db?: number;
    duck_db?: number;
  },
): Track | undefined {
  const track = getTrack(timelineId, trackId, userId, "write");
  if (!track) return undefined;
  requireGainDb(patch.gain_db, "gain_db");
  requireDuckDb(patch.duck_db, "duck_db");
  if (
    patch.track_order !== undefined &&
    (typeof patch.track_order !== "number" || !Number.isInteger(patch.track_order) ||
      patch.track_order < 1)
  ) {
    throw badRequest("track_order must be a positive integer");
  }
  const db = getDb();
  // Reorder with swap semantics: the track currently at the target position
  // moves back to this track's position. A temporary negative order avoids the
  // UNIQUE(timeline_id, track_order) constraint during the two-step swap.
  if (patch.track_order !== undefined && patch.track_order !== track.track_order) {
    const clash = db.prepare(
      "SELECT id FROM tracks WHERE timeline_id = ? AND track_order = ?",
    ).get(timelineId, patch.track_order) as { id: string } | undefined;
    if (clash) {
      (db.prepare("UPDATE tracks SET track_order = -1 WHERE id = ?")
        .run as (...params: unknown[]) => unknown)(trackId);
      (db.prepare(
        "UPDATE tracks SET track_order = ? WHERE id = ?",
      ).run as (...params: unknown[]) => unknown)(track.track_order, clash.id);
    }
  }
  (db.prepare(
    `UPDATE tracks SET name = ?, track_order = ?, locked = ?, muted = ?, gain_db = ?, duck_db = ? WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(
    patch.name ?? track.name,
    patch.track_order ?? track.track_order,
    (patch.locked ?? track.locked) ? 1 : 0,
    (patch.muted ?? track.muted) ? 1 : 0,
    patch.gain_db ?? track.gain_db,
    patch.duck_db ?? track.duck_db,
    trackId,
  );
  return getTrack(timelineId, trackId, userId);
}

export function deleteTrack(
  userId: number,
  timelineId: string,
  trackId: string,
): boolean {
  const track = getTrack(timelineId, trackId, userId, "write");
  if (!track) return false;
  getDb().prepare("DELETE FROM tracks WHERE id = ?").run(trackId);
  recomputeTimelineDuration(timelineId);
  logAudit(userId, "track.delete", timelineId, { track_id: trackId });
  return true;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export function getItem(
  timelineId: string,
  itemId: string,
  userId: number,
  required: "read" | "write" = "read",
): TimelineItem | undefined {
  if (!getTimeline(timelineId, userId, required)) return undefined;
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM timeline_items WHERE id = ? AND timeline_id = ?",
  ).get(itemId, timelineId) as Record<string, unknown> | undefined;
  return row ? rowToItem(row) : undefined;
}

export function listItems(timelineId: string, userId: number): TimelineItem[] {
  if (!getTimeline(timelineId, userId, "read")) return [];
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM timeline_items WHERE timeline_id = ? ORDER BY start_time, id",
  ).all(timelineId) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

export function listItemsByTrack(
  timelineId: string,
  trackId: string,
  userId: number,
): TimelineItem[] {
  const items = listItems(timelineId, userId);
  return items.filter((i) => i.track_id === trackId);
}

function requireWritableTrack(
  timelineId: string,
  trackId: string,
  userId: number,
): Track {
  const track = getTrack(timelineId, trackId, userId, "write");
  if (!track) throw notFound("Track not found");
  if (track.locked) throw badRequest("Track is locked");
  return track;
}

export function validatePlacement(
  p: { start_time: number; end_time: number; source_offset: number; speed: number },
): void {
  for (const [key, value] of Object.entries(p)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw badRequest(`${key} must be a finite number`);
    }
  }
  if (p.start_time < 0) throw badRequest("start_time must be >= 0");
  if (p.end_time <= p.start_time) {
    throw badRequest("end_time must be greater than start_time");
  }
  if (p.source_offset < 0) throw badRequest("source_offset must be >= 0");
  if (p.speed <= 0) throw badRequest("speed must be > 0");
}

// ---------------------------------------------------------------------------
// Item fx: transitions + color grading (applied at render time)
// ---------------------------------------------------------------------------

/** Blend types between an item and the one that precedes it (xfade names). */
export const TRANSITION_TYPES = [
  "cut",
  "fade",
  "dissolve",
  "wipeleft",
  "wiperight",
  "slideleft",
  "slideright",
] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const DEFAULT_TRANSITION_DURATION = 0.5;
export const MAX_TRANSITION_DURATION = 3;

/** Allowed color grade parameters and their ranges. */
export const COLOR_GRADE_LIMITS = {
  brightness: { min: -1, max: 1 },
  contrast: { min: 0.25, max: 4 },
  saturation: { min: 0, max: 2 },
  temperature: { min: -1, max: 1 },
} as const;

export function validateItemFx(
  fx: {
    transition?: string | null;
    transition_duration?: number | null;
    fade_in?: number | null;
    fade_out?: number | null;
    color_grade?: Record<string, unknown> | null;
  },
  duration: number,
): void {
  if (
    fx.transition !== undefined && fx.transition !== null &&
    !(TRANSITION_TYPES as readonly string[]).includes(fx.transition)
  ) {
    throw badRequest(`transition must be one of: ${TRANSITION_TYPES.join(", ")}`);
  }
  if (fx.transition_duration !== undefined && fx.transition_duration !== null) {
    const d = fx.transition_duration;
    if (typeof d !== "number" || !Number.isFinite(d) || d <= 0 || d > MAX_TRANSITION_DURATION) {
      throw badRequest(`transition_duration must be > 0 and <= ${MAX_TRANSITION_DURATION}`);
    }
  }
  for (const key of ["fade_in", "fade_out"] as const) {
    const value = fx[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw badRequest(`${key} must be a finite number >= 0`);
    }
    if (value >= duration) {
      throw badRequest(`${key} must be shorter than the item duration`);
    }
  }
  if (fx.color_grade !== undefined && fx.color_grade !== null) {
    const grade = fx.color_grade;
    if (typeof grade !== "object" || Array.isArray(grade)) {
      throw badRequest("color_grade must be a JSON object");
    }
    for (const [key, value] of Object.entries(grade)) {
      const limit = (COLOR_GRADE_LIMITS as Record<string, { min: number; max: number }>)[key];
      if (!limit) {
        throw badRequest(
          `unknown color_grade parameter: ${key} (allowed: ${
            Object.keys(COLOR_GRADE_LIMITS).join(", ")
          })`,
        );
      }
      if (
        typeof value !== "number" || !Number.isFinite(value) ||
        value < limit.min || value > limit.max
      ) {
        throw badRequest(
          `color_grade.${key} must be a number between ${limit.min} and ${limit.max}`,
        );
      }
    }
  }
}

export interface ItemInput {
  track_id: string;
  /** Required for media items; optional (nullable) for text/subtitle overlays. */
  asset_version_id: string | null;
  start_time: number;
  end_time: number;
  source_offset?: number;
  speed?: number;
  transform?: Record<string, unknown> | null;
  fade_in?: number | null;
  fade_out?: number | null;
  transition?: string | null;
  transition_duration?: number | null;
  effect_chain?: unknown[] | null;
  color_grade?: Record<string, unknown> | null;
  audio_settings?: Record<string, unknown> | null;
  notes?: string | null;
  /** Inline text overlay; only allowed on text/subtitle tracks. */
  text?: string | null;
  text_style?: Record<string, unknown> | null;
}

export const TEXT_TRACK_TYPES = ["text", "subtitle"] as const;

/** Track types that carry the rendered output video. */
export const VIDEO_TRACK_TYPES = ["video", "overlay"] as const;

/** Track types whose placed items are mixed into the rendered output audio. */
export const AUDIO_TRACK_TYPES = [
  "dialogue",
  "voiceover",
  "music",
  "sfx",
  "ambience",
] as const;

/**
 * Asset kind expected for the track type group, or `null` when the group is
 * unconstrained. Video tracks only accept video assets, audio tracks only
 * audio assets; the other track types (effect, transition, …) are reserved
 * for later work and stay unconstrained for now.
 */
function expectedAssetType(trackType: string): "video" | "audio" | null {
  if ((VIDEO_TRACK_TYPES as readonly string[]).includes(trackType)) return "video";
  if ((AUDIO_TRACK_TYPES as readonly string[]).includes(trackType)) return "audio";
  return null;
}

function assertAssetTypeMatches(
  trackType: string,
  version: { asset_id: string },
): void {
  const expected = expectedAssetType(trackType);
  if (!expected) return;
  const asset = getAssetById(version.asset_id);
  if (!asset) {
    throw badRequest("asset_version_id references a version without an asset");
  }
  if (asset.asset_type !== expected) {
    throw badRequest(
      `${trackType} tracks need ${expected} assets, but "${asset.display_name}" is ${asset.asset_type}`,
    );
  }
}

/** Validate a version id for placement on a track: it must exist and its asset kind must match. */
export function validateVersionForTrack(
  trackType: string,
  versionId: string,
): void {
  const version = getAssetVersion(versionId);
  if (!version) throw badRequest("asset_version_id does not reference a version");
  assertAssetTypeMatches(trackType, version);
}

const MAX_TEXT_LENGTH = 512;
const TEXT_POSITIONS = ["top", "middle", "bottom"] as const;
const TEXT_COLORS = new Set([
  "white",
  "black",
  "red",
  "green",
  "blue",
  "yellow",
  "cyan",
  "magenta",
]);

export function validateTextOverlay(
  track: Track,
  input: { text?: string | null; text_style?: Record<string, unknown> | null },
): void {
  const isTextTrack = (TEXT_TRACK_TYPES as readonly string[]).includes(track.track_type);
  const text = input.text;
  if (text === undefined) return;
  if (text === null) {
    if (!isTextTrack) throw badRequest("text can only be set on text or subtitle tracks");
    return;
  }
  if (!isTextTrack) {
    throw badRequest("text overlays are only allowed on text or subtitle tracks");
  }
  if (typeof text !== "string") throw badRequest("text must be a string");
  if (text.length === 0) throw badRequest("text must not be empty");
  if (text.length > MAX_TEXT_LENGTH) {
    throw badRequest(`text is too long (max ${MAX_TEXT_LENGTH} characters)`);
  }
  const style = input.text_style;
  if (style !== undefined && style !== null) {
    if (typeof style !== "object" || Array.isArray(style)) {
      throw badRequest("text_style must be a JSON object");
    }
    if (
      style.font_size !== undefined &&
      (typeof style.font_size !== "number" || !Number.isInteger(style.font_size) ||
        style.font_size < 1 || style.font_size > 200)
    ) {
      throw badRequest("text_style.font_size must be an integer between 1 and 200");
    }
    if (style.font_color !== undefined) {
      const c = style.font_color;
      const ok = typeof c === "string" &&
        (TEXT_COLORS.has(c.toLowerCase()) || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c));
      if (!ok) {
        throw badRequest(
          "text_style.font_color must be a name or a #RGB/#RRGGBB hex value",
        );
      }
    }
    if (
      style.position !== undefined &&
      !(TEXT_POSITIONS as readonly string[]).includes(style.position as string)
    ) {
      throw badRequest(`text_style.position must be one of: ${TEXT_POSITIONS.join(", ")}`);
    }
    if (
      style.margin !== undefined &&
      (typeof style.margin !== "number" || style.margin < 0 || style.margin > 100)
    ) {
      throw badRequest("text_style.margin must be a number between 0 and 100");
    }
    const known = new Set(["font_size", "font_color", "position", "margin"]);
    for (const key of Object.keys(style)) {
      if (!known.has(key)) throw badRequest(`unknown text_style parameter: ${key}`);
    }
  }
}

function requireVersionForItem(
  track: Track,
  input: { asset_version_id: string | null; text?: string | null },
): string | null {
  if (input.asset_version_id) {
    const version = getAssetVersion(input.asset_version_id);
    if (!version) throw badRequest("asset_version_id does not reference a version");
    assertAssetTypeMatches(track.track_type, version);
    return version.id;
  }
  // Text items may be versionless; media tracks require a version.
  if (!(TEXT_TRACK_TYPES as readonly string[]).includes(track.track_type)) {
    throw badRequest("asset_version_id is required for items on media tracks");
  }
  return null;
}

/** Serialize an optional JSON column value (`null`/`undefined` -> SQL NULL). */
function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

export function createItem(
  userId: number,
  timelineId: string,
  input: ItemInput,
): TimelineItem {
  const db = getDb();
  const count = (
    db.prepare("SELECT COUNT(*) AS n FROM timeline_items WHERE timeline_id = ?")
      .get(timelineId) as unknown as { n: number }
  ).n;
  if (count >= MAX_ITEMS_PER_TIMELINE) {
    throw badRequest(
      `A timeline can hold at most ${MAX_ITEMS_PER_TIMELINE} items`,
    );
  }
  const track = requireWritableTrack(timelineId, input.track_id, userId);
  const versionId = requireVersionForItem(track, input);

  validatePlacement({
    start_time: input.start_time,
    end_time: input.end_time,
    source_offset: input.source_offset ?? 0,
    speed: input.speed ?? 1,
  });
  validateItemFx(input, input.end_time - input.start_time);
  validateTextOverlay(track, input);

  const id = crypto.randomUUID();
  const now = nowIso();
  (db.prepare(
    `INSERT INTO timeline_items (
      id, timeline_id, track_id, asset_version_id, item_text, text_style_json,
      start_time, end_time,
      source_offset, speed, transform_json, fade_in, fade_out, transition,
      transition_duration,
      effect_chain_json, color_grade_json, audio_settings_json, notes, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    timelineId,
    track.id,
    versionId,
    input.text ?? null,
    jsonOrNull(input.text_style),
    input.start_time,
    input.end_time,
    input.source_offset ?? 0,
    input.speed ?? 1,
    jsonOrNull(input.transform),
    input.fade_in ?? null,
    input.fade_out ?? null,
    input.transition ?? null,
    input.transition_duration ?? DEFAULT_TRANSITION_DURATION,
    jsonOrNull(input.effect_chain),
    jsonOrNull(input.color_grade),
    jsonOrNull(input.audio_settings),
    input.notes ?? null,
    now,
    now,
  );
  recomputeTimelineDuration(timelineId);
  logAudit(userId, "item.create", timelineId, { item_id: id });
  return getItem(timelineId, id, userId) as TimelineItem;
}

export function updateItem(
  userId: number,
  timelineId: string,
  itemId: string,
  patch: Partial<ItemInput> & { track_id?: string; status?: string },
): TimelineItem | undefined {
  const item = getItem(timelineId, itemId, userId, "write");
  if (!item) return undefined;
  if (patch.status !== undefined && !["active", "muted", "archived"].includes(patch.status)) {
    throw badRequest("status must be one of: active, muted, archived");
  }
  const nextTrack = patch.track_id !== undefined
    ? requireWritableTrack(timelineId, patch.track_id, userId)
    : requireWritableTrack(timelineId, item.track_id, userId);

  const next = {
    start_time: patch.start_time ?? item.start_time,
    end_time: patch.end_time ?? item.end_time,
    source_offset: patch.source_offset ?? item.source_offset,
    speed: patch.speed ?? item.speed,
  };
  validatePlacement(next);
  validateItemFx(
    {
      transition: patch.transition !== undefined ? patch.transition : item.transition,
      transition_duration: patch.transition_duration !== undefined
        ? patch.transition_duration
        : item.transition_duration,
      fade_in: patch.fade_in !== undefined ? patch.fade_in : item.fade_in,
      fade_out: patch.fade_out !== undefined ? patch.fade_out : item.fade_out,
      color_grade: patch.color_grade !== undefined ? patch.color_grade : item.color_grade,
    },
    next.end_time - next.start_time,
  );
  const nextVersionId = patch.asset_version_id !== undefined
    ? patch.asset_version_id
    : item.asset_version_id;
  if (nextVersionId) {
    const version = getAssetVersion(nextVersionId);
    if (!version) throw badRequest("asset_version_id does not reference a version");
    assertAssetTypeMatches(nextTrack.track_type, version);
  }
  const isTextTrack = (TEXT_TRACK_TYPES as readonly string[]).includes(nextTrack.track_type);
  const nextText = patch.text !== undefined ? patch.text : item.item_text;
  validateTextOverlay(nextTrack, {
    text: patch.text !== undefined ? patch.text : item.item_text ?? undefined,
    text_style: patch.text_style !== undefined ? patch.text_style : item.text_style,
  });
  if (!isTextTrack && !nextVersionId) {
    throw badRequest("asset_version_id is required for items on media tracks");
  }

  (getDb().prepare(
    `UPDATE timeline_items SET
       track_id = ?, asset_version_id = ?, item_text = ?, text_style_json = ?,
       start_time = ?, end_time = ?,
       source_offset = ?, speed = ?, transform_json = ?, fade_in = ?, fade_out = ?,
       transition = ?, transition_duration = ?, effect_chain_json = ?,
       color_grade_json = ?,
       audio_settings_json = ?, notes = ?, status = ?, updated_at = ?
      WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(
    nextTrack.id,
    nextVersionId,
    nextText,
    jsonOrNull(patch.text_style === undefined ? item.text_style : patch.text_style),
    next.start_time,
    next.end_time,
    next.source_offset,
    next.speed,
    jsonOrNull(patch.transform === undefined ? item.transform : patch.transform),
    patch.fade_in !== undefined ? patch.fade_in : item.fade_in,
    patch.fade_out !== undefined ? patch.fade_out : item.fade_out,
    patch.transition !== undefined ? patch.transition : item.transition,
    patch.transition_duration !== undefined ? patch.transition_duration : item.transition_duration,
    jsonOrNull(patch.effect_chain === undefined ? item.effect_chain : patch.effect_chain),
    jsonOrNull(patch.color_grade === undefined ? item.color_grade : patch.color_grade),
    jsonOrNull(patch.audio_settings === undefined ? item.audio_settings : patch.audio_settings),
    patch.notes !== undefined ? patch.notes : item.notes,
    patch.status ?? item.status,
    nowIso(),
    itemId,
  );
  recomputeTimelineDuration(timelineId);
  return getItem(timelineId, itemId, userId);
}

/** Copy an item (same content/properties) starting at `at_time`. */
export function duplicateItem(
  userId: number,
  timelineId: string,
  itemId: string,
  atTime?: number,
): TimelineItem {
  const item = getItem(timelineId, itemId, userId, "write");
  if (!item) throw notFound("Item not found");
  if (
    atTime !== undefined &&
    (typeof atTime !== "number" || atTime < 0)
  ) {
    throw badRequest("at_time must be a non-negative number");
  }
  const length = item.end_time - item.start_time;
  const start = atTime ?? item.end_time;
  return createItem(userId, timelineId, {
    track_id: item.track_id,
    asset_version_id: item.asset_version_id,
    start_time: start,
    end_time: start + length,
    source_offset: item.source_offset,
    speed: item.speed,
    transform: item.transform ?? undefined,
    fade_in: item.fade_in ?? undefined,
    fade_out: item.fade_out ?? undefined,
    transition: item.transition ?? undefined,
    transition_duration: item.transition_duration,
    effect_chain: item.effect_chain ?? undefined,
    color_grade: item.color_grade ?? undefined,
    audio_settings: item.audio_settings ?? undefined,
    notes: item.notes ?? undefined,
    text: item.item_text ?? undefined,
    text_style: item.text_style ?? undefined,
  });
}

export function deleteItem(
  userId: number,
  timelineId: string,
  itemId: string,
): boolean {
  const item = getItem(timelineId, itemId, userId, "write");
  if (!item) return false;
  getDb().prepare("DELETE FROM timeline_items WHERE id = ?").run(itemId);
  recomputeTimelineDuration(timelineId);
  logAudit(userId, "item.delete", timelineId, { item_id: itemId });
  return true;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

export function createMarker(
  userId: number,
  timelineId: string,
  input: { time: number; label?: string; notes?: string },
): TimelineMarker {
  if (!getTimeline(timelineId, userId, "write")) throw notFound("Timeline not found");
  if (typeof input.time !== "number" || input.time < 0) {
    throw badRequest("time must be a non-negative number");
  }
  const db = getDb();
  const id = crypto.randomUUID();
  (db.prepare(
    `INSERT INTO timeline_markers (id, timeline_id, time, label, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    timelineId,
    input.time,
    input.label ?? null,
    input.notes ?? null,
    nowIso(),
  );
  return {
    id,
    timeline_id: timelineId,
    time: input.time,
    label: input.label ?? null,
    notes: input.notes ?? null,
    created_at: nowIso(),
  };
}

export function listMarkers(timelineId: string, userId: number): TimelineMarker[] {
  if (!getTimeline(timelineId, userId, "read")) return [];
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM timeline_markers WHERE timeline_id = ? ORDER BY time, id",
  ).all(timelineId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    timeline_id: row.timeline_id as string,
    time: Number(row.time),
    label: (row.label as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    created_at: row.created_at as string,
  }));
}

export function deleteMarker(
  userId: number,
  timelineId: string,
  markerId: string,
): boolean {
  if (!getTimeline(timelineId, userId, "write")) return false;
  const db = getDb();
  const changes = db.prepare(
    "DELETE FROM timeline_markers WHERE id = ? AND timeline_id = ?",
  ).run(markerId, timelineId) as unknown as number;
  return changes > 0;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface SnapshotData {
  duration: number;
  settings: Record<string, unknown> | null;
  tracks: Track[];
  items: TimelineItem[];
  markers: TimelineMarker[];
}

export function listSnapshots(
  timelineId: string,
  userId: number,
): TimelineSnapshot[] {
  if (!getTimeline(timelineId, userId, "read")) return [];
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, timeline_id, name, notes, created_at, created_by_user_id
     FROM timeline_snapshots WHERE timeline_id = ? ORDER BY created_at DESC`,
  ).all(timelineId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    timeline_id: row.timeline_id as string,
    name: row.name as string,
    notes: (row.notes as string | null) ?? null,
    created_at: row.created_at as string,
    created_by_user_id: row.created_by_user_id === null ? null : Number(row.created_by_user_id),
  }));
}

export function createSnapshot(
  userId: number,
  timelineId: string,
  input: { name: string; notes?: string },
): TimelineSnapshot {
  const timeline = getTimeline(timelineId, userId, "write");
  if (!timeline) throw notFound("Timeline not found");
  if (!input.name?.trim()) throw badRequest("name is required");

  const data: SnapshotData = {
    duration: timeline.duration,
    settings: timeline.settings,
    tracks: listTracks(timelineId, userId),
    items: listItems(timelineId, userId),
    markers: listMarkers(timelineId, userId),
  };

  const db = getDb();
  const id = crypto.randomUUID();
  (db.prepare(
    `INSERT INTO timeline_snapshots (id, timeline_id, name, snapshot_data_json, notes, created_at, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    timelineId,
    input.name.trim(),
    JSON.stringify(data),
    input.notes ?? null,
    nowIso(),
    userId,
  );
  logAudit(userId, "snapshot.create", timelineId, { snapshot_id: id });
  return {
    id,
    timeline_id: timelineId,
    name: input.name.trim(),
    notes: input.notes ?? null,
    created_at: nowIso(),
    created_by_user_id: userId,
  };
}

/**
 * Full in-timeline state replacement. Original row ids are preserved so the
 * provided data stays self-consistent even if it predates other edits.
 */
export function replaceTimelineState(
  timelineId: string,
  userId: number,
  data: SnapshotData,
): Timeline {
  const timeline = getTimeline(timelineId, userId, "write");
  if (!timeline) throw notFound("Timeline not found");
  const db = getDb();

  (db.prepare(
    "DELETE FROM timeline_items WHERE timeline_id = ?",
  ).run as (...params: unknown[]) => unknown)(timelineId);
  (db.prepare("DELETE FROM tracks WHERE timeline_id = ?")
    .run as (...params: unknown[]) => unknown)(timelineId);
  (db.prepare("DELETE FROM timeline_markers WHERE timeline_id = ?")
    .run as (...params: unknown[]) => unknown)(timelineId);

  for (const track of data.tracks) {
    (db.prepare(
      `INSERT OR IGNORE INTO tracks (id, timeline_id, track_type, name, track_order, locked, muted, gain_db, duck_db)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run as (...params: unknown[]) => unknown)(
      track.id,
      timelineId,
      track.track_type,
      track.name,
      track.track_order,
      track.locked ? 1 : 0,
      track.muted ? 1 : 0,
      Number(track.gain_db) || 0,
      Number(track.duck_db) || 0,
    );
  }
  for (const item of data.items) {
    (db.prepare(
      `INSERT OR IGNORE INTO timeline_items (
        id, timeline_id, track_id, asset_version_id, item_text, text_style_json,
        start_time, end_time,
        source_offset, speed, transform_json, fade_in, fade_out, transition,
        transition_duration,
        effect_chain_json, color_grade_json, audio_settings_json, notes, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run as (...params: unknown[]) => unknown)(
      item.id,
      timelineId,
      item.track_id,
      item.asset_version_id,
      item.item_text ?? null,
      item.text_style ? JSON.stringify(item.text_style) : null,
      item.start_time,
      item.end_time,
      item.source_offset,
      item.speed,
      item.transform ? JSON.stringify(item.transform) : null,
      item.fade_in,
      item.fade_out,
      item.transition,
      item.transition_duration ?? DEFAULT_TRANSITION_DURATION,
      item.effect_chain ? JSON.stringify(item.effect_chain) : null,
      item.color_grade ? JSON.stringify(item.color_grade) : null,
      item.audio_settings ? JSON.stringify(item.audio_settings) : null,
      item.notes,
      item.status,
      item.created_at,
      item.updated_at,
    );
  }
  for (const marker of data.markers) {
    (db.prepare(
      `INSERT OR IGNORE INTO timeline_markers (id, timeline_id, time, label, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
    ).run as (...params: unknown[]) => unknown)(
      marker.id,
      timelineId,
      marker.time,
      marker.label,
      marker.notes,
      marker.created_at,
    );
  }

  (db.prepare(
    "UPDATE timelines SET duration = ?, settings_json = ? WHERE id = ?",
  ).run as (...params: unknown[]) => unknown)(
    data.duration,
    JSON.stringify(data.settings),
    timelineId,
  );
  recomputeTimelineDuration(timelineId);
  logAudit(userId, "state.replace", timelineId, {
    tracks: data.tracks.length,
    items: data.items.length,
    markers: data.markers.length,
  });
  return getTimeline(timelineId, userId) as Timeline;
}

export function restoreSnapshot(
  userId: number,
  timelineId: string,
  snapshotId: string,
): Timeline {
  const timeline = getTimeline(timelineId, userId, "write");
  if (!timeline) throw notFound("Timeline not found");
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM timeline_snapshots WHERE id = ? AND timeline_id = ?",
  ).get(snapshotId, timelineId) as Record<string, unknown> | undefined;
  if (!row) throw notFound("Snapshot not found");

  const data = parseJson<SnapshotData>(row.snapshot_data_json, {
    duration: 0,
    settings: null,
    tracks: [],
    items: [],
    markers: [],
  });
  replaceTimelineState(timelineId, userId, data);
  logAudit(userId, "snapshot.restore", timelineId, { snapshot_id: snapshotId });
  return getTimeline(timelineId, userId) as Timeline;
}
