import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import * as schema from "../src/db/schema.ts";
import { getDb, resetDb } from "../src/db/database.ts";
import { addAlias, addTag, createAsset, createAssetVersion } from "../src/db/assets.ts";
import {
  createItem,
  createMarker,
  createSnapshot,
  createTimeline,
  createTrack,
  listItems,
  listTracks,
  restoreSnapshot,
} from "../src/db/timelines.ts";
import { createPanel, createStoryboard } from "../src/db/storyboards.ts";
import { createScene, createShot } from "../src/db/scenes.ts";
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
let trackId: string;
let itemId: string;
let storyboardId: string;
let panelId: string;
let sceneId: string;
let shotId: string;

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
    trackId = createTrack(owner, timelineId, {
      track_type: "video",
      name: "V1",
    }).id;
    itemId = createItem(owner, timelineId, {
      track_id: trackId,
      asset_version_id: versionId,
      start_time: 0,
      end_time: 4,
    }).id;
    createMarker(owner, timelineId, { time: 2, label: "beat" });
    // Snapshot of the live state: its payload embeds the old object ids.
    createSnapshot(owner, timelineId, { name: "snap1" });

    // Creative objects with prompt versions that reference the hero alias.
    storyboardId = createStoryboard(owner, {
      project_id: projectId,
      name: "Act 1",
    }).id;
    panelId = (
      await createPanel(owner, storyboardId, {
        panel_order: 1,
        description: "Opening shot",
        prompt: "A heroic landing @hero",
      })
    ).id;
    sceneId = (
      await createScene(owner, {
        project_id: projectId,
        name: "Scene 1",
        storyboard_id: storyboardId,
        prompt: "Wide shot of the city @hero",
      })
    ).id;
    shotId = (
      await createShot(owner, sceneId, {
        shot_order: 1,
        name: "Shot 1",
        prompt: "Slow dolly @hero",
      })
    ).id;
  });

  afterEach(() => {
    setRenderEngine(null);
    resetDb();
    removeDir(appData);
  });

  it("builds a backup of the project subtree only", () => {
    const data = buildProjectBackupData(projectId);
    assertEquals(data.schema, 3);
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
    assert(Array.isArray(timeline.snapshots));
    assertEquals(timeline.snapshots.length, 1);
    const snapshot = timeline.snapshots[0];
    assertEquals(snapshot.name, "snap1");
    assert(snapshot.snapshot_data);
    const snapTracks = snapshot.snapshot_data.tracks as Record<string, unknown>[];
    assertEquals(snapTracks.map((t) => t.id), [trackId]);
    const snapItems = snapshot.snapshot_data.items as Record<string, unknown>[];
    assertEquals(snapItems.map((i) => i.id), [itemId]);

    assertEquals(data.storyboards.length, 1);
    const board = data.storyboards[0];
    assertEquals(board.panels.length, 1);
    assertEquals(board.panels[0].prompt_version_id !== null, true);

    assertEquals(data.scenes.length, 1);
    const scene = data.scenes[0];
    assertEquals(scene.storyboard_id, storyboardId);
    assertEquals(scene.shots.length, 1);

    assert(
      data.prompts.length === 3 &&
        data.prompts.every((p) => p.content.includes("@hero")),
    );
    assertEquals(data.references.length, 3);
    assert(data.references.every((r) => r.asset_id === assetId));
    assert(data.references.every((r) => r.raw_text === "@hero"));

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
      snapshots: 1,
      storyboards: 1,
      panels: 1,
      scenes: 1,
      shots: 1,
      prompts: 3,
      references: 3,
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

    // Creative objects are restored with fresh ids and remapped links.
    const boardRow = (
      db
        .prepare("SELECT * FROM storyboards WHERE project_id = ?")
        .get(result.project_id)
    ) as Record<string, unknown>;
    assert(String(boardRow.id) !== storyboardId);
    assertEquals(boardRow.name, "Act 1");

    const panelRow = (
      db
        .prepare("SELECT * FROM storyboard_panels WHERE storyboard_id = ?")
        .get(String(boardRow.id))
    ) as Record<string, unknown>;
    assert(String(panelRow.id) !== panelId);

    const sceneRow = (
      db
        .prepare("SELECT * FROM scenes WHERE project_id = ?")
        .get(result.project_id)
    ) as Record<string, unknown>;
    assert(String(sceneRow.id) !== sceneId);
    assertEquals(sceneRow.storyboard_id, boardRow.id);

    const shotRow = (
      db.prepare("SELECT * FROM shots WHERE scene_id = ?").get(String(sceneRow.id))
    ) as Record<string, unknown>;
    assert(String(shotRow.id) !== shotId);

    const promptCount = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM prompt_versions
             WHERE scope_type = 'storyboard_panel' AND scope_id = ?
                OR scope_type = 'scene' AND scope_id = ?
                OR scope_type = 'shot' AND scope_id = ?`,
          )
          .get(String(panelRow.id), String(sceneRow.id), String(shotRow.id)) as Record<
            string,
            unknown
          >
      ).n,
    );
    assertEquals(promptCount, 3);

    // The restored references point at the new prompt version ids, with the
    // asset remapped to the restored asset.
    const restoredPromptIds = [
      panelRow.prompt_version_id,
      sceneRow.prompt_version_id,
      shotRow.prompt_version_id,
    ].map(String);
    const refCount = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM asset_references
             WHERE source_id IN (?, ?, ?)`,
          )
          .get(...restoredPromptIds) as Record<string, unknown>
      ).n,
    );
    assertEquals(refCount, 3);
    const refRow = (
      db
        .prepare(
          `SELECT * FROM asset_references
           WHERE source_type = 'storyboard_panel' AND source_id = ?`,
        )
        .get(String(panelRow.prompt_version_id))
    ) as Record<string, unknown>;
    assertEquals(refRow.asset_id, assetRow.id);
    assertEquals(refRow.asset_version_id, restoredVersionId);
    assertEquals(refRow.raw_text, "@hero");

    // Schema 3: the snapshot is restored with every embedded id remapped.
    assertEquals(result.issues.length, 0);
    const snapRow = (
      db
        .prepare(
          `SELECT s.* FROM timeline_snapshots s
           JOIN timelines t ON t.id = s.timeline_id
           WHERE t.project_id = ?`,
        )
        .get(result.project_id)
    ) as Record<string, unknown>;
    assertEquals(snapRow.name, "snap1");
    assertEquals(snapRow.created_by_user_id, collaborator);
    const snapData = JSON.parse(String(snapRow.snapshot_data_json)) as {
      tracks: Record<string, unknown>[];
      items: Record<string, unknown>[];
      markers: Record<string, unknown>[];
    };
    assertEquals(snapData.tracks.map((t) => t.id), [itemRow.track_id]);
    assertEquals(snapData.items.map((i) => i.id), [itemRow.id]);
    assertEquals(snapData.items[0].track_id, itemRow.track_id);
    assertEquals(snapData.items[0].asset_version_id, restoredVersionId);
    const restoredMarkerId = String(
      (
        db
          .prepare(
            `SELECT m.id FROM timeline_markers m
             JOIN timelines t ON t.id = m.timeline_id
             WHERE t.project_id = ?`,
          )
          .get(result.project_id) as Record<string, unknown>
      ).id,
    );
    assertEquals(snapData.markers.map((m) => m.id), [restoredMarkerId]);
    assertEquals(result.counts.snapshots, 1);

    // The remapped payload round-trips through the app's own restore path.
    const restoredTimeline = (
      db
        .prepare("SELECT id FROM timelines WHERE project_id = ?")
        .get(result.project_id) as Record<string, unknown>
    ).id as string;
    const afterRestore = restoreSnapshot(
      collaborator,
      restoredTimeline,
      String(snapRow.id),
    );
    assertEquals(afterRestore.duration, 4);
    assertEquals(listTracks(restoredTimeline, collaborator).length, 1);
    assertEquals(listItems(restoredTimeline, collaborator).length, 1);
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

  it("restores schema 1 backups without creative sections", () => {
    const data = buildProjectBackupData(projectId);
    const { storyboards, scenes, prompts, references, ...rest } = data;
    void storyboards;
    void scenes;
    void prompts;
    void references;
    const v1Snapshots = rest.timelines[0].snapshots;
    const v1 = {
      ...rest,
      schema: 1,
      timelines: [{
        ...rest.timelines[0],
        snapshots: Array.isArray(v1Snapshots) ? v1Snapshots.length : v1Snapshots,
      }],
    } as unknown as ProjectBackupData;

    const result = restoreProjectBackup(v1, {
      userId: collaborator,
      resolveContent: (h) => getContentStore().resolveExisting(h),
    });
    const db = getDb();
    assert(
      result.issues.some((issue) => issue.includes("snapshot(s) skipped")),
    );
    const snapshotCount = Number(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM timeline_snapshots s
             JOIN timelines t ON t.id = s.timeline_id
             WHERE t.project_id = ?`,
          )
          .get(result.project_id) as Record<string, unknown>
      ).n,
    );
    assertEquals(snapshotCount, 0);
    const boardCount = Number(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM storyboards WHERE project_id = ?")
          .get(result.project_id) as Record<string, unknown>
      ).n,
    );
    const sceneCount = Number(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM scenes WHERE project_id = ?")
          .get(result.project_id) as Record<string, unknown>
      ).n,
    );
    assertEquals(boardCount, 0);
    assertEquals(sceneCount, 0);
    assertEquals(result.counts.storyboards, 0);
    assertEquals(result.counts.prompts, 0);
    // Assets/timelines still restore as before.
    assertEquals(result.counts.assets, 1);
    assertEquals(result.counts.timelines, 1);
  });

  it("reports creative links outside the backup as issues", () => {
    const data = buildProjectBackupData(projectId);
    data.storyboards[0].panels[0].linked_shot_id = crypto.randomUUID();
    data.scenes[0].prompt_version_id = crypto.randomUUID();
    data.references[0].source_id = crypto.randomUUID();

    const result = restoreProjectBackup(data, {
      userId: collaborator,
      resolveContent: (h) => getContentStore().resolveExisting(h),
    });
    const creativeIssues = result.issues.filter(
      (issue) => issue.includes("not in backup") || issue.includes("not restored"),
    );
    assertEquals(creativeIssues.length, 3);

    // The panel is still restored, with the dangling link nulled.
    const boardRow = (
      getDb()
        .prepare("SELECT * FROM storyboards WHERE project_id = ?")
        .get(result.project_id)
    ) as Record<string, unknown>;
    const panelRow = (
      getDb()
        .prepare("SELECT * FROM storyboard_panels WHERE storyboard_id = ?")
        .get(String(boardRow.id))
    ) as Record<string, unknown>;
    assertEquals(panelRow.linked_shot_id, null);
    // Two of the three references survive; the skipped one's source prompt
    // matches no restored prompt version.
    const refCount = Number(
      (
        getDb()
          .prepare(
            `SELECT COUNT(*) AS n FROM asset_references
             WHERE source_id IN (
               SELECT pv.id FROM prompt_versions pv
               WHERE (pv.scope_type = 'storyboard_panel'
                       AND pv.scope_id IN (SELECT id FROM storyboard_panels
                                           WHERE storyboard_id IN
                                             (SELECT id FROM storyboards
                                              WHERE project_id = ?)))
                  OR (pv.scope_type = 'scene'
                      AND pv.scope_id IN (SELECT id FROM scenes
                                          WHERE project_id = ?))
                  OR (pv.scope_type = 'shot'
                      AND pv.scope_id IN (SELECT id FROM shots
                                          WHERE scene_id IN
                                            (SELECT id FROM scenes
                                             WHERE project_id = ?)))
             )`,
          )
          .get(
            result.project_id,
            result.project_id,
            result.project_id,
          ) as Record<string, unknown>
      ).n,
    );
    assertEquals(refCount, 2);
  });

  it("restores schema 2 backups and skips the count-only snapshots", () => {
    const data = buildProjectBackupData(projectId);
    const timeline = data.timelines[0];
    const snapshotCount = Array.isArray(timeline.snapshots)
      ? timeline.snapshots.length
      : timeline.snapshots;
    const v2 = {
      ...data,
      schema: 2,
      timelines: [{ ...timeline, snapshots: snapshotCount }],
    } as unknown as ProjectBackupData;

    const result = restoreProjectBackup(v2, {
      userId: collaborator,
      resolveContent: (h) => getContentStore().resolveExisting(h),
    });
    assert(
      result.issues.some(
        (issue) =>
          issue.includes("1 snapshot(s) skipped") &&
          issue.includes("backup predates snapshot restore"),
      ),
    );
    const restoredSnapshots = Number(
      (
        getDb()
          .prepare(
            `SELECT COUNT(*) AS n FROM timeline_snapshots s
             JOIN timelines t ON t.id = s.timeline_id
             WHERE t.project_id = ?`,
          )
          .get(result.project_id) as Record<string, unknown>
      ).n,
    );
    assertEquals(restoredSnapshots, 0);
    assertEquals(result.counts.snapshots, 1);
  });

  it("drops snapshot entries whose objects are missing from the backup", () => {
    const data = buildProjectBackupData(projectId);
    // Erase the live item from the backup, but keep its snapshot.
    data.timelines[0].items = [];

    const result = restoreProjectBackup(data, {
      userId: collaborator,
      resolveContent: (h) => getContentStore().resolveExisting(h),
    });
    assert(
      result.issues.some((issue) => issue.includes("snap1") && issue.includes("1 entry dropped")),
    );
    const snapRow = (
      getDb()
        .prepare(
          `SELECT s.* FROM timeline_snapshots s
           JOIN timelines t ON t.id = s.timeline_id
           WHERE t.project_id = ?`,
        )
        .get(result.project_id)
    ) as Record<string, unknown>;
    const snapData = JSON.parse(String(snapRow.snapshot_data_json)) as {
      items: unknown[];
      markers: unknown[];
    };
    assertEquals(snapData.items.length, 0);
    assertEquals(snapData.markers.length, 1);
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
