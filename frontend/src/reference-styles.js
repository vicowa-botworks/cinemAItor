// Pure, DOM-free helpers for rendering color-coded @reference tokens inside
// prompt fields. A reference (e.g. "@hero") is shown as a rounded pill whose
// ring is a solid color and whose fill is that color at 50% opacity; the color
// is deterministic per slug so every mention of the same reference shares a
// color. Image/video references additionally get a small inline thumbnail.

export const REFERENCE_PALETTE = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#0aa1a1",
  "#f032e6",
  "#7a9a01",
  "#d1495b",
  "#308b9e",
  "#8a5a44",
  "#5e35b1",
  "#00897b",
  "#c26600",
  "#5c6bc0",
  "#ad1457",
];

// FNV-1a style 32-bit hash over the normalized slug. Deterministic and
// non-negative; distinct slugs land on different colors in practice.
export function hashSlug(slug) {
  const s = String(slug ?? "").replace(/^@/, "").toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function referenceColor(slug) {
  return REFERENCE_PALETTE[hashSlug(slug) % REFERENCE_PALETTE.length];
}

// True when the resolved asset is thumbnailable (image or video). The MIME
// type of the resolved version is authoritative; asset_type is the fallback
// when the MIME is unknown.
export function isVisualAsset(asset) {
  if (!asset || typeof asset !== "object") return false;
  const mime = typeof asset.mime_type === "string" ? asset.mime_type : "";
  if (mime) return mime.startsWith("image/") || mime.startsWith("video/");
  return asset.asset_type === "image" || asset.asset_type === "video";
}

// Interleave the raw text with reference spans so a highlight layer can paint
// a pill behind each token without altering the visible characters. Tokens
// with out-of-range or overlapping spans are dropped; the returned segments
// always reassemble to the full input text.
export function buildHighlightSegments(text, tokens) {
  if (typeof text !== "string" || text === "") return [];
  const valid = (Array.isArray(tokens) ? tokens : [])
    .filter(
      (t) =>
        t &&
        Number.isInteger(t.start) &&
        Number.isInteger(t.end) &&
        t.start >= 0 &&
        t.end <= text.length &&
        t.end > t.start,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const chosen = [];
  let cursor = 0;
  for (const t of valid) {
    if (t.start < cursor) continue;
    chosen.push(t);
    cursor = t.end;
  }

  const segments = [];
  let pos = 0;
  let refIndex = 0;
  for (const t of chosen) {
    if (t.start > pos) {
      segments.push({ type: "text", text: text.slice(pos, t.start) });
    }
    const asset = t.asset ?? null;
    segments.push({
      type: "ref",
      raw: text.slice(t.start, t.end),
      slug: t.slug,
      color: referenceColor(t.slug),
      visual: isVisualAsset(asset),
      assetId: asset && asset.id ? asset.id : null,
      versionId: asset && asset.version_id ? asset.version_id : null,
      status: t.status ?? "resolved",
      index: refIndex,
    });
    refIndex += 1;
    pos = t.end;
  }
  if (pos < text.length) segments.push({ type: "text", text: text.slice(pos) });
  return segments;
}
