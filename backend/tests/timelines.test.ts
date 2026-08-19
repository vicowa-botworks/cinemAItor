import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import * as schema from "../src/db/schema.ts";
import { getDb, resetDb } from "../src/db/database.ts";
import { createProject } from "../src/db/projects.ts";
import { createAsset, createAssetVersion } from "../src/db/assets.ts";
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
  getItem,
  getTimeline,
  listItems,
  listMarkers,
  listSnapshots,
  listTimelines,
  listTracks,
  restoreSnapshot,
  updateItem,
  updateTimeline,
  updateTrack,
} from "../src/db/timelines.ts";

let ownerId: number;
let otherId: number;
let projectId: string;
let versionId: string;

describe("timeline editor", () => {
  beforeEach(() => {
    resetDb();
    getDb(":memory:");
    ownerId = schema.createUser("owner@example.com", "hash123", "Owner", "admin");
    otherId = schema.createUser("other@example.com", "hash456", "Other");
    projectId = createProject({ name: "Film" }, ownerId).id;
    const asset = createAsset(
      {
        unique_slug: "clip",
        display_name: "Clip",
        asset_type: "video",
        library_scope: "global",
      },
      ownerId,
    );
    versionId = createAssetVersion(asset.id, ownerId, {
      content_hash: "d".repeat(64),
      file_path: "/tmp/clip.mp4",
      format: "mp4",
      mime_type: "video/mp4",
      file_size: 1000,
      make_active: true,
    }).id;
  });

  afterEach(() => {
    resetDb();
  });

  it("creates timelines and enforces project permissions", () => {
    const tl = createTimeline(ownerId, { project_id: projectId, name: "Main" });
    assertEquals(tl.duration, 0);
    assertEquals(getTimeline(tl.id, otherId), undefined);
    assertEquals(listTimelines(otherId).length, 0);
    assertThrows(
      () => createTimeline(otherId, { project_id: projectId, name: "X" }),
      Error,
      "Project not found",
    );
    const renamed = updateTimeline(ownerId, tl.id, { name: "Main Cut" });
    assertEquals(renamed?.name, "Main Cut");
    assertEquals(deleteTimeline(ownerId, tl.id), true);
    assertEquals(getTimeline(tl.id, ownerId), undefined);
  });

  it("manages tracks with ordering, types and locks", () => {
    const tl = createTimeline(ownerId, { project_id: projectId, name: "T" });
    const v1 = createTrack(ownerId, tl.id, { track_type: "video", name: "V1" });
    const a1 = createTrack(ownerId, tl.id, { track_type: "music", name: "M1" });
    assertEquals(v1.track_order, 1);
    assertEquals(a1.track_order, 2);

    assertThrows(
      () => createTrack(ownerId, tl.id, { track_type: "bogus", name: "X" }),
      Error,
      "track_type",
    );
    assertThrows(
      () => createTrack(ownerId, tl.id, { track_type: "video", name: "dup", track_order: 1 }),
      Error,
      "already exists",
    );

    // Swap orders.
    const moved = updateTrack(ownerId, tl.id, a1.id, { track_order: 1 });
    assertEquals(moved?.track_order, 1);
    assertEquals(listTracks(tl.id, ownerId)[0].id, a1.id);

    const locked = updateTrack(ownerId, tl.id, v1.id, { locked: true });
    assertEquals(locked?.locked, true);
    assertEquals(deleteTrack(ownerId, tl.id, a1.id), true);
    assertEquals(listTracks(tl.id, ownerId).length, 1);
  });

  it("places items, trims, moves, duplicates and recomputes duration", () => {
    const tl = createTimeline(ownerId, { project_id: projectId, name: "T" });
    const track = createTrack(ownerId, tl.id, { track_type: "video", name: "V" });

    const i1 = createItem(ownerId, tl.id, {
      track_id: track.id,
      asset_version_id: versionId,
      start_time: 0,
      end_time: 4,
    });
    assertEquals(i1.speed, 1);
    assertEquals(i1.source_offset, 0);
    assertEquals(tl.id && getTimeline(tl.id, ownerId)?.duration, 4);

    // Validation.
    assertThrows(
      () =>
        createItem(ownerId, tl.id, {
          track_id: track.id,
          asset_version_id: versionId,
          start_time: 5,
          end_time: 3,
        }),
      Error,
      "end_time must be greater",
    );
    assertThrows(
      () =>
        createItem(ownerId, tl.id, {
          track_id: "nope",
          asset_version_id: versionId,
          start_time: 0,
          end_time: 1,
        }),
      Error,
      "Track not found",
    );
    assertThrows(
      () =>
        createItem(ownerId, tl.id, {
          track_id: track.id,
          asset_version_id: "nope",
          start_time: 0,
          end_time: 1,
        }),
      Error,
      "asset_version_id",
    );

    const i2 = createItem(ownerId, tl.id, {
      track_id: track.id,
      asset_version_id: versionId,
      start_time: 4,
      end_time: 9,
      speed: 2,
      source_offset: 1.5,
    });
    assertEquals(getTimeline(tl.id, ownerId)?.duration, 9);

    // Trim + move.
    const trimmed = updateItem(ownerId, tl.id, i2.id, {
      end_time: 7,
      start_time: 6,
    });
    assertEquals(trimmed?.end_time, 7);
    assertEquals(trimmed?.start_time, 6);
    assertEquals(getTimeline(tl.id, ownerId)?.duration, 7);

    // Duplicate defaults to right after the original (new id, same content).
    const dup = duplicateItem(ownerId, tl.id, i1.id);
    assertEquals(dup.start_time, 4);
    assertEquals(dup.end_time, 8);
    assert(dup.id !== i1.id);
    const at = duplicateItem(ownerId, tl.id, i1.id, 20);
    assertEquals(at.start_time, 20);
    assertEquals(listItems(tl.id, ownerId).length, 4);

    assertEquals(deleteItem(ownerId, tl.id, dup.id), true);
    assertEquals(getItem(tl.id, dup.id, ownerId), undefined);
    // "at" duplicate [20, 24] is now the furthest item.
    assertEquals(getTimeline(tl.id, ownerId)?.duration, 24);
  });

  it("refuses item writes on locked tracks", () => {
    const tl = createTimeline(ownerId, { project_id: projectId, name: "T" });
    const track = createTrack(ownerId, tl.id, { track_type: "video", name: "V" });
    const item = createItem(ownerId, tl.id, {
      track_id: track.id,
      asset_version_id: versionId,
      start_time: 0,
      end_time: 2,
    });
    updateTrack(ownerId, tl.id, track.id, { locked: true });
    assertThrows(
      () =>
        createItem(ownerId, tl.id, {
          track_id: track.id,
          asset_version_id: versionId,
          start_time: 2,
          end_time: 3,
        }),
      Error,
      "locked",
    );
    assertThrows(
      () => updateItem(ownerId, tl.id, item.id, { start_time: 1 }),
      Error,
      "locked",
    );
    // Deleting the track removes its items.
    updateTrack(ownerId, tl.id, track.id, { locked: false });
    assertEquals(deleteTrack(ownerId, tl.id, track.id), true);
    assertEquals(listItems(tl.id, ownerId).length, 0);
  });

  it("creates and deletes markers", () => {
    const tl = createTimeline(ownerId, { project_id: projectId, name: "T" });
    const m1 = createMarker(ownerId, tl.id, { time: 1.5, label: "cut" });
    createMarker(ownerId, tl.id, { time: 0.5 });
    const markers = listMarkers(tl.id, ownerId);
    assertEquals(markers.map((m) => m.time), [0.5, 1.5]);
    assertEquals(markers[1].label, "cut");
    assertThrows(() => createMarker(ownerId, tl.id, { time: -1 }), Error, "time");
    assertEquals(deleteMarker(ownerId, tl.id, m1.id), true);
    assertEquals(listMarkers(tl.id, ownerId).length, 1);
  });

  it("snapshots capture the full state and restore replaces it", () => {
    const tl = createTimeline(ownerId, { project_id: projectId, name: "T" });
    const track = createTrack(ownerId, tl.id, { track_type: "video", name: "V" });
    const item = createItem(ownerId, tl.id, {
      track_id: track.id,
      asset_version_id: versionId,
      start_time: 0,
      end_time: 3,
    });
    createMarker(ownerId, tl.id, { time: 1, label: "keep" });

    const snap = createSnapshot(ownerId, tl.id, { name: "before" });
    assert(snap.id);
    assertEquals(listSnapshots(tl.id, ownerId).length, 1);

    // Diverge.
    const track2 = createTrack(ownerId, tl.id, { track_type: "music", name: "M" });
    const item2 = createItem(ownerId, tl.id, {
      track_id: track2.id,
      asset_version_id: versionId,
      start_time: 3,
      end_time: 6,
    });
    assertEquals(listItems(tl.id, ownerId).length, 2);
    assertEquals(listTracks(tl.id, ownerId).length, 2);

    const restored = restoreSnapshot(ownerId, tl.id, snap.id);
    assertEquals(restored.duration, 3);
    const tracks = listTracks(tl.id, ownerId);
    assertEquals(tracks.length, 1);
    assertEquals(tracks[0].id, track.id);
    const items = listItems(tl.id, ownerId);
    assertEquals(items.length, 1);
    assertEquals(items[0].id, item.id);
    assertEquals(listMarkers(tl.id, ownerId).map((m) => m.label), ["keep"]);
    void item2;
    assertThrows(
      () => restoreSnapshot(ownerId, tl.id, "nope"),
      Error,
      "Snapshot not found",
    );
  });
});
