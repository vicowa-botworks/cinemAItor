import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import {
  defaultPrefs,
  hasReferenceTokens,
  loadPrefs,
  pickEnhanceSkill,
  runEnhance,
  savePrefs,
} from "../src/components/prompt-enhance.js";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
  };
}

function skill(id, name, assistant, enabled = true) {
  return { id, name, enabled, definition: { assistant } };
}

const MM = {
  id: "minimax_h3",
  task_types: ["text_to_video", "image_to_video"],
};
const FLUX = { id: "flux", task_types: ["text_to_video"] };

const MM_VIDEO = skill(
  "s-video",
  "MiniMax H3 video prompt",
  {
    model_ids: ["minimax_h3"],
    model_task_types: ["text_to_video", "image_to_video"],
  },
);
const MM_REF = skill(
  "s-ref",
  "MiniMax H3 full-reference rewrite",
  { model_ids: ["minimax_h3"], model_task_types: ["image_to_video"] },
);
const GENERIC = skill(
  "s-generic",
  "Generic video prompt",
  { model_ids: [], model_task_types: ["text_to_video"] },
);

describe("hasReferenceTokens", () => {
  it("detects @slug tokens", () => {
    assertEquals(hasReferenceTokens("show @pirate_sloop sailing"), true);
    assertEquals(hasReferenceTokens("@crew"), true);
  });

  it("detects versioned tokens", () => {
    assertEquals(hasReferenceTokens("@sloop:v3"), true);
    assertEquals(hasReferenceTokens("@sloop:2"), true);
  });

  it("returns false without tokens", () => {
    assertEquals(hasReferenceTokens("a ship on the open sea"), false);
    assertEquals(hasReferenceTokens(""), false);
  });

  it("returns false for non-strings", () => {
    assertEquals(hasReferenceTokens(null), false);
    assertEquals(hasReferenceTokens(42), false);
    assertEquals(hasReferenceTokens(undefined), false);
  });
});

describe("pickEnhanceSkill", () => {
  it("prefers the broadest model-scoped skill without references", () => {
    const picked = pickEnhanceSkill(
      [GENERIC, MM_REF, MM_VIDEO],
      MM,
      "text_to_video",
      false,
    );
    assertEquals(picked?.id, "s-video");
  });

  it("prefers the narrowest model-scoped skill with references", () => {
    const picked = pickEnhanceSkill(
      [GENERIC, MM_VIDEO, MM_REF],
      MM,
      "image_to_video",
      true,
    );
    assertEquals(picked?.id, "s-ref");
  });

  it("excludes model-scoped skills for other models", () => {
    const picked = pickEnhanceSkill(
      [MM_REF, MM_VIDEO, GENERIC],
      FLUX,
      "text_to_video",
      false,
    );
    assertEquals(picked?.id, "s-generic");
  });

  it("excludes disabled and non-assistant skills", () => {
    const disabled = skill(
      "s-off",
      "Off",
      { model_ids: ["minimax_h3"] },
      false,
    );
    const noAssistant = {
      id: "s-plain",
      name: "Plain",
      enabled: true,
      definition: {},
    };
    assertEquals(
      pickEnhanceSkill([disabled, noAssistant], MM, "text_to_video"),
      null,
    );
  });

  it("excludes skills whose task types do not overlap", () => {
    const imageOnly = skill("s-img", "Image only", {
      model_ids: [],
      model_task_types: ["text_to_image"],
    });
    assertEquals(pickEnhanceSkill([imageOnly], MM, "text_to_video"), null);
  });

  it("lets unrestricted unscoped skills match any model", () => {
    const unrestricted = skill("s-all", "All", {
      model_ids: [],
      model_task_types: [],
    });
    const picked = pickEnhanceSkill([unrestricted], MM, "text_to_video", false);
    assertEquals(picked?.id, "s-all");
  });

  it("breaks ties alphabetically by name", () => {
    const a = skill("s-a", "Alpha", {
      model_ids: ["minimax_h3"],
      model_task_types: ["text_to_video"],
    });
    const b = skill("s-b", "Beta", {
      model_ids: ["minimax_h3"],
      model_task_types: ["text_to_video"],
    });
    const picked = pickEnhanceSkill([b, a], MM, "text_to_video", false);
    assertEquals(picked?.id, "s-a");
  });

  it("returns null when nothing matches", () => {
    assertEquals(pickEnhanceSkill([GENERIC], MM, "image_to_video", true), null);
    assertEquals(pickEnhanceSkill([], MM, "text_to_video"), null);
    assertEquals(pickEnhanceSkill(null, MM, "text_to_video"), null);
  });
});

describe("prefs", () => {
  it("returns defaults for an empty storage", () => {
    assertEquals(loadPrefs(fakeStorage(), "scene"), { ...defaultPrefs });
  });

  it("round-trips saved prefs per surface", () => {
    const storage = fakeStorage();
    const prefs = { autoEnhance: true, autoSkill: true, modelId: "minimax_h3" };
    assertEquals(savePrefs(storage, "asset", prefs), true);
    assertEquals(loadPrefs(storage, "asset"), prefs);
    assertEquals(loadPrefs(storage, "scene"), { ...defaultPrefs });
  });

  it("coerces malformed stored values to defaults", () => {
    const storage = fakeStorage();
    storage.setItem(
      "cinemaitor:enhance:panel",
      JSON.stringify({ autoEnhance: "yes", modelId: 42 }),
    );
    assertEquals(loadPrefs(storage, "panel"), { ...defaultPrefs });
  });

  it("falls back to defaults on corrupt JSON", () => {
    const storage = fakeStorage();
    storage.setItem("cinemaitor:enhance:panel", "{not json");
    assertEquals(loadPrefs(storage, "panel"), { ...defaultPrefs });
  });

  it("reports storage failures", () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    assertEquals(savePrefs(broken, "scene", { autoEnhance: true }), false);
    assertEquals(savePrefs(null, "scene", { autoEnhance: true }), false);
  });
});

function fakeApi(
  { models = [], skills = [], content = "Enhanced prompt" } = {},
) {
  const calls = { listModels: [], listSkills: [], assistLlm: [] };
  return {
    calls,
    listModels: async (params) => {
      calls.listModels.push(params);
      return models;
    },
    listSkills: async (params) => {
      calls.listSkills.push(params);
      return skills;
    },
    assistLlm: async (request) => {
      calls.assistLlm.push(request);
      return { content };
    },
  };
}

describe("runEnhance", () => {
  it("returns null for empty text without any calls", async () => {
    const api = fakeApi({ models: [MM] });
    assertEquals(
      await runEnhance(api, { text: "   ", taskType: "text_to_video" }),
      null,
    );
    assertEquals(api.calls.listModels.length, 0);
    assertEquals(api.calls.assistLlm.length, 0);
  });

  it("returns null when no enabled model matches the task type", async () => {
    const api = fakeApi({ models: [] });
    assertEquals(
      await runEnhance(api, { text: "a ship", taskType: "text_to_video" }),
      null,
    );
    assertEquals(api.calls.assistLlm.length, 0);
  });

  it("survives a listModels failure", async () => {
    const api = fakeApi();
    api.listModels = async () => {
      throw new Error("down");
    };
    assertEquals(
      await runEnhance(api, { text: "a ship", taskType: "text_to_video" }),
      null,
    );
  });

  it("enhances with the first enabled model and returns trimmed content", async () => {
    const api = fakeApi({ models: [FLUX, MM], content: "  A better prompt " });
    const result = await runEnhance(api, {
      text: "a ship",
      taskType: "text_to_video",
    });
    assertEquals(result, "A better prompt");
    assertEquals(api.calls.listModels[0], {
      task_type: "text_to_video",
      enabled: true,
    });
    assertEquals(api.calls.assistLlm[0], {
      purpose: "enhance_prompt",
      context: "a ship",
      model_id: "flux",
    });
    assertEquals(api.calls.listSkills.length, 0);
  });

  it("honors an explicit model id when it is in the enabled list", async () => {
    const api = fakeApi({ models: [FLUX, MM] });
    await runEnhance(api, {
      text: "a ship",
      taskType: "text_to_video",
      modelId: "minimax_h3",
    });
    assertEquals(api.calls.assistLlm[0].model_id, "minimax_h3");
  });

  it("falls back to the first model when the explicit id is gone", async () => {
    const api = fakeApi({ models: [FLUX] });
    await runEnhance(api, {
      text: "a ship",
      taskType: "text_to_video",
      modelId: "minimax_h3",
    });
    assertEquals(api.calls.assistLlm[0].model_id, "flux");
  });

  it("auto-picks a skill only when autoSkill is on", async () => {
    const withSkill = fakeApi({
      models: [MM],
      skills: [MM_VIDEO, MM_REF],
      content: "Refined",
    });
    await runEnhance(withSkill, {
      text: "show @sloop",
      taskType: "image_to_video",
      autoSkill: true,
    });
    assertEquals(withSkill.calls.assistLlm[0].skill_id, "s-ref");

    const noSkill = fakeApi({ models: [MM], skills: [MM_VIDEO] });
    await runEnhance(noSkill, { text: "a ship", taskType: "text_to_video" });
    assertEquals(noSkill.calls.assistLlm[0].skill_id, undefined);
    assertEquals(noSkill.calls.listSkills.length, 0);
  });

  it("survives a listSkills failure and enhances without a skill", async () => {
    const api = fakeApi({ models: [MM], skills: [MM_VIDEO] });
    api.listSkills = async () => {
      throw new Error("down");
    };
    const result = await runEnhance(api, {
      text: "a ship",
      taskType: "text_to_video",
      autoSkill: true,
    });
    assertEquals(result, "Enhanced prompt");
    assertEquals(api.calls.assistLlm[0].skill_id, undefined);
  });

  it("returns null when the LLM call fails or content is empty", async () => {
    const failing = fakeApi({ models: [MM] });
    failing.assistLlm = async () => {
      throw new Error("llm down");
    };
    assertEquals(
      await runEnhance(failing, { text: "a ship", taskType: "text_to_video" }),
      null,
    );

    const empty = fakeApi({ models: [MM], content: "   " });
    assertEquals(
      await runEnhance(empty, { text: "a ship", taskType: "text_to_video" }),
      null,
    );
  });
});
