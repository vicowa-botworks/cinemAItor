// Pure helpers for the prompt-enhance feature: @reference token detection,
// model-skill auto-pick, and per-surface preference persistence.
// DOM-free; unit-tested in frontend/tests/prompt-enhance.test.js.

import { buildAssistRequest, skillMatchesModel } from "../ai-assist-request.js";

const REF_TOKEN_RE = /@[A-Za-z0-9_][A-Za-z0-9_]*(?::v?\d+)?/;
const PREFS_PREFIX = "cinemaitor:enhance:";

export const defaultPrefs = Object.freeze({
  autoEnhance: false,
  autoSkill: false,
  modelId: null,
});

/** True when the text carries at least one @slug (or @slug:vN) reference token. */
export function hasReferenceTokens(text) {
  if (typeof text !== "string") return false;
  return REF_TOKEN_RE.test(text);
}

/**
 * Deterministic auto-pick of the skill to apply for an enhance call.
 *
 * Candidates are enabled assistant skills that match the model (model-scoped
 * lists must include it; unscoped skills match by task-type overlap) and whose
 * model_task_types overlap the run's task type (unrestricted skills pass).
 * Ranking: model-scoped first, then reference-aware specificity — a prompt
 * with @references prefers the most specialized skill (fewest task types,
 * e.g. the MiniMax full-reference rewrite), a prompt without references the
 * broadest (e.g. the MiniMax final-prompt format) — then name for stability.
 */
export function pickEnhanceSkill(skills, model, taskType, hasRefs = false) {
  const list = (Array.isArray(skills) ? skills : []).filter(
    (s) => s?.enabled && s?.definition?.assistant,
  );
  const candidates = list
    .filter((s) => skillMatchesModel(s, model))
    .filter((s) => {
      const types = s.definition.assistant.model_task_types;
      return !Array.isArray(types) || types.length === 0 ||
        (taskType && types.includes(taskType));
    });
  if (candidates.length === 0) return null;

  const score = (s) => {
    const a = s.definition.assistant;
    const modelScoped = Array.isArray(a.model_ids) && a.model_ids.length > 0 && model
      ? a.model_ids.includes(model.id)
      : false;
    const specificity = Array.isArray(a.model_task_types) ? a.model_task_types.length : 0;
    return {
      scoped: modelScoped ? 1 : 0,
      spec: hasRefs ? specificity : -specificity,
      name: s.name ?? "",
    };
  };

  const ranked = [...candidates].sort((x, y) => {
    const sx = score(x);
    const sy = score(y);
    if (sx.scoped !== sy.scoped) return sy.scoped - sx.scoped;
    if (sx.spec !== sy.spec) return sx.spec - sy.spec;
    return sx.name.localeCompare(sy.name);
  });
  return ranked[0];
}

/** Read per-surface enhance prefs from a Storage-like object (localStorage). */
export function loadPrefs(storage, surface) {
  try {
    const raw = storage?.getItem(PREFS_PREFIX + surface);
    if (!raw) return { ...defaultPrefs };
    const parsed = JSON.parse(raw);
    return {
      autoEnhance: parsed.autoEnhance === true,
      autoSkill: parsed.autoSkill === true,
      modelId: typeof parsed.modelId === "string" && parsed.modelId ? parsed.modelId : null,
    };
  } catch {
    return { ...defaultPrefs };
  }
}

/** Persist per-surface enhance prefs; returns false when storage is unavailable. */
export function savePrefs(storage, surface, prefs) {
  if (!storage) return false;
  try {
    storage.setItem(
      PREFS_PREFIX + surface,
      JSON.stringify({ ...defaultPrefs, ...prefs }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Run one enhance pass and return the enhanced text, or null when there is
 * nothing to enhance, no enabled model for the task type, or the LLM call
 * fails — callers fall back to the raw prompt so generation is never blocked.
 *
 * modelId: an explicit persisted choice (validated against the live model
 * list); autoSkill: also auto-pick a matching skill via pickEnhanceSkill.
 */
export async function runEnhance(
  api,
  { text, taskType, modelId = "", autoSkill = false },
) {
  if (typeof text !== "string" || !text.trim()) return null;
  let models = [];
  try {
    models = await api.listModels({ task_type: taskType, enabled: true });
  } catch {
    models = [];
  }
  const model = (Array.isArray(models) ? models : []).find((m) => m.id === modelId) ??
    models[0] ?? null;
  if (!model) return null;

  let skillId = "";
  if (autoSkill) {
    let skills = [];
    try {
      skills = await api.listSkills({ assistant: "1" });
    } catch {
      skills = [];
    }
    const skill = pickEnhanceSkill(
      Array.isArray(skills) ? skills : [],
      model,
      taskType,
      hasReferenceTokens(text),
    );
    skillId = skill?.id ?? "";
  }

  try {
    const request = buildAssistRequest({
      purpose: "enhance_prompt",
      context: text,
      modelId: model.id,
      skillId,
    });
    const response = await api.assistLlm(request);
    const content = typeof response?.content === "string" ? response.content.trim() : "";
    return content || null;
  } catch {
    return null;
  }
}
