import { join } from "@std/path";
import { loadConfig } from "../config.ts";
import type { RenderPreset } from "../db/renders.ts";

export interface RenderInputItem {
  file_path: string;
  /** Whether this item renders from its proxy (draft) or master (final) media. */
  source?: "proxy" | "master";
  start_time: number;
  end_time: number;
  duration: number;
  /** Offset into the source where the item begins (seconds). */
  source_offset?: number;
  /** Playback speed (1 = normal). */
  speed?: number;
  /**
   * Whether the item plays to the end of its source (from
   * `source_offset` to EOF). The lossless concat path can only splice
   * whole files, so a tail-trimmed item (`false`) requires the fx pass for
   * a frame-accurate cut. `undefined` means unknown and keeps the legacy
   * concat behavior; `buildPlan` probes the source for the real value.
   */
  consumes_full_source?: boolean;
  /** Blend between this item and the one preceding it. */
  transition: string;
  transition_duration: number;
  fade_in: number;
  fade_out: number;
  color_grade: Record<string, number> | null;
}

/** An audio-track item placed on the timeline; mixed into the output by the fx pass. */
export interface RenderAudioItem {
  file_path: string;
  /** Whether this item renders from its proxy (draft) or master (final) media. */
  source?: "proxy" | "master";
  /** Timeline position of the item (seconds). */
  start_time: number;
  end_time: number;
  /** Timeline duration of the item (seconds). */
  duration: number;
  /** Source position where the item begins (seconds; clamped by version trim). */
  source_offset: number;
  /** Source seconds consumed, before speed is applied (clamped by version trim). */
  source_duration: number;
  /** Playback speed (1 = normal). */
  speed: number;
  /** Linear gain multiplier (10^(gain_db/20) of the version's adjustment). */
  gain: number;
  fade_in: number;
  fade_out: number;
  /**
   * Ducking (AUD-013): lower this item by this many dB inside
   * `duck_windows` (item-local, merged, in seconds). Set by the plan builder
   * on music-track items that overlap rendered dialogue.
   */
  duck_db?: number;
  duck_windows?: { start: number; end: number }[];
}

/** Text/subtitle overlay drawn on top of the video during the fx pass. */
export interface RenderTextOverlay {
  start_time: number;
  end_time: number;
  duration: number;
  text: string;
  style: Record<string, unknown> | null;
}

/** True when any item carries per-item fx that force a re-encoding render. */
export function planHasFx(items: RenderInputItem[]): boolean {
  return items.some(
    (i) =>
      i.transition !== "cut" ||
      i.fade_in > 0 ||
      i.fade_out > 0 ||
      (i.color_grade !== null && Object.keys(i.color_grade).length > 0),
  );
}

export interface RenderPlan {
  output_path: string;
  filename: string;
  format: string;
  preset: RenderPreset | null;
  items: RenderInputItem[];
  text_overlays: RenderTextOverlay[];
  audio_items?: RenderAudioItem[];
  total_duration: number;
}

/** True when an item trims into its source or plays at a non-normal speed. */
export function itemNeedsSourceEdit(
  item: Pick<RenderInputItem, "source_offset" | "speed">,
): boolean {
  return (item.source_offset ?? 0) > 0 || (item.speed ?? 1) !== 1;
}

/**
 * True when a preset's encode profile differs from the legacy default
 * (libx264 veryfast CRF 20 8-bit + AAC) — such presets (archival master,
 * HDR HEVC) must go through the re-encoding fx pass even on fx-free
 * timelines, because the lossless concat path stream-copies whatever the
 * sources were encoded with.
 */
export function presetRequiresReencode(preset: RenderPreset | null): boolean {
  return (
    (preset?.codec ?? "h264").toLowerCase() !== "h264" ||
    presetEncodeProfile(preset) !== presetEncodeProfile(null)
  );
}

/**
 * True when the plan needs the re-encoding fx pass: per-item fx, text
 * overlays, audio-track placement, per-item source edits (the lossless
 * concat path can only splice whole video files and cannot cut a
 * tail-trimmed item frame-accurately), or a preset whose encode profile
 * differs from the stream-copied default.
 */
export function planNeedsFxPass(plan: RenderPlan): boolean {
  return (
    planHasFx(plan.items) ||
    plan.text_overlays.length > 0 ||
    (plan.audio_items?.length ?? 0) > 0 ||
    plan.items.some(itemNeedsSourceEdit) ||
    plan.items.some((i) => i.consumes_full_source === false) ||
    presetRequiresReencode(plan.preset)
  );
}

export interface RenderHooks {
  onProgress(progress: number): void;
  isCancelled(): boolean;
}

export interface RenderResult {
  output_path: string;
  file_size: number;
  ticks: number;
}

export interface RenderEngine {
  readonly name: string;
  render(plan: RenderPlan, hooks: RenderHooks): Promise<RenderResult>;
}

export class RenderCancelledError extends Error {
  constructor() {
    super("Render cancelled");
    this.name = "RenderCancelledError";
  }
}

export class RenderFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderFailedError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function checkCancelled(hooks: RenderHooks): void {
  if (hooks.isCancelled()) throw new RenderCancelledError();
}

// ---------------------------------------------------------------------------
// ffmpeg machine-readable progress (`-progress pipe:1`)
// ---------------------------------------------------------------------------

/**
 * Parse state for ffmpeg `-progress pipe:1` output. `out_time_us` (ffmpeg
 * >= 5.1) is preferred over the coarser `out_time_ms`; the committed
 * `out_time_sec` updates at each block boundary (`progress=continue|end`).
 */
export interface FfmpegProgressState {
  out_time_sec: number;
  done: boolean;
  block_us: number | null;
  block_ms: number | null;
}

export function newFfmpegProgressState(): FfmpegProgressState {
  return { out_time_sec: 0, done: false, block_us: null, block_ms: null };
}

/** Consume one line of `-progress pipe:1` output into the state. */
export function consumeFfmpegProgressLine(state: FfmpegProgressState, line: string): void {
  const eq = line.indexOf("=");
  if (eq <= 0) return;
  const key = line.slice(0, eq);
  const value = line.slice(eq + 1);
  if (key === "out_time_us") {
    state.block_us = Number(value);
  } else if (key === "out_time_ms") {
    state.block_ms = Number(value);
  } else if (key === "progress") {
    if (value === "end") state.done = true;
    if (state.block_us !== null) {
      state.out_time_sec = state.block_us / 1e6;
    } else if (state.block_ms !== null) {
      state.out_time_sec = state.block_ms / 1e3;
    }
    state.block_us = null;
    state.block_ms = null;
  }
}

/**
 * Map ffmpeg's out_time into the band reserved for the child process:
 * [base, 90]. `base` is the milestone reported before spawn; 90/100 are the
 * post-completion milestones (output stat + finish). Returns null while
 * there is nothing to report yet (no out_time or no usable estimate).
 */
export function mapFfmpegProgress(
  outTimeSec: number,
  estimatedDurationSec: number,
  base: number,
): number | null {
  if (!Number.isFinite(outTimeSec) || outTimeSec <= 0) return null;
  if (!Number.isFinite(estimatedDurationSec) || estimatedDurationSec <= 0) return null;
  const frac = Math.min(1, outTimeSec / estimatedDurationSec);
  return base + frac * (90 - base);
}

// ---------------------------------------------------------------------------
// ffmpeg engine: concat of the timeline's video items (-c copy)
// ---------------------------------------------------------------------------

/** xfade transition name for each supported timeline transition. */
const XFADE_NAMES: Record<string, string> = {
  fade: "fade",
  dissolve: "dissolve",
  wipeleft: "wipeleft",
  wiperight: "wiperight",
  slideleft: "slideleft",
  slideright: "slideright",
};

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/**
 * `atempo` chain for an arbitrary positive speed: each atempo stage accepts
 * 0.5-100.0, so extreme speeds are split into repeated stages (rounded to
 * dodge float drift like 0.5*0.5*8 -> 1.999999).
 */
export function buildAtempoFilters(speed: number): string[] {
  if (!Number.isFinite(speed) || speed <= 0) return [];
  let remaining = speed;
  if (Math.abs(remaining - 1) < 1e-9) return [];
  const filters: string[] = [];
  while (remaining < 0.5 - 1e-9 || remaining > 100 + 1e-9) {
    const step = remaining < 1 ? 0.5 : 100;
    filters.push(`atempo=${step}`);
    remaining = round4(remaining / step);
  }
  if (Math.abs(remaining - 1) < 1e-9) return filters;
  filters.push(`atempo=${round4(remaining)}`);
  return filters;
}

/** Escape text for use inside a single-quoted ffmpeg filter argument. */
function escapeFilterText(text: string): string {
  return text.replace(/'/g, "''");
}

/** One `drawtext` filter stage for a text overlay (defaults: 24, white, bottom). */
export function buildDrawTextFilter(overlay: RenderTextOverlay): string {
  const style = overlay.style ?? {};
  const size = typeof style.font_size === "number" ? style.font_size : 24;
  const color = typeof style.font_color === "string" ? style.font_color : "white";
  const margin = typeof style.margin === "number" ? style.margin / 100 : 0.05;
  const position: string = style.position === "top" || style.position === "middle"
    ? style.position
    : "bottom";
  const y = position === "top"
    ? `h*${margin}`
    : position === "middle"
    ? "(h-text_h)/2"
    : `h-text_h-h*${margin}`;
  return `drawtext=text='${escapeFilterText(overlay.text)}':fontsize=${size}` +
    `:fontcolor=${color}:x=(w-text_w)/2:y=${y}` +
    `:enable='between(t,${round2(overlay.start_time)},${round2(overlay.end_time)})'`;
}

/**
 * Frame-evaluated `volume` filter expression implementing ducking (AUD-013):
 * full gain except inside the item-local windows, where the level drops by
 * `duckDb` dB. Multiple (merged) windows are summed and clipped so the
 * expression stays one term regardless of window count.
 */
export function duckVolumeExpr(
  duckDb: number,
  windows: { start: number; end: number }[],
): string | null {
  if (!Number.isFinite(duckDb) || duckDb <= 0 || windows.length === 0) return null;
  const d = round4(Math.pow(10, -duckDb / 20));
  const terms = windows
    .map((w) => `between(t,${round4(w.start)},${round4(w.end)})`)
    .join("+");
  return `1-(1-${d})*clip(${terms},0,1)`;
}

// ---------------------------------------------------------------------------
// Preset video/audio encode args (advanced exports, MS-8)
// ---------------------------------------------------------------------------

/**
 * The ffmpeg encoder a preset's video stream goes through when the fx pass
 * re-encodes. `hevc` presets need libx265 in the ffmpeg build; the
 * FfmpegRenderEngine checks availability before rendering and fails the job
 * with a clear error instead of a mid-render ffmpeg crash.
 */
export function requiredVideoEncoder(preset: RenderPreset | null): string {
  return (preset?.codec ?? "h264").toLowerCase() === "hevc" ? "libx265" : "libx264";
}

interface EncodeSettings {
  crf: number;
  preset: string;
  pix_fmt: string;
  color?: { primaries?: string; transfer?: string; space?: string };
}

function presetEncodeSettings(preset: RenderPreset | null): EncodeSettings {
  const s = (preset?.settings ?? {}) as Record<string, unknown>;
  const hevc = (preset?.codec ?? "").toLowerCase() === "hevc";
  const color = s.color && typeof s.color === "object"
    ? (s.color as EncodeSettings["color"])
    : undefined;
  return {
    crf: typeof s.crf === "number" ? s.crf : 20,
    preset: typeof s.preset === "string" && s.preset ? s.preset : "veryfast",
    pix_fmt: typeof s.pix_fmt === "string" && s.pix_fmt
      ? s.pix_fmt
      : hevc
      ? "yuv420p10le"
      : "yuv420p",
    color,
  };
}

/**
 * Video encoder args for the fx pass from the plan's preset. Defaults
 * reproduce the legacy hardcoded settings (libx264 veryfast CRF 20 8-bit);
 * advanced presets may raise quality (archival master) or switch to 10-bit
 * wide-gamut HEVC (HDR preset) with BT.2020 color metadata.
 */
export function videoEncodeArgs(preset: RenderPreset | null): string[] {
  const hevc = requiredVideoEncoder(preset) === "libx265";
  const args: string[] = ["-c:v", hevc ? "libx265" : "libx264"];
  if (hevc) args.push("-tag:v", "hvc1");
  const s = presetEncodeSettings(preset);
  args.push("-preset", s.preset, "-crf", String(s.crf), "-pix_fmt", s.pix_fmt);
  if (s.color) {
    if (s.color.primaries) args.push("-color_primaries", s.color.primaries);
    if (s.color.transfer) args.push("-color_trc", s.color.transfer);
    if (s.color.space) args.push("-colorspace", s.color.space);
  }
  return args;
}

/**
 * Per-audio-item filter chain (shared by the fx and audio-only passes):
 * trim the source window, reset timestamps, apply speed, static gain, duck
 * (when the plan carries duck windows) and fades, then silence the item into
 * its timeline slot.
 */
export function buildAudioItemChain(audio: RenderAudioItem): string[] {
  const chain: string[] = [
    `atrim=start=${round4(audio.source_offset)}:end=${
      round4(audio.source_offset + audio.source_duration)
    }`,
    "asetpts=PTS-STARTPTS",
    ...buildAtempoFilters(audio.speed),
  ];
  if (Math.abs(audio.gain - 1) > 1e-9) chain.push(`volume=${round4(audio.gain)}`);
  const duck = duckVolumeExpr(audio.duck_db ?? 0, audio.duck_windows ?? []);
  if (duck) chain.push(`volume='${duck}':eval=frame`);
  if (audio.fade_in > 0) {
    chain.push(`afade=t=in:st=0:d=${round2(audio.fade_in)}`);
  }
  if (audio.fade_out > 0) {
    const st = Math.max(0, round2(audio.duration - audio.fade_out));
    chain.push(`afade=t=out:st=${st}:d=${round2(audio.fade_out)}`);
  }
  chain.push(`adelay=${Math.round(audio.start_time * 1000)}:all=1`);
  return chain;
}

/**
 * Build the ffmpeg command for a plan whose items carry per-item fx
 * (transitions, fades, color grade, source trimming, speed) or text
 * overlays: one input per item, a filter graph that trims, grades and fades
 * each video input, pairwise `xfade` (real transitions) or `concat` (hard
 * cuts) between consecutive items, and a final `drawtext` stage per text
 * overlay. Audio-track items become additional inputs, each trimmed, speed-
 * adjusted, gain-scaled, ducked (AUD-013) and faded, then silenced into its
 * timeline slot via `adelay` and summed with `amix` (no normalization) onto
 * the output. Re-encodes with the preset's encoder settings (H.264 defaults,
 * or 10-bit wide-gamut HEVC for HDR presets; + AAC when audio is mixed).
 */
export function buildFxArgs(
  items: RenderInputItem[],
  textOverlays: RenderTextOverlay[],
  outputPath: string,
  audioItems: RenderAudioItem[] = [],
  preset: RenderPreset | null = null,
): string[] {
  const args: string[] = ["-v", "error", "-y"];
  for (const item of items) args.push("-i", item.file_path);
  for (const audio of audioItems) args.push("-i", audio.file_path);

  const filters: string[] = [];
  for (const [i, item] of items.entries()) {
    const chain: string[] = [];
    if (itemNeedsSourceEdit(item)) {
      const so = item.source_offset ?? 0;
      const speed = item.speed ?? 1;
      const srcEnd = round4(so + item.duration / speed);
      chain.push(
        `trim=start=${round4(so)}:end=${srcEnd}`,
        `setpts=(PTS-STARTPTS)/${round4(speed)}`,
      );
    }
    const grade = item.color_grade ?? {};
    if (
      grade.brightness !== undefined || grade.contrast !== undefined ||
      grade.saturation !== undefined
    ) {
      chain.push(
        `eq=brightness=${grade.brightness ?? 0}` +
          `:contrast=${grade.contrast ?? 1}:saturation=${grade.saturation ?? 1}`,
      );
    }
    if (grade.temperature !== undefined && grade.temperature !== 0) {
      chain.push(
        `colortemperature=temperature=${Math.round(6500 + grade.temperature * 2500)}`,
      );
    }
    if (item.fade_in > 0) {
      chain.push(`fade=t=in:st=0:d=${round2(item.fade_in)}`);
    }
    if (item.fade_out > 0) {
      const st = Math.max(0, round2(item.duration - item.fade_out));
      chain.push(`fade=t=out:st=${st}:d=${round2(item.fade_out)}`);
    }
    filters.push(`[${i}:v]${chain.join(",")}[v${i}]`);
  }

  let acc = round2(items[0].duration);
  let prev = "[v0]";
  for (let i = 1; i < items.length; i++) {
    const next = items[i];
    if (next.transition !== "cut") {
      const td = Math.max(
        0.02,
        Math.min(next.transition_duration, round2(acc - 0.02), round2(next.duration - 0.02)),
      );
      const offset = round2(acc - td);
      filters.push(
        `${prev}[v${i}]xfade=transition=${XFADE_NAMES[next.transition] ?? "fade"}` +
          `:duration=${td}:offset=${offset}[x${i}]`,
      );
      acc = round2(acc + next.duration - td);
    } else {
      filters.push(`${prev}[v${i}]concat=n=2:v=1:a=0[x${i}]`);
      acc = round2(acc + next.duration);
    }
    prev = `[x${i}]`;
  }

  let finalLabel = prev;
  if (textOverlays.length > 0) {
    const textFilters = textOverlays.map((o) => buildDrawTextFilter(o));
    filters.push(`${prev}${textFilters.join(",")}[out]`);
    finalLabel = "[out]";
  }

  if (audioItems.length > 0) {
    // Each audio item: see buildAudioItemChain (trim, speed, gain, duck,
    // fades, slot delay).
    audioItems.forEach((audio, k) => {
      const input = items.length + k;
      filters.push(`[${input}:a]${buildAudioItemChain(audio).join(",")}[ak${k}]`);
    });
    const mixInputs = audioItems.map((_, k) => `[ak${k}]`).join("");
    // Longest surviving stream wins, no 1/N normalization; the tail is cut
    // back to the video length so the mix never outruns the picture.
    filters.push(
      `${mixInputs}amix=inputs=${audioItems.length}:duration=longest:normalize=0` +
        `,atrim=end=${round2(acc)},asetpts=PTS-STARTPTS[aout]`,
    );
  }

  args.push("-filter_complex", filters.join(";"));
  args.push("-map", finalLabel);
  if (audioItems.length > 0) {
    args.push(
      "-map",
      "[aout]",
      "-c:a",
      (preset?.audio_codec ?? "aac").toLowerCase(),
      "-b:a",
      "192k",
    );
  } else {
    args.push("-an");
  }
  // Video encode settings from the preset (H.264 defaults, or the
  // archival-master / HDR encodes).
  args.push(...videoEncodeArgs(preset));
  args.push(outputPath);
  return args;
}

/**
 * Audio-only export (wav presets): the audio-track mix with per-item source
 * window, speed, gain and fades, delayed into its timeline slot. There is no
 * picture and no tail cut to a video length — the mix plays to the end of
 * its longest item. Output is 16-bit PCM (wav's native encoding).
 */
export function buildAudioArgs(
  audioItems: RenderAudioItem[],
  outputPath: string,
): string[] {
  const args: string[] = ["-v", "error", "-y"];
  for (const audio of audioItems) args.push("-i", audio.file_path);

  const filters: string[] = [];
  audioItems.forEach((audio, k) => {
    filters.push(`[${k}:a]${buildAudioItemChain(audio).join(",")}[ak${k}]`);
  });
  const mixInputs = audioItems.map((_, k) => `[ak${k}]`).join("");
  filters.push(
    `${mixInputs}amix=inputs=${audioItems.length}:duration=longest:normalize=0` +
      ",asetpts=PTS-STARTPTS[aout]",
  );

  args.push("-filter_complex", filters.join(";"));
  args.push("-map", "[aout]", "-vn", "-c:a", "pcm_s16le", outputPath);
  return args;
}

export class FfmpegRenderEngine implements RenderEngine {
  readonly name = "ffmpeg";
  private readonly binary: string;

  constructor(ffmpegPath: string) {
    this.binary = ffmpegPath;
  }

  /** Fast path for fx-free timelines: lossless concat demuxer, stream copy. */
  private async renderConcat(
    plan: RenderPlan,
    hooks: RenderHooks,
  ): Promise<RenderResult> {
    const config = loadConfig();
    const listDir = join(config.appDataDir, "cache");
    try {
      await Deno.mkdir(listDir, { recursive: true });
    } catch {
      // already exists
    }
    const listPath = join(
      listDir,
      `concat-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
    );
    try {
      const lines = plan.items
        .map((item) => `file '${item.file_path.replace(/'/g, `'\\''`)}'`)
        .join("\n");
      await Deno.writeTextFile(listPath, lines + "\n");
      checkCancelled(hooks);
      hooks.onProgress(20);

      await this.runFfmpeg(
        [
          "-v",
          "error",
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c",
          "copy",
          plan.output_path,
        ],
        plan.total_duration,
        20,
        hooks,
      );
      checkCancelled(hooks);
      hooks.onProgress(90);
      const stat = await Deno.stat(plan.output_path);
      hooks.onProgress(100);
      return { output_path: plan.output_path, file_size: stat.size, ticks: 3 };
    } finally {
      await Deno.remove(listPath).catch(() => {});
    }
  }

  /**
   * fx path: filter graph with per-item source edits, grade/fades, xfade
   * transitions, drawtext overlays and the audio-track mix.
   */
  private async renderFx(
    plan: RenderPlan,
    hooks: RenderHooks,
  ): Promise<RenderResult> {
    checkCancelled(hooks);
    hooks.onProgress(10);
    if (plan.format !== "wav") {
      // Fail early when the preset's encoder is missing from this ffmpeg
      // build (e.g. libx265 for the HDR preset) — a clean job failure with a
      // readable error beats a mid-render ffmpeg crash.
      const encoder = requiredVideoEncoder(plan.preset);
      const available = await this.availableEncoders();
      if (available && !available.has(encoder)) {
        throw new RenderFailedError(
          `Required video encoder '${encoder}' is not available in this ffmpeg build; ` +
            "choose a different preset or update ffmpeg",
        );
      }
    }
    const args = buildFxArgs(
      plan.items,
      plan.text_overlays,
      plan.output_path,
      plan.audio_items ?? [],
      plan.preset,
    );
    await this.runFfmpeg(args, plan.total_duration, 10, hooks);
    checkCancelled(hooks);
    hooks.onProgress(90);
    const stat = await Deno.stat(plan.output_path);
    hooks.onProgress(100);
    return { output_path: plan.output_path, file_size: stat.size, ticks: 3 };
  }

  /** wavs render the audio-track mix to 16-bit PCM, no picture at all. */
  private async renderAudio(
    plan: RenderPlan,
    hooks: RenderHooks,
  ): Promise<RenderResult> {
    checkCancelled(hooks);
    hooks.onProgress(10);
    const args = buildAudioArgs(plan.audio_items ?? [], plan.output_path);
    await this.runFfmpeg(args, plan.total_duration, 10, hooks);
    checkCancelled(hooks);
    hooks.onProgress(90);
    const stat = await Deno.stat(plan.output_path);
    hooks.onProgress(100);
    return { output_path: plan.output_path, file_size: stat.size, ticks: 3 };
  }

  private encoderProbe: Set<string> | null | undefined;

  /**
   * Probe `ffmpeg -encoders` once and cache the encoder name set.
   * Returns null when the probe itself fails (treated as "unknown" — the
   * render proceeds and lets ffmpeg report the real error).
   */
  private async availableEncoders(): Promise<Set<string> | null> {
    if (this.encoderProbe !== undefined) return this.encoderProbe;
    try {
      const proc = new Deno.Command(this.binary, {
        args: ["-hide_banner", "-encoders"],
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const bufs: Uint8Array[] = [];
      for await (const chunk of proc.stdout) bufs.push(chunk);
      const outLen = bufs.reduce((n, b) => n + b.byteLength, 0);
      const outBytes = new Uint8Array(outLen);
      let offset = 0;
      for (const b of bufs) {
        outBytes.set(b, offset);
        offset += b.byteLength;
      }
      const out = new TextDecoder().decode(outBytes);
      await proc.status;
      const names = new Set<string>();
      for (const line of out.split("\n")) {
        // Lines look like: ` V..... libx264  libx264 H.264 / AVC ...`
        const m = line.match(/^\s*V\.\S*\s+(\S+)/);
        if (m) names.add(m[1]);
      }
      // A real ffmpeg always lists many encoders; an empty list means the
      // probe output was not what we expected — treat as unknown and let
      // the render proceed (ffmpeg will report the real error).
      if (names.size === 0) {
        this.encoderProbe = null;
        return null;
      }
      this.encoderProbe = names;
      return names;
    } catch {
      this.encoderProbe = null;
      return null;
    }
  }

  /**
   * Spawn ffmpeg with machine-readable progress (`-progress pipe:1`), stream
   * the output into `hooks.onProgress` mapped into [base, 90], poll
   * cancellation per output chunk (killing the process when set) and enforce
   * the 5-minute watchdog. Throws RenderFailedError on a non-zero exit.
   */
  private async runFfmpeg(
    args: string[],
    estimatedDurationSec: number,
    base: number,
    hooks: RenderHooks,
  ): Promise<void> {
    const child = new Deno.Command(this.binary, {
      args: ["-nostats", "-progress", "pipe:1", ...args],
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const watchdog = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }, 300_000);
    // Cancellation poll: kill the process promptly even when ffmpeg produces
    // no further stdout (the read loop below only advances on chunks).
    const cancelPoller = setInterval(() => {
      if (hooks.isCancelled()) {
        try {
          child.kill("SIGKILL");
        } catch {
          // already exited
        }
      }
    }, 250);
    const stderrPromise = new Response(child.stderr).text();
    const statusPromise = child.status;
    const state = newFfmpegProgressState();
    let lastReported = base;
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // Race the read against process exit: a killed ffmpeg may have spawned
    // helpers that keep the stdout pipe open, so EOF would never arrive on
    // its own.
    type Settled =
      | { kind: "chunk"; value: Uint8Array }
      | { kind: "end" }
      | { kind: "read-error"; error: unknown }
      | { kind: "exit" };
    try {
      for (;;) {
        const settled: Settled = await Promise.race([
          reader.read().then(
            (r): Settled => (r.done ? { kind: "end" } : { kind: "chunk", value: r.value }),
            (error: unknown): Settled => ({ kind: "read-error", error }),
          ),
          statusPromise.then((): Settled => ({ kind: "exit" })),
        ]);
        if (settled.kind === "read-error") throw settled.error;
        if (settled.kind !== "chunk") break;
        buffer += decoder.decode(settled.value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          consumeFfmpegProgressLine(state, line);
          const mapped = mapFfmpegProgress(state.out_time_sec, estimatedDurationSec, base);
          if (mapped !== null) {
            const pct = Math.min(90, Math.floor(mapped));
            if (pct > lastReported) {
              lastReported = pct;
              hooks.onProgress(pct);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    try {
      const status = await statusPromise;
      const stderr = await stderrPromise;
      if (hooks.isCancelled()) throw new RenderCancelledError();
      if (!status.success) {
        throw new RenderFailedError(
          `ffmpeg exited with ${status.code}: ${stderr.slice(0, 500)}`,
        );
      }
    } finally {
      clearTimeout(watchdog);
      clearInterval(cancelPoller);
    }
  }

  render(plan: RenderPlan, hooks: RenderHooks): Promise<RenderResult> {
    checkCancelled(hooks);
    hooks.onProgress(5);
    if (plan.format === "wav") return this.renderAudio(plan, hooks);
    return planNeedsFxPass(plan) ? this.renderFx(plan, hooks) : this.renderConcat(plan, hooks);
  }
}

// ---------------------------------------------------------------------------
// mock engine: deterministic placeholder output (tests / no ffmpeg)
// ---------------------------------------------------------------------------

function xorshift(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

function seedFromText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Stable serialization of the per-item fx carried on a plan (source edits,
 * transitions, grades, text overlays, audio placement); mixed into the mock
 * engine's seed so different fx produce different output bytes.
 */
/**
 * Canonical description of a preset's encode profile (encoder settings +
 * audio codec). Part of the mock engine's seed so renders of the same
 * timeline with different presets produce different bytes, and re-renders
 * with the same preset stay byte-identical.
 */
export function presetEncodeProfile(preset: RenderPreset | null): string {
  const s = presetEncodeSettings(preset);
  const color = s.color
    ? `:${s.color.primaries ?? "-"}:${s.color.transfer ?? "-"}:${s.color.space ?? "-"}`
    : "";
  return `${requiredVideoEncoder(preset)}:${s.crf}:${s.preset}:${s.pix_fmt}${color}` +
    `:${(preset?.audio_codec ?? "aac").toLowerCase()}`;
}

export function fxFingerprint(
  items: RenderInputItem[],
  textOverlays: RenderTextOverlay[] = [],
  audioItems: RenderAudioItem[] = [],
  preset: RenderPreset | null = null,
): string {
  const itemPart = items
    .map((i) =>
      `${i.source ?? "master"}:${i.source_offset ?? 0}:${i.speed ?? 1}:${i.transition}` +
      `:${i.transition_duration}:${i.fade_in}:${i.fade_out}:${
        JSON.stringify(i.color_grade ?? null)
      }`
    )
    .join("|");
  const overlayPart = textOverlays
    .map((o) => `${o.start_time}-${o.end_time}:${o.text}:${JSON.stringify(o.style ?? null)}`)
    .join("|");
  const audioPart = audioItems
    .map((a) => {
      const duck = a.duck_windows?.length
        ? `${a.duck_db}:${a.duck_windows.map((w) => `${w.start}-${w.end}`).join(";")}`
        : "off";
      return `${a.source ?? "master"}:${a.start_time}-${a.end_time}:${a.source_offset}` +
        `:${a.source_duration}:${a.speed}:${a.gain}:${a.fade_in}:${a.fade_out}:${duck}`;
    })
    .join("|");
  const tail = [overlayPart, audioPart, presetEncodeProfile(preset)]
    .filter((p) => p !== "")
    .join("##");
  return tail === "" ? itemPart : `${itemPart}##${tail}`;
}

/**
 * Produces a deterministic placeholder file so the full render pipeline
 * (queue, engine, validation, export record, provenance) works without
 * ffmpeg. Bytes are content-addressed on the plan (format, duration and fx
 * fingerprint), so re-renders of an unchanged timeline are byte-identical
 * and deduplicate in the content store. For mp4 the bytes are a placeholder
 * container; for wav a valid minimal PCM header + silence.
 */
export class MockRenderEngine implements RenderEngine {
  readonly name = "mock";

  async render(plan: RenderPlan, hooks: RenderHooks): Promise<RenderResult> {
    const rand = xorshift(
      seedFromText(
        plan.format + plan.total_duration +
          fxFingerprint(
            plan.items,
            plan.text_overlays,
            plan.audio_items ?? [],
            plan.preset,
          ),
      ),
    );
    const chunks: number[] = [];
    const targetBytes = Math.max(4096, Math.min(1 << 20, Math.ceil(plan.total_duration * 8000)));
    for (let i = 0; i < targetBytes; i++) {
      chunks.push(rand() & 0xff);
    }
    const bytes = new Uint8Array(chunks);

    if (plan.format === "wav") {
      // Replace content with a valid minimal WAV (header + silence).
      const sampleRate = 8000;
      const n = Math.max(1, Math.floor(plan.total_duration * sampleRate));
      const dataSize = n * 2;
      const buf = new ArrayBuffer(44 + dataSize);
      const view = new DataView(buf);
      const writeStr = (offset: number, s: string) => {
        for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      view.setUint32(4, 36 + dataSize, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeStr(36, "data");
      view.setUint32(40, dataSize, true);
      await Deno.writeFile(plan.output_path, new Uint8Array(buf));
      checkCancelled(hooks);
      hooks.onProgress(100);
      return {
        output_path: plan.output_path,
        file_size: buf.byteLength,
        ticks: 4,
      };
    }

    for (let tick = 1; tick <= 4; tick++) {
      await sleep(5);
      checkCancelled(hooks);
      await Deno.writeFile(plan.output_path, bytes);
      hooks.onProgress(tick * 25);
    }
    return {
      output_path: plan.output_path,
      file_size: bytes.byteLength,
      ticks: 4,
    };
  }
}

// ---------------------------------------------------------------------------
// Engine selection
// ---------------------------------------------------------------------------

let cachedEngine: RenderEngine | null = null;

export function getRenderEngine(): RenderEngine {
  if (cachedEngine) return cachedEngine;
  const forced = Deno.env.get("RENDER_ENGINE");
  const config = loadConfig();
  if (forced === "mock") {
    cachedEngine = new MockRenderEngine();
  } else if (forced === "ffmpeg") {
    cachedEngine = new FfmpegRenderEngine(config.ffmpegPath);
  } else {
    // auto: prefer the configured binary, fall back to mock.
    cachedEngine = hasFfmpeg(config.ffmpegPath)
      ? new FfmpegRenderEngine(config.ffmpegPath)
      : new MockRenderEngine();
  }
  return cachedEngine;
}

/** Test hook: force a specific engine. */
export function setRenderEngine(engine: RenderEngine | null): void {
  cachedEngine = engine;
}

function hasFfmpeg(binary: string): boolean {
  try {
    // Quick synchronous-style check via Deno.Command spawn; a missing binary
    // fails fast.
    const child = new Deno.Command(binary, {
      args: ["-version"],
      stdout: "null",
      stderr: "null",
    }).spawn();
    child.kill("SIGKILL");
    return true;
  } catch {
    return false;
  }
}
