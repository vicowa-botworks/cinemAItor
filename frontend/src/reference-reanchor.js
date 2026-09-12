// Pure, DOM-free helpers for keeping parsed @reference tokens anchored to the
// right characters while prompt text is edited. A token parsed from an older
// revision of the text carries [start, end] offsets that go stale as soon as
// anything before it changes; re-anchoring maps them onto the new text so
// chips keep their highlight across ordinary keystrokes instead of being
// dropped (and re-resolved) on every edit.

/**
 * Compute the minimal edit region that turns `prev` into `next` by trimming
 * the common prefix and suffix: `prev[oldStart, oldEnd)` was replaced by
 * `next[newStart, newEnd)`. For an insertion the old region is empty, for a
 * deletion the new one is; for an untouched string both are empty at the end.
 *
 * @param {string} prev The text before the edit.
 * @param {string} next The text after the edit.
 * @returns {{oldStart: number, oldEnd: number, newStart: number, newEnd: number}}
 */
export function editRegion(prev, next) {
  if (typeof prev !== "string") throw new Error("prev must be a string");
  if (typeof next !== "string") throw new Error("next must be a string");
  let p = 0;
  const minLen = Math.min(prev.length, next.length);
  while (p < minLen && prev.charCodeAt(p) === next.charCodeAt(p)) p++;
  let s = 0;
  const maxS = minLen - p;
  while (
    s < maxS &&
    prev.charCodeAt(prev.length - 1 - s) ===
      next.charCodeAt(next.length - 1 - s)
  ) {
    s++;
  }
  return {
    oldStart: p,
    oldEnd: prev.length - s,
    newStart: p,
    newEnd: next.length - s,
  };
}

/**
 * Re-anchor tokens parsed on `prev` to their positions in `next`. Tokens
 * entirely before the edited region keep their offsets, tokens entirely after
 * it shift by the length delta, and tokens the edit touched are dropped (the
 * caller's parser re-resolves them shortly). A token is also dropped when its
 * text no longer appears at the mapped span — a guard for edits the
 * prefix/suffix diff cannot attribute.
 *
 * @param {string} prev The text the `tokens` were parsed from.
 * @param {string} next The edited text.
 * @param {Array<object>} tokens Parsed tokens with integer `start`/`end` and
 *   (optionally) the token's own `raw` text; without `raw`, the text of their
 *   span in `prev` is used.
 * @returns {{tokens: Array<object>, newStart: number, newEnd: number}} The
 *   kept tokens with updated `start`/`end` (the same object is reused when the
 *   span did not move) and the new edit region — after a native edit the caret
 *   sits at `newEnd`, so the caller can use it when the live selection is
 *   unreadable.
 */
export function reanchorTokens(prev, next, tokens) {
  const d = editRegion(prev, next);
  const shift = next.length - prev.length;
  const kept = [];
  for (const t of Array.isArray(tokens) ? tokens : []) {
    if (!t) continue;
    const raw = typeof t.raw === "string" && t.raw !== "" ? t.raw : prev.slice(t.start, t.end);
    let start;
    if (t.start >= d.oldEnd) start = t.start + shift;
    else if (t.end <= d.oldStart) start = t.start;
    else continue;
    if (next.slice(start, start + raw.length) !== raw) continue;
    kept.push(start === t.start ? t : { ...t, start, end: start + raw.length });
  }
  return { tokens: kept, newStart: d.newStart, newEnd: d.newEnd };
}
