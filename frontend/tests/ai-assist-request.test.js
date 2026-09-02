import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  ASSIST_CONTEXT_MAX,
  ASSIST_PURPOSES,
  buildAssistRequest,
  skillMatchesModel,
} from "../src/ai-assist-request.js";

describe("buildAssistRequest", () => {
  it("assembles a minimal request and trims the context", () => {
    assertEquals(
      buildAssistRequest({
        purpose: "write_script",
        context: "  A heist in space. ",
      }),
      { purpose: "write_script", context: "A heist in space." },
    );
  });

  it("rejects unknown purposes", () => {
    assertThrows(
      () => buildAssistRequest({ purpose: "vibrate", context: "x" }),
      Error,
    );
  });

  it("rejects missing or empty context", () => {
    assertThrows(
      () => buildAssistRequest({ purpose: "design_scene", context: "" }),
      Error,
      "Context is required",
    );
    assertThrows(
      () => buildAssistRequest({ purpose: "design_scene", context: "   " }),
      Error,
      "Context is required",
    );
    assertThrows(
      () => buildAssistRequest({ purpose: "design_scene", context: null }),
      Error,
    );
  });

  it("rejects context beyond the limit", () => {
    assertThrows(
      () =>
        buildAssistRequest({
          purpose: "write_script",
          context: "x".repeat(ASSIST_CONTEXT_MAX + 1),
        }),
      Error,
      "too long",
    );
  });

  it("only attaches model/skill ids for enhance_prompt", () => {
    const base = { modelId: "m1", skillId: "s1", context: "a @hero shot" };
    assertEquals(
      buildAssistRequest({ purpose: "enhance_prompt", ...base }),
      {
        purpose: "enhance_prompt",
        context: "a @hero shot",
        model_id: "m1",
        skill_id: "s1",
      },
    );
    assertEquals(
      buildAssistRequest({ purpose: "write_script", ...base }),
      { purpose: "write_script", context: "a @hero shot" },
    );
    assertEquals(
      buildAssistRequest({ purpose: "design_scene", ...base }),
      { purpose: "design_scene", context: "a @hero shot" },
    );
    assertEquals(
      buildAssistRequest({ purpose: "extend_script", ...base }),
      { purpose: "extend_script", context: "a @hero shot" },
    );
  });
});

describe("skillMatchesModel", () => {
  const t2vModel = { id: "m", task_types: ["text_to_video"] };
  const i2vModel = { id: "m2", task_types: ["image_to_video"] };

  it("matches any model when the skill declares no task types", () => {
    const skill = { definition: { assistant: { guidance: "x" } } };
    assertEquals(skillMatchesModel(skill, t2vModel), true);
    assertEquals(skillMatchesModel(skill, i2vModel), true);
  });

  it("requires a task-type overlap", () => {
    const skill = {
      definition: { assistant: { model_task_types: ["text_to_video"] } },
    };
    assertEquals(skillMatchesModel(skill, t2vModel), true);
    assertEquals(skillMatchesModel(skill, i2vModel), false);
  });

  it("honors a skill's model_ids scope over task types", () => {
    const scoped = {
      definition: { assistant: { model_ids: ["minimax_h3"] } },
    };
    assertEquals(
      skillMatchesModel(
        scoped,
        { id: "minimax_h3", task_types: ["text_to_video"] },
      ),
      true,
    );
    // A different model does not match even with overlapping task types.
    assertEquals(
      skillMatchesModel(
        scoped,
        { id: "flux2", task_types: ["text_to_video"] },
      ),
      false,
    );
  });

  it("is defensive against malformed shapes", () => {
    assertEquals(skillMatchesModel(null, null), true);
    assertEquals(
      skillMatchesModel({ definition: {} }, { task_types: "nope" }),
      true,
    );
  });
});

describe("ASSIST_PURPOSES", () => {
  it("covers the four contract purposes with labels", () => {
    assertEquals(Object.keys(ASSIST_PURPOSES).sort(), [
      "design_scene",
      "enhance_prompt",
      "extend_script",
      "write_script",
    ]);
    for (const [key, spec] of Object.entries(ASSIST_PURPOSES)) {
      assertEquals(typeof spec.label, "string", key);
      assertEquals(typeof spec.contextLabel, "string", key);
    }
  });
});
