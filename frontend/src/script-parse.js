// Script parser (SCN-015) — pure, deterministic fountain-lite parsing of a plain-text
// screenplay into structured draft scenes. No DOM, no network: unit-tested in
// frontend/tests/script-parse.test.js.

const HEADING_RE = /^(INT|EXT|I\/E)[.:\s]/i;
const CUE_RE = /^[A-Z][A-Z0-9 .'-]*$/;
const CUE_MAX_LENGTH = 32;

/**
 * Parse a plain-text screenplay (fountain-lite) into structured scenes.
 *
 * Rules (deterministic subset of Fountain):
 * - Bare "FADE IN" / "FADE OUT" (with or without punctuation) is skipped as
 *   boilerplate.
 * - A line starting with INT./EXT./I/E. (case-insensitive) starts a new scene.
 * - A short all-caps line (<= 32 chars, must be preceded by a blank line or a
 *   scene heading) starts a dialogue block attributed to that character.
 * - Following non-blank lines belong to that dialogue block; "(...)" lines are
 *   parentheticals folded into the last spoken line.
 * - Everything else is action text for the current scene.
 * - Content before any heading (or with no headings) lands in a synthetic
 *   "Scene N" scene.
 *
 * Returns { scenes, warnings } where each scene is
 * { heading, action, dialogue: [{ name, lines: string[] }] } (trimmed strings).
 */
export function parseScript(text) {
  const warnings = [];
  const scenes = [];
  let current = null;
  let inDialogue = false;
  let lastWasBlank = true;
  let sawHeading = false;

  const actionOf = (scene) => scene.actionParts.join("\n").trim();

  const ensureScene = () => {
    if (!current) {
      current = {
        heading: `Scene ${scenes.length + 1}`,
        actionParts: [],
        dialogue: [],
      };
    }
    return current;
  };

  const flush = () => {
    if (!current) return;
    const action = actionOf(current);
    const hasDialogue = current.dialogue.some((d) => d.lines.length > 0);
    if (action || hasDialogue) {
      scenes.push({
        heading: current.heading,
        action,
        dialogue: current.dialogue
          .filter((d) => d.lines.length > 0)
          .map(({ name, lines }) => ({ name, lines })),
      });
    }
    current = null;
    inDialogue = false;
  };

  for (const rawLine of String(text ?? "").split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      lastWasBlank = true;
      inDialogue = false;
      continue;
    }
    const lower = line.toLowerCase();
    if (
      lower === "fade in" || lower === "fade in:" || lower === "fade out" || lower === "fade out."
    ) {
      continue;
    }

    if (HEADING_RE.test(line) && line.length <= 120) {
      flush();
      sawHeading = true;
      current = { heading: line, actionParts: [], dialogue: [] };
      lastWasBlank = true;
      continue;
    }

    const scene = ensureScene();

    if (inDialogue) {
      const speaker = scene.dialogue[scene.dialogue.length - 1];
      if (/^\(.*\)$/.test(line)) {
        // A parenthetical applies to the next spoken line.
        speaker.pending = line.slice(1, -1);
      } else {
        const paren = speaker.pending ? ` (${speaker.pending})` : "";
        delete speaker.pending;
        speaker.lines.push(line + paren);
      }
      lastWasBlank = false;
      continue;
    }

    const canBeCue = lastWasBlank &&
      line.length <= CUE_MAX_LENGTH &&
      CUE_RE.test(line) &&
      !/[.!?]$/.test(line);
    if (canBeCue) {
      scene.dialogue.push({ name: line, lines: [] });
      inDialogue = true;
      lastWasBlank = false;
      continue;
    }

    if (lastWasBlank && scene.actionParts.length > 0 && scene.actionParts.at(-1) !== "") {
      scene.actionParts.push("");
    }
    scene.actionParts.push(line);
    lastWasBlank = false;
  }
  flush();

  if (scenes.length === 0) {
    if (String(text ?? "").trim() !== "") {
      warnings.push("no usable content found");
    }
  } else if (!sawHeading) {
    warnings.push("no scene headings found; created one scene for all content");
  }
  return { scenes, warnings };
}

/**
 * Format a parsed scene's dialogue as a transcript: "NAME: line" pairs, blank
 * line between speakers. Empty string when the scene has no dialogue.
 */
export function formatDialogue(dialogue) {
  return (dialogue ?? [])
    .map((d) => {
      const body = (d.lines ?? []).join("\n").trim();
      if (!body) return "";
      const name = d.name.trim();
      return name ? `${name}\n${body}` : body;
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Map parsed scenes to the bulk-import payload for
 * POST /api/v1/projects/:id/scenes/from-script:
 * { name, description, prompt, notes? }
 * - name: the scene heading
 * - description: the action text (falls back to the dialogue transcript)
 * - notes: dialogue transcript when present
 * - prompt: a deterministic draft prompt for the generation pipeline
 */
export function scriptToSceneInputs(scenes, { maxPromptLength = 4000 } = {}) {
  return (scenes ?? []).map((scene) => {
    const dialogueText = formatDialogue(scene.dialogue).trim();
    const action = (scene.action ?? "").trim();
    const name = (scene.heading ?? "").trim() || "Untitled scene";
    const description = (action || dialogueText || "Imported from script.").slice(0, 500);
    const notes = dialogueText || undefined;
    const parts = [`Film scene draft (imported from script).`, `Setting: ${name}`];
    if (action) parts.push("", action);
    if (dialogueText) parts.push("", "Dialogue:", dialogueText);
    const prompt = parts.join("\n").slice(0, maxPromptLength);
    return { name, description, prompt, ...(notes ? { notes } : {}) };
  });
}
