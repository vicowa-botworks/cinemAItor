import { getDb } from "./database.ts";
import { badRequest } from "../errors.ts";
import {
  createTimeline,
  createTrack,
  deleteTimeline,
  type Timeline,
  TRACK_TYPES,
} from "./timelines.ts";

/** One track definition inside a template structure. */
export interface TemplateStructureTrack {
  name: string;
  track_type: string;
}

/**
 * A project template's starting structure: an optional default timeline and
 * the tracks to place on it, in order. `null` timeline name or an empty track
 * list means "blank" (no timeline created at all).
 */
export interface TemplateStructure {
  timeline_name: string | null;
  tracks: TemplateStructureTrack[];
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  structure: TemplateStructure;
  is_system: boolean;
}

function templateFromRow(row: Record<string, unknown>): Template {
  let raw: unknown;
  try {
    raw = JSON.parse(String(row.structure_json ?? "")) as unknown;
  } catch {
    throw badRequest(`template ${String(row.id)} has malformed structure_json`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    throw badRequest(`template ${String(row.id)} has malformed structure_json`);
  }
  const timelineName = obj.timeline_name;
  if (timelineName !== null && typeof timelineName !== "string") {
    throw badRequest(`template ${String(row.id)} structure timeline_name must be a string or null`);
  }
  const tracksRaw = obj.tracks;
  if (!Array.isArray(tracksRaw)) {
    throw badRequest(`template ${String(row.id)} structure tracks must be an array`);
  }
  const tracks: TemplateStructureTrack[] = tracksRaw.map((entry) => {
    const t = entry as Record<string, unknown>;
    if (
      typeof t !== "object" || t === null ||
      typeof t.name !== "string" || !t.name.trim() ||
      typeof t.track_type !== "string" ||
      !(TRACK_TYPES as readonly string[]).includes(t.track_type)
    ) {
      throw badRequest(
        `template ${String(row.id)} structure contains a track without a valid name/track_type`,
      );
    }
    return { name: t.name.trim(), track_type: t.track_type };
  });
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description === null ? null : String(row.description),
    is_system: Number(row.is_system) === 1,
    structure: {
      timeline_name: timelineName === null ? null : (timelineName as string).trim() || null,
      tracks,
    },
  };
}

/** All templates (system-seeded today; global and read-only for every user). */
export function listTemplates(): Template[] {
  const rows = getDb().prepare(
    "SELECT * FROM templates ORDER BY (is_system = 0), name",
  ).all() as unknown as Record<string, unknown>[];
  return rows.map(templateFromRow);
}

export function getTemplate(id: string): Template | undefined {
  const row = getDb()
    .prepare("SELECT * FROM templates WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? templateFromRow(row) : undefined;
}

/**
 * Materialize a template's structure inside a project (Milestone 7): create
 * the default timeline and its tracks when the template is not blank.
 * Returns the timeline, or undefined for blank templates. If track creation
 * fails part-way, the half-built timeline is removed before the error
 * propagates, so a failed project creation never leaves a partial structure.
 */
export function applyTemplateStructure(
  userId: number,
  projectId: string,
  template: Template,
): Timeline | undefined {
  const structure = template.structure;
  if (!structure.timeline_name || structure.tracks.length === 0) return undefined;
  let timeline: Timeline | undefined;
  try {
    timeline = createTimeline(userId, {
      project_id: projectId,
      name: structure.timeline_name,
    });
    for (const track of structure.tracks) {
      createTrack(userId, timeline.id, {
        name: track.name,
        track_type: track.track_type,
      });
    }
    return timeline;
  } catch (error) {
    if (timeline) {
      try {
        deleteTimeline(userId, timeline.id);
      } catch {
        // best-effort compensation; the original error is what matters
      }
    }
    throw error;
  }
}
