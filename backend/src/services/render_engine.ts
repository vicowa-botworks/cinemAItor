import { join } from "@std/path";
import { loadConfig } from "../config.ts";
import type { RenderPreset } from "../db/renders.ts";

export interface RenderInputItem {
  file_path: string;
  start_time: number;
  end_time: number;
  duration: number;
  /** Blend between this item and the one preceding it. */
  transition: string;
  transition_duration: number;
  fade_in: number;
  fade_out: number;
  color_grade: Record<string, number> | null;
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
  total_duration: number;
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

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Build the ffmpeg command for a plan whose items carry per-item fx
 * (transitions, fades, color grade): one input per item, a filter graph that
 * grades and fades each video input, and pairwise `xfade` (real transitions)
 * or `concat` (hard cuts) between consecutive items. Re-encodes to H.264.
 *
 * The fx pass is video-only (`-an`): per-track audio placement is a separate
 * render concern not yet modelled in the plan.
 */
export function buildFxArgs(items: RenderInputItem[], outputPath: string): string[] {
  const args: string[] = ["-v", "error", "-y"];
  for (const item of items) args.push("-i", item.file_path);

  const filters: string[] = [];
  for (const [i, item] of items.entries()) {
    const chain: string[] = [];
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

  args.push("-filter_complex", filters.join(";"));
  args.push("-map", prev);
  args.push("-an");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p");
  args.push(outputPath);
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

      const child = new Deno.Command(this.binary, {
        args: [
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
        stdout: "null",
        stderr: "piped",
      }).spawn();
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already exited
        }
      }, 300_000);
      const stderr = await new Response(child.stderr).text();
      const status = await child.status;
      clearTimeout(timer);
      checkCancelled(hooks);
      if (!status.success) {
        throw new RenderFailedError(
          `ffmpeg exited with ${status.code}: ${stderr.slice(0, 500)}`,
        );
      }
      hooks.onProgress(90);
      const stat = await Deno.stat(plan.output_path);
      hooks.onProgress(100);
      return { output_path: plan.output_path, file_size: stat.size, ticks: 3 };
    } finally {
      await Deno.remove(listPath).catch(() => {});
    }
  }

  /** fx path: filter graph with per-item grade/fades and xfade transitions. */
  private async renderFx(
    plan: RenderPlan,
    hooks: RenderHooks,
  ): Promise<RenderResult> {
    checkCancelled(hooks);
    hooks.onProgress(10);
    const child = new Deno.Command(this.binary, {
      args: buildFxArgs(plan.items, plan.output_path),
      stdout: "null",
      stderr: "piped",
    }).spawn();
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }, 300_000);
    const stderr = await new Response(child.stderr).text();
    const status = await child.status;
    clearTimeout(timer);
    checkCancelled(hooks);
    if (!status.success) {
      throw new RenderFailedError(
        `ffmpeg exited with ${status.code}: ${stderr.slice(0, 500)}`,
      );
    }
    hooks.onProgress(90);
    const stat = await Deno.stat(plan.output_path);
    hooks.onProgress(100);
    return { output_path: plan.output_path, file_size: stat.size, ticks: 3 };
  }

  render(plan: RenderPlan, hooks: RenderHooks): Promise<RenderResult> {
    checkCancelled(hooks);
    hooks.onProgress(5);
    return planHasFx(plan.items) ? this.renderFx(plan, hooks) : this.renderConcat(plan, hooks);
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
 * Stable serialization of the per-item fx carried on a plan; mixed into the
 * mock engine's seed so different fx produce different output bytes.
 */
export function fxFingerprint(items: RenderInputItem[]): string {
  return items
    .map((i) =>
      `${i.transition}:${i.transition_duration}:${i.fade_in}:${i.fade_out}:${
        JSON.stringify(i.color_grade ?? null)
      }`
    )
    .join("|");
}

/**
 * Produces a deterministic placeholder file so the full render pipeline
 * (queue, engine, validation, export record, provenance) works without
 * ffmpeg. For mp4 the bytes are a placeholder container; for wav a valid
 * minimal PCM header + silence.
 */
export class MockRenderEngine implements RenderEngine {
  readonly name = "mock";

  async render(plan: RenderPlan, hooks: RenderHooks): Promise<RenderResult> {
    const rand = xorshift(
      seedFromText(plan.output_path + plan.total_duration + fxFingerprint(plan.items)),
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
