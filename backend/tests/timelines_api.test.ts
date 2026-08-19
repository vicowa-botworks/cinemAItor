import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createAsset, createAssetVersion } from "../src/db/assets.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

let baseUrl = "";
let ownerToken: string;
let ownerId: number;
let projectId: string;
let versionId: string;

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, json };
}

describe("timelines api", () => {
  beforeEach(async () => {
    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(health.status, 200);

      const res = await req(
        "POST",
        "/api/v1/auth/bootstrap",
        {
          email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Studio Admin",
        },
      );
      assertEquals(res.status, 201);
      const user = res.json as { token: string; user: { id: number } };
      ownerToken = user.token;
      ownerId = user.user.id;

      const { createProject } = await import("../src/db/projects.ts");
      projectId = createProject({ name: "Test Film" }, ownerId).id;
      const asset = createAsset(
        {
          unique_slug: `clip_${Math.random().toString(36).slice(2, 8)}`,
          display_name: "Clip",
          asset_type: "video",
          library_scope: "global",
        },
        ownerId,
      );
      versionId = createAssetVersion(asset.id, ownerId, {
        content_hash: "e".repeat(64),
        file_path: "/tmp/clip.mp4",
        format: "mp4",
        mime_type: "video/mp4",
        file_size: 1000,
        make_active: true,
      }).id;
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("requires authentication", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        assertEquals((await req("GET", "/api/v1/timelines")).status, 401);
      })();
    }));

  it("full timeline lifecycle: tracks, items, duplicate, snapshot restore", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const tl = await req(
          "POST",
          "/api/v1/timelines",
          { project_id: projectId, name: "Main" },
          ownerToken,
        );
        assertEquals(tl.status, 201);
        const timelineId = (tl.json as { id: string }).id;

        const trackRes = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/tracks`,
          { track_type: "video", name: "V1" },
          ownerToken,
        );
        assertEquals(trackRes.status, 201);
        const trackId = (trackRes.json as { id: string }).id;

        const badType = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/tracks`,
          { track_type: "bogus", name: "X" },
          ownerToken,
        );
        assertEquals(badType.status, 400);

        const itemRes = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/items`,
          {
            track_id: trackId,
            asset_version_id: versionId,
            start_time: 0,
            end_time: 4,
          },
          ownerToken,
        );
        assertEquals(itemRes.status, 201);
        const item1 = itemRes.json as { id: string };

        const missingFields = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/items`,
          { track_id: trackId },
          ownerToken,
        );
        assertEquals(missingFields.status, 400);

        const badVersion = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/items`,
          {
            track_id: trackId,
            asset_version_id: "nope",
            start_time: 0,
            end_time: 1,
          },
          ownerToken,
        );
        assertEquals(badVersion.status, 400);

        // Trim/move.
        const patched = await req(
          "PATCH",
          `/api/v1/timelines/${timelineId}/items/${item1.id}`,
          { start_time: 2, end_time: 6 },
          ownerToken,
        );
        assertEquals(patched.status, 200);
        assertEquals((patched.json as { end_time: number }).end_time, 6);

        // Duplicate at a given time.
        const dup = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/items/${item1.id}/duplicate`,
          { at_time: 10 },
          ownerToken,
        );
        assertEquals(dup.status, 201);
        assertEquals((dup.json as { start_time: number }).start_time, 10);

        // Detail view with nested items + duration.
        const detailRes = await req(
          "GET",
          `/api/v1/timelines/${timelineId}`,
          undefined,
          ownerToken,
        );
        const detail = detailRes.json as {
          timeline: { duration: number };
          tracks: { id: string; items: { id: string }[] }[];
        };
        assertEquals(detail.timeline.duration, 14);
        assertEquals(detail.tracks[0].items.length, 2);

        // Snapshot, diverge, restore.
        const snap = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/snapshots`,
          { name: "v1" },
          ownerToken,
        );
        assertEquals(snap.status, 201);
        const snapshotId = (snap.json as { id: string }).id;

        const more = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/items`,
          {
            track_id: trackId,
            asset_version_id: versionId,
            start_time: 14,
            end_time: 20,
          },
          ownerToken,
        );
        assertEquals(more.status, 201);

        const marker = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/markers`,
          { time: 5, label: "after-snapshot" },
          ownerToken,
        );
        assertEquals(marker.status, 201);

        const restore = await req(
          "POST",
          `/api/v1/timelines/${timelineId}/snapshots/${snapshotId}/restore`,
          {},
          ownerToken,
        );
        assertEquals(restore.status, 200);
        const restored = restore.json as {
          timeline: { duration: number };
          markers: { label: string | null }[];
        };
        assertEquals(restored.timeline.duration, 14);
        assertEquals(restored.markers.length, 0);

        // Delete item, track, timeline.
        const delItem = await req(
          "DELETE",
          `/api/v1/timelines/${timelineId}/items/${item1.id}`,
          undefined,
          ownerToken,
        );
        assertEquals(delItem.status, 200);
        const delTrack = await req(
          "DELETE",
          `/api/v1/timelines/${timelineId}/tracks/${trackId}`,
          undefined,
          ownerToken,
        );
        assertEquals(delTrack.status, 200);
        const delTl = await req(
          "DELETE",
          `/api/v1/timelines/${timelineId}`,
          undefined,
          ownerToken,
        );
        assertEquals(delTl.status, 200);
        const gone = await req("GET", `/api/v1/timelines/${timelineId}`, undefined, ownerToken);
        assertEquals(gone.status, 404);
      })();
    });
  });

  it("list endpoints respect permissions and unknown targets 404", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const list = await req(
          "GET",
          `/api/v1/timelines?project_id=${projectId}`,
          undefined,
          ownerToken,
        );
        assertEquals(list.status, 200);

        const missing = await req("PATCH", "/api/v1/timelines/nope", { name: "X" }, ownerToken);
        assertEquals(missing.status, 404);
        const missingItem = await req(
          "PATCH",
          "/api/v1/timelines/nope/items/nope",
          {},
          ownerToken,
        );
        assertEquals(missingItem.status, 404);
      })();
    });
  });
});
