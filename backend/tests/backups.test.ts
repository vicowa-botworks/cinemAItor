import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import * as schema from "../src/db/schema.ts";
import { getDb, resetDb } from "../src/db/database.ts";
import { addAlias, addTag, createAsset, createAssetVersion } from "../src/db/assets.ts";
import { createItem, createMarker, createTimeline, createTrack } from "../src/db/timelines.ts";
import { createProject } from "../src/db/projects.ts";
import { MockRenderEngine, setRenderEngine } from "../src/services/render_engine.ts";
import { ensureDefaultPresets } from "../src/db/renders.ts";
import {
  backupCounts,
  backupMediaManifest,
  buildProjectBackupData,
  type ProjectBackupData,
  restoreProjectBackup,
} from "../src/services/project_backup.ts";
import { getContentStore, resetContentStore } from "../src/storage/content_store.ts";

let owner: number;
let collaborator: number;
let projectId: string;
let appData: string;
let assetId: string;
let versionId: string;
let timelineId: string;

async function storedFile(name: string, bytes: string): Promise<string> {
  const tmp = Deno.makeTempFileSync();
  await Deno.writeTextFile(tmp, bytes);
  const stored = await getContentStore().put(tmp, name);
  Deno.removeSync(tmp);
  return stored.hash;
}

describe("project backup and restore", () => {
  beforeEach(async () => {
    Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
    resetDb();
    getDb(":memory:");
    ensureDefaultPresets();
    appData = Deno.makeTempDirSync({ prefix: "cinemaitor_backup_test_" });
    Deno.env.set("APP_DATA_DIR", appData);
    resetContentStore();
    setRenderEngine(new MockRenderEngine());

    owner = schema.createUser("owner@example.com", "hash-a", "Owner", "admin");
    collaborator = schema.createUser(
      "collab@example.com",
      "hash-b",
      "Collab",
    );
    projectId = createProject({ name: "Backup Film" }, owner).id;

    const hash = await storedFile("clip.mp4", "clip-bytes");
    assetId = createAsset(
      {
        unique_slug: "hero_clip",
        display_name: "Hero Clip",
        asset_type: "video",
        library_scope: "project",
        project_id: projectId,
      },
      owner,
    ).id;
    const version = createAssetVersion(assetId, owner, {
      content_hash: hash,
      file_path: getContentStore().resolve(hash) as string,
      format: "mp4",
      mime_type: "video/mp4",
      file_size: 11,
      make_active: true,
    });
    versionId = version.id;
    addAlias(assetId, owner, "hero");
    addTag(assetId, owner, "action");

    // A global asset that must NOT be part of the project backup.
    const globalHash = await storedFile("global.mp4", "global-bytes");
    const globalAsset = createAsset(
      {
        unique_slug: "global_clip",
        display_name: "Global Clip",
        asset_type: "video",
        library_scope: "global",
      },
      owner,
    ).id;
    createAssetVersion(globalAsset, owner, {
      content_hash: globalHash,
      file_path: getContentStore().resolve(globalHash) as string,
      format: "mp4",
      mime_type: "video/mp4",
      file_size: 12,
      make_active: true,
    });

    timelineId = createTimeline(owner, {
      project_id: projectId,
      name: "Main",
    }).id;
    const track = createTrack(owner, timelineId, {
      track_type: "video",
      name: "V1",
    });
    createItem(owner, timelineId, {
      track_id: track.id,
      asset_version_id: versionId,
      start_time: 0,
      end_time: 4,
    });
    createMarker(owner, timelineId, { time: 2, label: "beat" });
    // Snapshots embed ids and are skipped by restore.
    getDb()
      .prepare(
        `INSERT INTO timeline_snapshots (
          id, timeline_id, name, snapshot_data_json, notes, created_at,
          created_by_user_id
        ) VALUES (?, ?, 'snap1', '{}', NULL, datetime('now'), ?)`,
      )
      .run(crypto.randomUUID(), timelineId, owner);
  });

  afterEach(() => {
    setRenderEngine(null);
    resetDb();
    removeDir(appData);
  });

  it("builds a backup of the project subtree only", () => {
    const data = buildProjectBackupData(projectId);
    assertEquals(data.schema, 1);
    assertEquals(data.project.id, projectId);
    assertEquals(data.project.name, "Backup Film");
    assertEquals(data.assets.length, 1);
    const asset = data.assets[0];
    assertEquals(asset.unique_slug, "hero_clip");
    assertEquals(asset.aliases, ["hero"]);
    assertEquals(asset.tags, ["action"]);
    assertEquals(asset.versions.length, 1);
    assert(asset.versions[0].content_hash);
    assert(data.assets.every((a) => a.library_scope === "project"));

    assertEquals(data.timelines.length, 1);
    const timeline = data.timelines[0];
    assertEquals(timeline.tracks.length, 1);
    assertEquals(timeline.items.length, 1);
    assertEquals(timeline.items[0].asset_version_id, versionId);
    assertEquals(timeline.markers.length, 1);
    assertEquals(timeline.snapshots, 1);

    const counts = backupCounts(data);
    assertEquals(counts, {
      assets: 1,
      versions: 1,
      aliases: 1,
      tags: 1,
      timelines: 1,
      tracks: 1,
      items: 1,
      markers: 1,
      snapshots_skipped: 1,
    });

    const manifest = backupMediaManifest(
      data,
      (hash) => getContentStore().resolve(hash),
    );
    assertEquals(manifest.length, 1);
    assertEquals(manifest[0].present, true);
  });

  it("restores into a new project with fresh ids and remapped links", () => {
    const data = buildProjectBackupData(projectId);
    const result = restoreProjectBackup(data, {
      userId: collaborator,
      resolveContent: (h) => getContentStore().resolveExisting(h),
    });

    assert(result.project_id !== projectId);
    assertEquals(result.project_name, "Backup Film (restored)");

    const db = getDb();
    const projectRow = (
      db.prepare("SELECT * FROM projects WHERE id = ?").get(result.project_id)
    ) as Record<string, unknown>;
    assertEquals(projectRow.created_by_user_id, collaborator);

    const assetRow = (
      db
        .prepare("SELECT * FROM assets WHERE project_id = ?")
        .get(result.project_id)
    ) as Record<string, unknown>;
    assert(assetRow.id !== assetId);
    // The original slug is still taken, so the restore gets a unique one.
    assert(String(assetRow.unique_slug).startsWith("hero_clip"));
    assert(String(assetRow.unique_slug) !== "hero_clip");

    const versionRow = (
      db.prepare("SELECT * FROM asset_versions WHERE asset_id = ?").get(
        String(assetRow.id),
      )
    ) as Record<string, unknown>;
    const restoredVersionId = String(versionRow.id);
    assert(restoredVersionId !== versionId);
    assertEquals(versionRow.content_hash, getVersionHash());
    assertEquals(assetRow.active_version_id, restoredVersionId);

    const itemRow = (
      db
        .prepare(
          `SELECT i.* FROM timeline_items i
           JOIN timelines t ON t.id = i.timeline_id
           WHERE t.project_id = ?`,
        )
        .get(result.project_id)
    ) as Record<string, unknown>;
    assertEquals(itemRow.asset_version_id, restoredVersionId);

    const markerCount = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM timeline_markers m
             JOIN timelines t ON t.id = m.timeline_id
             WHERE t.project_id = ?`,
          )
          .get(result.project_id) as Record<string, unknown>
      ).n,
    );
    assertEquals(markerCount, 1);

    // Only the snapshot-skip issue is expected.
    assertEquals(result.issues.length, 1);
    assert(result.issues[0].includes("snapshot(s) skipped"));
  });

  it("reports missing media instead of failing the restore", () => {
    const data = buildProjectBackupData(projectId);
    // Evict the stored file to simulate a pruned content store.
    const hash = getVersionHash();
    const filePath = getContentStore().resolve(hash) as string;
    Deno.removeSync(filePath);

    const result = restoreProjectBackup(data, {
      userId: collaborator,
      resolveContent: (h) => getContentStore().resolveExisting(h),
    });
    const mediaIssues = result.issues.filter((issue) =>
      issue.includes("media not in content store")
    );
    assertEquals(mediaIssues.length, 1);
    // The version row is still restored (ordering is preserved) but without
    // a resolvable file path.
    const restoredVersion = (
      getDb()
        .prepare(
          `SELECT v.* FROM asset_versions v
           JOIN assets a ON a.id = v.asset_id
           WHERE a.project_id = ?`,
        )
        .get(result.project_id)
    ) as Record<string, unknown>;
    assertEquals(restoredVersion.content_hash, hash);
    assertEquals(restoredVersion.file_path, null);
  });

  it("rejects unknown backup schema versions", () => {
    const data = buildProjectBackupData(projectId);
    const mutated = { ...data, schema: 99 } as unknown as ProjectBackupData;
    assertThrows(
      () =>
        restoreProjectBackup(mutated, {
          userId: collaborator,
          resolveContent: (h) => getContentStore().resolveExisting(h),
        }),
      Error,
      "Unsupported backup schema",
    );
  });
});

function removeDir(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
  } catch {
    // already gone
  }
}

function getVersionHash(): string {
  const row = getDb()
    .prepare("SELECT content_hash FROM asset_versions WHERE id = ?")
    .get(versionId) as Record<string, unknown>;
  return String(row.content_hash);
}
