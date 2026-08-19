import { getDb } from "./database.ts";
import { badRequest, notFound } from "../errors.ts";
import { getProjectAccessible } from "./projects.ts";
import { getAssetVersion } from "./assets.ts";

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
}

export interface TimelineItem {
  id: string;
  timeline_id: string;
  track_id: string;
  asset_version_id: string;
  start_time: number;
  end_time: number;
  source_offset: number;
  speed: number;
  transform: Record<string, unknown> | null;
  fade_in: number | null;
  fade_out: number | null;
  transition: string | null;
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
  };
}

export function rowToItem(row: Record<string, unknown>): TimelineItem {
  return {
    id: row.id as string,
    timeline_id: row.timeline_id as string,
    track_id: row.track_id as string,
    asset_version_id: row.asset_version_id as string,
    start_time: asNum(row.start_time) ?? 0,
    end_time: asNum(row.end_time) ?? 0,
    source_offset: asNum(row.source_offset) ?? 0,
    speed: asNum(row.speed) ?? 1,
    transform: parseJson<Record<string, unknown> | null>(row.transform_json, null),
    fade_in: asNum(row.fade_in),
    fade_out: asNum(row.fade_out),
    transition: (row.transition as string | null) ?? null,
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
    `INSERT INTO tracks (id, timeline_id, track_type, name, track_order, locked, muted)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    timelineId,
    input.track_type,
    input.name.trim(),
    order,
    input.locked ? 1 : 0,
    input.muted ? 1 : 0,
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
  },
): Track | undefined {
  const track = getTrack(timelineId, trackId, userId, "write");
  if (!track) return undefined;
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
    `UPDATE tracks SET name = ?, track_order = ?, locked = ?, muted = ? WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(
    patch.name ?? track.name,
    patch.track_order ?? track.track_order,
    (patch.locked ?? track.locked) ? 1 : 0,
    (patch.muted ?? track.muted) ? 1 : 0,
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

function validatePlacement(
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

export interface ItemInput {
  track_id: string;
  asset_version_id: string;
  start_time: number;
  end_time: number;
  source_offset?: number;
  speed?: number;
  transform?: Record<string, unknown>;
  fade_in?: number;
  fade_out?: number;
  transition?: string;
  effect_chain?: unknown[];
  color_grade?: Record<string, unknown>;
  audio_settings?: Record<string, unknown>;
  notes?: string;
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
  const version = getAssetVersion(input.asset_version_id);
  if (!version) throw badRequest("asset_version_id does not reference a version");

  validatePlacement({
    start_time: input.start_time,
    end_time: input.end_time,
    source_offset: input.source_offset ?? 0,
    speed: input.speed ?? 1,
  });

  const id = crypto.randomUUID();
  const now = nowIso();
  (db.prepare(
    `INSERT INTO timeline_items (
      id, timeline_id, track_id, asset_version_id, start_time, end_time,
      source_offset, speed, transform_json, fade_in, fade_out, transition,
      effect_chain_json, color_grade_json, audio_settings_json, notes, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    id,
    timelineId,
    track.id,
    version.id,
    input.start_time,
    input.end_time,
    input.source_offset ?? 0,
    input.speed ?? 1,
    input.transform ? JSON.stringify(input.transform) : null,
    input.fade_in ?? null,
    input.fade_out ?? null,
    input.transition ?? null,
    input.effect_chain ? JSON.stringify(input.effect_chain) : null,
    input.color_grade ? JSON.stringify(input.color_grade) : null,
    input.audio_settings ? JSON.stringify(input.audio_settings) : null,
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
  if (patch.asset_version_id !== undefined) {
    const version = getAssetVersion(patch.asset_version_id);
    if (!version) throw badRequest("asset_version_id does not reference a version");
  }

  (getDb().prepare(
    `UPDATE timeline_items SET
       track_id = ?, asset_version_id = ?, start_time = ?, end_time = ?,
       source_offset = ?, speed = ?, transform_json = ?, fade_in = ?, fade_out = ?,
       transition = ?, effect_chain_json = ?, color_grade_json = ?,
       audio_settings_json = ?, notes = ?, status = ?, updated_at = ?
     WHERE id = ?`,
  ).run as (...params: unknown[]) => unknown)(
    nextTrack.id,
    patch.asset_version_id ?? item.asset_version_id,
    next.start_time,
    next.end_time,
    next.source_offset,
    next.speed,
    JSON.stringify(patch.transform ?? item.transform),
    patch.fade_in !== undefined ? patch.fade_in : item.fade_in,
    patch.fade_out !== undefined ? patch.fade_out : item.fade_out,
    patch.transition !== undefined ? patch.transition : item.transition,
    JSON.stringify(patch.effect_chain ?? item.effect_chain),
    JSON.stringify(patch.color_grade ?? item.color_grade),
    JSON.stringify(patch.audio_settings ?? item.audio_settings),
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
    effect_chain: item.effect_chain ?? undefined,
    color_grade: item.color_grade ?? undefined,
    audio_settings: item.audio_settings ?? undefined,
    notes: item.notes ?? undefined,
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

interface SnapshotData {
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

  // Full replacement within the timeline; original row ids are preserved so
  // snapshot data stays self-consistent even if it predates other edits.
  (db.prepare(
    "DELETE FROM timeline_items WHERE timeline_id = ?",
  ).run as (...params: unknown[]) => unknown)(timelineId);
  (db.prepare("DELETE FROM tracks WHERE timeline_id = ?")
    .run as (...params: unknown[]) => unknown)(timelineId);
  (db.prepare("DELETE FROM timeline_markers WHERE timeline_id = ?")
    .run as (...params: unknown[]) => unknown)(timelineId);

  for (const track of data.tracks) {
    (db.prepare(
      `INSERT OR IGNORE INTO tracks (id, timeline_id, track_type, name, track_order, locked, muted)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run as (...params: unknown[]) => unknown)(
      track.id,
      timelineId,
      track.track_type,
      track.name,
      track.track_order,
      track.locked ? 1 : 0,
      track.muted ? 1 : 0,
    );
  }
  for (const item of data.items) {
    (db.prepare(
      `INSERT OR IGNORE INTO timeline_items (
        id, timeline_id, track_id, asset_version_id, start_time, end_time,
        source_offset, speed, transform_json, fade_in, fade_out, transition,
        effect_chain_json, color_grade_json, audio_settings_json, notes, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run as (...params: unknown[]) => unknown)(
      item.id,
      timelineId,
      item.track_id,
      item.asset_version_id,
      item.start_time,
      item.end_time,
      item.source_offset,
      item.speed,
      item.transform ? JSON.stringify(item.transform) : null,
      item.fade_in,
      item.fade_out,
      item.transition,
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
  logAudit(userId, "snapshot.restore", timelineId, { snapshot_id: snapshotId });
  return getTimeline(timelineId, userId) as Timeline;
}
