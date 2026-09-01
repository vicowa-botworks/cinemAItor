import { badRequest, notFound } from "../errors.ts";
import { pickModel } from "./creative_generation.ts";
import { createJob } from "../db/jobs.ts";
import {
  createAsset,
  getAssetAccessible,
  getAssetVersion,
  getAssetVersionByNumber,
} from "../db/assets.ts";
import { getProjectAccessible } from "../db/projects.ts";

/**
 * Prompt-based asset generation (image/video). Two entry points:
 *
 * - generateNewAsset: create a fresh asset + enqueue a generation job.
 * - generateIntoAsset: enqueue a generation/edit job targeting an existing
 *   asset (the current version and/or other assets act as references).
 *
 * Task type selection mirrors the creative pipeline: no inputs means a text
 * task (text_to_image / text_to_video); any image/video input upgrades it to
 * the image-conditioned variant (image_to_image / image_to_video).
 * Candidates are stored as new versions of the target asset and picked in
 * the review workflow.
 */

export const ASSET_GENERATION_KINDS = ["image", "video"] as const;
export type AssetGenerationKind = (typeof ASSET_GENERATION_KINDS)[number];

export const KIND_TASK_TYPES: Record<
  AssetGenerationKind,
  { text: string; input: string }
> = {
  image: { text: "text_to_image", input: "image_to_image" },
  video: { text: "text_to_video", input: "image_to_video" },
};

const IMAGE_ASSET_TYPES = new Set(["image", "character", "location", "prop"]);
const VIDEO_ASSET_TYPES = new Set(["video"]);

const SLUG_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;

export const MIN_CANDIDATES = 1;
export const MAX_CANDIDATES = 8;
export const DEFAULT_CANDIDATES = 2;

/**
 * Execution device hint for local_cli generation. When set, the runner is
 * told via RUNNER_DEVICE to use it instead of its own auto fallback (GPU
 * when enough VRAM is free, CPU otherwise). The UI offers this from the
 * pre-generation VRAM check: "use CPU" when free VRAM is short of the
 * model's requirement.
 */
export const GENERATION_DEVICES = ["cpu", "cuda"] as const;
export type GenerationDevice = (typeof GENERATION_DEVICES)[number];

export interface AssetReferenceInput {
  asset_id: string;
  version_number?: number;
}

export interface GenerateNewAssetOptions {
  kind: unknown;
  prompt?: string;
  unique_slug?: string;
  display_name?: string;
  asset_type?: string;
  library_scope?: "global" | "project" | undefined;
  project_id?: string;
  model_id?: string;
  seed?: string;
  candidates?: unknown;
  references?: AssetReferenceInput[];
  device?: unknown;
}

export interface GenerateIntoAssetOptions {
  kind: unknown;
  prompt?: string;
  model_id?: string;
  seed?: string;
  candidates?: unknown;
  include_current?: boolean;
  references?: AssetReferenceInput[];
  device?: unknown;
}

export interface AssetGenerateResult {
  job_id: string;
  job_type: string;
  asset_id: string;
  model_id: string;
}

function requireKind(kind: unknown): AssetGenerationKind {
  if (kind !== "image" && kind !== "video") {
    throw badRequest(`kind must be one of: ${ASSET_GENERATION_KINDS.join(", ")}`);
  }
  return kind;
}

function requirePrompt(prompt: string | undefined): string {
  const trimmed = prompt?.trim();
  if (!trimmed) throw badRequest("prompt is required");
  return trimmed;
}

export function resolveCandidateCount(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_CANDIDATES;
  if (
    typeof value !== "number" || !Number.isInteger(value) ||
    value < MIN_CANDIDATES || value > MAX_CANDIDATES
  ) {
    throw badRequest(
      `candidates must be an integer between ${MIN_CANDIDATES} and ${MAX_CANDIDATES}`,
    );
  }
  return value;
}

export function resolveDevice(value: unknown): GenerationDevice | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value !== "cpu" && value !== "cuda") {
    throw badRequest(`device must be one of: ${GENERATION_DEVICES.join(", ")}`);
  }
  return value;
}

/**
 * Resolve the asset type for a generated asset: defaults to the kind name,
 * and an explicit type must be compatible with the kind (character /
 * location / prop / image for images; video for videos).
 */
export function assetTypeForKind(
  kind: AssetGenerationKind,
  assetType: string | undefined,
): string {
  if (!assetType) return kind;
  const compatible = kind === "image"
    ? IMAGE_ASSET_TYPES.has(assetType)
    : VIDEO_ASSET_TYPES.has(assetType);
  if (!compatible) {
    throw badRequest(
      `asset_type '${assetType}' is not compatible with kind '${kind}'`,
    );
  }
  return assetType;
}

export function mediaKindForMime(
  mime: string | null | undefined,
): "image" | "video" | null {
  if (!mime) return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}

function resolveReference(
  userId: number,
  reference: AssetReferenceInput,
): { asset_id: string; version_number: number } {
  const assetId = typeof reference?.asset_id === "string" ? reference.asset_id : "";
  if (!assetId) throw badRequest("references[].asset_id is required");
  const asset = getAssetAccessible(assetId, userId, "read");
  if (!asset) throw notFound(`Reference asset not found: ${assetId}`);

  let versionNumber = reference.version_number;
  if (versionNumber === undefined && asset.active_version_id) {
    versionNumber = getAssetVersion(asset.active_version_id)?.version_number;
  }
  if (versionNumber === undefined) {
    throw badRequest(
      `Reference asset '${asset.unique_slug}' has no active version`,
    );
  }
  const version = getAssetVersionByNumber(asset.id, versionNumber);
  if (!version) {
    throw badRequest(
      `Reference asset '${asset.unique_slug}' has no version ${versionNumber}`,
    );
  }
  if (!version.file_path) {
    throw badRequest(
      `Reference version ${asset.unique_slug} v${versionNumber} has no stored file`,
    );
  }
  if (mediaKindForMime(version.mime_type) === null) {
    throw badRequest(
      `Reference '${asset.unique_slug}' v${versionNumber} is not an image or video`,
    );
  }
  return { asset_id: asset.id, version_number: version.version_number };
}

function resolveReferences(
  userId: number,
  references: AssetReferenceInput[] | undefined,
  skip: { asset_id: string; version_number: number } | null,
): { asset_id: string; version_number: number }[] {
  const inputs: { asset_id: string; version_number: number }[] = [];
  const seen = new Set<string>();
  for (const reference of references ?? []) {
    const input = resolveReference(userId, reference);
    const key = `${input.asset_id}:${input.version_number}`;
    if (
      skip && skip.asset_id === input.asset_id &&
      skip.version_number === input.version_number
    ) {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    inputs.push(input);
  }
  return inputs;
}

function enqueueGeneration(
  userId: number,
  kind: AssetGenerationKind,
  prompt: string,
  modelId: string | undefined,
  seed: string | undefined,
  candidates: number,
  inputs: { asset_id: string; version_number: number }[],
  target: { asset_id: string; project_id: string | null },
  device: GenerationDevice | undefined,
) {
  const taskType = inputs.length > 0 ? KIND_TASK_TYPES[kind].input : KIND_TASK_TYPES[kind].text;
  const model = pickModel(taskType, modelId);
  const job = createJob(userId, {
    job_type: taskType,
    model_id: model.id,
    asset_id: target.asset_id,
    project_id: target.project_id ?? undefined,
    prompt_text: prompt,
    seed,
    settings: {
      candidates,
      ...(device ? { device } : {}),
      // The model's declared VRAM requirement, so the runner's auto-fallback
      // threshold matches the UI's pre-generation VRAM check (both read
      // vram_requirement_mb). local_cli only — other backends ignore it.
      ...(model.backend === "local_cli" && model.vram_requirement_mb != null
        ? { min_free_vram_mb: model.vram_requirement_mb }
        : {}),
    },
    input_asset_versions: inputs,
  });
  return { job_id: job.id, job_type: taskType, asset_id: target.asset_id, model_id: model.id };
}

/** Create a fresh asset and enqueue a prompt-based generation job for it. */
export function generateNewAsset(
  userId: number,
  options: GenerateNewAssetOptions,
): AssetGenerateResult {
  const kind = requireKind(options.kind);
  const prompt = requirePrompt(options.prompt);
  const slug = typeof options.unique_slug === "string" ? options.unique_slug.trim() : "";
  if (!SLUG_RE.test(slug)) {
    throw badRequest(
      `unique_slug must match ${SLUG_RE} (lowercase letters, digits, underscore; max 64)`,
    );
  }
  const assetType = assetTypeForKind(kind, options.asset_type);

  const scope = options.library_scope ?? "global";
  if (scope !== "global" && scope !== "project") {
    throw badRequest("library_scope must be 'global' or 'project'");
  }
  let projectId: string | undefined;
  if (scope === "project") {
    if (!options.project_id) {
      throw badRequest("project_id is required when library_scope is 'project'");
    }
    const project = getProjectAccessible(options.project_id, userId, "write");
    if (!project) throw notFound("Project not found");
    projectId = project.id;
  } else if (options.project_id) {
    const project = getProjectAccessible(options.project_id, userId, "write");
    if (!project) throw notFound("Project not found");
    projectId = project.id;
  }

  const inputs = resolveReferences(userId, options.references, null);
  const candidates = resolveCandidateCount(options.candidates);

  const asset = createAsset(
    {
      unique_slug: slug,
      display_name: options.display_name?.trim() || slug,
      asset_type: assetType,
      library_scope: projectId ? "project" : "global",
      project_id: projectId,
      description: null,
    },
    userId,
  );
  return enqueueGeneration(
    userId,
    kind,
    prompt,
    options.model_id,
    options.seed,
    candidates,
    inputs,
    { asset_id: asset.id, project_id: projectId ?? null },
    resolveDevice(options.device),
  );
}

/** Enqueue a generation/edit job that stores new versions on an existing asset. */
export function generateIntoAsset(
  userId: number,
  assetId: string,
  options: GenerateIntoAssetOptions,
): AssetGenerateResult {
  const kind = requireKind(options.kind);
  const prompt = requirePrompt(options.prompt);

  const asset = getAssetAccessible(assetId, userId, "write");
  if (!asset) throw notFound("Asset not found");

  const activeVersion = asset.active_version_id
    ? getAssetVersion(asset.active_version_id)
    : undefined;
  const typeCompatible = kind === "image"
    ? IMAGE_ASSET_TYPES.has(asset.asset_type)
    : VIDEO_ASSET_TYPES.has(asset.asset_type);
  const activeKind = activeVersion ? mediaKindForMime(activeVersion.mime_type) : null;
  if (!typeCompatible && activeKind !== kind) {
    throw badRequest(
      `kind '${kind}' is not compatible with asset type '${asset.asset_type}'`,
    );
  }

  const inputs: { asset_id: string; version_number: number }[] = [];
  let current: { asset_id: string; version_number: number } | null = null;
  if (options.include_current) {
    if (!activeVersion) {
      throw badRequest("Asset has no active version to use as a reference");
    }
    if (activeKind === null) {
      throw badRequest("The active version is not an image or video");
    }
    if (!activeVersion.file_path) {
      throw badRequest("The active version has no stored file");
    }
    current = {
      asset_id: asset.id,
      version_number: activeVersion.version_number,
    };
    inputs.push(current);
  }
  inputs.push(...resolveReferences(userId, options.references, current));

  const candidates = resolveCandidateCount(options.candidates);
  return enqueueGeneration(
    userId,
    kind,
    prompt,
    options.model_id,
    options.seed,
    candidates,
    inputs,
    { asset_id: asset.id, project_id: asset.project_id },
    resolveDevice(options.device),
  );
}
