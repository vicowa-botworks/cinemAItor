import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import * as schema from "../src/db/schema.ts";
import { getDb, resetDb } from "../src/db/database.ts";
import { createProject } from "../src/db/projects.ts";
import { createAsset } from "../src/db/assets.ts";
import {
  createPanel,
  createStoryboard,
  creativePrompt,
  deletePanel,
  deleteStoryboard,
  getPanel,
  getStoryboard,
  listPanels,
  listStoryboards,
  setPanelPreview,
  updatePanel,
} from "../src/db/storyboards.ts";
import {
  createScene,
  createShot,
  creativePromptFor,
  deleteScene,
  getScene,
  getShot,
  listScenes,
  listShots,
  setShotGenerated,
  updateScene,
} from "../src/db/scenes.ts";

let owner: number;
let other: number;
let projectId: string;

describe("storyboards and scenes", () => {
  beforeEach(() => {
    getDb(":memory:");
    owner = schema.createUser("owner@example.com", "hash123", "Owner", "admin");
    other = schema.createUser("other@example.com", "hash456", "Other");
    projectId = createProject({ name: "Film" }, owner).id;
  });

  afterEach(() => {
    resetDb();
  });

  it("creates storyboards and panels with ordered positions", async () => {
    const board = createStoryboard(owner, { project_id: projectId, name: "Act 1" });
    assertEquals(board.status, "draft");

    const p1 = await createPanel(owner, board.id, {
      panel_order: 1,
      description: "Establishing shot",
      prompt: "a lighthouse at dawn",
    });
    const p2 = await createPanel(owner, board.id, {
      panel_order: 2,
      mood: "tense",
    });

    const panels = listPanels(board.id, owner);
    assertEquals(panels.map((p) => p.panel_order), [1, 2]);
    assertEquals(p1.status, "draft");
    assertEquals(p2.mood, "tense");

    // Duplicate positions and unknown boards rejected.
    await assertRejects(
      () => createPanel(owner, board.id, { panel_order: 1 }),
      Error,
      "already exists",
    );
    await assertRejects(
      () => createPanel(owner, "nope", { panel_order: 1 }),
      Error,
      "Storyboard not found",
    );
    assertThrows(
      () => createStoryboard(other, { project_id: projectId, name: "x" }),
      Error,
      "Project not found",
    );
  });

  it("resolves panel prompt references and reports warnings", async () => {
    const hero = createAsset(
      {
        unique_slug: "captain",
        display_name: "Captain",
        asset_type: "character",
        library_scope: "global",
      },
      owner,
    );
    const board = createStoryboard(owner, { project_id: projectId, name: "B" });
    const panel = await createPanel(owner, board.id, {
      panel_order: 1,
      prompt: "@captain stands on @deck, @ghost watches",
    });

    const prompt = creativePrompt("storyboard_panel", panel.id, owner);
    assert(prompt);
    assertEquals(prompt.content, "@captain stands on @deck, @ghost watches");
    assertEquals(prompt.version_number, 1);
    const refs = getDb()
      .prepare(
        "SELECT status, raw_text, asset_id FROM asset_references WHERE source_id = ? ORDER BY start_index",
      )
      .all(panel.prompt_version_id) as unknown as {
        status: string;
        raw_text: string;
        asset_id: string | null;
      }[];
    assertEquals(refs.map((r) => r.status), ["resolved", "missing", "missing"]);
    assertEquals(refs.find((r) => r.raw_text === "@captain")?.asset_id, hero.id);
    assertEquals(prompt.warnings.length, 2);
    assert(prompt.warnings.some((w) => w.includes("@deck")));
    assert(prompt.warnings.some((w) => w.includes("@ghost")));

    // Updating the prompt appends a version and re-resolves references.
    const updated = await updatePanel(owner, panel.id, {
      prompt: "@captain leaves the @waves",
    });
    assert(updated);
    const prompt2 = creativePrompt("storyboard_panel", panel.id, owner);
    assert(prompt2);
    assertEquals(prompt2.version_number, 2);
    assertEquals(prompt2.warnings.length, 1);
    assert(prompt2.warnings[0].includes("@waves"));
  });

  it("tracks panel previews and generated clips from the runner", async () => {
    const board = createStoryboard(owner, { project_id: projectId, name: "C" });
    const panel = await createPanel(owner, board.id, { panel_order: 1 });
    setPanelPreview(panel.id, "version-abc");
    const fresh = getPanel(panel.id, owner);
    assert(fresh);
    assertEquals(fresh.preview_asset_version_id, "version-abc");
    assertEquals(fresh.status, "preview_ready");

    getDb()
      .prepare(
        "UPDATE storyboard_panels SET generated_clip_asset_version_id = 'clip-1' WHERE id = ?",
      )
      .run(panel.id);
    assertEquals(getPanel(panel.id, owner)?.generated_clip_asset_version_id, "clip-1");

    assertEquals(deletePanel(owner, panel.id), true);
    assertEquals(getPanel(panel.id, owner), undefined);
  });

  it("soft deletes storyboards and hides them", async () => {
    const board = createStoryboard(owner, { project_id: projectId, name: "D" });
    await createPanel(owner, board.id, { panel_order: 1 });
    assertEquals(deleteStoryboard(owner, board.id), true);
    assertEquals(getStoryboard(board.id, owner), undefined);
    assertEquals(listStoryboards(owner).length, 0);
    const row = getDb().prepare("SELECT status FROM storyboards WHERE id = ?")
      .get(board.id) as { status: string };
    assertEquals(row.status, "deleted");
  });

  it("creates scenes and shots with prompts and ordering", async () => {
    const board = createStoryboard(owner, { project_id: projectId, name: "E" });
    const scene = await createScene(owner, {
      project_id: projectId,
      storyboard_id: board.id,
      name: "Docks",
      prompt: "fog over the @waves",
      target_duration: 45,
    });
    assertEquals(scene.status, "draft");

    const sprompt = creativePromptFor("scene", scene.id, owner);
    assert(sprompt);
    assertEquals(sprompt.warnings.length, 1);
    assert(sprompt.warnings[0].includes("@waves"));

    const s1 = await createShot(owner, scene.id, {
      shot_order: 1,
      name: "Wide",
      prompt: "wide shot of the pier",
      duration: 8,
    });
    await createShot(owner, scene.id, { shot_order: 2 });

    await assertRejects(
      () => createShot(owner, scene.id, { shot_order: 2 }),
      Error,
      "already exists",
    );

    assertEquals(
      listShots(scene.id, owner).map((s) => s.shot_order),
      [1, 2],
    );
    const shotPrompt = creativePromptFor("shot", s1.id, owner);
    assert(shotPrompt);
    assertEquals(shotPrompt.content, "wide shot of the pier");

    setShotGenerated(s1.id, "vid-1");
    const gen = getShot(s1.id, owner);
    assert(gen);
    assertEquals(gen.generated_asset_version_id, "vid-1");
    assertEquals(gen.status, "generated");

    const updated = await updateScene(owner, scene.id, {
      status: "in_production",
    });
    assertEquals(updated?.status, "in_production");
    assertEquals(deleteScene(owner, scene.id), true);
    assertEquals(listScenes(owner).length, 0);
  });

  it("enforces project permissions on creative objects", async () => {
    const board = createStoryboard(owner, { project_id: projectId, name: "F" });
    const panel = await createPanel(owner, board.id, { panel_order: 1 });
    const scene = await createScene(owner, { project_id: projectId, name: "S" });

    assertEquals(getStoryboard(board.id, other), undefined);
    assertEquals(getPanel(panel.id, other), undefined);
    assertEquals(getScene(scene.id, other), undefined);
    assert(getStoryboard(board.id, owner));
  });
});
