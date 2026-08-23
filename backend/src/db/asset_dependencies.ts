import { getDb } from "./database.ts";
import { auditReferences, type ReferenceAuditEntry } from "./references.ts";

/**
 * Asset dependency tracking (AST-015): everything that points at an asset,
 * so the "Used in" view and delete warnings can show real impact before an
 * asset goes away.
 *
 * Covered pointers:
 * - prompt_references: asset_references rows (@-tokens in prompt versions
 *   sourced from prompts/scenes/shots/storyboard panels)
 * - timeline_items: placed asset versions on timeline tracks
 * - panels: storyboard panel preview / generated-clip pointers
 * - shots: shot generated-clip pointers
 *
 * Jobs/renders/review rows are operational provenance and are intentionally
 * excluded from this view.
 */

export interface DependencyPromptReference {
  id: string;
  source_type: string;
  source_id: string;
  raw_text: string;
  role: string | null;
  status: string;
  broken: boolean;
}

export interface DependencyTimelineItem {
  item_id: string;
  timeline_id: string;
  timeline_name: string;
  track_id: string;
  track_name: string;
  track_type: string;
  version_id: string;
}

export interface DependencyPanelPointer {
  pointer: "preview" | "clip";
  storyboard_id: string;
  storyboard_name: string;
  panel_id: string;
  shot_number: string | null;
  version_id: string;
}

export interface DependencyShotClip {
  scene_id: string;
  scene_name: string;
  shot_id: string;
  shot_order: number;
  version_id: string;
}

export interface AssetDependencies {
  asset_id: string;
  prompt_references: DependencyPromptReference[];
  timeline_items: DependencyTimelineItem[];
  panels: DependencyPanelPointer[];
  shots: DependencyShotClip[];
  totals: {
    prompt_references: number;
    timeline_items: number;
    panels: number;
    shots: number;
    total: number;
  };
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapPromptReferences(
  entries: ReferenceAuditEntry[],
): DependencyPromptReference[] {
  return entries.map((entry) => ({
    id: entry.reference.id,
    source_type: entry.reference.source_type,
    source_id: entry.reference.source_id,
    raw_text: entry.reference.raw_text,
    role: entry.reference.role,
    status: entry.reference.status,
    broken: entry.broken,
  }));
}

export function getAssetDependencies(assetId: string): AssetDependencies {
  const db = getDb();

  const versionIds = (
    (db.prepare(
      "SELECT id FROM asset_versions WHERE asset_id = ? ORDER BY version_number",
    ).all as (...values: unknown[]) => unknown[])(assetId) as Record<
      string,
      unknown
    >[]
  ).map((row) => row.id as string);

  let prompt_references: DependencyPromptReference[] = [];
  let timeline_items: DependencyTimelineItem[] = [];
  let panels: DependencyPanelPointer[] = [];
  let shots: DependencyShotClip[] = [];

  if (versionIds.length > 0) {
    const inList = versionIds.map(() => "?").join(", ");

    const timelineRows = (
      (db.prepare(
        `SELECT i.id AS item_id, i.timeline_id, t.name AS timeline_name,
                i.track_id, tr.name AS track_name, tr.track_type,
                i.asset_version_id AS version_id
         FROM timeline_items i
         JOIN tracks tr ON tr.id = i.track_id
         JOIN timelines t ON t.id = i.timeline_id
         WHERE i.asset_version_id IN (${inList})
         ORDER BY t.name, tr.track_order, i.start_time`,
      ).all as (...values: unknown[]) => unknown[])(
        ...versionIds,
      ) as Record<string, unknown>[]
    ) as unknown as DependencyTimelineItem[];
    timeline_items = timelineRows;

    const panelRows = (
      (db.prepare(
        `SELECT p.storyboard_id, b.name AS storyboard_name, p.id AS panel_id,
                p.shot_number,
                p.preview_asset_version_id AS preview_version_id,
                p.generated_clip_asset_version_id AS clip_version_id
         FROM storyboard_panels p
         JOIN storyboards b ON b.id = p.storyboard_id
         WHERE p.preview_asset_version_id IN (${inList})
            OR p.generated_clip_asset_version_id IN (${inList})
         ORDER BY b.name, p.panel_order`,
      ).all as (...values: unknown[]) => unknown[])(
        ...versionIds,
        ...versionIds,
      ) as Record<string, unknown>[]
    )
      .flatMap((row) => {
        const base = {
          storyboard_id: row.storyboard_id as string,
          storyboard_name: row.storyboard_name as string,
          panel_id: row.panel_id as string,
          shot_number: asNullableString(row.shot_number),
        };
        const results: DependencyPanelPointer[] = [];
        const previewId = asNullableString(row.preview_version_id);
        const clipId = asNullableString(row.clip_version_id);
        if (previewId) {
          results.push({ ...base, pointer: "preview", version_id: previewId });
        }
        if (clipId) {
          results.push({ ...base, pointer: "clip", version_id: clipId });
        }
        return results;
      });
    panels = panelRows;

    const shotRows = (
      (db.prepare(
        `SELECT s.scene_id, c.name AS scene_name, s.id AS shot_id,
                s.shot_order, s.generated_asset_version_id AS version_id
         FROM shots s
         JOIN scenes c ON c.id = s.scene_id
         WHERE s.generated_asset_version_id IN (${inList})
         ORDER BY c.name, s.shot_order`,
      ).all as (...values: unknown[]) => unknown[])(
        ...versionIds,
      ) as Record<string, unknown>[]
    ) as unknown as DependencyShotClip[];
    shots = shotRows;
  }

  prompt_references = mapPromptReferences(auditReferences({ asset_id: assetId }));

  const totals = {
    prompt_references: prompt_references.length,
    timeline_items: timeline_items.length,
    panels: panels.length,
    shots: shots.length,
  };

  return {
    asset_id: assetId,
    prompt_references,
    timeline_items,
    panels,
    shots,
    totals: {
      ...totals,
      total: totals.prompt_references +
        totals.timeline_items +
        totals.panels +
        totals.shots,
    },
  };
}
