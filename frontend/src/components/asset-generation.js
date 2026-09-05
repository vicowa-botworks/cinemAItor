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

// ---- image output size (aspect ratio + resolution) ----
// Mirrors the backend's sizing (asset_generation.ts): the shorter edge equals
// the chosen base edge; the longer edge is base × ratio rounded to 8px. Auto
// (empty) omits the field so the model picks its own size.

/** Aspect-ratio choices for the generate form ("w:h" or "" for Auto). */
export const ASPECT_RATIO_PRESETS = [
  { value: "", label: "Auto (model default)" },
  { value: "1:1", label: "1:1 square" },
  { value: "4:3", label: "4:3 classic" },
  { value: "3:4", label: "3:4 portrait" },
  { value: "16:9", label: "16:9 widescreen" },
  { value: "9:16", label: "9:16 vertical" },
  { value: "3:2", label: "3:2 photo" },
  { value: "2:3", label: "2:3 portrait" },
  { value: "21:9", label: "21:9 cinematic" },
];

/** Base-edge (px) choices for the generate form (number or "" for Auto). */
export const RESOLUTION_PRESETS = [
  { value: "", label: "Auto (model default)" },
  { value: 512, label: "512 px" },
  { value: 768, label: "768 px" },
  { value: 1024, label: "1024 px" },
  { value: 1536, label: "1536 px" },
  { value: 2048, label: "2048 px" },
];

export const MIN_IMAGE_EDGE = 64;
export const MAX_IMAGE_EDGE = 8192;

/** Round to the nearest 8, floored at 8 — matches the backend's round8. */
export function round8(n) {
  return Math.max(8, Math.round(n / 8) * 8);
}

/**
 * Compute output width/height from an aspect ratio ("w:h") and a base edge in
 * px. The shorter edge equals the base; the longer edge is the base scaled by
 * the ratio and rounded to 8px. Returns undefined when either input is absent
 * or the ratio is malformed (the model then decides its own size).
 * @param {string|number|null|undefined} aspect
 * @param {string|number|null|undefined} baseEdge
 * @returns {{width: number, height: number} | undefined}
 */
export function computeImageSize(aspect, baseEdge) {
  const base = Number(baseEdge);
  const ratio = typeof aspect === "string" ? aspect.trim() : "";
  if (!ratio || !Number.isFinite(base) || base <= 0) return undefined;
  const m = ratio.match(/^(\d{1,4}):(\d{1,4})$/);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w >= h) return { width: round8(base * (w / h)), height: Math.round(base) };
  return { width: Math.round(base), height: round8(base * (h / w)) };
}

/**
 * The size fields to send from the form's aspect/resolution selects. Auto
 * (empty) omits the field. `resolution` arrives as a string from a <select>;
 * it is coerced to an integer.
 * @param {object} form
 * @returns {{aspect_ratio?: string, resolution?: number}}
 */
export function sizeFieldsFromForm(form) {
  const fields = {};
  const aspect = String(form?.aspect_ratio ?? "").trim();
  if (aspect) fields.aspect_ratio = aspect;
  const resRaw = form?.resolution ?? "";
  if (resRaw !== "" && resRaw !== null && resRaw !== undefined) {
    const res = Number(resRaw);
    if (Number.isFinite(res) && res > 0) fields.resolution = Math.round(res);
  }
  return fields;
}

/** Human "WxH" preview of the chosen size, or null when Auto. */
export function sizePreview(aspect, resolution) {
  const size = computeImageSize(aspect, resolution);
  return size ? `${size.width}×${size.height}` : null;
}

/**
 * Unwrap the GET /models/hardware response envelope to its inner `hardware`
 * object (the shape `vramPreCheck`/`vramSufficient` expect). The endpoint
 * answers `{hardware, warnings}` — passing the envelope to the helpers reads
 * `hardware.gpu` off a missing key and silently fails the check open.
 * @param {{hardware?: {gpu?: object}} | null | undefined} response
 */
export function hardwareOf(response) {
  return response?.hardware ?? null;
}

/**
 * Decide whether a generation job needs a pre-submit VRAM choice, and report
 * how much VRAM is free versus required.
 *
 * A choice is offered only when ALL of these hold:
 *   - the model runs as a local CLI (`backend === "local_cli"`), since that is
 *     the only backend whose runner honors a device override (RUNNER_DEVICE);
 *   - the model declares a VRAM requirement (`vram_requirement_mb > 0`);
 *   - a GPU is present and reports usable VRAM numbers; and
 *   - the free VRAM (total − used) is below the requirement.
 *
 * Everything else (mock/comfyui, no requirement, no GPU, or unknown VRAM) is
 * left to the runner's own auto fallback, so we return `needed: false` rather
 * than block the user with a modal we can't meaningfully answer.
 *
 * @param {{backend?: string, vram_requirement_mb?: number|null} | null | undefined} model
 * @param {{gpu?: {vram_mb?: number|null, vram_used_mb?: number|null, model?: string}|null} | null | undefined} hardware
 * @returns {{needed: boolean, freeMb: number|null, requirementMb: number|null, gpuModel: string|null}}
 */
export function vramPreCheck(model, hardware) {
  const requirementMb = model &&
      typeof model.vram_requirement_mb === "number" &&
      model.vram_requirement_mb > 0
    ? Math.round(model.vram_requirement_mb)
    : null;
  const gpu = hardware?.gpu ?? null;
  const freeMb = gpu && typeof gpu.vram_mb === "number" && typeof gpu.vram_used_mb === "number"
    ? gpu.vram_mb - gpu.vram_used_mb
    : null;
  const needed = model?.backend === "local_cli" &&
    requirementMb !== null &&
    freeMb !== null &&
    freeMb < requirementMb;
  return { needed, freeMb, requirementMb, gpuModel: gpu?.model ?? null };
}

/**
 * Whether a (re)checked hardware snapshot now has enough free VRAM for the
 * model, so a "free VRAM & recheck" can auto-continue on the GPU. Returns true
 * when there is no declared requirement to check against.
 */
export function vramSufficient(model, hardware) {
  const check = vramPreCheck(model, hardware);
  if (check.requirementMb === null) return true;
  return check.freeMb !== null && check.freeMb >= check.requirementMb;
}

/**
 * Format a megabyte count as a short GB label for the VRAM dialog ("50.0 GB").
 * Unknown values render as "?".
 * @param {number|null|undefined} mb
 */
export function formatGb(mb) {
  if (mb === null || mb === undefined) return "?";
  return `${(mb / 1024).toFixed(1)} GB`;
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
