import { loadConfig } from "../config.ts";

export interface Waveform {
  bucket_count: number;
  peaks: number[];
}

export interface AudioAnalysis {
  duration: number | null;
  sample_rate: number | null;
  channels: number | null;
  bit_rate: number | null;
  waveform: Waveform | null;
  analysis_status: "analyzed" | "unavailable" | "failed";
  analysis_error: string | null;
}

export interface AudioAdjustments {
  trim?: { start: number; end: number };
  gain_db?: number;
}

export const WAVEFORM_BUCKETS = 200;

interface ProbeInfo {
  duration: number | null;
  sample_rate: number | null;
  channels: number | null;
  bit_rate: number | null;
}

async function runFfprobe(filePath: string): Promise<ProbeInfo | null> {
  const config = loadConfig();
  try {
    const child = new Deno.Command(config.ffprobePath, {
      args: [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }, 20_000);
    const stdout = await new Response(child.stdout).arrayBuffer();
    const status = await child.status;
    clearTimeout(timer);
    if (!status.success) return null;
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(stdout))) as {
      format?: {
        duration?: string;
        bit_rate?: string;
      };
      streams?: {
        sample_rate?: string;
        channels?: number;
        codec_type?: string;
      }[];
    };
    const stream = (json.streams ?? []).find((s) => s.codec_type === "audio") ??
      json.streams?.[0];
    return {
      duration: json.format?.duration ? Number(json.format.duration) : null,
      sample_rate: stream?.sample_rate ? Number(stream.sample_rate) : null,
      channels: stream?.channels ?? null,
      bit_rate: json.format?.bit_rate ? Number(json.format.bit_rate) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Decode to mono s16le and compute peak amplitude per bucket. Pure JS after
 * decoding, so the result is deterministic for a given file.
 */
async function computeWaveform(filePath: string): Promise<Waveform | null> {
  const config = loadConfig();
  try {
    const child = new Deno.Command(config.ffmpegPath, {
      args: [
        "-v",
        "error",
        "-i",
        filePath,
        "-f",
        "s16le",
        "-ar",
        "8000",
        "-ac",
        "1",
        "-",
      ],
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }, 30_000);
    const buffer = await new Response(child.stdout).arrayBuffer();
    const status = await child.status;
    clearTimeout(timer);
    if (!status.success || buffer.byteLength < 2) return null;

    const view = new DataView(buffer);
    const samples = view.byteLength / 2;
    const peaks: number[] = [];
    for (let bucket = 0; bucket < WAVEFORM_BUCKETS; bucket++) {
      const from = Math.floor((bucket * samples) / WAVEFORM_BUCKETS);
      const to = Math.max(from + 1, Math.floor(((bucket + 1) * samples) / WAVEFORM_BUCKETS));
      let peak = 0;
      for (let i = from; i < to && i * 2 + 1 < view.byteLength; i++) {
        const sample = Math.abs(view.getInt16(i * 2, true));
        if (sample > peak) peak = sample;
      }
      peaks.push(Number((peak / 32767).toFixed(4)));
    }
    return { bucket_count: WAVEFORM_BUCKETS, peaks };
  } catch {
    return null;
  }
}

/**
 * Best-effort analysis via the configured ffmpeg/ffprobe binary. When the
 * binary is missing or fails, callers still get a usable (null) analysis so
 * uploads never require ffmpeg.
 */
export async function analyzeAudioFile(filePath: string): Promise<AudioAnalysis> {
  const config = loadConfig();
  const probe = await runFfprobe(filePath);
  const waveform = await computeWaveform(filePath);
  if (!probe && !waveform) {
    return unavailable(config.ffmpegPath);
  }
  return {
    duration: probe?.duration ?? null,
    sample_rate: probe?.sample_rate ?? null,
    channels: probe?.channels ?? null,
    bit_rate: probe?.bit_rate ?? null,
    waveform,
    analysis_status: "analyzed",
    analysis_error: null,
  };
}

function unavailable(binary: string): AudioAnalysis {
  return {
    duration: null,
    sample_rate: null,
    channels: null,
    bit_rate: null,
    waveform: null,
    analysis_status: "unavailable",
    analysis_error: `ffprobe/ffmpeg not available (configured: '${binary}')`,
  };
}

export function buildAudioMetadata(analysis: AudioAnalysis): Record<string, unknown> {
  return {
    audio: {
      duration: analysis.duration,
      sample_rate: analysis.sample_rate,
      channels: analysis.channels,
      bit_rate: analysis.bit_rate,
      waveform: analysis.waveform,
      analysis_status: analysis.analysis_status,
      analysis_error: analysis.analysis_error,
      adjustments: {},
    },
  };
}

export function validateAdjustments(
  body: Record<string, unknown>,
  duration: number | null,
): AudioAdjustments {
  const adjustments: AudioAdjustments = {};
  const trim = body.trim;
  if (trim !== undefined) {
    if (typeof trim !== "object" || trim === null || Array.isArray(trim)) {
      throw new AudioAdjustmentError("trim must be an object with start and end");
    }
    const t = trim as Record<string, unknown>;
    const start = t.start;
    const end = t.end;
    if (
      typeof start !== "number" || typeof end !== "number" ||
      !Number.isFinite(start) || !Number.isFinite(end)
    ) {
      throw new AudioAdjustmentError("trim.start and trim.end must be numbers");
    }
    if (start < 0 || end <= start) {
      throw new AudioAdjustmentError("trim requires 0 <= start < end");
    }
    if (duration !== null && end > duration + 1e-6) {
      throw new AudioAdjustmentError(
        `trim.end (${end}) exceeds the known duration (${duration})`,
      );
    }
    adjustments.trim = { start, end };
  }
  const gain = body.gain_db;
  if (gain !== undefined) {
    if (typeof gain !== "number" || !Number.isFinite(gain) || gain < -60 || gain > 24) {
      throw new AudioAdjustmentError("gain_db must be a number between -60 and 24");
    }
    adjustments.gain_db = gain;
  }
  return adjustments;
}

export class AudioAdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioAdjustmentError";
  }
}
