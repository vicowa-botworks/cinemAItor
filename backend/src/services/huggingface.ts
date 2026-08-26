import { AppError, badRequest, ERROR_CODES, notFound } from "../errors.ts";
import {
  type Model,
  MODEL_BACKENDS,
  registerModel,
  type RegisterModelInput,
} from "../db/models.ts";
import { getHfToken } from "../db/hf_settings.ts";

/** Public HuggingFace REST API root (metadata only; public repos need no token). */
export const HF_API_BASE = "https://huggingface.co/api";
/** Public site root, used to build weight-file download URLs. */
export const HF_PUBLIC_BASE = "https://huggingface.co";

/** Effective API root — `HF_API_BASE` env override (tests point it at a fake server). */
export function hfApiBase(): string {
  return Deno.env.get("HF_API_BASE") ?? HF_API_BASE;
}
/** Effective public site root — `HF_PUBLIC_BASE` env override (tests). */
export function hfPublicBase(): string {
  return Deno.env.get("HF_PUBLIC_BASE") ?? HF_PUBLIC_BASE;
}
const HF_TIMEOUT_MS = 15_000;
const LICENSE_PREFIX = "license:";
/** Hard cap on files returned per repo listing (weight files are always kept). */
export const HF_MAX_FILES = 500;
/** README excerpt size kept for the UI + copilot context. */
export const HF_README_MAX_CHARS = 4000;

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
  readme: string | null;
  filesTruncated: boolean;
  /** The branch the file listing came from (`main`, or `master` fallback). */
  branch: string;
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

/**
 * Normalize raw `/tree/<branch>` entries. The live HF API keys entries by
 * `path` (plus `size`, `type`, `oid`) — it never sends `name`; entries missing
 * `path` are dropped. (We originally parsed `name`, which silently emptied
 * every real repo listing while fakes that mirrored the bug kept tests green.)
 */
function normalizeFiles(entries: unknown[]): HfRepoFile[] {
  return entries.flatMap((e) => {
    if (typeof e !== "object" || e === null) return [];
    const rec = e as Record<string, unknown>;
    if (typeof rec.path !== "string") return [];
    return [{
      path: rec.path,
      size: typeof rec.size === "number" ? rec.size : 0,
      type: rec.type === "directory" ? "directory" as const : "file" as const,
    }];
  }).filter((f) => f.type === "file");
}

/**
 * Effective HuggingFace token: the admin-stored token (settings) wins, then the
 * `HF_TOKEN` env, then none.
 */
export function hfEffectiveToken(): string {
  return getHfToken() || Deno.env.get("HF_TOKEN") || "";
}

/**
 * Optional auth for HuggingFace. Public repos need no token, but HF has been
 * tightening anonymous access on per-repo endpoints — when a token is configured
 * (settings or env) it is forwarded as a Bearer token.
 */
function hfAuthHeaders(): Record<string, string> {
  const token = hfEffectiveToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function hfFetch(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: hfAuthHeaders(),
      signal: AbortSignal.timeout(HF_TIMEOUT_MS),
    });
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
  if (res.status === 401) {
    throw hfError(
      "HuggingFace rejected the request (HTTP 401) — anonymous per-repo access " +
        "may be restricted; set HF_TOKEN to a HuggingFace access token and retry",
      "HTTP 401",
    );
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
 * Keep at most `HF_MAX_FILES` entries, always preserving every weight file so
 * the auto-register heuristic still finds them on huge repos.
 */
export function capHfFiles(files: HfRepoFile[]): { files: HfRepoFile[]; truncated: boolean } {
  if (files.length <= HF_MAX_FILES) return { files, truncated: false };
  const isWeight = (f: HfRepoFile): boolean =>
    HF_WEIGHT_EXTENSIONS.some((ext) => f.path.toLowerCase().endsWith(ext));
  const weights = files.filter(isWeight).slice(0, HF_MAX_FILES);
  const others = files.filter((f) => !isWeight(f));
  const head = weights.length < HF_MAX_FILES ? others.slice(0, HF_MAX_FILES - weights.length) : [];
  return { files: [...weights, ...head], truncated: true };
}

/** Trim a README to a bounded excerpt for the UI + copilot context. */
export function truncateReadme(readme: string): string | null {
  const trimmed = readme.trim();
  if (!trimmed) return null;
  if (trimmed.length <= HF_README_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, HF_README_MAX_CHARS)}\n… (truncated)`;
}

/**
 * Best-effort README fetch (`resolve/<branch>/README.md`). Returns null when
 * the repo has no README or the fetch fails — a missing README never fails the
 * repo lookup.
 */
async function fetchReadme(
  repoId: string,
  publicBase: string,
  branch: string,
): Promise<string | null> {
  try {
    const res = await hfFetch(`${publicBase}/${repoId}/resolve/${branch}/README.md`);
    if (!res.ok) return null;
    const text = await res.text();
    return truncateReadme(text);
  } catch {
    return null;
  }
}

/**
 * Repo metadata + recursive file listing with sizes
 * (`/tree/<branch>?recursive=true`, so weights in subfolders such as `vae/`,
 * `transformer/`, `text_encoder/` are found) + a truncated README excerpt.
 * The branch is resolved by probing `main`, then `master` (the tree endpoint
 * 404s on an unknown branch).
 * The repo id is `owner/name`; each segment is percent-encoded separately — the
 * HuggingFace API rejects a percent-encoded slash (`owner%2Fname`) with HTTP 400
 * ("repo name includes an url-encoded slash"), so the slash must stay literal.
 */
export async function getHuggingFaceRepo(
  repoId: string,
  baseUrl: string = hfApiBase(),
  publicBase: string = hfPublicBase(),
): Promise<HfRepoInfo> {
  validateRepoId(repoId);
  const [owner, name] = repoId.split("/");
  const encoded = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  // Most repos default to `main`, older ones to `master`; the tree endpoint
  // 404s on an unknown branch, so probe the common defaults in order. The
  // branch is resolved first (the README fetch needs it) and meta + README are
  // fetched in parallel afterwards — no promise is left dangling on the error
  // paths.
  let branch = "main";
  let tree: unknown;
  try {
    tree = await hfFetchJson(`${baseUrl}/models/${encoded}/tree/main?recursive=true`);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) {
      branch = "master";
      tree = await hfFetchJson(`${baseUrl}/models/${encoded}/tree/master?recursive=true`);
    } else {
      throw err;
    }
  }
  const [metaPayload, readme] = await Promise.all([
    hfFetchJson(`${baseUrl}/models/${encoded}`),
    fetchReadme(repoId, publicBase, branch),
  ]);
  if (typeof metaPayload !== "object" || metaPayload === null) {
    throw hfError("HuggingFace returned no repo metadata");
  }
  const allFiles = Array.isArray(tree) ? normalizeFiles(tree) : [];
  const capped = capHfFiles(allFiles);
  return {
    repo: normalizeRepo(metaPayload as Record<string, unknown>),
    files: capped.files,
    readme,
    filesTruncated: capped.truncated,
    branch,
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

/** Download URL for a repo file (on the given branch, `main` by default). */
export function resolveFileUrl(repoId: string, file: string, branch: string = "main"): string {
  return `${hfPublicBase()}/${repoId}/resolve/${branch}/${file}`;
}

/**
 * Validate the effective HuggingFace token against `/whoami-v2`. Returns the
 * account name on success; throws a 502 when the token is rejected or HF is
 * unreachable.
 */
export async function testHfToken(baseUrl: string = hfApiBase()): Promise<string> {
  const res = await hfFetch(`${baseUrl}/whoami-v2`);
  if (res.status === 401 || res.status === 403) {
    throw hfError(
      "HuggingFace rejected the token (HTTP 401/403) — check that it is a valid access token",
      `HTTP ${res.status}`,
    );
  }
  if (!res.ok) {
    throw hfError(`HuggingFace API error (HTTP ${res.status})`, `HTTP ${res.status}`);
  }
  try {
    const data = (await res.json()) as Record<string, unknown>;
    return typeof data.fullname === "string" && data.fullname
      ? data.fullname
      : typeof data.name === "string"
      ? data.name
      : "authenticated";
  } catch {
    throw hfError("HuggingFace returned a non-JSON response");
  }
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
    repository_url: resolveFileUrl(repoId, weightFile, info.branch),
    license: info.repo.license ?? undefined,
    vram_requirement_mb: options.min_vram_mb,
    dependencies: options.dependencies,
    known_limitations: options.known_limitations,
    task_types: options.task_types,
  });
  return { model, file: weightFile, repo: info.repo };
}
