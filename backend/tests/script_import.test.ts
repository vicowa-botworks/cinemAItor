import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { createProject } from "../src/db/projects.ts";
import {
  bulkCreateScenes,
  getScene,
  listScenes,
  MAX_SCENES_PER_SCRIPT_IMPORT,
  type ScriptSceneInput,
} from "../src/db/scenes.ts";
import { AppError, ERROR_CODES } from "../src/errors.ts";
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

async function login(email: string, password: string): Promise<string> {
  const res = await post("/api/v1/auth/login", { email, password });
  assertEquals(res.status, 200);
  const body = (await res.json()) as UserBody;
  return body.token;
}

describe("script import (SCN-015)", () => {
  beforeEach(async () => {
    freshMemoryDb();
    ownerUserId = createUser(
      "owner@script.example",
      await hashPassword("password123"),
      "Owner",
      "admin",
    );
  });

  afterEach(() => {
    closeDb();
  });

  describe("bulkCreateScenes", () => {
    it("creates the scenes in order as draft scenes with prompts", async () => {
      const project = createProject({ name: "P" }, ownerUserId);
      const inputs: ScriptSceneInput[] = [
        { name: "INT. OFFICE - DAY", description: "She reads the report.", prompt: "p1" },
        { name: "EXT. DOCK - DAWN", notes: "LEA\nWe found it." },
      ];

      const created = await bulkCreateScenes(ownerUserId, project.id, inputs);
      assertEquals(created.length, 2);
      assertEquals(created[0].name, "INT. OFFICE - DAY");
      assertEquals(created[0].description, "She reads the report.");
      assertEquals(created[0].status, "draft");
      assert(created[0].prompt_version_id, "prompt attached");
      assert(!created[1].prompt_version_id, "no prompt for prompt-less entry");
      assertEquals(created[1].notes, "LEA\nWe found it.");

      const all = listScenes(ownerUserId, { project_id: project.id });
      assertEquals(all.length, 2);
      assertEquals(
        new Set(all.map((s) => s.name)),
        new Set(inputs.map((i) => i.name)),
      );
      assertEquals(getScene(created[1].id, ownerUserId)?.id, created[1].id);
    });

    it("rejects an empty or oversized scene list", async () => {
      const project = createProject({ name: "P" }, ownerUserId);
      await assertRejects(
        () => bulkCreateScenes(ownerUserId, project.id, []),
        AppError,
        "non-empty",
      );
      const tooMany: ScriptSceneInput[] = Array.from(
        { length: MAX_SCENES_PER_SCRIPT_IMPORT + 1 },
        (_, i) => ({ name: `Scene ${i}` }),
      );
      await assertRejects(
        () => bulkCreateScenes(ownerUserId, project.id, tooMany),
        AppError,
        `at most ${MAX_SCENES_PER_SCRIPT_IMPORT}`,
      );
    });

    it("validates each entry", async () => {
      const project = createProject({ name: "P" }, ownerUserId);
      await assertRejects(
        () => bulkCreateScenes(ownerUserId, project.id, [{ name: "  " }]),
        AppError,
        "name is required",
      );
      await assertRejects(
        () =>
          bulkCreateScenes(ownerUserId, project.id, [
            { name: "A", description: 42 as unknown as string },
          ]),
        AppError,
        "description must be a string",
      );
      await assertRejects(
        () =>
          bulkCreateScenes(ownerUserId, project.id, [
            { name: "A", prompt: null as unknown as string },
          ]),
        AppError,
        "prompt must be a string",
      );
      await assertRejects(
        () =>
          bulkCreateScenes(ownerUserId, project.id, [
            { name: "A", notes: [] as unknown as string },
          ]),
        AppError,
        "notes must be a string",
      );
    });

    it("rejects projects the user cannot write to", async () => {
      const otherUserId = createUser(
        "other@script.example",
        await hashPassword("password123"),
        "Other",
        "user",
      );
      const project = createProject({ name: "P" }, ownerUserId);
      await assertRejects(
        () => bulkCreateScenes(otherUserId, project.id, [{ name: "A" }]),
        AppError,
        "Project not found",
      );
    });
  });

  describe("route", () => {
    it("rejects unauthenticated requests", async () => {
      await withServer((url) => {
        base = url;
        return (async () => {
          await fetchWithRetry(`${base}/api/v1/health`);
          const res = await post(
            "/api/v1/projects/00000000-0000-0000-0000-000000000000/scenes/from-script",
            { scenes: [{ name: "A" }] },
          );
          assertEquals(res.status, 401);
        })();
      });
    });

    it("creates scenes in the project and returns them with prompts", async () => {
      await withServer((url) => {
        base = url;
        return (async () => {
          await fetchWithRetry(`${base}/api/v1/health`);
          const token = await login("owner@script.example", "password123");
          const projectRes = await fetch(`${base}/api/v1/projects`, {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({ name: "Scripted" }),
          });
          assertEquals(projectRes.status, 201);
          const project = (await projectRes.json()) as { id: string };

          const res = await post(
            `/api/v1/projects/${project.id}/scenes/from-script`,
            {
              scenes: [
                {
                  name: "INT. OFFICE - DAY",
                  description: "She reads the report.",
                  prompt: "Setting: INT. OFFICE - DAY\nShe reads the report.",
                  notes: "LEA\nWe found it.",
                },
                { name: "EXT. DOCK - DAWN" },
              ],
            },
            token,
          );
          assertEquals(res.status, 201);
          const body = (await res.json()) as {
            created: Array<{
              name: string;
              description: string | null;
              notes: string | null;
              status: string;
              prompt: { content: string } | null;
            }>;
          };
          assertEquals(body.created.length, 2);
          assertEquals(body.created[0].name, "INT. OFFICE - DAY");
          assertEquals(body.created[0].description, "She reads the report.");
          assertEquals(body.created[0].notes, "LEA\nWe found it.");
          assertEquals(body.created[0].status, "draft");
          assertEquals(
            body.created[0].prompt?.content,
            "Setting: INT. OFFICE - DAY\nShe reads the report.",
          );
          assertEquals(body.created[1].name, "EXT. DOCK - DAWN");
          assertEquals(body.created[1].prompt, null);
        })();
      });
    });

    it("rejects a body without a scenes array", async () => {
      await withServer((url) => {
        base = url;
        return (async () => {
          await fetchWithRetry(`${base}/api/v1/health`);
          const token = await login("owner@script.example", "password123");
          const projectRes = await fetch(`${base}/api/v1/projects`, {
            method: "POST",
            headers: headers(token),
            body: JSON.stringify({ name: "Scripted" }),
          });
          const project = (await projectRes.json()) as { id: string };

          const res = await post(
            `/api/v1/projects/${project.id}/scenes/from-script`,
            { notScenes: true },
            token,
          );
          assertEquals(res.status, 400);
          const errBody = (await res.json()) as { error: { code: string; message: string } };
          assertEquals(errBody.error.code, ERROR_CODES.VALIDATION);
          assertEquals(errBody.error.message, "scenes must be an array");
        })();
      });
    });

    it("returns 404 for an unknown project", async () => {
      await withServer((url) => {
        base = url;
        return (async () => {
          await fetchWithRetry(`${base}/api/v1/health`);
          const token = await login("owner@script.example", "password123");
          const res = await post(
            "/api/v1/projects/00000000-0000-0000-0000-000000000000/scenes/from-script",
            { scenes: [{ name: "A" }] },
            token,
          );
          assertEquals(res.status, 404);
        })();
      });
    });

    it("returns 404 for a project the user cannot write to", async () => {
      await withServer((url) => {
        base = url;
        return (async () => {
          await fetchWithRetry(`${base}/api/v1/health`);
          const owner = await login("owner@script.example", "password123");
          const projectRes = await fetch(`${base}/api/v1/projects`, {
            method: "POST",
            headers: headers(owner),
            body: JSON.stringify({ name: "Locked" }),
          });
          const project = (await projectRes.json()) as { id: string };

          const reg = await post(
            "/api/auth/register",
            { email: "viewer@script.example", password: "password123", display_name: "V" },
          );
          assertEquals(reg.status, 201);
          const viewer = await login("viewer@script.example", "password123");

          const res = await post(
            `/api/v1/projects/${project.id}/scenes/from-script`,
            { scenes: [{ name: "A" }] },
            viewer,
          );
          assertEquals(res.status, 404);
        })();
      });
    });
  });
});
