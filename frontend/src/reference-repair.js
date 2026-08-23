// Pure helpers for repairing broken @references in prompt text.

/**
 * Replace one parsed reference token's span in the prompt text with a new
 * slug. The replacement targets the replacement asset's active version, so
 * any `:vN` suffix on the original token is dropped — version numbers belong
 * to the old asset's history.
 *
 * @param {string} text The full prompt text the `token` was parsed from.
 * @param {{start: number, end: number}} token The parsed token span within `text`.
 * @param {string} newSlug The unique slug of the replacement asset.
 * @returns {{text: string, oldText: string, newText: string}} The rewritten
 *   text plus the exact token text that was replaced and its replacement.
 */
export function replaceReferenceToken(text, token, newSlug) {
  if (typeof text !== "string") throw new Error("text must be a string");
  if (
    !token ||
    typeof token.start !== "number" ||
    typeof token.end !== "number" ||
    !Number.isInteger(token.start) ||
    !Number.isInteger(token.end)
  ) {
    throw new Error("token must have integer start/end offsets");
  }
  if (token.start < 0 || token.end > text.length || token.start >= token.end) {
    throw new Error("token span is out of range");
  }
  if (typeof newSlug !== "string" || !newSlug) {
    throw new Error("newSlug must be a non-empty string");
  }
  const oldText = text.slice(token.start, token.end);
  const newText = `@${newSlug}`;
  return {
    text: text.slice(0, token.start) + newText + text.slice(token.end),
    oldText,
    newText,
  };
}
