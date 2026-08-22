// Pure helpers for the timeline playback engine. No DOM here: these functions
// map timeline time onto the items and media state the preview layer renders.
// Mirrors the render source selection: video sources come from unlocked
// video/overlay tracks (see render_runner.ts), audio comes from the audio
// track types, and text/subtitle tracks are overlays.

export const VISUAL_TRACK_TYPES = ["video", "overlay"];
export const AUDIO_TRACK_TYPES = [
  "dialogue",
  "voiceover",
  "music",
  "sfx",
  "ambience",
];
export const TEXT_TRACK_TYPES = ["text", "subtitle"];

/** True when the timeline time t falls inside the item's span. */
export function itemAt(item, t) {
  return item.start_time <= t && t < item.end_time;
}

/**
 * Source (media file) time corresponding to timeline time t for the item:
 * source_offset plus the elapsed item time scaled by the item speed.
 */
export function sourceTimeAt(item, t) {
  const speed = Number(item.speed) || 1;
  return item.source_offset + (t - item.start_time) * speed;
}

/**
 * Source times to fetch as filmstrip thumbnails for a timeline item.
 * One frame every ~2 s of item span (clamped to [1, maxFrames]), sampled at
 * the sub-span midpoints, expressed in source seconds and quantized to 100 ms
 * (matching the server-side thumbnail cache key). Returns [] for items that
 * have no media version.
 */
export function filmstripFramesFor(item, maxFrames = 4) {
  if (!item || !item.asset_version_id) return [];
  const start = Number(item.start_time) || 0;
  const end = Number(item.end_time) || 0;
  if (!(end > start)) return [];
  const span = end - start;
  const frames = Math.min(Math.max(1, maxFrames), Math.max(1, Math.round(span / 2)));
  const out = [];
  for (let k = 0; k < frames; k++) {
    const t = start + ((k + 0.5) * span) / frames;
    const at = sourceTimeAt(item, t);
    out.push(Math.max(0, Math.round(at * 10) / 10));
  }
  return out;
}

/**
 * Fade factor (0..1) at timeline time t across the item span, combining
 * fade_in (from the item start) and fade_out (toward the item end).
 */
export function fadeFactorAt(item, t) {
  let factor = 1;
  const span = item.end_time - item.start_time;
  const fadeIn = Number(item.fade_in) > 0 ? Number(item.fade_in) : 0;
  const fadeOut = Number(item.fade_out) > 0 ? Number(item.fade_out) : 0;
  if (fadeIn > 0 && span > 0) {
    const local = t - item.start_time;
    if (local < fadeIn) factor = Math.min(factor, local / fadeIn);
  }
  if (fadeOut > 0 && span > 0) {
    const local = item.end_time - t;
    if (local < fadeOut) factor = Math.min(factor, local / fadeOut);
  }
  return Math.max(0, Math.min(1, factor));
}

/**
 * The visible media item at timeline time t: the item on the topmost
 * (highest track_order) unlocked video/overlay track whose span contains t.
 * Returns `{ item, muted }` or null when nothing is visible.
 */
export function activeVisual(tracks, t) {
  let best = null;
  for (const track of tracks ?? []) {
    if (track.locked) continue;
    if (!VISUAL_TRACK_TYPES.includes(track.track_type)) continue;
    for (const item of track.items ?? []) {
      if (!itemAt(item, t)) continue;
      if (best === null || track.track_order > best.trackOrder) {
        best = { item, trackOrder: track.track_order, muted: track.muted };
      }
    }
  }
  return best === null ? null : { item: best.item, muted: best.muted };
}

/**
 * All audio items sounding at timeline time t (one entry per item, with its
 * track for the mute flag).
 */
export function activeAudioItems(tracks, t) {
  const out = [];
  for (const track of tracks ?? []) {
    if (!AUDIO_TRACK_TYPES.includes(track.track_type)) continue;
    for (const item of track.items ?? []) {
      if (itemAt(item, t)) out.push({ item, track });
    }
  }
  return out;
}

/** All text/subtitle overlay items active at timeline time t. */
export function activeTextItems(tracks, t) {
  const out = [];
  for (const track of tracks ?? []) {
    if (!TEXT_TRACK_TYPES.includes(track.track_type)) continue;
    for (const item of track.items ?? []) {
      if (itemAt(item, t)) out.push({ item, track });
    }
  }
  return out;
}

/**
 * CSS filter string approximating the item color grade:
 * brightness (-1..1, 0 neutral), contrast (0.25..4, 1 neutral), saturation
 * (0..2, 1 neutral), temperature (-1..1, 0 neutral).
 */
export function gradeFilter(grade) {
  const parts = [];
  const b = Number(grade?.brightness);
  const c = Number(grade?.contrast);
  const s = Number(grade?.saturation);
  const temperature = Number(grade?.temperature);
  if (Number.isFinite(b) && b !== 0) {
    parts.push(`brightness(${(1 + b).toFixed(3)})`);
  }
  if (Number.isFinite(c) && c !== 1) {
    parts.push(`contrast(${c.toFixed(3)})`);
  }
  if (Number.isFinite(s) && s !== 1) {
    parts.push(`saturation(${s.toFixed(3)})`);
  }
  if (Number.isFinite(temperature) && temperature !== 0) {
    if (temperature > 0) {
      parts.push(`sepia(${(0.35 * temperature).toFixed(3)})`);
    } else {
      parts.push(
        `hue-rotate(${(-35 * temperature).toFixed(1)}deg) brightness(${
          (1 - 0.08 * -temperature).toFixed(3)
        })`,
      );
    }
  }
  return parts.join(" ");
}

/**
 * Playback element volume for an audio item: 10^(gain_db/20) (the same
 * linear scale the renderer uses) scaled by the fade factor, clamped to 0..1.
 */
export function audioVolumeFor(gainDb, fade) {
  const gain = Number(gainDb) || 0;
  return Math.max(0, Math.min(1, Math.pow(10, gain / 20) * (fade || 0)));
}

/**
 * Ducking (AUD-013): linear gain multiplier for the item at timeline time t,
 * applied on top of audioVolumeFor. An item on a music track drops by its
 * track's duck_db while any dialogue-track item is sounding, mirroring the
 * duck windows the renderer computes for the same items. Otherwise full
 * level (1).
 */
export function duckGainAt(tracks, item, t) {
  const track = (tracks ?? []).find((tr) => tr.id === item.track_id);
  const duckDb = Number(track?.duck_db) || 0;
  if (track?.track_type !== "music" || duckDb <= 0) return 1;
  // Locked or muted dialogue tracks are outside the render source, so they
  // never duck (matching the renderer's plan).
  for (const other of tracks ?? []) {
    if (other.track_type !== "dialogue" || other.locked || other.muted) continue;
    for (const d of other.items ?? []) {
      if (itemAt(d, t)) return Math.pow(10, -duckDb / 20);
    }
  }
  return 1;
}

/**
 * Optional loop range from raw from/to form values (numbers or strings).
 * Returns `{ from, to }` in seconds when a valid range is given, otherwise
 * null (play to the end of the timeline).
 */
export function playbackRange(from, to) {
  if (from === null || from === undefined || String(from).trim() === "") {
    return null;
  }
  if (to === null || to === undefined || String(to).trim() === "") {
    return null;
  }
  const f = Number(from);
  const t = Number(to);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return null;
  if (f < 0 || t <= f) return null;
  return { from: f, to: t };
}
