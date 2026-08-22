import { dirname, join } from "@std/path";
import { loadConfig } from "../config.ts";
import { isFfmpegAvailable } from "./media_proxy.ts";

export type ThumbnailKind = "video" | "image";

/**
 * Error classes so the route layer can map service failures without
 * depending on framework-level error objects.
 */
export class ThumbnailUnavailableError extends Error {
  constructor() {
    super(
      "ffmpeg is required to generate thumbnails; install ffmpeg or set FFMPEG_PATH",
    );
    this.name = "ThumbnailUnavailableError";
  }
}

export class ThumbnailGenerationError extends Error {
  readonly stderr: string;
  constructor(stderr: string) {
    super(`thumbnail generation failed: ${stderr}`.slice(0, 500));
    this.name = "ThumbnailGenerationError";
    this.stderr = stderr;
  }
}

/**
 * Only video and image assets have thumbnails (audio has waveforms).
 * Mirrors proxyKindFor() minus the audio kind.
 */
export function thumbnailKindFor(
  mimeType: string | null | undefined,
  assetType?: string | null,
): ThumbnailKind | null {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  const type = (assetType ?? "").toLowerCase();
  if (type === "image") return "image";
  if (type === "video") return "video";
  return null;
}

export const THUMBNAIL_WIDTH_DEFAULT = 320;
export const THUMBNAIL_WIDTH_MIN = 64;
export const THUMBNAIL_WIDTH_MAX = 1280;

// The cache key quantizes the timestamp to 100 ms; filmstrip frames land on
// clean values anyway, and rounding keeps the cache path stable.
export function quantizeTimestamp(atSec: number): number {
  return Math.round(Math.max(0, atSec) * 10) / 10;
}

export function clampThumbnailWidth(width: number): number {
  if (!Number.isFinite(width)) return THUMBNAIL_WIDTH_DEFAULT;
  const w = Math.round(width);
  return Math.min(THUMBNAIL_WIDTH_MAX, Math.max(THUMBNAIL_WIDTH_MIN, w));
}

/**
 * Deterministic on-disk cache path per (version, quantized time, width):
 * re-requests for the same frame are served from disk without re-running
 * ffmpeg, keeping thumbnail generation within the sub-second target.
 */
export function thumbnailCachePath(
  appDataDir: string,
  versionId: string,
  atSec: number,
  width: number,
): string {
  const at = quantizeTimestamp(atSec).toFixed(1);
  return join(
    appDataDir,
    "assets",
    "thumbnails",
    `${versionId}-${at}-${width}.jpg`,
  );
}

/**
 * ffmpeg argument lists (engine-agnostic, unit-testable):
 *
 * - video: input-seek to `at`, grab one frame, scale to the requested
 *   width keeping the aspect ratio (odd sizes rounded to even), JPEG q5.
 * - image: a still source is scaled the same way to its 1-frame output.
 */
export function ffmpegThumbnailArgs(
  kind: ThumbnailKind,
  sourcePath: string,
  atSec: number,
  width: number,
  outPath: string,
): string[] {
  const scale = `scale=${width}:-2:force_original_aspect_ratio=decrease`;
  if (kind === "image") {
    return ["-v", "error", "-y", "-i", sourcePath, "-vf", scale, "-q:v", "5", outPath];
  }
  return [
    "-v",
    "error",
    "-y",
    "-ss",
    String(atSec),
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-vf",
    scale,
    "-q:v",
    "5",
    outPath,
  ];
}

const THUMBNAIL_TIMEOUT_MS = 30_000;

export interface ThumbnailOptions {
  sourcePath: string;
  kind: ThumbnailKind;
  atSec: number;
  width: number;
  outPath: string;
}

/**
 * Generate a cached JPEG thumbnail. The output is written to a temp file and
 * renamed into place so a concurrent request never serves a half-written
 * frame; an existing cache file is the caller's business (it checks first).
 */
export async function generateThumbnail(opts: ThumbnailOptions): Promise<void> {
  if (!(await isFfmpegAvailable())) {
    throw new ThumbnailUnavailableError();
  }
  const config = loadConfig();
  const partPath = `${opts.outPath}.part`;
  Deno.mkdirSync(dirname(opts.outPath), { recursive: true });
  try {
    const args = ffmpegThumbnailArgs(
      opts.kind,
      opts.sourcePath,
      opts.atSec,
      opts.width,
      partPath,
    );
    const child = new Deno.Command(config.ffmpegPath, {
      args,
      stdin: "null",
      stdout: "null",
      stderr: "piped",
    }).spawn();
    const timeout = setTimeout(
      () => {
        try {
          child.kill();
        } catch {
          // already exited
        }
      },
      THUMBNAIL_TIMEOUT_MS,
    );
    const { code, stderr } = await child.output().catch(
      (error: unknown) => ({
        code: 1,
        stderr: new TextEncoder().encode(String(error)),
      }),
    );
    clearTimeout(timeout);
    const stderrText = new TextDecoder().decode(stderr);
    if (code !== 0) {
      throw new ThumbnailGenerationError(stderrText.trim());
    }
    const stat = await Deno.stat(partPath).catch(
      () => null,
    );
    // ffmpeg exits 0 without emitting a file when `at` is past the media
    // end - surface that as a generation failure, not a served empty file.
    if (!stat || stat.size === 0) {
      throw new ThumbnailGenerationError(
        stderrText.trim() ||
          `no frame available at ${opts.atSec}s`,
      );
    }
    await Deno.rename(partPath, opts.outPath);
  } finally {
    await Deno.remove(partPath).catch(() => {});
  }
}
