// Shared pure helpers for prompt-based asset generation (image/video).
// DOM-free and unit-testable.

export const GENERATION_KINDS = ["image", "video"];

/** Asset types that can be generated or edited as image content. */
export const IMAGE_ASSET_TYPES = ["image", "character", "location", "prop"];

/** Asset types that can be generated or edited as video content. */
export const VIDEO_ASSET_TYPES = ["video"];

export function isImageAssetType(assetType) {
  return IMAGE_ASSET_TYPES.includes(assetType);
}

export function isVideoAssetType(assetType) {
  return VIDEO_ASSET_TYPES.includes(assetType);
}

/**
 * The generation kind an existing asset's type maps to, or null when the
 * asset kind cannot be generated/edited (e.g. audio, notes).
 * @param {{asset_type?: string} | null | undefined} asset
 */
export function generationKindForAsset(asset) {
  const t = asset?.asset_type;
  if (isImageAssetType(t)) return "image";
  if (isVideoAssetType(t)) return "video";
  return null;
}

/**
 * The backend task type a generation request resolves to, given whether
 * any input references (or the current version) are attached.
 */
export function generationTaskType(kind, hasInputs) {
  if (kind === "video") return hasInputs ? "image_to_video" : "text_to_video";
  return hasInputs ? "image_to_image" : "text_to_image";
}

export const SLUG_RE = /^[a-z0-9][a-z0-9_]*$/;

export function isValidSlug(slug) {
  return typeof slug === "string" && SLUG_RE.test(slug);
}

/** Lowercase slug from arbitrary text (spaces/punctuation → underscores). */
export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

/**
 * Coerce a seed field value to the wire format: integer string, or
 * undefined for empty / invalid input (server then treats it as random).
 */
export function normalizeSeed(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return String(n);
}

/** Coerce a candidates field value to the 1..8 range (default 2). */
export function normalizeCandidates(value) {
  const n = Number(value);
  if (!Number.isInteger(n)) return 2;
  return Math.min(8, Math.max(1, n));
}

/**
 * Client-side validation of a generation form.
 * @param {object} fields
 * @param {boolean} [opts.isNew] true when creating a NEW asset (slug +
 *   scope/project rules apply).
 * @returns {string[]} human-readable errors; empty means valid.
 */
export function validateGenerationForm(fields, { isNew = true } = {}) {
  const errors = [];
  const kind = fields?.kind;
  if (!GENERATION_KINDS.includes(kind)) {
    errors.push("Pick a generation kind (image or video).");
  }
  const prompt = String(fields?.prompt ?? "").trim();
  if (!prompt) {
    errors.push("A prompt is required.");
  } else if (prompt.length > 4000) {
    errors.push("The prompt must be at most 4000 characters.");
  }
  if (isNew) {
    if (!isValidSlug(fields?.unique_slug)) {
      errors.push(
        "The unique slug must start with a letter or digit and use only " +
          "lowercase letters, digits and underscores.",
      );
    }
    const scope = fields?.library_scope ?? "global";
    if (scope === "project" && !fields?.project_id) {
      errors.push("Pick a project for project-scoped assets.");
    }
  }
  const refs = fields?.references;
  if (refs !== undefined && !Array.isArray(refs)) {
    errors.push("References must be a list of assets.");
  }
  return errors;
}
