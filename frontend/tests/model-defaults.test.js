import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import {
  autoModelFor,
  autoOptionLabel,
  defaultTaskTypesFor,
  invalidateModelDefaults,
  loadModelDefaults,
  parseProjectPreferences,
  projectPreferencesPayload,
} from "../src/model-defaults.js";

const ALPHA = { id: "alpha", name: "Alpha SDXL" };
const BETA = { id: "beta", name: "Beta Flux" };

describe("autoModelFor", () => {
  it("prefers the task type's default when the list contains it", () => {
    assertEquals(autoModelFor([ALPHA, BETA], { text_to_image: "beta" }, "text_to_image"), BETA);
  });

  it("falls back to the first model when no default is set", () => {
    assertEquals(autoModelFor([ALPHA, BETA], {}, "text_to_image"), ALPHA);
    assertEquals(autoModelFor([ALPHA, BETA], { text_to_image: null }, "text_to_image"), ALPHA);
  });

  it("ignores a default for another task type", () => {
    assertEquals(
      autoModelFor([ALPHA, BETA], { text_to_video: "beta" }, "text_to_image"),
      ALPHA,
    );
  });

  it("ignores a default the picker's list does not offer", () => {
    // A disabled model, or one that no longer serves the task: the server
    // skips it too, so the label must not claim it.
    assertEquals(autoModelFor([ALPHA], { text_to_image: "gone" }, "text_to_image"), ALPHA);
  });

  it("returns null for an empty list", () => {
    assertEquals(autoModelFor([], { text_to_image: "beta" }, "text_to_image"), null);
    assertEquals(autoModelFor(null, null, "text_to_image"), null);
  });
});

describe("autoOptionLabel", () => {
  it("names the default the auto option resolves to", () => {
    assertEquals(autoOptionLabel(BETA), "Auto (default: Beta Flux)");
    assertEquals(
      autoOptionLabel(BETA, { projectScoped: true }),
      "Auto (project default: Beta Flux)",
    );
  });

  it("keeps the historical wording when nothing is configured", () => {
    assertEquals(autoOptionLabel(null), "Auto (first enabled)");
    assertEquals(autoOptionLabel(undefined, { projectScoped: true }), "Auto (first enabled)");
  });
});

describe("defaultTaskTypesFor", () => {
  it("lists every task type a model is the default for", () => {
    assertEquals(
      defaultTaskTypesFor(
        { text_to_video: "beta", text_to_image: "beta", music: "gamma" },
        "beta",
      ),
      ["text_to_image", "text_to_video"],
    );
  });

  it("is empty for a model that is nobody's default", () => {
    assertEquals(defaultTaskTypesFor({ text_to_image: "beta" }, "alpha"), []);
    assertEquals(defaultTaskTypesFor(null, "alpha"), []);
    assertEquals(defaultTaskTypesFor({ text_to_image: "beta" }, null), []);
  });
});

describe("loadModelDefaults", () => {
  function fakeApi(calls, result) {
    return {
      async listModelDefaults() {
        calls.count = (calls.count ?? 0) + 1;
        if (result instanceof Error) throw result;
        return result;
      },
    };
  }

  it("caches one request and shares it across callers", async () => {
    invalidateModelDefaults();
    const calls = {};
    const api = fakeApi(calls, { defaults: { text_to_image: "beta" }, models: {} });

    const [a, b] = await Promise.all([loadModelDefaults(api), loadModelDefaults(api)]);
    const c = await loadModelDefaults(api);

    assertEquals(calls.count, 1);
    assertEquals(a.defaults, { text_to_image: "beta" });
    assertEquals(b, a);
    assertEquals(c, a);
  });

  it("re-reads on refresh", async () => {
    invalidateModelDefaults();
    const calls = {};
    const api = fakeApi(calls, { defaults: { music: "m" }, models: {} });
    await loadModelDefaults(api);
    const refreshed = await loadModelDefaults(api, { refresh: true });
    assertEquals(calls.count, 2);
    assertEquals(refreshed.defaults, { music: "m" });
  });

  it("degrades to empty defaults when the endpoint fails", async () => {
    invalidateModelDefaults();
    const calls = {};
    const failing = fakeApi(calls, new Error("boom"));
    const view = await loadModelDefaults(failing);
    assertEquals(view, { defaults: {}, models: {}, taskTypes: [] });

    // A failure is not cached: a later caller retries and gets real data.
    const ok = fakeApi(calls, { defaults: { text_to_image: "beta" }, models: {} });
    const retried = await loadModelDefaults(ok);
    assertEquals(retried.defaults, { text_to_image: "beta" });
  });

  it("does not leave a rejected request pending", async () => {
    invalidateModelDefaults();
    const calls = {};
    const failing = fakeApi(calls, new Error("boom"));
    await loadModelDefaults(failing);
    invalidateModelDefaults();

    const ok = fakeApi(calls, { defaults: { a: 1 }, models: {} });
    const view = await loadModelDefaults(ok);
    assert(view.defaults.a === 1);
  });
});

describe("parseProjectPreferences", () => {
  it("reads a stored JSON map", () => {
    assertEquals(
      parseProjectPreferences('{"text_to_image":"beta","music":"m"}'),
      { text_to_image: "beta", music: "m" },
    );
  });

  it("accepts an already-parsed object", () => {
    assertEquals(parseProjectPreferences({ music: "m" }), { music: "m" });
  });

  it("reads anything malformed or of the wrong shape as no preferences", () => {
    assertEquals(parseProjectPreferences(null), {});
    assertEquals(parseProjectPreferences(""), {});
    assertEquals(parseProjectPreferences("not json"), {});
    assertEquals(parseProjectPreferences("[]"), {});
    assertEquals(parseProjectPreferences('"beta"'), {});
  });

  it("drops empty and non-string values", () => {
    assertEquals(
      parseProjectPreferences({ music: "", voice: null, sfx: 3, audio: "a" }),
      { audio: "a" },
    );
  });
});

describe("projectPreferencesPayload", () => {
  it("drops cleared selections so the map holds only overrides", () => {
    assertEquals(
      projectPreferencesPayload({ text_to_image: "beta", music: "" }),
      { text_to_image: "beta" },
    );
  });

  it("maps an all-empty form to an empty object (clears the column)", () => {
    assertEquals(projectPreferencesPayload({ music: "" }), {});
    assertEquals(projectPreferencesPayload(undefined), {});
  });
});

describe("loadModelDefaults task types", () => {
  function apiReturning(payload) {
    return {
      async listModelDefaults() {
        return payload;
      },
    };
  }

  it("carries the server's canonical task-type list", async () => {
    invalidateModelDefaults();
    const view = await loadModelDefaults(apiReturning({
      defaults: {},
      models: {},
      task_types: ["text_to_image", "music"],
    }));
    assertEquals(view.taskTypes, ["text_to_image", "music"]);
  });

  it("reads a missing list as empty rather than undefined", async () => {
    invalidateModelDefaults();
    const view = await loadModelDefaults(apiReturning({ defaults: {}, models: {} }));
    assertEquals(view.taskTypes, []);
  });
});
