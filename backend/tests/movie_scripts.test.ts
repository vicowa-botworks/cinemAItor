import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import * as schema from "../src/db/schema.ts";
import { getDb, resetDb } from "../src/db/database.ts";
import { createProject } from "../src/db/projects.ts";
import { createAsset } from "../src/db/assets.ts";
import {
  attachScriptPrompt,
  createMovieScript,
  deleteMovieScript,
  getMovieScript,
  listMovieScripts,
  listScriptVersions,
  restoreScriptVersion,
  scriptPrompt,
  updateMovieScript,
} from "../src/db/movie_scripts.ts";

let owner: number;
let other: number;
let projectId: string;

describe("movie scripts", () => {
  beforeEach(() => {
    getDb(":memory:");
    owner = schema.createUser("owner@example.com", "hash123", "Owner", "admin");
    other = schema.createUser("other@example.com", "hash456", "Other");
    projectId = createProject({ name: "Film" }, owner).id;
  });

  afterEach(() => {
    resetDb();
  });

  it("creates, lists, updates and soft-deletes scripts", () => {
    const s1 = createMovieScript(owner, { project_id: projectId, name: "Act One" });
    const s2 = createMovieScript(owner, { project_id: projectId, name: "Act Two" });
    assertEquals(s1.status, "draft");
    assertEquals(s2.prompt_version_id, null);

    const list = listMovieScripts(owner, { project_id: projectId });
    assertEquals(list.map((s) => s.name).sort(), ["Act One", "Act Two"]);

    const updated = updateMovieScript(owner, s1.id, { name: "Opening", status: "active" });
    assert(updated);
    assertEquals(updated.name, "Opening");
    assertEquals(updated.status, "active");

    assertThrows(
      () => updateMovieScript(owner, s1.id, { status: "bogus" }),
      Error,
      "status must be one of",
    );

    assertEquals(deleteMovieScript(owner, s2.id), true);
    assertEquals(getMovieScript(s2.id, owner), undefined);
    assertEquals(listMovieScripts(owner).length, 1);
    const row = getDb().prepare("SELECT status FROM movie_scripts WHERE id = ?").get(s2.id) as {
      status: string;
    };
    assertEquals(row.status, "deleted");

    assertThrows(
      () => createMovieScript(owner, { project_id: projectId, name: "  " }),
      Error,
      "name is required",
    );
    assertThrows(
      () => createMovieScript(other, { project_id: projectId, name: "x" }),
      Error,
      "Project not found",
    );
  });

  it("saves text versions with duplicate detection and repoints prompt_version_id", async () => {
    const script = createMovieScript(owner, { project_id: projectId, name: "Draft" });
    assertEquals(script.prompt_version_id, null);

    const saved1 = await attachScriptPrompt(
      owner,
      script.id,
      "INT. DOCKS - NIGHT\n\nA lone figure waits.",
    );
    assertEquals(saved1.version_number, 1);
    assertEquals(saved1.duplicate, false);
    assertEquals(getMovieScript(script.id, owner)!.prompt_version_id, saved1.version_id);

    const saved2 = await attachScriptPrompt(
      owner,
      script.id,
      "INT. DOCKS - NIGHT\n\nA lone figure waits.",
    );
    assertEquals(saved2.duplicate, true);

    const saved3 = await attachScriptPrompt(
      owner,
      script.id,
      "INT. DOCKS - DAWN\n\nThe lights come up.",
    );
    assertEquals(saved3.version_number, 2);
    assertEquals(saved3.duplicate, false);

    const prompt = scriptPrompt(script.id, owner);
    assert(prompt);
    assertEquals(prompt.content, "INT. DOCKS - DAWN\n\nThe lights come up.");
    assertEquals(prompt.version_number, 2);
    assertEquals(listScriptVersions(script.id, owner).length, 2);
  });

  it("reports unresolved @reference warnings on the current text", async () => {
    createAsset(
      {
        unique_slug: "captain",
        display_name: "Captain",
        asset_type: "character",
        library_scope: "global",
      },
      owner,
    );
    const script = createMovieScript(owner, { project_id: projectId, name: "Refs" });
    await attachScriptPrompt(owner, script.id, "The @captain meets the @ghost by the @waves");
    const prompt = scriptPrompt(script.id, owner);
    assert(prompt);
    assertEquals(prompt.version_number, 1);
    // @captain resolves, @ghost + @waves are missing
    assertEquals(prompt.warnings.length, 2);
    assert(prompt.warnings.some((w) => w.includes("@ghost")));
    assert(prompt.warnings.some((w) => w.includes("@waves")));
  });

  it("lists versions newest-first and restores a prior version as a new one", async () => {
    const script = createMovieScript(owner, { project_id: projectId, name: "Hist" });
    await attachScriptPrompt(owner, script.id, "v1 text");
    const v2 = await attachScriptPrompt(owner, script.id, "v2 text");
    assertEquals(v2.version_number, 2);

    const versions = listScriptVersions(script.id, owner);
    assertEquals(versions.map((v) => v.version_number), [2, 1]);

    const v1Id = versions[1].id;
    const restored = restoreScriptVersion(owner, script.id, v1Id);
    assertEquals(restored.version_number, 3);
    assertEquals(restored.duplicate, false);
    const prompt = scriptPrompt(script.id, owner);
    assert(prompt);
    assertEquals(prompt.content, "v1 text");
    assertEquals(prompt.version_number, 3);
    assertEquals(listScriptVersions(script.id, owner).length, 3);
  });

  it("enforces project permissions on scripts", () => {
    const script = createMovieScript(owner, { project_id: projectId, name: "Priv" });
    assertEquals(getMovieScript(script.id, other), undefined);
    assertEquals(listMovieScripts(other).length, 0);
    assert(getMovieScript(script.id, owner));
  });

  it("refuses version saves/restores the caller cannot reach", async () => {
    const script = createMovieScript(owner, { project_id: projectId, name: "Guard" });
    await attachScriptPrompt(owner, script.id, "secret text");
    await assertRejects(
      () => attachScriptPrompt(other, script.id, "hacked"),
      Error,
      "Script not found",
    );

    const otherScript = createMovieScript(owner, { project_id: projectId, name: "Other" });
    const foreignVersion = listScriptVersions(script.id, owner)[0];
    assert(foreignVersion);
    assertThrows(
      () => restoreScriptVersion(owner, otherScript.id, foreignVersion.id),
      Error,
      "Version not found",
    );
  });
});
