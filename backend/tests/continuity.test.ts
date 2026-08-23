import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { createProject } from "../src/db/projects.ts";
import { createScene, createShot, updateScene } from "../src/db/scenes.ts";
import { createPanel, createStoryboard, updatePanel } from "../src/db/storyboards.ts";
import { hashPassword } from "../src/services/password.ts";
import {
  analyzeContinuity,
  type ContinuityInput,
  type ContinuityIssue,
  type ContinuityPanelRow,
  type ContinuitySceneRow,
  type ContinuityShotRow,
} from "../src/services/continuity.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

// ---------------------------------------------------------------------------
// Pure analyzer
// ---------------------------------------------------------------------------

function panel(overrides: Partial<ContinuityPanelRow> = {}): ContinuityPanelRow {
  return {
    id: "panel-1",
    storyboard_name: "Board",
    panel_order: 1,
    time_of_day: null,
    lighting: null,
    linked_scene_id: null,
    linked_shot_id: null,
    prompt_created_at: null,
    clip_created_at: null,
    ...overrides,
  };
}

function scene(overrides: Partial<ContinuitySceneRow> = {}): ContinuitySceneRow {
  return { id: "scene-a", name: "Scene A", target_duration: null, ...overrides };
}

function shot(overrides: Partial<ContinuityShotRow> = {}): ContinuityShotRow {
  return {
    id: "shot-1",
    scene_id: "scene-a",
    shot_order: 1,
    name: null,
    duration: null,
    prompt_created_at: null,
    clip_created_at: null,
    ...overrides,
  };
}

function input(overrides: Partial<ContinuityInput> = {}): ContinuityInput {
  return {
    panels: [],
    scenes: [],
    shots: [],
    ...overrides,
  };
}

function rules(issues: ContinuityIssue[]): string[] {
  return issues.map((i) => i.rule);
}

describe("continuity analyzer (pure)", () => {
  it("returns no issues for an empty project", () => {
    assertEquals(analyzeContinuity(input()), []);
  });

  it("flags panels whose links do not resolve in the project", () => {
    const issues = analyzeContinuity(input({
      panels: [
        panel({ id: "p1", linked_scene_id: "scene-ghost", linked_shot_id: null }),
        panel({ id: "p2", linked_scene_id: null, linked_shot_id: "shot-ghost" }),
        panel({ id: "p3", linked_scene_id: "scene-a", linked_shot_id: "shot-b-scene" }),
      ],
      scenes: [scene()],
      shots: [
        shot({ id: "shot-1" }),
        shot({ id: "shot-b-scene", scene_id: "scene-b", shot_order: 1 }),
      ],
    }));
    assertEquals(rules(issues), [
      "panel-link-mismatch",
      "panel-link-mismatch",
      "panel-link-mismatch",
    ]);
    for (const issue of issues) assertEquals(issue.severity, "error");
    const p3 = issues.find((i) => i.object_id === "p3");
    assert(p3, "cross-scene link reported");
  });

  it("does not flag self-consistent links", () => {
    const issues = analyzeContinuity(input({
      panels: [panel({ linked_scene_id: "scene-a", linked_shot_id: "shot-1" })],
      scenes: [scene()],
      shots: [shot({ id: "shot-1" })],
    }));
    assertEquals(issues.filter((i) => i.rule === "panel-link-mismatch"), []);
  });

  it("flags time-of-day and lighting conflicts within a linked scene", () => {
    const issues = analyzeContinuity(input({
      panels: [
        panel({ id: "p1", linked_scene_id: "scene-a", time_of_day: "day", lighting: "hard" }),
        panel({ id: "p2", linked_scene_id: "scene-a", time_of_day: "night", lighting: "hard" }),
        panel({ id: "p3", linked_scene_id: "scene-a", time_of_day: "night", lighting: "soft" }),
        // Unlinked panels are out of scope.
        panel({ id: "p4", time_of_day: "dawn", lighting: "neon" }),
      ],
      scenes: [scene()],
    }));
    const tod = issues.find((i) => i.rule === "time-of-day-jump");
    const lighting = issues.find((i) => i.rule === "lighting-conflict");
    assert(tod, "time-of-day flag");
    assert(lighting, "lighting flag");
    assertEquals(tod.object_id, "scene-a");
    assert(tod.message.includes("day (1)") && tod.message.includes("night (2)"), tod.message);
    assert(lighting.message.includes("hard (2)"), lighting.message);
  });

  it("does not flag consistent linked panels", () => {
    const issues = analyzeContinuity(input({
      panels: [
        panel({ id: "p1", linked_scene_id: "scene-a", time_of_day: "day" }),
        panel({ id: "p2", linked_scene_id: "scene-a", time_of_day: "day" }),
      ],
      scenes: [scene()],
    }));
    assertEquals(issues, []);
  });

  it("flags clips generated before the current prompt version (shots and panels)", () => {
    const issues = analyzeContinuity(input({
      panels: [
        panel({
          id: "p-stale",
          prompt_created_at: "2026-08-23T10:00:00.000Z",
          clip_created_at: "2026-08-23T09:00:00.000Z",
        }),
        panel({
          id: "p-fresh",
          prompt_created_at: "2026-08-23T09:00:00.000Z",
          clip_created_at: "2026-08-23T10:00:00.000Z",
        }),
      ],
      shots: [
        shot({
          id: "s-stale",
          prompt_created_at: "2026-08-23T10:00:00.000Z",
          clip_created_at: "2026-08-23T09:00:00.000Z",
        }),
        shot({ id: "s-noclips", prompt_created_at: "2026-08-23T10:00:00.000Z" }),
      ],
    }));
    const stale = issues.filter((i) => i.rule === "stale-clip");
    assertEquals(stale.map((i) => i.object_id).sort(), ["p-stale", "s-stale"]);
  });

  it("flags scene target durations that disagree with shot totals", () => {
    const issues = analyzeContinuity(input({
      scenes: [
        scene({ id: "scene-a", target_duration: 10 }),
        scene({ id: "scene-b", target_duration: 10 }),
        scene({ id: "scene-c", target_duration: 10 }),
        scene({ id: "scene-d", target_duration: 10 }),
      ],
      shots: [
        // Sum 8 vs target 10 → off.
        shot({ id: "s1", scene_id: "scene-a", duration: 4 }),
        shot({ id: "s2", scene_id: "scene-a", duration: 4 }),
        // Sum 10 vs target 10 → ok.
        shot({ id: "s3", scene_id: "scene-b", duration: 5 }),
        shot({ id: "s4", scene_id: "scene-b", duration: 5 }),
        // Sum 9.6 vs target 10 → inside max(0.5, 10%) tolerance.
        shot({ id: "s5", scene_id: "scene-c", duration: 4.8 }),
        shot({ id: "s6", scene_id: "scene-c", duration: 4.8 }),
        // No shots → nothing to compare.
      ],
      panels: [],
    }));
    const mismatch = issues.filter((i) => i.rule === "duration-mismatch");
    assertEquals(mismatch.map((i) => i.object_id), ["scene-a"]);
  });

  it("flags panels linked to a scene but left without a shot", () => {
    const issues = analyzeContinuity(input({
      panels: [
        panel({ id: "p1", linked_scene_id: "scene-a" }),
        panel({ id: "p2", linked_scene_id: "scene-b" }),
        panel({ id: "p3", linked_scene_id: "scene-a", linked_shot_id: "shot-1" }),
      ],
      scenes: [scene(), scene({ id: "scene-b", name: "Scene B" })],
      shots: [shot({ id: "shot-1" })],
    }));
    const unlinked = issues.filter((i) => i.rule === "unlinked-panel");
    assertEquals(unlinked.map((i) => i.object_id), ["p1"]);
    assertEquals(unlinked[0].severity, "info");
  });

  it("sorts issues by severity, then object", () => {
    const issues = analyzeContinuity(input({
      panels: [
        panel({ id: "p1", linked_scene_id: "ghost" }),
        panel({ id: "p2", linked_scene_id: "scene-a", time_of_day: "day" }),
        panel({ id: "p3", linked_scene_id: "scene-a", time_of_day: "night" }),
        panel({ id: "p4", linked_scene_id: "scene-a" }),
      ],
      scenes: [scene({ target_duration: 10 })],
      shots: [shot({ duration: 1 })],
    }));
    // p1 -> error; p2/p3 -> time-of-day warning + one unlinked-panel info each;
    // p4 -> unlinked-panel info; scene-a -> duration-mismatch warning.
    assertEquals(
      issues.map((i) => i.severity),
      ["error", "warning", "warning", "info", "info", "info"],
    );
  });
});

// ---------------------------------------------------------------------------
// Route: GET /api/v1/projects/:id/continuity
// ---------------------------------------------------------------------------

let base = "";

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assertEquals(res.status, 200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

function get(path: string, token?: string): Promise<Response> {
  return fetch(`${base}${path}`, { headers: headers(token) });
}

describe("continuity route (MS-8)", () => {
  let ownerUserId: number;

  beforeEach(() => {
    freshMemoryDb();
    ownerUserId = 0;
  });

  afterEach(() => {
    closeDb();
  });

  it("rejects unauthenticated requests", () => {
    return withServer((url) => {
      base = url;
      return (async () => {
        await fetchWithRetry(`${base}/api/v1/health`);
        const res = await get(`/api/v1/projects/${crypto.randomUUID()}/continuity`);
        assertEquals(res.status, 401);
      })();
    });
  });

  it("returns 404 for unknown or inaccessible projects", async () => {
    ownerUserId = createUser(
      "owner@cont.example",
      await hashPassword("password123"),
      "Owner",
      "admin",
    );
    createUser(
      "intruder@cont.example",
      await hashPassword("password123"),
      "Intruder",
      "user",
    );
    const project = createProject({ name: "Locked" }, ownerUserId);

    await withServer((url) => {
      base = url;
      return (async () => {
        await fetchWithRetry(`${base}/api/v1/health`);
        const owner = await login("owner@cont.example", "password123");
        const stranger = await login("intruder@cont.example", "password123");

        assertEquals(
          (await get(`/api/v1/projects/${crypto.randomUUID()}/continuity`, owner)).status,
          404,
        );
        assertEquals(
          (await get(`/api/v1/projects/${project.id}/continuity`, stranger)).status,
          404,
        );
        assertEquals((await get(`/api/v1/projects/${project.id}/continuity`, owner)).status, 200);
      })();
    });
  });

  it("reports issues found from real creative rows", async () => {
    ownerUserId = createUser(
      "owner@cont.example",
      await hashPassword("password123"),
      "Owner",
      "admin",
    );
    const project = createProject({ name: "Continuity Check" }, ownerUserId);
    const board = createStoryboard(ownerUserId, { project_id: project.id, name: "Board" });
    const sceneA = await createScene(ownerUserId, { project_id: project.id, name: "Scene A" });
    const sceneB = await createScene(ownerUserId, { project_id: project.id, name: "Scene B" });
    const shotA = await createShot(ownerUserId, sceneA.id, {
      shot_order: 1,
      name: "Wide",
      duration: 4,
    });
    const shotB = await createShot(ownerUserId, sceneB.id, { shot_order: 1, name: "Close" });

    const p1 = await createPanel(ownerUserId, board.id, {
      panel_order: 1,
      time_of_day: "day",
      lighting: "hard",
    });
    const p2 = await createPanel(ownerUserId, board.id, {
      panel_order: 2,
      time_of_day: "night",
      lighting: "hard",
    });
    // p1: linked to Scene A with a Scene B shot → error, plus no shot link…
    await updatePanel(ownerUserId, p1.id, {
      linked_scene_id: sceneA.id,
      linked_shot_id: shotB.id,
    });
    // p2: linked to Scene A, no shot → unlinked-panel (Scene A has a shot).
    await updatePanel(ownerUserId, p2.id, { linked_scene_id: sceneA.id });
    // Scene A targets 10s but only a 4s shot → duration mismatch.
    await updateScene(ownerUserId, sceneA.id, { target_duration: 10 });
    void shotA;

    await withServer((url) => {
      base = url;
      return (async () => {
        await fetchWithRetry(`${base}/api/v1/health`);
        const token = await login("owner@cont.example", "password123");
        const res = await get(`/api/v1/projects/${project.id}/continuity`, token);
        assertEquals(res.status, 200);
        const body = (await res.json()) as {
          project_id: string;
          generated_at: string;
          issue_count: number;
          issues: ContinuityIssue[];
        };
        assertEquals(body.project_id, project.id);
        assertEquals(body.issue_count, body.issues.length);
        const byRule = new Map(body.issues.map((i) => [i.rule, i]));
        assert(byRule.get("panel-link-mismatch"), "cross-scene shot link reported");
        assertEquals(byRule.get("panel-link-mismatch")?.object_id, p1.id);
        assert(byRule.get("time-of-day-jump"), "time-of-day conflict reported");
        assertEquals(byRule.get("time-of-day-jump")?.object_id, sceneA.id);
        assert(byRule.get("unlinked-panel"), "unlinked panel reported");
        assertEquals(byRule.get("unlinked-panel")?.object_id, p2.id);
        assert(byRule.get("duration-mismatch"), "duration mismatch reported");
        // Errors must come first in the report.
        assertEquals(body.issues[0].severity, "error");
      })();
    });
  });

  it("returns an empty report for a project with no creative content", async () => {
    ownerUserId = createUser(
      "owner@cont.example",
      await hashPassword("password123"),
      "Owner",
      "admin",
    );
    const project = createProject({ name: "Empty" }, ownerUserId);

    await withServer((url) => {
      base = url;
      return (async () => {
        await fetchWithRetry(`${base}/api/v1/health`);
        const token = await login("owner@cont.example", "password123");
        const res = await get(`/api/v1/projects/${project.id}/continuity`, token);
        assertEquals(res.status, 200);
        const body = (await res.json()) as { issue_count: number; issues: unknown[] };
        assertEquals(body.issue_count, 0);
        assertEquals(body.issues, []);
      })();
    });
  });
});
