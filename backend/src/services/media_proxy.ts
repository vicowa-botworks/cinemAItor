/**
 * Proxy media generation (Workstream 14 polish, plan 14.2/14.3).
 *
 * Produces a playback proxy for an asset version's master file:
 *   video -> 720p low-bitrate H.264 MP4
 *   audio -> 128k MP3
 *   image -> capped JPG
 *
 * Uses the configured ffmpeg binary when available (`config.ffmpegPath`,
 * `FFMPEG_PATH` env); otherwise falls back to a deterministic mock proxy so
 * the pipeline (queue, version pointers, render preference) works on hosts
 * without ffmpeg. Proxies are regenerable: the version's `proxy_path` is
 * simply re-pointed at a freshly generated file.
 */

import { loadConfig } from "../config.ts";

export type ProxyMediaKind = "video" | "audio" | "image";

export interface ProxyHooks {
  onProgress(progress: number, message: string | null): void;
  isCancelled(): boolean;
}

export interface ProxyResult {
  extension: string;
  mime_type: string;
  engine: "ffmpeg" | "mock";
}

const PROXY_TIMEOUT_MS = 900_000;

/** Classify a version's media type for proxying; null when not proxyable. */
export function proxyKindFor(
  mimeType: string | null,
  assetType: string,
): ProxyMediaKind | null {
  if (mimeType) {
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("image/")) return "image";
  }
  if (assetType === "video") return "video";
  if (assetType === "audio") return "audio";
  if (assetType === "image") return "image";
  return null;
}

/** Probe whether the configured ffmpeg binary answers `-version`. */
export async function isFfmpegAvailable(): Promise<boolean> {
  const config = loadConfig();
  try {
    const child = new Deno.Command(config.ffmpegPath, {
      args: ["-version"],
      stdout: "null",
      stderr: "null",
    }).spawn();
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }, 10_000);
    const status = await child.status;
    clearTimeout(timer);
    return status.success;
  } catch {
    return false;
  }
}

/** Build the ffmpeg args for a proxy transcode (also used by tests). */
export function ffmpegArgs(
  kind: ProxyMediaKind,
  sourcePath: string,
  outPath: string,
): string[] {
  const base = ["-v", "error", "-y", "-i", sourcePath];
  switch (kind) {
    case "video":
      return [
        ...base,
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        outPath,
      ];
    case "audio":
      return [...base, "-c:a", "libmp3lame", "-b:a", "128k", outPath];
    case "image":
      return [
        ...base,
        "-vf",
        "scale=1280:1280:force_original_aspect_ratio=decrease",
        "-q:v",
        "4",
        outPath,
      ];
  }
}

function mockProxy(seed: string, kind: ProxyMediaKind): {
  content: Uint8Array;
  extension: string;
  mime_type: string;
} {
  const meta = {
    video: { extension: "mp4", mime_type: "video/mp4" },
    audio: { extension: "mp3", mime_type: "audio/mpeg" },
    image: { extension: "jpg", mime_type: "image/jpeg" },
  }[kind];
  const marker = new TextEncoder().encode(
    `MOCKPROXY:${kind}:${seed}`.slice(0, 64),
  );
  const content = new Uint8Array(1024);
  content.set(marker, 0);
  for (let i = marker.length; i < content.length; i++) {
    content[i] = (i * 31 + seed.length) & 0xff;
  }
  return { content, extension: meta.extension, mime_type: meta.mime_type };
}

/**
 * Generate a proxy for `sourcePath` and write it to `outPath`.
 * Throws on failure; the caller decides terminal job state.
 */
export async function generateProxyMedia(
  sourcePath: string,
  kind: ProxyMediaKind,
  outPath: string,
  seed: string,
  hooks: ProxyHooks,
): Promise<ProxyResult> {
  hooks.onProgress(10, `Generating ${kind} proxy`);
  if (hooks.isCancelled()) throw new Error("Proxy generation cancelled");

  if (!(await isFfmpegAvailable())) {
    const mock = mockProxy(seed, kind);
    await Deno.writeFile(outPath, mock.content);
    hooks.onProgress(100, "Mock proxy generated");
    return { extension: mock.extension, mime_type: mock.mime_type, engine: "mock" };
  }

  const config = loadConfig();
  const child = new Deno.Command(config.ffmpegPath, {
    args: ffmpegArgs(kind, sourcePath, outPath),
    stdout: "null",
    stderr: "piped",
  }).spawn();
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // already exited
    }
  }, PROXY_TIMEOUT_MS);
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

  void new Response(child.stderr).arrayBuffer().catch(() => {});

  try {
    const status = await child.status;
    if (hooks.isCancelled()) throw new Error("Proxy generation cancelled");
    if (!status.success) {
      throw new Error(`ffmpeg proxy generation failed (exit ${status.code})`);
    }
    await Deno.stat(outPath);
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }

  const meta = {
    video: { extension: "mp4", mime_type: "video/mp4" },
    audio: { extension: "mp3", mime_type: "audio/mpeg" },
    image: { extension: "jpg", mime_type: "image/jpeg" },
  }[kind];
  hooks.onProgress(100, "Proxy generated");
  return { extension: meta.extension, mime_type: meta.mime_type, engine: "ffmpeg" };
}
