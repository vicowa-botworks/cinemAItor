import { AppError, badRequest, ERROR_CODES, notFound } from "../errors.ts";
import {
  type Model,
  MODEL_BACKENDS,
  registerModel,
  type RegisterModelInput,
} from "../db/models.ts";

/** Public HuggingFace REST API root (metadata only; public repos need no token). */
export const HF_API_BASE = "https://huggingface.co/api";
/** Public site root, used to build weight-file download URLs. */
export const HF_PUBLIC_BASE = "https://huggingface.co";

/** Effective API root — `HF_API_BASE` env override (tests point it at a fake server). */
export function hfApiBase(): string {
  return Deno.env.get("HF_API_BASE") ?? HF_API_BASE;
}
const HF_TIMEOUT_MS = 15_000;
const LICENSE_PREFIX = "license:";

export interface HfRepoSummary {
  id: string;
  likes: number;
  downloads: number;
  pipeline_tag: string | null;
  tags: string[];
  license: string | null;
}

export interface HfRepoFile {
  path: string;
  size: number;
  type: "file" | "directory";
}

export interface HfRepoInfo {
  repo: HfRepoSummary;
  files: HfRepoFile[];
}

/** Weight file extensions the auto-register heuristic accepts. */
export const HF_WEIGHT_EXTENSIONS = [".safetensors", ".gguf", ".ckpt", ".bin"];

function hfError(message: string, details?: string, cause?: unknown): AppError {
  return new AppError(ERROR_CODES.NETWORK_ERROR, message, {
    status: 502,
    details,
    cause,
  });
}

function licenseFromTags(tags: string[]): string | null {
  const hit = tags.find((t) => t.startsWith(LICENSE_PREFIX));
  return hit ? hit.slice(LICENSE_PREFIX.length) : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : [];
}

function normalizeRepo(entry: Record<string, unknown>): HfRepoSummary {
  const tags = asStringArray(entry.tags);
  return {
    id: typeof entry.id === "string" ? entry.id : "",
    likes: typeof entry.likes === "number" ? entry.likes : 0,
    downloads: typeof entry.downloads === "number" ? entry.downloads : 0,
    pipeline_tag: typeof entry.pipeline_tag === "string" ? entry.pipeline_tag : null,
    tags,
    license: licenseFromTags(tags),
  };
}

function normalizeFiles(entries: unknown[]): HfRepoFile[] {
  return entries.flatMap((e) => {
    if (typeof e !== "object" || e === null) return [];
    const rec = e as Record<string, unknown>;
    if (typeof rec.name !== "string") return [];
    return [{
      path: rec.name,
      size: typeof rec.size === "number" ? rec.size : 0,
      type: rec.type === "directory" ? "directory" as const : "file" as const,
    }];
  }).filter((f) => f.type === "file");
}

async function hfFetch(url: string): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(HF_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw hfError(
        `HuggingFace did not answer within ${HF_TIMEOUT_MS / 1000}s`,
        undefined,
        err,
      );
    }
    throw hfError(
      `HuggingFace unreachable: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      err,
    );
  }
}

async function hfFetchJson(url: string): Promise<unknown> {
  const res = await hfFetch(url);
  if (res.status === 404) {
    throw notFound(`HuggingFace repo not found: ${new URL(url).pathname}`);
  }
  if (!res.ok) {
    throw hfError(`HuggingFace API error (HTTP ${res.status})`, `HTTP ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    throw hfError("HuggingFace returned a non-JSON response");
  }
}

/**
 * Search public HF model repos. `query` is free text (empty → popular repos);
 * `filter` is passed through as the HF `pipeline_tag` (e.g. `text-to-image`);
 * `limit` is clamped to 1–50 by the caller.
 */
export async function searchHuggingFaceModels(
  query: string,
  filter: string | null,
  limit: number,
  baseUrl: string = hfApiBase(),
): Promise<HfRepoSummary[]> {
  const url = new URL(`${baseUrl}/models`);
  if (query) url.searchParams.set("search", query);
  if (filter) url.searchParams.set("pipeline_tag", filter);
  url.searchParams.set("limit", String(limit));
  const payload = await hfFetchJson(url.toString());
  if (!Array.isArray(payload)) throw hfError("HuggingFace search returned no list");
  return (payload as Record<string, unknown>[])
    .map(normalizeRepo)
    .filter((r) => r.id !== "");
}

/**
 * Repo metadata + root-level file listing with sizes (`/tree/main`, non-recursive).
 * The repo id may contain one `/` (owner/name); it is percent-encoded.
 */
export async function getHuggingFaceRepo(
  repoId: string,
  baseUrl: string = hfApiBase(),
): Promise<HfRepoInfo> {
  validateRepoId(repoId);
  const encoded = encodeURIComponent(repoId);
  const [meta, tree] = await Promise.all([
    hfFetchJson(`${baseUrl}/models/${encoded}`),
    hfFetchJson(`${baseUrl}/models/${encoded}/tree/main`),
  ]);
  if (typeof meta !== "object" || meta === null) {
    throw hfError("HuggingFace returned no repo metadata");
  }
  return {
    repo: normalizeRepo(meta as Record<string, unknown>),
    files: Array.isArray(tree) ? normalizeFiles(tree) : [],
  };
}

/** A repo id is `owner/name` — exactly one slash, safe characters only. */
export function validateRepoId(repoId: string): void {
  if (
    typeof repoId !== "string" ||
    !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repoId)
  ) {
    throw badRequest(
      "repo_id must be a HuggingFace repo in the form 'owner/name'",
      "repo_id",
    );
  }
}

/**
 * Pick the weight file to register: the explicit `file` (must exist in the
 * listing) or the largest file with a known weight extension.
 */
export function pickWeightFile(
  files: HfRepoFile[],
  explicit?: string,
): string {
  if (explicit) {
    if (!files.some((f) => f.path === explicit)) {
      throw badRequest(`file '${explicit}' is not in the repo file listing`, "file");
    }
    return explicit;
  }
  const candidates = files.filter((f) =>
    HF_WEIGHT_EXTENSIONS.some((ext) => f.path.toLowerCase().endsWith(ext))
  );
  if (candidates.length === 0) {
    throw badRequest(
      `No usable weight file found (expected ${HF_WEIGHT_EXTENSIONS.join(" / ")})`,
      "file",
    );
  }
  return candidates.reduce((best, f) => (f.size > best.size ? f : best)).path;
}

/** Download URL for a repo file on the default branch. */
export function resolveFileUrl(repoId: string, file: string): string {
  return `${HF_PUBLIC_BASE}/${repoId}/resolve/main/${file}`;
}

/**
 * Model id from the last repo segment (`stabilityai/sdxl-base` → `sdxl_base`).
 * Lowercased, non-alphanumerics collapsed to `_`, capped at 40 chars.
 */
export function slugifyModelId(repoId: string): string {
  const last = repoId.split("/").pop() ?? repoId;
  const slug = last.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!slug) throw badRequest(`Repo name '${last}' yields an empty model id`, "repo_id");
  return slug.slice(0, 40).replace(/_+$/g, "");
}

export interface RegisterFromHfOptions {
  file?: string;
  backend?: string;
  name?: string;
  version?: string;
  task_types?: string[];
  min_vram_mb?: number;
  dependencies?: string[];
  known_limitations?: string[];
}

/**
 * Shared auto-registration from a HuggingFace repo (the route handler and the
 * model-copilot `register_model_from_huggingface` tool both go through this):
 * pick the weight file and register a `source: url` model row pointing at the
 * resolve URL. Weights are NOT downloaded.
 */
export async function registerModelFromHuggingFace(
  userId: number,
  repoId: string,
  options: RegisterFromHfOptions = {},
): Promise<{ model: Model; file: string; repo: HfRepoSummary }> {
  validateRepoId(repoId);
  const info = await getHuggingFaceRepo(repoId);
  const weightFile = pickWeightFile(info.files, options.file);
  const backend = options.backend ?? "local_cli";
  if (!MODEL_BACKENDS.includes(backend as (typeof MODEL_BACKENDS)[number])) {
    throw badRequest(`backend must be one of: ${MODEL_BACKENDS.join(", ")}`, "backend");
  }
  const model = registerModel(userId, {
    id: slugifyModelId(repoId),
    name: options.name ?? repoId,
    version: options.version ?? "1.0",
    backend: backend as RegisterModelInput["backend"],
    source: "url",
    repository_url: resolveFileUrl(repoId, weightFile),
    license: info.repo.license ?? undefined,
    vram_requirement_mb: options.min_vram_mb,
    dependencies: options.dependencies,
    known_limitations: options.known_limitations,
    task_types: options.task_types,
  });
  return { model, file: weightFile, repo: info.repo };
}
