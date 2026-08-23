import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { createAsset, createAssetVersion } from "../src/db/assets.ts";
import { createProject } from "../src/db/projects.ts";
import { createPanel, createStoryboard, setPanelPreview } from "../src/db/storyboards.ts";
import { createScene, createShot, setShotGenerated } from "../src/db/scenes.ts";
import { createItem, createTimeline, createTrack } from "../src/db/timelines.ts";
import { resolveReferenceText, saveResolvedReferences } from "../src/db/references.ts";
import { getAssetDependencies } from "../src/db/asset_dependencies.ts";
import { hashPassword } from "../src/services/password.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

interface UserBody {
  token: string;
  user: { id: number; email: string; display_name: string; role: string };
}

let base = "";
let ownerUserId = 0;

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function post(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function get(path: string, token?: string): Promise<Response> {
  return fetch(`${base}${path}`, { headers: headers(token) });
}

async function login(email: string, password: string): Promise<string> {
  const res = await post("/api/v1/auth/login", { email, password });
  assertEquals(res.status, 200);
  const body = (await res.json()) as UserBody;
  return body.token;
}

let versionCounter = 0;
function makeVersion(assetId: string): string {
  versionCounter += 1;
  const created = createAssetVersion(assetId, ownerUserId, {
    content_hash: `hash-${versionCounter}`.padEnd(64, "0").slice(0, 64),
    file_path: `media/v${versionCounter}.mp4`,
    format: "mp4",
    mime_type: "video/mp4",
    file_size: 1234,
  });
  return created.id;
}

function makeAsset(slug: string): { id: string; versionId: string } {
  const made = createAsset(
    {
      unique_slug: slug,
      display_name: slug,
      asset_type: "video",
      library_scope: "global",
    },
    ownerUserId,
  );
  return { id: made.id, versionId: makeVersion(made.id) };
}

async function wireDependents(
  projectId: string,
  versionId: string,
): Promise<void> {
  const timeline = createTimeline(ownerUserId, {
    project_id: projectId,
    name: "Cut",
  });
  const track = createTrack(ownerUserId, timeline.id, {
    track_type: "video",
    name: "V1",
  });
  createItem(ownerUserId, timeline.id, {
    track_id: track.id,
    asset_version_id: versionId,
    start_time: 0,
    end_time: 5,
  });
  const board = createStoryboard(ownerUserId, {
    project_id: projectId,
    name: "Board",
  });
  const panel = await createPanel(ownerUserId, board.id, {
    panel_order: 1,
    shot_number: "1",
  });
  setPanelPreview(panel.id, versionId);
  const scene = await createScene(ownerUserId, {
    project_id: projectId,
    name: "Sc1",
  });
  const shot = await createShot(ownerUserId, scene.id, { shot_order: 1 });
  setShotGenerated(shot.id, versionId);
}

describe("asset dependencies (AST-015)", () => {
  beforeEach(async () => {
    freshMemoryDb();
    versionCounter = 0;
    ownerUserId = createUser(
      "owner@dep.example",
      await hashPassword("password123"),
      "Owner",
      "admin",
    );
  });

  afterEach(() => {
    closeDb();
  });

  it("reports timeline items, panels, shots, and prompt references", async () => {
    const project = createProject({ name: "P" }, ownerUserId);
    const asset = makeAsset("bg_forest");
    await wireDependents(project.id, asset.versionId);
    saveResolvedReferences(
      ownerUserId,
      "scene",
      "scene-src-1",
      resolveReferenceText(ownerUserId, "wide of @bg_forest at dawn"),
    );

    const deps = getAssetDependencies(asset.id);
    assertEquals(deps.asset_id, asset.id);
    assertEquals(deps.totals.timeline_items, 1);
    assertEquals(deps.totals.panels, 1);
    assertEquals(deps.totals.shots, 1);
    assertEquals(deps.totals.prompt_references, 1);
    assertEquals(deps.totals.total, 4);

    const item = deps.timeline_items[0];
    assertEquals(item.timeline_name, "Cut");
    assertEquals(item.track_name, "V1");
    assertEquals(item.track_type, "video");
    assertEquals(item.version_id, asset.versionId);

    const panel = deps.panels[0];
    assertEquals(panel.pointer, "preview");
    assertEquals(panel.storyboard_name, "Board");
    assertEquals(panel.shot_number, "1");
    assertEquals(panel.version_id, asset.versionId);

    const shot = deps.shots[0];
    assertEquals(shot.scene_name, "Sc1");
    assertEquals(shot.shot_order, 1);
    assertEquals(shot.version_id, asset.versionId);

    const ref = deps.prompt_references[0];
    assertEquals(ref.source_type, "scene");
    assertEquals(ref.raw_text, "@bg_forest");
    assertEquals(ref.broken, false);
    assertEquals(ref.status, "resolved");
  });

  it("reports an empty dependency set for unused assets", () => {
    const lonely = makeAsset("bg_city");
    const deps = getAssetDependencies(lonely.id);
    assertEquals(deps.totals.total, 0);
    assertEquals(deps.timeline_items, []);
    assertEquals(deps.panels, []);
    assertEquals(deps.shots, []);
    assertEquals(deps.prompt_references, []);
  });

  it("counts each pointer kind per version in use", async () => {
    const project = createProject({ name: "P" }, ownerUserId);
    const asset = makeAsset("bg_multi");
    const v1 = asset.versionId;
    const v2 = makeVersion(asset.id);

    const timeline = createTimeline(ownerUserId, {
      project_id: project.id,
      name: "Cut",
    });
    const trackA = createTrack(ownerUserId, timeline.id, {
      track_type: "video",
      name: "V1",
    });
    const trackB = createTrack(ownerUserId, timeline.id, {
      track_type: "video",
      name: "V2",
    });
    createItem(ownerUserId, timeline.id, {
      track_id: trackA.id,
      asset_version_id: v1,
      start_time: 0,
      end_time: 2,
    });
    createItem(ownerUserId, timeline.id, {
      track_id: trackB.id,
      asset_version_id: v2,
      start_time: 2,
      end_time: 4,
    });
    const board = createStoryboard(ownerUserId, {
      project_id: project.id,
      name: "Board",
    });
    const panel = await createPanel(ownerUserId, board.id, { panel_order: 1 });
    setPanelPreview(panel.id, v1);
    const scene = await createScene(ownerUserId, {
      project_id: project.id,
      name: "Sc1",
    });
    const shot = await createShot(ownerUserId, scene.id, { shot_order: 1 });
    setShotGenerated(shot.id, v2);

    const deps = getAssetDependencies(asset.id);
    assertEquals(deps.totals.timeline_items, 2);
    assertEquals(deps.totals.panels, 1);
    assertEquals(deps.totals.shots, 1);
    assertEquals(deps.totals.prompt_references, 0);
    assertEquals(deps.totals.total, 4);
    const itemVersionIds = new Set(deps.timeline_items.map((i) => i.version_id));
    assertEquals(itemVersionIds.has(v1), true);
    assertEquals(itemVersionIds.has(v2), true);
    assert(deps.shots[0].version_id === v2);
  });

  it("does not count dangling references to other assets", async () => {
    const project = createProject({ name: "P" }, ownerUserId);
    const asset = makeAsset("bg_ghost");
    await wireDependents(project.id, asset.versionId);
    saveResolvedReferences(
      ownerUserId,
      "panel",
      "panel-src-1",
      resolveReferenceText(ownerUserId, "nothing here @no_such_asset"),
    );

    const deps = getAssetDependencies(asset.id);
    assertEquals(deps.totals.prompt_references, 0);
  });

  describe("route", () => {
    it("rejects unauthenticated requests", async () => {
      await withServer((url) => {
        base = url;
        return (async () => {
          await fetchWithRetry(`${base}/api/v1/health`);
          const res = await get("/api/v1/assets/anything/dependencies");
          assertEquals(res.status, 401);
        })();
      });
    });

    it("returns the dependency map for an accessible asset", async () => {
      await withServer((url) => {
        base = url;
        return (async () => {
          await fetchWithRetry(`${base}/api/v1/health`);
          const token = await login("owner@dep.example", "password123");
          const created = await post(
            "/api/v1/assets",
            {
              unique_slug: `dep_${Math.random().toString(36).slice(2, 10)}`,
              display_name: "Dep Asset",
              asset_type: "image",
              library_scope: "global",
            },
            token,
          );
          assertEquals(created.status, 201);
          const body = (await created.json()) as { id: string };

          const res = await get(
            `/api/v1/assets/${body.id}/dependencies`,
            token,
          );
          assertEquals(res.status, 200);
          const deps = (await res.json()) as {
            asset_id: string;
            totals: { total: number };
            timeline_items: unknown[];
            panels: unknown[];
            shots: unknown[];
            prompt_references: unknown[];
          };
          assertEquals(deps.asset_id, body.id);
          assertEquals(deps.totals.total, 0);
          assertEquals(deps.timeline_items, []);
          assertEquals(deps.panels, []);
          assertEquals(deps.shots, []);
          assertEquals(deps.prompt_references, []);
        })();
      });
    });

    it("returns 404 for unknown assets", async () => {
      await withServer((url) => {
        base = url;
        return (async () => {
          await fetchWithRetry(`${base}/api/v1/health`);
          const token = await login("owner@dep.example", "password123");
          const res = await get(
            "/api/v1/assets/00000000-0000-0000-0000-000000000000/dependencies",
            token,
          );
          assertEquals(res.status, 404);
        })();
      });
    });
  });
});
