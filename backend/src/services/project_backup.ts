import { getDb } from "../db/database.ts";

// ---------------------------------------------------------------------------
// DIA-006 / DIA-007: project backup and restore
//
// A backup is a JSON snapshot of one project's asset and timeline subtree.
// Media binaries are never copied: versions keep their content hash, so a
// restore can verify which files are still in the content store and report
// the ones that are missing. Snapshots are intentionally not restored
// (their serialized state embeds the old ids) and are counted as an issue.
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
  markers: { time: number; label: string | null; notes: string | null }[];
  snapshots: number; // count only — snapshots embed old ids and are not restored
}

export interface ProjectBackupData {
  schema: 1;
  created_at: string;
  project: BackupProjectData;
  assets: BackupAssetData[];
  timelines: BackupTimelineData[];
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
  snapshots_skipped: number;
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
      time: Number(m.time ?? 0),
      label: asString(m.label),
      notes: asString(m.notes),
    }));
    const snapshots = db
      .prepare(
        "SELECT COUNT(*) AS n FROM timeline_snapshots WHERE timeline_id = ?",
      )
      .get(timelineId) as unknown as { n: number };

    timelines.push({
      id: timelineId,
      name: asString(tRow.name) ?? "Timeline",
      duration: Number(tRow.duration ?? 0),
      settings_json: asString(tRow.settings_json),
      created_at: asString(tRow.created_at) ?? "",
      tracks,
      items,
      markers,
      snapshots: Number(snapshots.n ?? 0),
    });
  }

  return {
    schema: 1,
    created_at: new Date().toISOString(),
    project,
    assets,
    timelines,
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
    snapshots_skipped: data.timelines.reduce((n, t) => n + t.snapshots, 0),
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
 * items) are remapped. Timeline snapshots are skipped (they embed the old
 * ids) and reported as issues, as are versions whose media is missing.
 */
export function restoreProjectBackup(
  data: ProjectBackupData,
  options: RestoreOptions,
): RestoreResult {
  if (data.schema !== 1) {
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
      const newVersionIds = new Map<string, string>();

      for (const version of asset.versions) {
        const newVersionId = crypto.randomUUID();
        newVersionIds.set(version.id, newVersionId);
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
        (insertItem.run as (...params: unknown[]) => unknown)(
          crypto.randomUUID(),
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
        insertMarker.run(
          crypto.randomUUID(),
          newTimelineId,
          marker.time,
          marker.label,
          marker.notes,
          now,
        );
      }

      if (timeline.snapshots > 0) {
        issues.push(
          `timeline "${timeline.name}": ${timeline.snapshots} snapshot(s) skipped (they embed original ids)`,
        );
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
