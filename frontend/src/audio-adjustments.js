// Shared helpers for non-destructive audio adjustments (trim + gain).
// The values are stored on the version's audio metadata by the backend and
// applied at render time; these helpers keep the UI's parsing/prefill and
// validation in one testable place.

export const AUDIO_TYPES = ["audio", "music", "sfx", "voiceover", "ambience"];

/** Parse a version's technical_metadata_json into its `audio` object (or null). */
export function parseAudioMetadata(technicalMetadataJson) {
  if (!technicalMetadataJson) return null;
  try {
    const parsed = JSON.parse(technicalMetadataJson);
    const audio = parsed?.audio;
    return audio && typeof audio === "object" ? audio : null;
  } catch {
    return null;
  }
}

/** Prefill form values (strings) from stored adjustments; "" means "not set". */
export function audioFormFromMeta(audioMeta) {
  const adjustments = audioMeta?.adjustments ?? null;
  const trim = adjustments?.trim ?? null;
  const gain = adjustments?.gain_db ?? 0;
  return {
    start: trim ? String(trim.start) : "",
    end: trim ? String(trim.end) : "",
    gain: gain === 0 ? "" : String(gain),
  };
}

/**
 * Validate form values and build the PATCH body. Blank fields mean the
 * neutral values (start 0, end = full duration, gain 0).
 * Returns `{ trim, gain_db }` on success or `{ error }` when invalid.
 */
export function validateAudioAdjustments(form, duration) {
  const start = form.start === "" ? 0 : Number(form.start);
  const end = form.end === "" ? duration : Number(form.end);
  const gainDb = form.gain === "" ? 0 : Number(form.gain);
  if (end === null) {
    return { error: "Enter the trim end (duration is unknown)." };
  }
  if (![start, end, gainDb].every(Number.isFinite)) {
    return { error: "Adjustments must be numbers." };
  }
  if (start < 0 || end <= start) {
    return { error: "Trim needs 0 <= start < end." };
  }
  if (duration !== null && end > duration + 1e-6) {
    return { error: `Trim end (${end}s) exceeds the duration (${duration}s).` };
  }
  if (gainDb < -60 || gainDb > 24) {
    return { error: "Gain must be between -60 and 24 dB." };
  }
  return { trim: { start, end }, gain_db: gainDb };
}
