// Pure helpers for the AI-assist dialog: request assembly and the
// model/skill compatibility hint. Server-side validation (routes/llm.ts)
// remains authoritative — these just keep the dialog honest before the call.

export const ASSIST_PURPOSES = {
  write_script: {
    label: "Write script",
    contextLabel: "Movie idea",
    placeholder: "Describe your movie idea: logline, tone, setting, characters…",
  },
  extend_script: {
    label: "Extend script",
    contextLabel: "Current script + instruction",
    placeholder: "Paste your current screenplay, then say what to add or change…",
  },
  design_scene: {
    label: "Design scene",
    contextLabel: "Scene brief",
    placeholder: "Describe the scene you want designed: story beat, characters, mood…",
  },
  enhance_prompt: {
    label: "Enhance prompt",
    contextLabel: "Prompt",
    placeholder: "Paste the prompt to enhance…",
  },
};

export const ASSIST_CONTEXT_MAX = 32000;

/**
 * Assemble the POST /llm/assist body from the dialog state.
 * Throws a plain Error with a user-facing message on invalid input.
 */
export function buildAssistRequest({ purpose, context, modelId, skillId }) {
  if (!ASSIST_PURPOSES[purpose]) {
    throw new Error(`Unknown assist purpose: ${purpose}`);
  }
  const trimmed = typeof context === "string" ? context.trim() : "";
  if (!trimmed) {
    throw new Error("Context is required");
  }
  if (trimmed.length > ASSIST_CONTEXT_MAX) {
    throw new Error(
      `Context too long (${trimmed.length} chars, max ${ASSIST_CONTEXT_MAX})`,
    );
  }
  const request = { purpose, context: trimmed };
  if (purpose === "enhance_prompt") {
    if (modelId) request.model_id = modelId;
    if (skillId) request.skill_id = skillId;
  }
  return request;
}

/**
 * True when the skill's assistant block (if any task types are declared)
 * overlaps the model's task types. Skills without task types match any model.
 */
export function skillMatchesModel(skill, model) {
  const assistant = skill?.definition?.assistant;
  const types = assistant?.model_task_types;
  if (!Array.isArray(types) || types.length === 0) return true;
  const modelTypes = Array.isArray(model?.task_types) ? model.task_types : [];
  return types.some((type) => modelTypes.includes(type));
}
