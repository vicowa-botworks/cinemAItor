import type { Model } from "@cinemaItor/db/models.ts";
import type { Skill } from "@cinemaItor/db/skills.ts";
import type { LlmMessage } from "./llm_client.ts";

export const ASSIST_PURPOSES = ["write_script", "design_scene", "enhance_prompt"] as const;
export type AssistPurpose = (typeof ASSIST_PURPOSES)[number];

/** Bumped whenever a system prompt changes, for testability and debugging. */
export const ASSIST_PROMPT_VERSION = "1";

const WRITE_SCRIPT_SYSTEM_PROMPT = [
  "You are the script department of an AI movie studio.",
  "The user gives you a movie idea or outline. Answer with Fountain-lite screenplay text ONLY.",
  "Rules:",
  "- Scene headings start with INT. or EXT. (or INT./EXT.) followed by the location and a time of day",
  "  (MORNING, AFTERNOON, EVENING or NIGHT), e.g. `INT. COFFEE SHOP - MORNING`.",
  "- Action lines are plain prose describing what happens on screen.",
  "- Character names are in UPPERCASE on their own line, followed by their dialogue on the next line.",
  "- No markdown, no code fences, no headings, no commentary, no explanations — screenplay text only.",
  "- Keep it tight: 3 to 10 scenes unless the user asks for more.",
].join("\n");

const DESIGN_SCENE_SYSTEM_PROMPT = [
  "You are a film director and cinematographer in an AI movie studio.",
  "The user gives you a story beat or panel summary. Design the scene for production and answer",
  "using exactly this structure (markdown headings, in this order):",
  "## Overview",
  "One or two sentences: what the scene is and what it must achieve.",
  "## Mood & Tone",
  "The emotional register and visual style.",
  "## Shots",
  "A numbered list of 2 to 6 shots. Each shot has: description, camera, movement, duration (in",
  "seconds).",
  "## Lighting",
  "The lighting design for the scene.",
  "## Time of day",
  "Exactly one of: morning, afternoon, evening, night.",
  "## Dialogue",
  "The lines spoken, or none.",
].join("\n");

const ENHANCE_PROMPT_SYSTEM_PROMPT = [
  "You are a prompt engineer for AI media generation (image and video models) in a movie studio.",
  "The user gives you a generation prompt. Rewrite it to be more specific, visual and effective",
  "for the target model, keeping the same subject and intent.",
  "Rules:",
  "- Answer with the improved prompt ONLY. No explanations, no markdown fences, no prefixes.",
  "- Any @reference tokens (an @ followed by a slug, e.g. @hero_red_jacket) appearing in the",
  "  input must survive verbatim in your output, in the same relative position. Never rename,",
  "  remove or reformat them.",
  "- Do not invent new subjects; sharpen what is already there (camera, lighting, style, motion).",
].join("\n");

const SYSTEM_PROMPTS: Record<AssistPurpose, string> = {
  write_script: WRITE_SCRIPT_SYSTEM_PROMPT,
  design_scene: DESIGN_SCENE_SYSTEM_PROMPT,
  enhance_prompt: ENHANCE_PROMPT_SYSTEM_PROMPT,
};

/** Model metadata injected into the enhance_prompt system prompt. */
export function modelContextBlock(model: Model): string {
  const lines = [
    `Target model: ${model.name} (version ${model.version})`,
    `Task types: ${model.task_types.join(", ")}`,
  ];
  if (model.known_limitations && model.known_limitations.length > 0) {
    lines.push(`Known limitations: ${model.known_limitations.join("; ")}`);
  }
  const settingKeys = Object.keys(model.default_settings);
  if (settingKeys.length > 0) {
    lines.push(`Default setting keys the model understands: ${settingKeys.join(", ")}`);
  }
  return lines.join("\n");
}

/** A skill's assistant block injected into the enhance_prompt system prompt. */
export function skillContextBlock(skill: Skill): string {
  const assistant = skill.definition.assistant;
  if (!assistant) return "";
  const lines = [`Prompt guidance from skill "${skill.name}":`];
  if (assistant.model_task_types.length > 0) {
    lines.push(`Applies to task types: ${assistant.model_task_types.join(", ")}`);
  }
  if (assistant.guidance) lines.push(assistant.guidance);
  if (assistant.examples.length > 0) {
    lines.push("Examples that work well:");
    for (const example of assistant.examples) {
      lines.push(`- ${example.prompt}`);
      if (example.notes) lines.push(`  (why: ${example.notes})`);
    }
  }
  return lines.join("\n");
}

export function buildAssistMessages(
  purpose: AssistPurpose,
  context: string,
  opts: { model?: Model; skill?: Skill } = {},
): LlmMessage[] {
  let system = SYSTEM_PROMPTS[purpose];
  if (opts.model) {
    system += "\n\n" + modelContextBlock(opts.model);
  }
  if (opts.skill?.definition.assistant) {
    system += "\n\n" + skillContextBlock(opts.skill);
  }
  return [
    { role: "system", content: system },
    { role: "user", content: context },
  ];
}

/**
 * @reference tokens: an @ followed by a slug ([A-Za-z0-9_], internal `-`/`.` allowed).
 * Returned unique, in first-seen order.
 */
export function extractRefTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(/@[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*/g)) {
    if (!seen.has(match[0])) {
      seen.add(match[0]);
      out.push(match[0]);
    }
  }
  return out;
}

/**
 * Post-check for enhance_prompt: any @reference present in the input context but dropped by
 * the model is re-appended so references are never lost.
 */
export function ensureRefsPreserved(content: string, context: string): string {
  const missing = extractRefTokens(context).filter((ref) => !content.includes(ref));
  if (missing.length === 0) return content;
  return content.trimEnd() + "\n" + missing.join(" ");
}
