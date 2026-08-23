import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { getDb, resetDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { applyTemplateStructure, getTemplate, listTemplates } from "../src/db/templates.ts";
import { listTimelines, listTracks } from "../src/db/timelines.ts";
import { createProject } from "../src/db/projects.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
}

describe("templates", () => {
  let ownerId: number;

  beforeEach(() => {
    getDb(":memory:");
    ownerId = createUser(uniqueEmail("owner"), "hash123", "Owner");
  });

  afterEach(() => {
    resetDb();
  });

  it("seeds the system template set", () => {
    const all = listTemplates();
    const ids = all.map((t) => t.id);
    assertEquals(
      ids,
      ["tpl-blank", "tpl-podcast", "tpl-short-film"],
    );
    assert(all.every((t) => t.is_system));

    const blank = all.find((t) => t.id === "tpl-blank") as (typeof all)[number];
    assertEquals(blank.structure.timeline_name, null);
    assertEquals(blank.structure.tracks.length, 0);

    const film = all.find((t) => t.id === "tpl-short-film") as (
      typeof all
    )[number];
    assertEquals(film.structure.timeline_name, "Main");
    assertEquals(
      film.structure.tracks.map((t) => t.track_type),
      ["video", "dialogue", "music", "text"],
    );

    const podcast = all.find((t) => t.id === "tpl-podcast") as (
      typeof all
    )[number];
    assertEquals(
      podcast.structure.tracks.map((t) => t.track_type),
      ["dialogue", "music", "ambience", "subtitle"],
    );
  });

  it("resolves known ids and reports unknown ones", () => {
    assertEquals(getTemplate("tpl-blank")?.name, "Blank");
    assertEquals(getTemplate("tpl-nope"), undefined);
  });

  function projectFor(userId: number, templateId?: string) {
    return createProject(
      { name: "T", ...(templateId ? { template_id: templateId } : {}) },
      userId,
    );
  }

  it("applies blank structures as a no-op", () => {
    const project = projectFor(ownerId, "tpl-blank");
    const template = getTemplate("tpl-blank");
    assert(template);
    const timeline = applyTemplateStructure(ownerId, project.id, template);
    assertEquals(timeline, undefined);
    assertEquals(listTimelines(ownerId, { project_id: project.id }).length, 0);
  });

  it("materializes template tracks on a fresh default timeline", () => {
    const project = projectFor(ownerId, "tpl-short-film");
    const template = getTemplate("tpl-short-film");
    assert(template);
    const timeline = applyTemplateStructure(ownerId, project.id, template);
    assert(timeline);
    const tracks = listTracks(timeline.id, ownerId);
    assertEquals(tracks.map((t) => t.name), [
      "Picture",
      "Dialogue",
      "Music",
      "Captions",
    ]);
    assertEquals(tracks.map((t) => t.track_order), [1, 2, 3, 4]);
    assertEquals(tracks.at(-1)?.muted, false);
  });
});

describe("templates api", () => {
  let baseUrl = "";
  let adminToken = "";

  function headers(token?: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  function post(path: string, body: unknown, token?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    });
  }

  function get(path: string, token?: string): Promise<Response> {
    return fetch(`${baseUrl}${path}`, { headers: headers(token) });
  }

  async function bootstrapAdmin(): Promise<string> {
    const boot = await post("/api/v1/auth/bootstrap", {
      email: "tpl-admin@example.com",
      password: "secret123",
      display_name: "Admin",
    });
    assertEquals(boot.status, 201);
    return ((await boot.json()) as { token: string }).token;
  }

  beforeEach(() => {
    freshMemoryDb();
  });

  afterEach(() => {
    resetDb();
  });

  it("lists templates and rejects unauthenticated calls", () =>
    withServer(async (base) => {
      baseUrl = base;
      await fetchWithRetry(`${baseUrl}/api/v1/health`);
      adminToken = await bootstrapAdmin();

      assertEquals((await get("/api/v1/templates")).status, 401);
      const res = await get("/api/v1/templates", adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as { id: string }[];
      assert(body.some((t) => t.id === "tpl-short-film"));
    }));

  it("creates projects with a materialized template structure", () =>
    withServer(async (base) => {
      baseUrl = base;
      await fetchWithRetry(`${baseUrl}/api/v1/health`);
      adminToken = await bootstrapAdmin();

      const res = await post("/api/v1/projects", {
        name: "From Template",
        template_id: "tpl-podcast",
      }, adminToken);
      assertEquals(res.status, 201);
      const project = (await res.json()) as { id: string; template_id: string };
      assertEquals(project.template_id, "tpl-podcast");

      const tlRes = await get(`/api/v1/timelines?project_id=${project.id}`, adminToken);
      assertEquals(tlRes.status, 200);
      const timelines = (await tlRes.json()) as { id: string; name: string }[];
      assertEquals(timelines.length, 1);
      assertEquals(timelines[0].name, "Main");

      const detailRes = await get(`/api/v1/timelines/${timelines[0].id}`, adminToken);
      const detail = (await detailRes.json()) as {
        tracks: { track_type: string }[];
      };
      assertEquals(
        detail.tracks.map((t) => t.track_type),
        ["dialogue", "music", "ambience", "subtitle"],
      );
    }));

  it("rejects unknown template ids before creating anything", () =>
    withServer(async (base) => {
      baseUrl = base;
      await fetchWithRetry(`${baseUrl}/api/v1/health`);
      adminToken = await bootstrapAdmin();

      const res = await post("/api/v1/projects", {
        name: "Bad Template",
        template_id: "tpl-nope",
      }, adminToken);
      assertEquals(res.status, 400);

      const projects = (await (await get("/api/v1/projects", adminToken)).json()) as unknown[];
      assertEquals(projects.length, 0);
    }));
});

describe("templates structure validation", () => {
  beforeEach(() => {
    getDb(":memory:");
    createUser(uniqueEmail("v"), "hash123", "V");
  });

  afterEach(() => {
    resetDb();
  });

  function seedTemplate(id: string, structure: unknown): void {
    const db = getDb();
    (db.prepare(
      `INSERT OR REPLACE INTO templates
         (id, name, description, structure_json, is_system, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 0, datetime('now'), datetime('now'))`,
    ).run as (...params: unknown[]) => unknown)(
      id,
      id,
      JSON.stringify(structure),
    );
  }

  it("accepts valid structures", () => {
    seedTemplate("tpl-ok", {
      timeline_name: "Main",
      tracks: [{ name: "Voice", track_type: "voiceover" }],
    });
    assertEquals(getTemplate("tpl-ok")?.structure.tracks.length, 1);
  });

  it("rejects malformed or invalid structures", () => {
    for (
      const structure of [
        { timeline_name: 7, tracks: [] },
        { timeline_name: null },
        { tracks: "nope" },
        { timeline_name: "M", tracks: [{ name: "x", track_type: "hologram" }] },
        { timeline_name: "M", tracks: [{ track_type: "music" }] },
        "not-an-object",
      ]
    ) {
      seedTemplate("tpl-bad", structure);
      assertThrows(() => getTemplate("tpl-bad"), Error, "tpl-bad");
    }
    // Corrupted JSON payload.
    const db = getDb();
    (db.prepare(
      "UPDATE templates SET structure_json = '{oops' WHERE id = 'tpl-bad'",
    ).run as (...params: unknown[]) => unknown)();
    assertThrows(() => getTemplate("tpl-bad"), Error, "malformed");
  });
});
