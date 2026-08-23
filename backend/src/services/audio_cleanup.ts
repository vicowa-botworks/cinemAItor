/**
 * Audio cleanup (AUD-012): denoise and/or normalize an audio asset version
 * into a new version of the same asset. Runs as a model-less
 * `audio_cleanup` job through the ffmpeg media engine; on hosts without
 * ffmpeg it falls back to a deterministic mock output so the pipeline
 * (queue, versioning, provenance) still works.
 */
import { badRequest, forbidden, notFound } from "../errors.ts";
import { AUDIO_CLEANUP_JOB_TYPE, createJob } from "../db/jobs.ts";
import { isAudioAssetType } from "../db/audio.ts";
import { getAssetById, getAssetVersion, hasAssetPermission } from "../db/assets.ts";
import { loadConfig } from "../config.ts";
import { isFfmpegAvailable } from "./media_proxy.ts";

export interface CleanupOperations {
  denoise: boolean;
  normalize: boolean;
}

/** Loudness target for the normalize pass (EBU R128 single pass). */
export const NORMALIZE_TARGETS = "loudnorm=I=-16:TP=-1.5:LRA=11";

export interface CleanupOutputFormat {
  extension: string;
  mime_type: string;
  codecArgs: string[];
}

/** Keep the cleaned version in the source format when the codec is known. */
export function cleanupOutputFormat(sourceFormat: string): CleanupOutputFormat {
  switch (sourceFormat) {
    case "mp3":
      return {
        extension: "mp3",
        mime_type: "audio/mpeg",
        codecArgs: ["-c:a", "libmp3lame", "-b:a", "192k"],
      };
    case "aac":
      return {
        extension: "aac",
        mime_type: "audio/aac",
        codecArgs: ["-c:a", "aac", "-b:a", "192k"],
      };
    case "m4a":
      return {
        extension: "m4a",
        mime_type: "audio/mp4",
        codecArgs: ["-c:a", "aac", "-b:a", "192k"],
      };
    case "flac":
      return {
        extension: "flac",
        mime_type: "audio/flac",
        codecArgs: ["-c:a", "flac"],
      };
    case "ogg":
      return {
        extension: "ogg",
        mime_type: "audio/ogg",
        codecArgs: ["-c:a", "libvorbis", "-q:a", "6"],
      };
    default:
      return {
        extension: "wav",
        mime_type: "audio/wav",
        codecArgs: ["-c:a", "pcm_s16le"],
      };
  }
}

/** Ordered filter chain: denoise first, then normalize. */
export function cleanupFilterChain(operations: CleanupOperations): string {
  const chain: string[] = [];
  if (operations.denoise) chain.push("afftdn");
  if (operations.normalize) chain.push(NORMALIZE_TARGETS);
  return chain.join(",");
}

/** Build the ffmpeg args for a cleanup pass (also used by tests). */
export function ffmpegCleanupArgs(
  operations: CleanupOperations,
  sourcePath: string,
  outPath: string,
  sourceFormat: string,
): string[] {
  const out = cleanupOutputFormat(sourceFormat);
  return [
    "-v",
    "error",
    "-y",
    "-i",
    sourcePath,
    "-af",
    cleanupFilterChain(operations),
    ...out.codecArgs,
    outPath,
  ];
}

export interface CleanupHooks {
  onProgress(progress: number, message: string | null): void;
  isCancelled(): boolean;
}

export interface CleanupResult {
  extension: string;
  mime_type: string;
  engine: "ffmpeg" | "mock";
}

const CLEANUP_TIMEOUT_MS = 900_000;

function mockCleanupContent(operations: CleanupOperations, seed: string): Uint8Array {
  const ops = [
    operations.denoise ? "denoise" : null,
    operations.normalize ? "normalize" : null,
  ].filter(Boolean).join("+");
  const marker = new TextEncoder().encode(`MOCKCLEANUP:${ops}:${seed}`.slice(0, 64));
  const content = new Uint8Array(1024);
  content.set(marker, 0);
  for (let i = marker.length; i < content.length; i++) {
    content[i] = (i * 31 + seed.length) & 0xff;
  }
  return content;
}

/**
 * Run the cleanup pass over `sourcePath` and write the result to `outPath`.
 * Throws on failure; the caller decides the terminal job state.
 */
export async function generateAudioCleanup(
  sourcePath: string,
  outPath: string,
  operations: CleanupOperations,
  sourceFormat: string,
  seed: string,
  hooks: CleanupHooks,
): Promise<CleanupResult> {
  const out = cleanupOutputFormat(sourceFormat);
  hooks.onProgress(10, "Running cleanup pass");
  if (hooks.isCancelled()) throw new Error("Audio cleanup cancelled");

  if (!(await isFfmpegAvailable())) {
    await Deno.writeFile(outPath, mockCleanupContent(operations, seed));
    hooks.onProgress(100, "Mock cleanup generated");
    return { extension: out.extension, mime_type: out.mime_type, engine: "mock" };
  }

  const config = loadConfig();
  const child = new Deno.Command(config.ffmpegPath, {
    args: ffmpegCleanupArgs(operations, sourcePath, outPath, sourceFormat),
    stdout: "null",
    stderr: "piped",
  }).spawn();
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // already exited
    }
  }, CLEANUP_TIMEOUT_MS);
  const poll = setInterval(() => {
    if (hooks.isCancelled()) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }
  }, 500);
  Deno.unrefTimer(timer);
  Deno.unrefTimer(poll);

  const stderrPromise = new Response(child.stderr).arrayBuffer().catch(() => new Uint8Array());

  try {
    const status = await child.status;
    if (hooks.isCancelled()) throw new Error("Audio cleanup cancelled");
    if (!status.success) {
      const stderrText = new TextDecoder().decode(await stderrPromise).trim().slice(0, 400);
      throw new Error(
        `ffmpeg cleanup failed (exit ${status.code}): ${stderrText}`,
      );
    }
    await Deno.stat(outPath);
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }

  hooks.onProgress(100, "Cleanup complete");
  return { extension: out.extension, mime_type: out.mime_type, engine: "ffmpeg" };
}

function parseCleanupOperations(body: Record<string, unknown>): CleanupOperations {
  for (const key of Object.keys(body)) {
    if (key !== "denoise" && key !== "normalize") {
      throw badRequest(`Unknown cleanup option '${key}'`);
    }
  }
  const denoise = body.denoise === true;
  const normalize = body.normalize === true;
  if (!denoise && !normalize) {
    throw badRequest("At least one of denoise or normalize is required");
  }
  return { denoise, normalize };
}

export interface AudioCleanupRequest {
  job_id: string;
  job_type: string;
  asset_id: string;
  source_version_id: string;
  source_version_number: number;
  operations: CleanupOperations;
}

/**
 * Validate a cleanup request and enqueue the model-less `audio_cleanup`
 * job. The source version stays untouched; the cleaned result lands as a
 * new (non-active) version once the job succeeds.
 */
export function requestAudioCleanup(
  userId: number,
  assetId: string,
  versionId: string,
  body: Record<string, unknown>,
): AudioCleanupRequest {
  const asset = getAssetById(assetId);
  if (!asset || asset.status === "deleted") throw notFound("Asset not found");
  if (!isAudioAssetType(asset.asset_type)) {
    throw badRequest(`Asset '@${asset.unique_slug}' is not an audio asset`);
  }
  const version = getAssetVersion(versionId);
  if (!version || version.asset_id !== asset.id) {
    throw notFound("Asset version not found");
  }
  if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();
  const operations = parseCleanupOperations(body);
  if (!version.file_path) {
    throw badRequest("Version has no stored master file to clean up");
  }
  let present = false;
  try {
    Deno.statSync(version.file_path);
    present = true;
  } catch {
    present = false;
  }
  if (!present) {
    throw badRequest("Version's master file is missing from the content store");
  }

  const job = createJob(userId, {
    project_id: asset.project_id ?? undefined,
    asset_id: asset.id,
    job_type: AUDIO_CLEANUP_JOB_TYPE,
    settings: { ...operations },
    input_asset_versions: [
      { asset_id: asset.id, version_number: version.version_number },
    ],
  });
  return {
    job_id: job.id,
    job_type: job.job_type,
    asset_id: asset.id,
    source_version_id: version.id,
    source_version_number: version.version_number,
    operations,
  };
}

export function cleanupOperationsLabel(operations: CleanupOperations): string {
  return [
    operations.denoise ? "denoise" : null,
    operations.normalize ? "normalize" : null,
  ].filter(Boolean).join(", ");
}
