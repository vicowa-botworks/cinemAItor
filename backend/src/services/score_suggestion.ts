// Score suggestion (MS-8) — pure, deterministic analysis of an assembled cut
// (timeline items + the project's storyboard panels) into a synthesized music
// prompt. No DB, no DOM: the route layers a loader on top, so the whole
// suggestion is unit-testable against plain rows.

export interface ScorePanelInput {
  panel_order: number;
  time_of_day: string | null;
  lighting: string | null;
  mood: string | null;
  music_cue: string | null;
}

export interface ScoreInput {
  /** Timeline duration in seconds (furthest item end time). */
  timeline_duration: number;
  /** Items on non-muted video/overlay tracks — the assembled cut. */
  video_item_count: number;
  /** Items on non-muted music tracks — existing score. */
  music_item_count: number;
  /** Items on non-muted dialogue tracks. */
  dialogue_item_count: number;
  panels: ScorePanelInput[];
}

export interface ScoreSuggestion {
  /** Synthesized music generation prompt. */
  prompt: string;
  /** Target score length in whole five-second steps. */
  duration_seconds: number;
  /** Dominant panel values (mode, alphabetical tie-break). */
  time_of_day: string | null;
  lighting: string | null;
  mood: string | null;
  /** Distinct stated music cues, sorted, capped. */
  music_cues: string[];
  has_existing_music: boolean;
  has_dialogue: boolean;
  /** Human-readable reasons behind the suggestion. */
  sources: string[];
}

export const MAX_MUSIC_CUES = 4;
export const MAX_DURATION_SECONDS = 1800;
export const MIN_DURATION_SECONDS = 5;
const DURATION_STEP = 5;

function cleaned(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^(n\/a|na|none|unknown|-)$/i.test(trimmed)) return null;
  return trimmed;
}

/** Mode of non-null values; ties break alphabetically (deterministic). */
function dominant(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = cleaned(raw);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function countOf(value: string | null, values: Array<string | null>): number {
  if (value === null) return 0;
  return values.filter((v) => cleaned(v) === value).length;
}

/** Round the cut length up to whole five-second steps (always >= 5s). */
export function scoreDuration(timelineDuration: number): number {
  const clamped = Math.max(
    0,
    Math.min(Number.isFinite(timelineDuration) ? timelineDuration : 0, MAX_DURATION_SECONDS),
  );
  return Math.max(
    MIN_DURATION_SECONDS,
    Math.ceil(clamped / DURATION_STEP) *
      DURATION_STEP,
  );
}

export function suggestScore(input: ScoreInput): ScoreSuggestion {
  const { panels } = input;
  const todValues = panels.map((p) => p.time_of_day);
  const lightingValues = panels.map((p) => p.lighting);
  const moodValues = panels.map((p) => p.mood);

  const timeOfDay = dominant(todValues);
  const lighting = dominant(lightingValues);
  const mood = dominant(moodValues);

  const cueSet = new Set<string>();
  for (const panel of panels) {
    const cue = cleaned(panel.music_cue);
    if (cue) cueSet.add(cue);
  }
  const musicCues = [...cueSet].sort((a, b) => a.localeCompare(b)).slice(
    0,
    MAX_MUSIC_CUES,
  );

  const durationSeconds = scoreDuration(input.timeline_duration);
  const hasExistingMusic = input.music_item_count > 0;
  const hasDialogue = input.dialogue_item_count > 0;

  const tags = [timeOfDay, lighting, mood].filter((t): t is string => t !== null);
  const tagList = tags.length > 0 ? tags.join(", ") : "timeless and atmospheric";

  const parts: string[] = [];
  if (musicCues.length > 0) {
    parts.push(`Stated cues: ${musicCues.join("; ")}.`);
  }
  parts.push(
    `Cinematic instrumental score, ${durationSeconds}s, ${tagList}${
      hasDialogue ? ", leaves space for dialogue" : ", no dialogue on the cut"
    }${hasExistingMusic ? ", complements the existing score on the cut" : ""}.`,
  );

  const sources: string[] = [
    `Cut length ${Math.round(input.timeline_duration * 10) / 10}s → ${durationSeconds}s target`,
  ];
  if (timeOfDay !== null) {
    sources.push(
      `Time of day: "${timeOfDay}" (${countOf(timeOfDay, todValues)} of ${panels.length} panels)`,
    );
  }
  if (lighting !== null) {
    sources.push(
      `Lighting: "${lighting}" (${countOf(lighting, lightingValues)} of ${panels.length} panels)`,
    );
  }
  if (mood !== null) {
    sources.push(
      `Mood: "${mood}" (${countOf(mood, moodValues)} of ${panels.length} panels)`,
    );
  }
  if (musicCues.length > 0) {
    sources.push(`Music cues: ${musicCues.map((c) => `"${c}"`).join(", ")}`);
  }
  if (hasExistingMusic) {
    sources.push(`Existing music: ${input.music_item_count} item(s) on the cut`);
  }
  sources.push(
    hasDialogue
      ? `Dialogue: ${input.dialogue_item_count} item(s) on the cut`
      : "No dialogue on the cut",
  );
  if (input.video_item_count > 0) {
    sources.push(`Cut: ${input.video_item_count} video item(s)`);
  } else {
    sources.push("Cut: no video items yet");
  }

  return {
    prompt: parts.join(" "),
    duration_seconds: durationSeconds,
    time_of_day: timeOfDay,
    lighting,
    mood,
    music_cues: musicCues,
    has_existing_music: hasExistingMusic,
    has_dialogue: hasDialogue,
    sources,
  };
}
