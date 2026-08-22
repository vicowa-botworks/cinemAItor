import { getDb } from "../db/database.ts";

// ---------------------------------------------------------------------------
// DIA-006 / DIA-007: project backup and restore
//
// A backup is a JSON snapshot of one project's subtree: assets, timelines,
// and creative objects (storyboards, panels, scenes, shots) with their
// prompt version history and resolved references. Media binaries are never
// copied: versions keep their content hash, so a restore can verify which
// files are still in the content store and report the ones that are missing.
//
// Schema 2 adds the creative-object sections; schema 1 backups restore with
// empty creative sections. Schema 3 adds full timeline snapshots; snapshots
// in older backups are skipped and reported as issues.
// ---------------------------------------------------------------------------

export interface BackupProjectData {
  id: string;
  name: string;
  description: string | null;
  aspect_ratio: string | null;
  frame_rate: number | null;
  resolution_width: number | null;
  resolution_height: number | null;
  color_space: string | null;
  audio_sample_rate: number | null;
  default_export_preset_id: string | null;
  default_model_preferences_json: string | null;
  template_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface BackupAssetData {
  id: string;
  library_scope: string;
  unique_slug: string;
  display_name: string;
  asset_type: string;
  description: string | null;
  status: string;
  source_type: string;
  license: string | null;
  rights_status: string | null;
  attribution: string | null;
  parent_asset_id: string | null;
  active_version_id: string | null;
  preview_version_id: string | null;
  created_at: string;
  aliases: string[];
  tags: string[];
  versions: {
    id: string;
    version_number: number;
    status: string;
    content_hash: string | null;
    file_path: string | null;
    format: string | null;
    mime_type: string | null;
    file_size: number | null;
    technical_metadata_json: string | null;
    notes: string | null;
    created_at: string;
  }[];
}

export interface BackupTimelineData {
  id: string;
  name: string;
  duration: number;
  settings_json: string | null;
  created_at: string;
  tracks: {
    id: string;
    track_type: string;
    name: string;
    track_order: number;
    locked: boolean;
    muted: boolean;
  }[];
  items: {
    id: string;
    track_id: string;
    asset_version_id: string | null;
    start_time: number;
    end_time: number;
    source_offset: number;
    speed: number;
    transform_json: string | null;
    fade_in: number | null;
    fade_out: number | null;
    transition: string | null;
    effect_chain_json: string | null;
    color_grade_json: string | null;
    audio_settings_json: string | null;
    notes: string | null;
    status: string;
    created_at: string;
  }[];
  markers: {
    id: string;
    time: number;
    label: string | null;
    notes: string | null;
  }[];
  /**
   * Schema 3: full snapshot rows, restored with remapped ids. Schema 1/2
   * documents carry a plain count here instead (skipped on restore).
   */
  snapshots: BackupSnapshotData[] | number;
}

export interface BackupSnapshotData {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  /** Parsed `snapshot_data_json`; null when the stored JSON was unreadable. */
  snapshot_data: Record<string, unknown> | null;
}

export interface BackupShotData {
  id: string;
  scene_id: string;
  shot_order: number;
  name: string | null;
  prompt_version_id: string | null;
  duration: number | null;
  camera_settings_json: string | null;
  status: string;
  generated_asset_version_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BackupSceneData {
  id: string;
  storyboard_id: string | null;
  name: string;
  description: string | null;
  prompt_version_id: string | null;
  status: string;
  target_duration: number | null;
  aspect_ratio_override: string | null;
  frame_rate_override: number | null;
  notes: string | null;
  audio_plan_json: string | null;
  created_at: string;
  updated_at: string;
  shots: BackupShotData[];
}

export interface BackupPanelData {
  id: string;
  panel_order: number;
  shot_number: string | null;
  description: string | null;
  prompt_version_id: string | null;
  duration: number | null;
  camera_settings_json: string | null;
  mood: string | null;
  lighting: string | null;
  time_of_day: string | null;
  dialogue: string | null;
  voiceover: string | null;
  music_cue: string | null;
  sfx: string | null;
  transition: string | null;
  notes: string | null;
  status: string;
  preview_asset_version_id: string | null;
  generated_clip_asset_version_id: string | null;
  linked_scene_id: string | null;
  linked_shot_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BackupStoryboardData {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  panels: BackupPanelData[];
}

export interface BackupPromptVersionData {
  id: string;
  scope_type: string;
  scope_id: string;
  version_number: number;
  content: string;
  content_hash: string;
  parent_prompt_id: string | null;
  created_at: string;
}

export interface BackupReferenceData {
  id: string;
  source_type: string;
  source_id: string;
  asset_id: string | null;
  asset_version_id: string | null;
  role: string | null;
  raw_text: string;
  start_index: number | null;
  end_index: number | null;
  status: string;
  notes: string | null;
}

export interface ProjectBackupData {
  schema: 1 | 2 | 3;
  created_at: string;
  project: BackupProjectData;
  assets: BackupAssetData[];
  timelines: BackupTimelineData[];
  storyboards: BackupStoryboardData[];
  scenes: BackupSceneData[];
  prompts: BackupPromptVersionData[];
  references: BackupReferenceData[];
}

export interface BackupCounts {
  assets: number;
  versions: number;
  aliases: number;
  tags: number;
  timelines: number;
  tracks: number;
  items: number;
  markers: number;
  snapshots: number;
  storyboards: number;
  panels: number;
  scenes: number;
  shots: number;
  prompts: number;
  references: number;
}

export interface BackupFileManifest {
  hash: string;
  size: number | null;
  present: boolean;
}

type Row = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
function asBool(value: unknown): boolean {
  return value === 1 || value === true;
}

/** Read the full backup payload for a project (no I/O beyond queries). */
export function buildProjectBackupData(projectId: string): ProjectBackupData {
  const db = getDb();
  const projectRow = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId) as Row | undefined;
  if (!projectRow) throw new Error("Project not found");

  const projectIdValue = asString(projectRow.project_id) ?? projectId;
  const project: BackupProjectData = {
    id: projectIdValue,
    name: asString(projectRow.name) ?? "",
    description: asString(projectRow.description),
    aspect_ratio: asString(projectRow.aspect_ratio),
    frame_rate: asNumber(projectRow.frame_rate),
    resolution_width: asNumber(projectRow.resolution_width),
    resolution_height: asNumber(projectRow.resolution_height),
    color_space: asString(projectRow.color_space),
    audio_sample_rate: asNumber(projectRow.audio_sample_rate),
    default_export_preset_id: asString(projectRow.default_export_preset_id),
    default_model_preferences_json: asString(
      projectRow.default_model_preferences_json,
    ),
    template_id: asString(projectRow.template_id),
    status: asString(projectRow.status) ?? "active",
    created_at: asString(projectRow.created_at) ?? "",
    updated_at: asString(projectRow.updated_at) ?? "",
  };

  const assets: BackupAssetData[] = [];
  const assetRows = db
    .prepare("SELECT * FROM assets WHERE project_id = ? ORDER BY created_at")
    .all(projectId) as unknown as Row[];
  for (const row of assetRows) {
    const assetId = asString(row.id) as string;
    const versions = (
      db
        .prepare(
          `SELECT * FROM asset_versions WHERE asset_id = ?
           ORDER BY version_number`,
        )
        .all(assetId) as unknown as Row[]
    ).map((v) => ({
      id: asString(v.id) as string,
      version_number: Number(v.version_number ?? 1),
      status: asString(v.status) ?? "draft",
      content_hash: asString(v.content_hash),
      file_path: asString(v.file_path),
      format: asString(v.format),
      mime_type: asString(v.mime_type),
      file_size: asNumber(v.file_size),
      technical_metadata_json: asString(v.technical_metadata_json),
      notes: asString(v.notes),
      created_at: asString(v.created_at) ?? "",
    }));
    const aliases = (
      db
        .prepare(
          "SELECT alias_slug FROM asset_aliases WHERE asset_id = ? ORDER BY alias_slug",
        )
        .all(assetId) as unknown as Row[]
    ).map((a) => asString(a.alias_slug) as string);
    const tags = (
      db
        .prepare("SELECT tag FROM asset_tags WHERE asset_id = ? ORDER BY tag")
        .all(assetId) as unknown as Row[]
    ).map((t) => asString(t.tag) as string);

    assets.push({
      id: assetId,
      library_scope: asString(row.library_scope) ?? "project",
      unique_slug: asString(row.unique_slug) as string,
      display_name: asString(row.display_name) as string,
      asset_type: asString(row.asset_type) as string,
      description: asString(row.description),
      status: asString(row.status) ?? "draft",
      source_type: asString(row.source_type) ?? "uploaded",
      license: asString(row.license),
      rights_status: asString(row.rights_status),
      attribution: asString(row.attribution),
      parent_asset_id: asString(row.parent_asset_id),
      active_version_id: asString(row.active_version_id),
      preview_version_id: asString(row.preview_version_id),
      created_at: asString(row.created_at) ?? "",
      aliases,
      tags,
      versions,
    });
  }

  const timelines: BackupTimelineData[] = [];
  const timelineRows = db
    .prepare("SELECT * FROM timelines WHERE project_id = ? ORDER BY created_at")
    .all(projectId) as unknown as Row[];
  for (const tRow of timelineRows) {
    const timelineId = asString(tRow.id) as string;
    const tracks = (
      db
        .prepare("SELECT * FROM tracks WHERE timeline_id = ? ORDER BY track_order")
        .all(timelineId) as unknown as Row[]
    ).map((t) => ({
      id: asString(t.id) as string,
      track_type: asString(t.track_type) as string,
      name: asString(t.name) as string,
      track_order: Number(t.track_order ?? 0),
      locked: asBool(t.locked),
      muted: asBool(t.muted),
    }));
    const items = (
      db
        .prepare(
          `SELECT * FROM timeline_items WHERE timeline_id = ? ORDER BY start_time`,
        )
        .all(timelineId) as unknown as Row[]
    ).map((i) => ({
      id: asString(i.id) as string,
      track_id: asString(i.track_id) as string,
      asset_version_id: asString(i.asset_version_id),
      start_time: Number(i.start_time ?? 0),
      end_time: Number(i.end_time ?? 0),
      source_offset: Number(i.source_offset ?? 0),
      speed: Number(i.speed ?? 1),
      transform_json: asString(i.transform_json),
      fade_in: asNumber(i.fade_in),
      fade_out: asNumber(i.fade_out),
      transition: asString(i.transition),
      effect_chain_json: asString(i.effect_chain_json),
      color_grade_json: asString(i.color_grade_json),
      audio_settings_json: asString(i.audio_settings_json),
      notes: asString(i.notes),
      status: asString(i.status) ?? "active",
      created_at: asString(i.created_at) ?? "",
    }));
    const markers = (
      db
        .prepare("SELECT * FROM timeline_markers WHERE timeline_id = ? ORDER BY time")
        .all(timelineId) as unknown as Row[]
    ).map((m) => ({
      id: asString(m.id) as string,
      time: Number(m.time ?? 0),
      label: asString(m.label),
      notes: asString(m.notes),
    }));
    const snapshots: BackupSnapshotData[] = (
      db
        .prepare(
          `SELECT id, name, notes, created_at, snapshot_data_json
           FROM timeline_snapshots WHERE timeline_id = ? ORDER BY created_at`,
        )
        .all(timelineId) as unknown as Row[]
    ).map((s) => {
      let parsed: Record<string, unknown> | null = null;
      const raw = asString(s.snapshot_data_json);
      if (raw) {
        try {
          const value: unknown = JSON.parse(raw);
          if (value && typeof value === "object" && !Array.isArray(value)) {
            parsed = value as Record<string, unknown>;
          }
        } catch {
          // Unreadable snapshot data: kept in the backup, reported on restore.
        }
      }
      return {
        id: asString(s.id) as string,
        name: asString(s.name) ?? "Snapshot",
        notes: asString(s.notes),
        created_at: asString(s.created_at) ?? "",
        snapshot_data: parsed,
      };
    });

    timelines.push({
      id: timelineId,
      name: asString(tRow.name) ?? "Timeline",
      duration: Number(tRow.duration ?? 0),
      settings_json: asString(tRow.settings_json),
      created_at: asString(tRow.created_at) ?? "",
      tracks,
      items,
      markers,
      snapshots,
    });
  }

  const storyboards: BackupStoryboardData[] = [];
  const scenes: BackupSceneData[] = [];
  const panelScopeIds: string[] = [];
  const shotScopeIds: string[] = [];
  const sceneScopeIds: string[] = [];
  const storyboardRows = db
    .prepare("SELECT * FROM storyboards WHERE project_id = ? ORDER BY created_at")
    .all(projectId) as unknown as Row[];
  for (const sRow of storyboardRows) {
    const storyboardId = asString(sRow.id) as string;
    const panels = (
      db
        .prepare(
          "SELECT * FROM storyboard_panels WHERE storyboard_id = ? ORDER BY panel_order",
        )
        .all(storyboardId) as unknown as Row[]
    ).map((p) => {
      const panel: BackupPanelData = {
        id: asString(p.id) as string,
        panel_order: Number(p.panel_order ?? 0),
        shot_number: asString(p.shot_number),
        description: asString(p.description),
        prompt_version_id: asString(p.prompt_version_id),
        duration: asNumber(p.duration),
        camera_settings_json: asString(p.camera_settings_json),
        mood: asString(p.mood),
        lighting: asString(p.lighting),
        time_of_day: asString(p.time_of_day),
        dialogue: asString(p.dialogue),
        voiceover: asString(p.voiceover),
        music_cue: asString(p.music_cue),
        sfx: asString(p.sfx),
        transition: asString(p.transition),
        notes: asString(p.notes),
        status: asString(p.status) ?? "draft",
        preview_asset_version_id: asString(p.preview_asset_version_id),
        generated_clip_asset_version_id: asString(p.generated_clip_asset_version_id),
        linked_scene_id: asString(p.linked_scene_id),
        linked_shot_id: asString(p.linked_shot_id),
        created_at: asString(p.created_at) ?? "",
        updated_at: asString(p.updated_at) ?? "",
      };
      panelScopeIds.push(panel.id);
      return panel;
    });
    storyboards.push({
      id: storyboardId,
      name: asString(sRow.name) ?? "Storyboard",
      status: asString(sRow.status) ?? "draft",
      created_at: asString(sRow.created_at) ?? "",
      updated_at: asString(sRow.updated_at) ?? "",
      panels,
    });
  }
  const sceneRows = db
    .prepare("SELECT * FROM scenes WHERE project_id = ? ORDER BY created_at")
    .all(projectId) as unknown as Row[];
  for (const scRow of sceneRows) {
    const sceneId = asString(scRow.id) as string;
    sceneScopeIds.push(sceneId);
    const shots = (
      db
        .prepare("SELECT * FROM shots WHERE scene_id = ? ORDER BY shot_order")
        .all(sceneId) as unknown as Row[]
    ).map((s) => {
      shotScopeIds.push(asString(s.id) as string);
      const shot: BackupShotData = {
        id: asString(s.id) as string,
        scene_id: sceneId,
        shot_order: Number(s.shot_order ?? 0),
        name: asString(s.name),
        prompt_version_id: asString(s.prompt_version_id),
        duration: asNumber(s.duration),
        camera_settings_json: asString(s.camera_settings_json),
        status: asString(s.status) ?? "draft",
        generated_asset_version_id: asString(s.generated_asset_version_id),
        notes: asString(s.notes),
        created_at: asString(s.created_at) ?? "",
        updated_at: asString(s.updated_at) ?? "",
      };
      return shot;
    });
    scenes.push({
      id: sceneId,
      storyboard_id: asString(scRow.storyboard_id),
      name: asString(scRow.name) ?? "Scene",
      description: asString(scRow.description),
      prompt_version_id: asString(scRow.prompt_version_id),
      status: asString(scRow.status) ?? "draft",
      target_duration: asNumber(scRow.target_duration),
      aspect_ratio_override: asString(scRow.aspect_ratio_override),
      frame_rate_override: asNumber(scRow.frame_rate_override),
      notes: asString(scRow.notes),
      audio_plan_json: asString(scRow.audio_plan_json),
      created_at: asString(scRow.created_at) ?? "",
      updated_at: asString(scRow.updated_at) ?? "",
      shots,
    });
  }

  // Prompt versions for every creative object (full history per scope).
  const scopes: [string, string[]][] = [
    ["storyboard_panel", panelScopeIds],
    ["scene", sceneScopeIds],
    ["shot", shotScopeIds],
  ];
  const prompts: BackupPromptVersionData[] = [];
  const promptIds: string[] = [];
  for (const [scopeType, scopeIds] of scopes) {
    for (const scopeId of scopeIds) {
      const rows = db.prepare(
        `SELECT * FROM prompt_versions
         WHERE scope_type = ? AND scope_id = ?
         ORDER BY version_number`,
      ).all(scopeType, scopeId) as unknown as Row[];
      for (const pRow of rows) {
        const prompt: BackupPromptVersionData = {
          id: asString(pRow.id) as string,
          scope_type: asString(pRow.scope_type) as string,
          scope_id: asString(pRow.scope_id) as string,
          version_number: Number(pRow.version_number ?? 0),
          content: asString(pRow.content) ?? "",
          content_hash: asString(pRow.content_hash) ?? "",
          parent_prompt_id: asString(pRow.parent_prompt_id),
          created_at: asString(pRow.created_at) ?? "",
        };
        prompts.push(prompt);
        promptIds.push(prompt.id);
      }
    }
  }

  const references: BackupReferenceData[] = [];
  if (promptIds.length > 0) {
    const inList = promptIds.map(() => "?").join(", ");
    const refRows = db
      .prepare(
        `SELECT * FROM asset_references
         WHERE source_type IN ('storyboard_panel', 'scene', 'shot')
           AND source_id IN (${inList})
         ORDER BY source_type, source_id, COALESCE(start_index, 0)`,
      )
      .all(...promptIds) as unknown as Row[];
    for (const rRow of refRows) {
      references.push({
        id: asString(rRow.id) as string,
        source_type: asString(rRow.source_type) as string,
        source_id: asString(rRow.source_id) as string,
        asset_id: asString(rRow.asset_id),
        asset_version_id: asString(rRow.asset_version_id),
        role: asString(rRow.role),
        raw_text: asString(rRow.raw_text) ?? "",
        start_index: asNumber(rRow.start_index),
        end_index: asNumber(rRow.end_index),
        status: asString(rRow.status) ?? "resolved",
        notes: asString(rRow.notes),
      });
    }
  }

  return {
    schema: 3,
    created_at: new Date().toISOString(),
    project,
    assets,
    timelines,
    storyboards,
    scenes,
    prompts,
    references,
  };
}

export function backupCounts(data: ProjectBackupData): BackupCounts {
  return {
    assets: data.assets.length,
    versions: data.assets.reduce((n, a) => n + a.versions.length, 0),
    aliases: data.assets.reduce((n, a) => n + a.aliases.length, 0),
    tags: data.assets.reduce((n, a) => n + a.tags.length, 0),
    timelines: data.timelines.length,
    tracks: data.timelines.reduce((n, t) => n + t.tracks.length, 0),
    items: data.timelines.reduce((n, t) => n + t.items.length, 0),
    markers: data.timelines.reduce((n, t) => n + t.markers.length, 0),
    snapshots: data.timelines.reduce(
      (n, t) => n + (typeof t.snapshots === "number" ? t.snapshots : t.snapshots.length),
      0,
    ),
    storyboards: data.storyboards?.length ?? 0,
    panels: data.storyboards?.reduce((n, b) => n + b.panels.length, 0) ?? 0,
    scenes: data.scenes?.length ?? 0,
    shots: data.scenes?.reduce((n, s) => n + s.shots.length, 0) ?? 0,
    prompts: data.prompts?.length ?? 0,
    references: data.references?.length ?? 0,
  };
}

/** Unique media hashes referenced by the backup, with store presence. */
export function backupMediaManifest(
  data: ProjectBackupData,
  resolve: (hash: string) => string | undefined,
): BackupFileManifest[] {
  const seen = new Map<string, { size: number | null; present: boolean }>();
  for (const asset of data.assets) {
    for (const version of asset.versions) {
      if (!version.content_hash) continue;
      const present = resolve(version.content_hash) !== undefined;
      const existing = seen.get(version.content_hash);
      if (!existing) {
        seen.set(version.content_hash, { size: version.file_size, present });
      } else if (present) {
        existing.present = true;
      }
    }
  }
  return [...seen.entries()]
    .map(([hash, info]) => ({ hash, ...info }))
    .sort((a, b) => a.hash.localeCompare(b.hash));
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export interface RestoreOptions {
  userId: number;
  project_name?: string;
  /** Content-store presence probe; missing files become restore issues. */
  resolveContent?: (hash: string) => string | undefined;
}

export interface RestoreResult {
  project_id: string;
  project_name: string;
  counts: BackupCounts;
  issues: string[];
}

interface RemappedSnapshot {
  /** Snapshot payload ready for `replaceTimelineState`. */
  data: Record<string, unknown>;
  /** Tracks/items/markers dropped because their targets were not restored. */
  dropped: number;
}

/**
 * Rewrite the ids embedded in a snapshot payload to the restored objects'
 * id. Entries whose targets (track, item, marker, media version) were not
 * part of this restore are dropped and counted.
 */
function remapSnapshotData(
  raw: Record<string, unknown> | null,
  trackMap: Map<string, string>,
  itemMap: Map<string, string>,
  markerMap: Map<string, string>,
  versionMap: Map<string, string>,
): RemappedSnapshot | null {
  if (!raw) return null;
  const lookup = (
    map: Map<string, string>,
    id: unknown,
  ): string | undefined => (typeof id === "string" ? map.get(id) : undefined);

  const dropped = { tracks: 0, items: 0, markers: 0 };

  const tracks = (Array.isArray(raw.tracks) ? raw.tracks : [])
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map((t): Record<string, unknown> | null => {
      const id = lookup(trackMap, t.id);
      if (!id) {
        dropped.tracks++;
        return null;
      }
      return { ...t, id };
    })
    .filter((t): t is Record<string, unknown> => t !== null);

  const trackIds = new Set(tracks.map((t) => t.id as string));
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
    .map((i): Record<string, unknown> | null => {
      const id = lookup(itemMap, i.id);
      const trackId = lookup(trackMap, i.track_id);
      const versionId = i.asset_version_id ? lookup(versionMap, i.asset_version_id) : undefined;
      if (!id || !trackId || !trackIds.has(trackId) || !versionId) {
        dropped.items++;
        return null;
      }
      return { ...i, id, track_id: trackId, asset_version_id: versionId };
    })
    .filter((i): i is Record<string, unknown> => i !== null);

  const markers = (Array.isArray(raw.markers) ? raw.markers : [])
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
    .map((m): Record<string, unknown> | null => {
      const id = lookup(markerMap, m.id);
      if (!id) {
        dropped.markers++;
        return null;
      }
      return { ...m, id };
    })
    .filter((m): m is Record<string, unknown> => m !== null);

  const data: Record<string, unknown> = { ...raw };
  data.tracks = tracks;
  data.items = items;
  data.markers = markers;
  return {
    data,
    dropped: dropped.tracks + dropped.items + dropped.markers,
  };
}

function uniqueSlug(base: string): string {
  const db = getDb();
  const exists = (slug: string) => {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM assets WHERE unique_slug = ?")
      .get(slug) as unknown as { n: number };
    return Number(row.n) > 0;
  };
  if (!exists(base)) return base;
  // Collision: suffix with a short random tag until it is free.
  const suffix = crypto.randomUUID().slice(0, 8);
  const short = base.slice(0, 64 - suffix.length - 1);
  return `${short}_${suffix}`;
}

function uniqueAlias(base: string): string {
  const db = getDb();
  const exists = (alias: string) => {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM asset_aliases WHERE alias_slug = ?")
      .get(alias) as unknown as { n: number };
    return Number(row.n) > 0;
  };
  if (!exists(base)) return base;
  const suffix = crypto.randomUUID().slice(0, 8);
  const short = base.slice(0, 100 - suffix.length - 1);
  return `${short}_${suffix}`;
}

/**
 * Restore a backup into a brand-new project owned by `userId`. All ids are
 * fresh UUIDs; foreign keys (assets inside a project, versions, tracks,
 * items, creative objects, prompt versions, references) are remapped.
 * Schema 3 snapshots are restored with their embedded ids remapped to the
 * restored objects (snapshot entries referring to objects outside the
 * backup are dropped and reported). Snapshots from schema 1/2 backups are
 * skipped and reported, as are versions whose media is missing and creative
 * links whose targets were not part of the backup.
 */
export function restoreProjectBackup(
  data: ProjectBackupData,
  options: RestoreOptions,
): RestoreResult {
  if (data.schema !== 1 && data.schema !== 2 && data.schema !== 3) {
    throw new Error(`Unsupported backup schema: ${String(data.schema)}`);
  }
  const db = getDb();
  const issues: string[] = [];
  const now = new Date().toISOString();
  const sourceName = data.project.name || "Project";
  const name = options.project_name?.trim() || `${sourceName} (restored)`;

  db.exec("BEGIN");
  try {
    const projectId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO projects (
        id, name, description, media_directory, output_directory, aspect_ratio,
        frame_rate, resolution_width, resolution_height, color_space,
        audio_sample_rate, default_export_preset_id,
        default_model_preferences_json, template_id, status, created_at,
        updated_at, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      projectId,
      name,
      data.project.description,
      `projects/${projectId}/media`,
      `projects/${projectId}/output`,
      data.project.aspect_ratio,
      data.project.frame_rate,
      data.project.resolution_width,
      data.project.resolution_height,
      data.project.color_space,
      data.project.audio_sample_rate,
      data.project.default_export_preset_id,
      data.project.default_model_preferences_json,
      data.project.template_id,
      data.project.status,
      now,
      now,
      options.userId,
    );

    const versionMap = new Map<string, string>();
    const assetMap = new Map<string, string>();
    const versionAssetMap = new Map<string, string>();
    const versionInsert = db.prepare(
      `INSERT INTO asset_versions (
        id, asset_id, version_number, status, content_hash, file_path, format,
        mime_type, file_size, checksum_algorithm, technical_metadata_json,
        notes, created_at, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sha256', ?, ?, ?, ?)`,
    );
    const insertAsset = db.prepare(
      `INSERT INTO assets (
        id, library_scope, project_id, unique_slug, display_name, asset_type,
        description, status, source_type, license, rights_status, attribution,
        parent_asset_id, active_version_id, preview_version_id, created_at,
        updated_at, created_by_user_id
      ) VALUES (?, 'project', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    );
    const insertAlias = db.prepare(
      `INSERT INTO asset_aliases (id, asset_id, alias_slug, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    const insertTag = db.prepare(
      "INSERT OR IGNORE INTO asset_tags (id, asset_id, tag) VALUES (?, ?, ?)",
    );

    const updateAssetVersions = db.prepare(
      `UPDATE assets SET active_version_id = ?, preview_version_id = ? WHERE id = ?`,
    );

    for (const asset of data.assets) {
      const newAssetId = crypto.randomUUID();
      assetMap.set(asset.id, newAssetId);
      const newVersionIds = new Map<string, string>();

      for (const version of asset.versions) {
        const newVersionId = crypto.randomUUID();
        newVersionIds.set(version.id, newVersionId);
        versionAssetMap.set(version.id, asset.id);
      }

      // The asset row must exist before its versions (FK asset_id).
      insertAsset.run(
        newAssetId,
        projectId,
        uniqueSlug(asset.unique_slug),
        asset.display_name,
        asset.asset_type,
        asset.description,
        asset.status,
        asset.source_type,
        asset.license,
        asset.rights_status,
        asset.attribution,
        null,
        null,
        asset.created_at || now,
        now,
        options.userId,
      );

      let activeVersionId: string | null = null;
      let previewVersionId: string | null = null;

      for (const version of asset.versions) {
        const newVersionId = newVersionIds.get(version.id) as string;
        versionMap.set(version.id, newVersionId);
        let filePath: string | null = version.file_path;
        if (version.content_hash) {
          const resolved = options.resolveContent
            ? options.resolveContent(version.content_hash)
            : version.file_path;
          filePath = resolved ?? null;
          if (!filePath) {
            issues.push(
              `version v${version.version_number} of "${asset.display_name}": media not in content store (hash ${
                version.content_hash.slice(0, 12)
              }…)`,
            );
            // The version row is still restored so the item slots keep their
            // ordering; consumers must treat the missing media as an error.
          }
        }
        (versionInsert.run as (...params: unknown[]) => unknown)(
          newVersionId,
          newAssetId,
          version.version_number,
          version.status,
          version.content_hash,
          filePath,
          version.format,
          version.mime_type,
          version.file_size,
          version.technical_metadata_json,
          version.notes,
          version.created_at || now,
          options.userId,
        );
        if (asset.active_version_id === version.id) {
          activeVersionId = newVersionId;
        }
        if (asset.preview_version_id === version.id) {
          previewVersionId = newVersionId;
        }
      }

      (updateAssetVersions.run as (...params: unknown[]) => unknown)(
        activeVersionId,
        previewVersionId,
        newAssetId,
      );

      for (const alias of asset.aliases) {
        insertAlias.run(
          crypto.randomUUID(),
          newAssetId,
          uniqueAlias(alias),
          now,
        );
      }
      for (const tag of asset.tags) {
        (insertTag.run as (...params: unknown[]) => unknown)(
          crypto.randomUUID(),
          newAssetId,
          tag,
        );
      }
    }

    // ---- Creative objects (schema 2) ------------------------------------
    // Storyboards, scenes and shots get fresh ids; prompt-version history is
    // restored per scope and every creative pointer (prompt_version_id,
    // preview/clip/generation version ids, scene links, scene.storyboard_id)
    // is remapped. Pointers at objects that were not part of the backup are
    // nulled and reported as issues. Asset reference ids (asset / version)
    // are globally unique: versions restored above are remapped, others stay
    // untouched.
    const storyboards = (data.storyboards ?? []).slice();
    const scenes = (data.scenes ?? []).slice();
    const prompts = (data.prompts ?? []).slice();
    const references = (data.references ?? []).slice();

    const creativeNewIds = new Map<string, string>();
    for (const board of storyboards) {
      creativeNewIds.set(board.id, crypto.randomUUID());
      for (const panel of board.panels) creativeNewIds.set(panel.id, crypto.randomUUID());
    }
    for (const scene of scenes) {
      creativeNewIds.set(scene.id, crypto.randomUUID());
      for (const shot of scene.shots) creativeNewIds.set(shot.id, crypto.randomUUID());
    }

    const insertStoryboard = db.prepare(
      `INSERT INTO storyboards (
        id, project_id, name, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertPanel = db.prepare(
      `INSERT INTO storyboard_panels (
        id, storyboard_id, panel_order, shot_number, description,
        prompt_version_id, duration, camera_settings_json, mood, lighting,
        time_of_day, dialogue, voiceover, music_cue, sfx, transition, notes,
        status, preview_asset_version_id, generated_clip_asset_version_id,
        linked_scene_id, linked_shot_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?)`,
    );
    const insertScene = db.prepare(
      `INSERT INTO scenes (
        id, project_id, storyboard_id, name, description, prompt_version_id,
        status, target_duration, aspect_ratio_override, frame_rate_override,
        notes, audio_plan_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertShot = db.prepare(
      `INSERT INTO shots (
        id, scene_id, shot_order, name, prompt_version_id, duration,
        camera_settings_json, status, generated_asset_version_id, notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertPrompt = db.prepare(
      `INSERT INTO prompt_versions (
        id, scope_type, scope_id, version_number, content, content_hash,
        parent_prompt_id, created_at, created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertReference = db.prepare(
      `INSERT INTO asset_references (
        id, source_type, source_id, asset_id, asset_version_id, role, raw_text,
        start_index, end_index, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const remapVersion = (versionId: string | null): string | null =>
      versionId ? versionMap.get(versionId) ?? null : null;
    const remapCreative = (id: string | null): string | null =>
      id ? creativeNewIds.get(id) ?? null : null;

    const newPromptIds = new Map<string, string>();
    for (const prompt of prompts) {
      const newScopeId = creativeNewIds.get(prompt.scope_id);
      if (!newScopeId) {
        issues.push(
          `prompt ${prompt.scope_type}:${
            prompt.scope_id.slice(
              0,
              8,
            )
          }: creative object not in backup, skipped`,
        );
        continue;
      }
      newPromptIds.set(prompt.id, crypto.randomUUID());
    }
    const remapPrompt = (versionId: string | null): string | null =>
      versionId ? newPromptIds.get(versionId) ?? null : null;

    for (const board of storyboards) {
      (insertStoryboard.run as (...params: unknown[]) => unknown)(
        creativeNewIds.get(board.id) as string,
        projectId,
        board.name,
        board.status,
        board.created_at || now,
        now,
      );
      const newBoardId = creativeNewIds.get(board.id) as string;
      for (const panel of board.panels) {
        const newPanelId = creativeNewIds.get(panel.id) as string;
        const newPanelPrompt = remapPrompt(panel.prompt_version_id);
        if (panel.prompt_version_id && newPanelPrompt === null) {
          issues.push(
            `panel "${panel.description ?? panel.id.slice(0, 8)}": prompt version not in backup`,
          );
        }
        const newLinkedScene = remapCreative(panel.linked_scene_id);
        if (panel.linked_scene_id && newLinkedScene === null) {
          issues.push(
            `panel "${panel.description ?? panel.id.slice(0, 8)}": linked scene not in backup`,
          );
        }
        const newLinkedShot = remapCreative(panel.linked_shot_id);
        if (panel.linked_shot_id && newLinkedShot === null) {
          issues.push(
            `panel "${panel.description ?? panel.id.slice(0, 8)}": linked shot not in backup`,
          );
        }
        (insertPanel.run as (...params: unknown[]) => unknown)(
          newPanelId,
          newBoardId,
          panel.panel_order,
          panel.shot_number,
          panel.description,
          newPanelPrompt,
          panel.duration,
          panel.camera_settings_json,
          panel.mood,
          panel.lighting,
          panel.time_of_day,
          panel.dialogue,
          panel.voiceover,
          panel.music_cue,
          panel.sfx,
          panel.transition,
          panel.notes,
          panel.status,
          remapVersion(panel.preview_asset_version_id),
          remapVersion(panel.generated_clip_asset_version_id),
          newLinkedScene,
          newLinkedShot,
          panel.created_at || now,
          now,
        );
      }
    }

    for (const scene of scenes) {
      const newSceneId = creativeNewIds.get(scene.id) as string;
      const newStoryboardId = remapCreative(scene.storyboard_id);
      if (scene.storyboard_id && newStoryboardId === null) {
        issues.push(`scene "${scene.name}": storyboard not in backup`);
      }
      const newScenePrompt = remapPrompt(scene.prompt_version_id);
      if (scene.prompt_version_id && newScenePrompt === null) {
        issues.push(`scene "${scene.name}": prompt version not in backup`);
      }
      (insertScene.run as (...params: unknown[]) => unknown)(
        newSceneId,
        projectId,
        newStoryboardId,
        scene.name,
        scene.description,
        newScenePrompt,
        scene.status,
        scene.target_duration,
        scene.aspect_ratio_override,
        scene.frame_rate_override,
        scene.notes,
        scene.audio_plan_json,
        scene.created_at || now,
        now,
      );
      for (const shot of scene.shots) {
        const newShotPrompt = remapPrompt(shot.prompt_version_id);
        if (shot.prompt_version_id && newShotPrompt === null) {
          issues.push(
            `shot "${shot.name ?? shot.id.slice(0, 8)}": prompt version not in backup`,
          );
        }
        (insertShot.run as (...params: unknown[]) => unknown)(
          creativeNewIds.get(shot.id) as string,
          newSceneId,
          shot.shot_order,
          shot.name,
          newShotPrompt,
          shot.duration,
          shot.camera_settings_json,
          shot.status,
          remapVersion(shot.generated_asset_version_id),
          shot.notes,
          shot.created_at || now,
          now,
        );
      }
    }

    for (const prompt of prompts) {
      const newPromptId = newPromptIds.get(prompt.id);
      if (!newPromptId) continue; // unknown scope: reported above
      const remappedParent = prompt.parent_prompt_id
        ? newPromptIds.get(prompt.parent_prompt_id) ?? null
        : null;
      if (prompt.parent_prompt_id && remappedParent === null) {
        issues.push(
          `prompt ${prompt.scope_type}:${
            prompt.scope_id.slice(
              0,
              8,
            )
          }: parent prompt not restored`,
        );
      }
      (insertPrompt.run as (...params: unknown[]) => unknown)(
        newPromptId,
        prompt.scope_type,
        creativeNewIds.get(prompt.scope_id) as string,
        prompt.version_number,
        prompt.content,
        prompt.content_hash,
        remappedParent,
        prompt.created_at || now,
        options.userId,
      );
    }

    for (const ref of references) {
      // source_id is the prompt version id the reference was resolved from.
      const newSourceId = newPromptIds.get(ref.source_id);
      if (!newSourceId) {
        issues.push(
          `reference "${ref.raw_text}": source prompt not restored, skipped`,
        );
        continue;
      }
      let newAssetId = ref.asset_id ?? null;
      let newVersionId = ref.asset_version_id ?? null;
      if (ref.asset_version_id) {
        const restoredVersion = versionMap.get(ref.asset_version_id) ?? null;
        const oldAssetId = versionAssetMap.get(ref.asset_version_id);
        newAssetId = oldAssetId
          ? assetMap.get(oldAssetId) ?? ref.asset_id ?? null
          : (ref.asset_id ?? null);
        if (restoredVersion === null) {
          issues.push(
            `reference "${ref.raw_text}": media version not in backup`,
          );
        }
        newVersionId = restoredVersion;
      }
      (insertReference.run as (...params: unknown[]) => unknown)(
        crypto.randomUUID(),
        ref.source_type,
        newSourceId,
        newAssetId,
        newVersionId,
        ref.role,
        ref.raw_text,
        ref.start_index,
        ref.end_index,
        ref.status,
        ref.notes,
        now,
        now,
      );
    }

    const insertTimeline = db.prepare(
      `INSERT INTO timelines (
        id, project_id, name, duration, settings_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertTrack = db.prepare(
      `INSERT INTO tracks (
        id, timeline_id, track_type, name, track_order, locked, muted
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertItem = db.prepare(
      `INSERT INTO timeline_items (
        id, timeline_id, track_id, asset_version_id, start_time, end_time,
        source_offset, speed, transform_json, fade_in, fade_out, transition,
        effect_chain_json, color_grade_json, audio_settings_json, notes,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMarker = db.prepare(
      `INSERT INTO timeline_markers (id, timeline_id, time, label, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertSnapshot = db.prepare(
      `INSERT INTO timeline_snapshots (
        id, timeline_id, name, snapshot_data_json, notes, created_at,
        created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const timeline of data.timelines) {
      const newTimelineId = crypto.randomUUID();
      insertTimeline.run(
        newTimelineId,
        projectId,
        timeline.name,
        timeline.duration,
        timeline.settings_json,
        timeline.created_at || now,
        now,
      );

      const trackMap = new Map<string, string>();
      const itemMap = new Map<string, string>();
      const markerMap = new Map<string, string>();
      for (const track of timeline.tracks) {
        const newTrackId = crypto.randomUUID();
        trackMap.set(track.id, newTrackId);
        insertTrack.run(
          newTrackId,
          newTimelineId,
          track.track_type,
          track.name,
          track.track_order,
          track.locked ? 1 : 0,
          track.muted ? 1 : 0,
        );
      }

      for (const item of timeline.items) {
        const newTrackId = trackMap.get(
          item.track_id,
        ) as string | undefined;
        if (!newTrackId) {
          issues.push(
            `item "${item.id}" from timeline "${timeline.name}": unknown track`,
          );
          continue;
        }
        const newVersionId = item.asset_version_id
          ? versionMap.get(item.asset_version_id)
          : undefined;
        if (item.asset_version_id && !newVersionId) {
          // timeline_items.asset_version_id is NOT NULL — the item cannot be
          // restored without its media version.
          issues.push(
            `item at ${item.start_time}s in timeline "${timeline.name}": media version not restored`,
          );
          continue;
        }
        if (!newVersionId) {
          issues.push(
            `item at ${item.start_time}s in timeline "${timeline.name}": had no media version`,
          );
          continue;
        }
        const newItemId = crypto.randomUUID();
        itemMap.set(item.id, newItemId);
        (insertItem.run as (...params: unknown[]) => unknown)(
          newItemId,
          newTimelineId,
          newTrackId,
          newVersionId,
          item.start_time,
          item.end_time,
          item.source_offset,
          item.speed,
          item.transform_json,
          item.fade_in,
          item.fade_out,
          item.transition,
          item.effect_chain_json,
          item.color_grade_json,
          item.audio_settings_json,
          item.notes,
          item.status,
          item.created_at || now,
          now,
        );
      }

      for (const marker of timeline.markers) {
        const newMarkerId = crypto.randomUUID();
        markerMap.set(marker.id, newMarkerId);
        insertMarker.run(
          newMarkerId,
          newTimelineId,
          marker.time,
          marker.label,
          marker.notes,
          now,
        );
      }

      const snapshots = Array.isArray(timeline.snapshots) ? timeline.snapshots : [];
      if (!Array.isArray(timeline.snapshots) && timeline.snapshots > 0) {
        issues.push(
          `timeline "${timeline.name}": ${timeline.snapshots} snapshot(s) skipped (backup predates snapshot restore)`,
        );
      }
      for (const snapshot of snapshots) {
        const remapped = remapSnapshotData(
          snapshot.snapshot_data,
          trackMap,
          itemMap,
          markerMap,
          versionMap,
        );
        if (!remapped) {
          issues.push(
            `snapshot "${snapshot.name}" in timeline "${timeline.name}": skipped (no readable snapshot data)`,
          );
          continue;
        }
        (insertSnapshot.run as (...params: unknown[]) => unknown)(
          crypto.randomUUID(),
          newTimelineId,
          snapshot.name,
          JSON.stringify(remapped.data),
          snapshot.notes,
          snapshot.created_at || now,
          options.userId,
        );
        if (remapped.dropped > 0) {
          issues.push(
            `snapshot "${snapshot.name}" in timeline "${timeline.name}": ${remapped.dropped} entr${
              remapped.dropped === 1 ? "y" : "ies"
            } dropped (not part of backup)`,
          );
        }
      }
    }

    db.exec("COMMIT");
    return {
      project_id: projectId,
      project_name: name,
      counts: backupCounts(data),
      issues,
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
