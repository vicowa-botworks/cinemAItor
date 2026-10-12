import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertThrows } from "@std/assert";
import { closeDb, getDb, resetDb } from "../src/db/database.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";
import * as schema from "../src/db/schema.ts";
import { deleteModel, registerModel, updateModel } from "../src/db/models.ts";
import {
  clearTaskTypeDefaultsForModel,
  getTaskTypeDefault,
  listTaskTypeDefaults,
  modelsForTaskType,
  normalizeModelPreferences,
  parseModelPreferences,
  resolveDefaultModel,
  setTaskTypeDefault,
} from "../src/db/model_defaults.ts";
import { pickModel } from "../src/services/creative_generation.ts";
import { createProject } from "../src/db/projects.ts";

let userId: number;

function register(name: string, taskTypes: string[], enabled = true) {
  return registerModel(userId, {
    name,
    version: "1.0",
    backend: "local_cli",
    source: "local",
    task_types: taskTypes,
    output_types: ["image"],
    default_settings: { command: `${name}-runner` },
    enabled,
  });
}

describe("task-type default models", () => {
  beforeEach(() => {
    getDb(":memory:");
    userId = schema.createUser(
      `owner.${Math.random().toString(36).slice(2)}@example.com`,
      "hash123",
      "Owner",
    );
  });

  afterEach(() => {
    resetDb();
  });

  describe("registry defaults", () => {
    it("sets, replaces and clears one default per task type", () => {
      const a = register("alpha", ["text_to_image"]);
      const b = register("beta", ["text_to_image"]);

      assertEquals(getTaskTypeDefault("text_to_image"), null);
      assertEquals(setTaskTypeDefault(userId, "text_to_image", a.id), {
        task_type: "text_to_image",
        model_id: a.id,
      });
      assertEquals(getTaskTypeDefault("text_to_image"), a.id);

      // Setting another model replaces the choice — never two defaults for one task.
      setTaskTypeDefault(userId, "text_to_image", b.id);
      assertEquals(getTaskTypeDefault("text_to_image"), b.id);
      assertEquals(listTaskTypeDefaults(), { text_to_image: b.id });

      setTaskTypeDefault(userId, "text_to_image", null);
      assertEquals(getTaskTypeDefault("text_to_image"), null);
      assertEquals(listTaskTypeDefaults(), {});
    });

    it("normalizes dashed task-type aliases to canonical keys", () => {
      const m = register("alpha", ["text_to_image"]);
      assertEquals(setTaskTypeDefault(userId, "text-to-image", m.id).task_type, "text_to_image");
      assertEquals(getTaskTypeDefault("text_to_image"), m.id);
    });

    it("rejects an unknown task type", () => {
      const m = register("alpha", ["text_to_image"]);
      assertThrows(() => setTaskTypeDefault(userId, "text_to_speech", m.id));
    });

    it("rejects a model that cannot serve the task", () => {
      const wrongTask = register("video-only", ["image_to_video"]);
      const disabled = register("sleepy", ["text_to_image"], false);
      assertThrows(() => setTaskTypeDefault(userId, "text_to_image", wrongTask.id));
      assertThrows(() => setTaskTypeDefault(userId, "text_to_image", disabled.id));
      assertThrows(() => setTaskTypeDefault(userId, "text_to_image", "nope"));
      assertEquals(getTaskTypeDefault("text_to_image"), null);
    });

    it("clears the default held by a deleted model", () => {
      const a = register("alpha", ["text_to_image"]);
      const b = register("beta", ["text_to_image", "image_to_video"]);
      setTaskTypeDefault(userId, "text_to_image", a.id);
      setTaskTypeDefault(userId, "image_to_video", b.id);

      deleteModel(userId, a.id);
      assertEquals(getTaskTypeDefault("text_to_image"), null);
      assertEquals(getTaskTypeDefault("image_to_video"), b.id);
    });

    it("keeps a default when its model is only disabled (self-heals on re-enable)", () => {
      const a = register("alpha", ["text_to_image"]);
      setTaskTypeDefault(userId, "text_to_image", a.id);
      updateModel(userId, a.id, { enabled: false });
      assertEquals(getTaskTypeDefault("text_to_image"), a.id);
      // …but it is not honoured while unusable.
      assertEquals(resolveDefaultModel("text_to_image"), null);
      updateModel(userId, a.id, { enabled: true });
      assertEquals(resolveDefaultModel("text_to_image")?.id, a.id);
    });

    it("lists the enabled models that can serve a task type", () => {
      register("alpha", ["text_to_image"]);
      register("beta", ["image_to_video"]);
      register("gamma", ["text_to_image"], false);
      assertEquals(modelsForTaskType("text_to_image").map((m) => m.name), ["alpha"]);
      assertEquals(modelsForTaskType("nonsense"), []);
    });

    it("clearTaskTypeDefaultsForModel is explicit for callers outside deleteModel", () => {
      const a = register("alpha", ["text_to_image", "image_to_video"]);
      setTaskTypeDefault(userId, "text_to_image", a.id);
      setTaskTypeDefault(userId, "image_to_video", a.id);
      clearTaskTypeDefaultsForModel(a.id);
      assertEquals(listTaskTypeDefaults(), {});
    });
  });

  describe("resolveDefaultModel", () => {
    it("prefers the project override over the global default", () => {
      const global = register("a-global", ["text_to_image"]);
      const override = register("b-project", ["text_to_image"]);
      setTaskTypeDefault(userId, "text_to_image", global.id);
      assertEquals(resolveDefaultModel("text_to_image")?.id, global.id);
      assertEquals(
        resolveDefaultModel("text_to_image", { text_to_image: override.id })?.id,
        override.id,
      );
    });

    it("skips a default that no longer qualifies instead of failing", () => {
      const stale = register("gone-later", ["text_to_image"]);
      const fallback = register("zeta", ["text_to_image"]);
      setTaskTypeDefault(userId, "text_to_image", stale.id);
      updateModel(userId, stale.id, { task_types: ["image_to_video"] });
      assertEquals(resolveDefaultModel("text_to_image"), null);
      // pickModel falls through to the first enabled model (alphabetical).
      assertEquals(pickModel("text_to_image", undefined).id, fallback.id);
    });

    it("ignores a project entry for another task type or an unknown model", () => {
      const m = register("alpha", ["text_to_image"]);
      assertEquals(resolveDefaultModel("text_to_image", { music: m.id }), null);
      assertEquals(resolveDefaultModel("text_to_image", { text_to_image: "ghost" }), null);
    });
  });

  describe("project preferences", () => {
    it("parses stored JSON defensively", () => {
      assertEquals(parseModelPreferences(null), {});
      assertEquals(parseModelPreferences(""), {});
      assertEquals(parseModelPreferences("{not json"), {});
      assertEquals(parseModelPreferences("[1,2]"), {});
      assertEquals(parseModelPreferences('"a string"'), {});
      assertEquals(
        parseModelPreferences('{"text-to-image":"m1","music":null,"bogus":"m2"}'),
        { text_to_image: "m1", bogus: "m2" },
      );
    });

    it("normalizes a write payload to canonical keys", () => {
      const m = register("alpha", ["text_to_image"]);
      assertEquals(
        JSON.parse(normalizeModelPreferences({ "text-to-image": m.id, music: null })),
        { text_to_image: m.id, music: null },
      );
      assertEquals(
        JSON.parse(normalizeModelPreferences('{"text_to_image":"x"}')),
        { text_to_image: "x" },
      );
      assertThrows(() => normalizeModelPreferences({ nonsense: "x" }));
      assertThrows(() => normalizeModelPreferences({ text_to_image: 42 }));
      assertThrows(() => normalizeModelPreferences({ text_to_image: "" }));
      assertThrows(() => normalizeModelPreferences("[]"));
      assertThrows(() => normalizeModelPreferences("{broken"));
      assertThrows(() => normalizeModelPreferences(null));
    });

    it("round-trips through the project row into model resolution", () => {
      const global = register("a-global", ["text_to_image"]);
      const preferred = register("b-project", ["text_to_image"]);
      setTaskTypeDefault(userId, "text_to_image", global.id);
      const project = createProject(
        {
          name: "Override project",
          default_model_preferences_json: JSON.stringify({ text_to_image: preferred.id }),
        },
        userId,
      );
      assertEquals(pickModel("text_to_image", undefined, project.id).id, preferred.id);
      // A global asset (no project) still gets the registry default.
      assertEquals(pickModel("text_to_image", undefined, null).id, global.id);
      // An unknown project id degrades to the registry default, never an error.
      assertEquals(pickModel("text_to_image", undefined, "missing-project").id, global.id);
    });
  });

  describe("pickModel", () => {
    it("keeps an explicit model_id authoritative", () => {
      const a = register("a-alpha", ["text_to_image"]);
      const b = register("b-beta", ["text_to_image"]);
      setTaskTypeDefault(userId, "text_to_image", a.id);
      assertEquals(pickModel("text_to_image", b.id).id, b.id);
      assertThrows(() => pickModel("text_to_image", "ghost"));
    });

    it("falls back to the first enabled model when nothing is set", () => {
      const b = register("b-beta", ["text_to_image"]);
      register("a-alpha", ["text_to_image"], false);
      assertEquals(pickModel("text_to_image", undefined).id, b.id);
    });
  });
});

describe("project default preferences (api)", () => {
  let baseUrl = "";
  let token = "";

  async function req(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  beforeEach(async () => {
    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      await fetchWithRetry(`${baseUrl}/api/v1/health`);
      const res = await req("POST", "/api/v1/auth/bootstrap", {
        email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
        password: "password123",
        display_name: "Admin",
      });
      token = (res.json as { token: string }).token;
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("validates and normalizes the preferences map", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const created = await req("POST", "/api/v1/projects", {
        name: "Prefs",
        default_model_preferences: { "text-to-image": "flux", music: null },
      });
      assertEquals(created.status, 201);
      const project = created.json as {
        id: string;
        default_model_preferences_json: string;
      };
      assertEquals(JSON.parse(project.default_model_preferences_json), {
        text_to_image: "flux",
        music: null,
      });

      for (
        const bad of [
          { nonsense: "x" },
          { text_to_image: 42 },
          { text_to_image: "" },
          [],
          "not json",
          7,
        ]
      ) {
        assertEquals(
          (await req("PATCH", `/api/v1/projects/${project.id}`, {
            default_model_preferences: bad,
          })).status,
          400,
          `expected 400 for ${JSON.stringify(bad)}`,
        );
      }

      const cleared = await req("PATCH", `/api/v1/projects/${project.id}`, {
        default_model_preferences: null,
      });
      assertEquals(cleared.status, 200);
      assertEquals(
        (cleared.json as { default_model_preferences_json: string | null })
          .default_model_preferences_json,
        null,
      );
    });
  });
});
