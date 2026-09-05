import { mediaTypeFor } from "../storage/media_types.ts";

/**
 * Adapter interface (GEN-007): every model runtime exposes the same
 * generation contract. The core never talks to runtimes directly.
 */

export interface CandidateFile {
  content: Uint8Array;
  extension: string;
  mime_type: string;
  /**
   * The seed actually used for this candidate (per-candidate derivation,
   * see candidateSeed). Omitted when the runtime used the base seed for
   * every candidate (e.g. a single ComfyUI run).
   */
  seed?: string;
}

export interface AdapterHooks {
  onProgress(progress: number, message: string | null): void;
  isCancelled(): boolean;
  /** Structured status line from a CLI runner (RUNNER_STATUS <json>) —
   * surfaced as a job event so the job card reports e.g. the device
   * (gpu/cpu) a long generation is running on. */
  onLog?(message: string): void;
}

export interface AdapterInputRef {
  asset_id: string;
  version_number: number;
  /** Absolute path to the stored master file (resolved by the job runner). */
  file_path: string;
  format: string | null;
  mime_type: string | null;
}

export interface GenerationAdapterInput {
  jobType: string;
  seed: string | null;
  settings: Record<string, unknown>;
  inputs: AdapterInputRef[];
  promptText: string | null;
  /** Scratch directory the runner guarantees exists; adapters may create temp files here. */
  workDir: string;
  /**
   * Effective HuggingFace token for HF-origin models (resolved by the runner
   * via hfTokenForUrl, "" or undefined otherwise). local_cli exposes it to the
   * spawned process as HF_TOKEN / HUGGING_FACE_HUB_TOKEN so runners can
   * download gated-repo components (VAE / text encoder) at job time.
   */
  hfToken?: string;
}

export interface GenerationAdapterResult {
  candidates: CandidateFile[];
  seedUsed: string;
}

export interface ModelAdapter {
  readonly backend: string;
  generate(
    input: GenerationAdapterInput,
    hooks: AdapterHooks,
  ): Promise<GenerationAdapterResult>;
}

export class CancelledError extends Error {
  constructor(message = "Generation cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String(bytes[0]);
}

/**
 * Per-candidate seed for multi-candidate runs. Candidate 0 keeps the job's
 * exact seed (a requested seed stays reproducible); later candidates derive
 * from it so deterministic runtimes (e.g. a CPU diffusers runner) produce
 * distinct candidates instead of byte-identical copies. Numeric seeds
 * offset numerically; non-numeric seeds suffix the index.
 */
export function candidateSeed(seedUsed: string, index: number): string {
  if (index <= 0) return seedUsed;
  const asNumber = Number(seedUsed);
  if (seedUsed.trim() !== "" && Number.isFinite(asNumber)) {
    return String(asNumber + index);
  }
  return `${seedUsed}:${index}`;
}

/**
 * ComfyUI INT seed: map any seed string to a non-negative integer that fits a
 * ComfyUI INT input (noise_seed is 0..2^64-1). Numeric seeds pass through
 * verbatim; non-numeric ones (benchmark jobs use 'bench-<model-id>') hash via
 * FNV-1a so the same string always yields the same seed across processes and
 * distinct strings yield distinct seeds.
 */
export function comfySeedToInt(seed: string): number {
  const trimmed = seed.trim();
  const asNumber = Number(trimmed);
  if (trimmed !== "" && Number.isSafeInteger(asNumber) && asNumber >= 0) {
    return asNumber;
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Mock adapter (GEN-008/009/010): deterministic pseudo-output so tests and
// development can simulate generation without model binaries.
// ---------------------------------------------------------------------------

const VIDEO_TASKS = ["image_to_video", "text_to_video"];
const AUDIO_TASKS = ["audio", "music", "voice"];
const SUBTITLE_TASKS = ["transcribe"];

export function candidateCount(settings: Record<string, unknown>): number {
  const value = settings.candidates;
  if (typeof value !== "number" || !Number.isInteger(value)) return 1;
  return Math.min(Math.max(value, 1), 8);
}

export function outputForTask(jobType: string): { extension: string; mime_type: string } {
  if (VIDEO_TASKS.includes(jobType)) return { extension: "mp4", mime_type: "video/mp4" };
  if (AUDIO_TASKS.includes(jobType)) {
    return { extension: "wav", mime_type: "audio/wav" };
  }
  if (SUBTITLE_TASKS.includes(jobType)) {
    return { extension: "srt", mime_type: "application/x-subrip" };
  }
  return { extension: "png", mime_type: "image/png" };
}

/**
 * Resolve the effective output size a runner should pass to the model: the
 * job's computed width/height (from the requested aspect ratio + base edge),
 * falling back to the model's baked `default_width`/`default_height`, plus the
 * raw aspect hint. Fields are undefined for "auto" (the model decides).
 */
export function resolveOutputSize(settings: Record<string, unknown>): {
  width: number | undefined;
  height: number | undefined;
  aspect: string | undefined;
} {
  const asPositiveInt = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.round(value)
      : undefined;
  const aspect = typeof settings.aspect_ratio === "string" && settings.aspect_ratio !== ""
    ? settings.aspect_ratio
    : undefined;
  const width = asPositiveInt(settings.width) ?? asPositiveInt(settings.default_width);
  const height = asPositiveInt(settings.height) ?? asPositiveInt(settings.default_height);
  return { width, height, aspect };
}

/**
 * Extra environment for local_cli spawns: the string values of
 * `settings.env`, the HF hub token (so runners can fetch gated-repo files —
 * an explicit settings.env entry wins), RUNNER_DEVICE when the job settings
 * carry a user-chosen device (the runner must honour it instead of its own
 * auto fallback), RUNNER_MIN_FREE_VRAM_MB when the job settings carry a
 * VRAM requirement (the runner's auto-fallback threshold, so it matches the
 * UI's pre-generation VRAM check), and RUNNER_WIDTH / RUNNER_HEIGHT /
 * RUNNER_ASPECT_RATIO when an output size was requested (image generation —
 * the runner can size the model from them; absent = the model's default).
 * Returns undefined when nothing is added.
 */
export function cliExtraEnv(
  settingsEnv: Record<string, string> | undefined,
  hfToken: string,
  device: "cpu" | "cuda" | undefined,
  minFreeVramMb: number | undefined,
  size?: { width: number | undefined; height: number | undefined; aspect: string | undefined },
): Record<string, string> | undefined {
  const env: Record<string, string> = { ...(settingsEnv ?? {}) };
  if (hfToken) {
    if (env.HF_TOKEN === undefined) env.HF_TOKEN = hfToken;
    if (env.HUGGING_FACE_HUB_TOKEN === undefined) {
      env.HUGGING_FACE_HUB_TOKEN = hfToken;
    }
  }
  if (device !== undefined && env.RUNNER_DEVICE === undefined) {
    env.RUNNER_DEVICE = device;
  }
  if (
    minFreeVramMb !== undefined && minFreeVramMb > 0 &&
    env.RUNNER_MIN_FREE_VRAM_MB === undefined
  ) {
    env.RUNNER_MIN_FREE_VRAM_MB = String(Math.round(minFreeVramMb));
  }
  if (size) {
    if (size.width !== undefined && env.RUNNER_WIDTH === undefined) {
      env.RUNNER_WIDTH = String(size.width);
    }
    if (size.height !== undefined && env.RUNNER_HEIGHT === undefined) {
      env.RUNNER_HEIGHT = String(size.height);
    }
    if (size.aspect !== undefined && env.RUNNER_ASPECT_RATIO === undefined) {
      env.RUNNER_ASPECT_RATIO = size.aspect;
    }
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

/** Source audio duration in seconds from job settings (route-probed), clamped. */
function subtitleSourceDuration(settings: Record<string, unknown>): number {
  const value = settings.source_duration;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 12;
  return Math.min(value, 3600);
}

/** Format seconds as an SRT timestamp (HH:MM:SS,mmm). */
export function srtTimestamp(seconds: number): string {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/**
 * Deterministic mock transcription: split `duration` seconds into 2..5 cues of
 * 1.5–3.5 s (seeded), each line referencing the seed so candidates differ.
 */
export function synthesizeSrt(seed: string, duration: number, candidateIndex: number): string {
  const gen = seededBytes(`${seed}#srt#${candidateIndex}`);
  const pool = new Uint8Array(64);
  for (let i = 0; i < 4; i++) {
    const chunk = gen.next().value;
    pool.set(chunk, i * 16);
  }
  const rng = new Uint32Array(pool.buffer, 0, 16);
  const cueCount = 2 + (rng[0] % 4);
  const lines: string[] = [];
  let t = 0;
  for (let i = 0; i < cueCount; i++) {
    const cueLen = 1.5 + (rng[(i + 1) % 16] % 200) / 100 * 2.0;
    const end = Math.min(duration, t + cueLen);
    lines.push(String(i + 1));
    lines.push(`${srtTimestamp(t)} --> ${srtTimestamp(end)}`);
    lines.push(`Mock transcription line ${i + 1} of ${cueCount} (seed ${seed})`);
    lines.push("");
    t = t + cueLen >= duration ? duration : t + cueLen;
    if (t >= duration) break;
  }
  return lines.join("\n");
}

/** Expand a seed string into a deterministic byte stream (xorshift32). */
function* seededBytes(seed: string): Generator<Uint8Array> {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0 || 0x9e3779b9;
  for (;;) {
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      out[i] = state & 0xff;
    }
    yield out;
  }
}

function synthesize(seed: string, index: number, size: number): Uint8Array {
  const head = ["MOCK", "GEN:"];
  const bytes = new Uint8Array(size);
  const marker = new TextEncoder().encode(head.join("") + `${seed}:${index}`);
  const gen = seededBytes(`${seed}#${index}`);
  let pos = 0;
  if (marker.length <= size) {
    bytes.set(marker, 0);
    pos = marker.length;
  }
  while (pos < size) {
    const next = gen.next();
    if (next.done) break;
    const chunk = next.value;
    const take = Math.min(chunk.length, size - pos);
    bytes.set(chunk.subarray(0, take), pos);
    pos += take;
  }
  return bytes;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class MockAdapter implements ModelAdapter {
  readonly backend = "mock";

  async generate(
    input: GenerationAdapterInput,
    hooks: AdapterHooks,
  ): Promise<GenerationAdapterResult> {
    const needsInput = input.jobType === "image_to_video" ||
      input.jobType === "image_to_image" ||
      input.jobType === "transcribe";
    if (needsInput && input.inputs.length === 0) {
      throw new Error(
        `Job type ${input.jobType} requires at least one input asset version`,
      );
    }

    const seedUsed = input.seed && input.seed !== "random" ? input.seed : randomSeed();
    const count = candidateCount(input.settings);
    const out = outputForTask(input.jobType);
    const size = AUDIO_TASKS.includes(input.jobType) ? 2048 : 4096;
    const isSubtitle = SUBTITLE_TASKS.includes(input.jobType);
    const sourceDuration = subtitleSourceDuration(input.settings);

    // Simulate a 4-stage generation so progress events are observable.
    const ticks = 4;
    const candidates: CandidateFile[] = [];
    for (let tick = 0; tick < ticks; tick++) {
      hooks.onProgress(((tick + 1) / ticks) * 100, "Generating");
      if (hooks.isCancelled()) throw new CancelledError();
      await sleep(10);
      if (hooks.isCancelled()) throw new CancelledError();
    }
    for (let i = 0; i < count; i++) {
      if (hooks.isCancelled()) throw new CancelledError();
      const content = isSubtitle
        ? new TextEncoder().encode(synthesizeSrt(seedUsed, sourceDuration, i))
        : synthesize(seedUsed, i, size);
      candidates.push({ content, extension: out.extension, mime_type: out.mime_type });
    }
    hooks.onProgress(100, "Done");
    return { candidates, seedUsed };
  }
}

// ---------------------------------------------------------------------------
// Local CLI adapter (GEN-009/010): runs a user-configured command per
// candidate. The model's default_settings carry the invocation:
//   command (string, required)   executable name or absolute path
//   args (string[], optional)    argument templates; must include {output}
//   timeout_seconds (number)     default 600
//   env (string map, optional)   extra env vars (inherited from the server)
//   output_extension (string)    default derived from the job type
// Placeholders: {prompt} {seed} {candidate} {count} {output} {input:<i>}
// {seed} is the PER-CANDIDATE derived seed (candidateSeed: candidate 0 gets
// the job's exact seed, candidate i gets the derived one) so deterministic
// runtimes produce distinct candidates.
// A bare {input:<i>} token is an OPTIONAL reference: when the job carries
// no such input the token — and a lone flag token directly before it — is
// dropped, so dual t2i/i2i models work from a single settings row.
// Embedded {input:<i>} references (part of a larger token) still fail the
// job when the input is absent.
// ---------------------------------------------------------------------------

export interface CliArgContext {
  prompt: string;
  seed: string;
  candidate: number;
  count: number;
  inputPaths: string[];
  output: string;
  // Optional output size (image generation). When a model's args reference
  // {width}/{height} but the job has no resolved size (auto aspect/resolution
  // with no default_width/height), rendering throws a clear error.
  width?: number;
  height?: number;
}

export function renderCliArgs(args: string[], ctx: CliArgContext): string[] {
  const render = (arg: string): string =>
    arg.replace(/\{([a-z]+:[a-z0-9]+|[a-z]+)\}/g, (match, key: string) => {
      if (key === "prompt") return ctx.prompt;
      if (key === "seed") return ctx.seed;
      if (key === "candidate") return String(ctx.candidate);
      if (key === "count") return String(ctx.count);
      if (key === "output") return ctx.output;
      if (key === "width") {
        if (ctx.width === undefined) {
          throw new Error(
            `Argument '${arg}' references '{width}' but no output width is set — choose a non-Auto aspect ratio/resolution or add a default_width to the model`,
          );
        }
        return String(ctx.width);
      }
      if (key === "height") {
        if (ctx.height === undefined) {
          throw new Error(
            `Argument '${arg}' references '{height}' but no output height is set — choose a non-Auto aspect ratio/resolution or add a default_height to the model`,
          );
        }
        return String(ctx.height);
      }
      if (key.startsWith("input:")) {
        const i = Number(key.slice("input:".length));
        const path = ctx.inputPaths[i];
        if (path === undefined) {
          throw new Error(
            `Argument '${arg}' references input ${i} but the job has ${ctx.inputPaths.length} input(s) — use a bare '{input:${i}}' token to make the reference optional`,
          );
        }
        return path;
      }
      return match;
    });
  const out: string[] = [];
  for (const arg of args) {
    // Optional input reference: a bare {input:<i>} token whose input the
    // job does not carry is dropped together with a lone flag token
    // directly preceding it, so one settings row can serve both
    // text->image and image->image jobs (dual-mode models).
    const bare = arg.match(/^\{input:(\d+)\}$/);
    if (bare && ctx.inputPaths[Number(bare[1])] === undefined) {
      if (out.length > 0 && out[out.length - 1].startsWith("-")) out.pop();
      continue;
    }
    out.push(render(arg));
  }
  return out;
}

function settingNumber(
  settings: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = settings[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

const RUNNER_STATUS_PREFIX = "RUNNER_STATUS ";

/** Format a RUNNER_STATUS JSON payload as `key=value, ...` (null when the
 * line is not a flat object of scalar values). */
function formatRunnerStatus(raw: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

async function runCli(
  command: string,
  args: string[],
  timeoutSeconds: number,
  extraEnv: Record<string, string> | undefined,
  hooks: AdapterHooks,
): Promise<void> {
  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(command, {
      args,
      env: extraEnv ? { ...Deno.env.toObject(), ...extraEnv } : undefined,
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch (err) {
    throw new Error(
      `Failed to start CLI '${command}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const startedAt = Date.now();
  // Stdout is streamed line by line so RUNNER_STATUS lines (e.g. the device
  // a generation is running on) reach the job card while the CLI is still
  // running; the full text is kept for the error tail.
  let stdoutText = "";
  let stderrText = "";
  let lineCarry = "";
  const handleLine = (line: string): void => {
    if (line.startsWith(RUNNER_STATUS_PREFIX)) {
      const formatted = formatRunnerStatus(line.slice(RUNNER_STATUS_PREFIX.length).trim());
      if (formatted && hooks.onLog) hooks.onLog(formatted);
    }
  };
  const readStdout = (async (): Promise<void> => {
    const decoder = new TextDecoder();
    const reader = child.stdout.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        stdoutText += text;
        lineCarry += text;
        let newline: number;
        while ((newline = lineCarry.indexOf("\n")) >= 0) {
          const line = lineCarry.slice(0, newline);
          lineCarry = lineCarry.slice(newline + 1);
          handleLine(line);
        }
      }
      const tail = decoder.decode();
      stdoutText += tail;
      if (tail) lineCarry += tail;
      if (lineCarry.length > 0) handleLine(lineCarry);
    } catch {
      // A kill or I/O error ends the stream; the status below still reports.
    } finally {
      reader.releaseLock();
    }
  })();
  const errReader = child.stderr.getReader();
  const readStderr = (async (): Promise<void> => {
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await errReader.read();
        if (done) break;
        stderrText += decoder.decode(value, { stream: true });
      }
      stderrText += decoder.decode();
    } catch {
      // Same as stdout: a kill ends the stream.
    } finally {
      errReader.releaseLock();
    }
  })();
  const streamsDone = Promise.all([readStdout, readStderr]);
  // Bounded drain after a kill: SIGKILL kills the direct child, but any
  // grandchild it spawned inherits the pipe fds and holds them open, so
  // the read loops would otherwise wait for the grandchild to exit on its
  // own. Wait a short grace period for the pipes to flush, then abandon them.
  const killAndDrain = async (): Promise<void> => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Process may have already exited.
    }
    const grace = new Promise((resolve) => setTimeout(resolve, 2000));
    const done = streamsDone.then(
      () => "done" as const,
      () => "done" as const,
    );
    // Attach a no-op handler so a late rejection can't go unhandled.
    streamsDone.catch(() => {});
    await Promise.race([done, grace]);
  };
  for (;;) {
    if (hooks.isCancelled()) {
      await killAndDrain();
      throw new CancelledError();
    }
    if (Date.now() - startedAt > timeoutSeconds * 1000) {
      await killAndDrain();
      throw new Error(`CLI '${command}' timed out after ${timeoutSeconds}s`);
    }
    const tick = new Promise((resolve) => setTimeout(resolve, 100));
    const done = streamsDone.then(
      () => "done" as const,
      () => "done" as const,
    );
    if (await Promise.race([done, tick]) === "done") break;
  }
  await streamsDone;
  const status = await child.status;
  if (!status.success) {
    const tail = (stderrText.trim() || stdoutText.trim() || "(no output)").slice(-1500);
    throw new Error(`CLI '${command}' exited with code ${status.code}: ${tail}`);
  }
}

export class LocalCliAdapter implements ModelAdapter {
  readonly backend = "local_cli";

  async generate(
    input: GenerationAdapterInput,
    hooks: AdapterHooks,
  ): Promise<GenerationAdapterResult> {
    const settings = input.settings;
    const command = settings.command;
    if (typeof command !== "string" || command.trim() === "") {
      throw new Error(
        "local_cli model requires a 'command' string in default_settings",
      );
    }
    const rawArgs = Array.isArray(settings.args)
      ? (settings.args as unknown[]).filter((a): a is string => typeof a === "string")
      : [];
    if (!rawArgs.some((a) => a.includes("{output}"))) {
      throw new Error(
        "local_cli model args must include an '{output}' placeholder for the result file",
      );
    }
    const timeoutSeconds = settingNumber(settings, "timeout_seconds", 600, 1, 6 * 3600);
    const rawEnv = settings.env;
    const settingsEnv = rawEnv && typeof rawEnv === "object" && !Array.isArray(rawEnv)
      ? Object.fromEntries(
        Object.entries(rawEnv as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => [k, v as string]),
      )
      : undefined;
    // HF token for gated-repo hub access at job time: an explicit
    // settings.env entry (user's choice) wins over the injected one.
    const hfToken = typeof input.hfToken === "string" ? input.hfToken.trim() : "";
    const device = settings.device === "cpu" || settings.device === "cuda"
      ? (settings.device as "cpu" | "cuda")
      : undefined;
    const rawMinFree = settings.min_free_vram_mb;
    const minFreeVramMb =
      typeof rawMinFree === "number" && Number.isFinite(rawMinFree) && rawMinFree > 0
        ? rawMinFree
        : undefined;
    const size = resolveOutputSize(settings);
    const extraEnv = cliExtraEnv(settingsEnv, hfToken, device, minFreeVramMb, size);
    const seedUsed = input.seed && input.seed !== "random" ? input.seed : randomSeed();
    const count = candidateCount(settings);
    const def = outputForTask(input.jobType);
    const rawExt = settings.output_extension;
    const ext = typeof rawExt === "string" && rawExt.trim() !== ""
      ? rawExt.trim().replace(/^\./, "").toLowerCase()
      : def.extension;

    const candidates: CandidateFile[] = [];
    for (let i = 0; i < count; i++) {
      if (hooks.isCancelled()) throw new CancelledError();
      const seedForCandidate = candidateSeed(seedUsed, i);
      const outPath = `${input.workDir}/.localcli-${crypto.randomUUID()}.${ext}`;
      try {
        const args = renderCliArgs(rawArgs, {
          prompt: input.promptText ?? "",
          seed: seedForCandidate,
          candidate: i,
          count,
          inputPaths: input.inputs.map((ref) => ref.file_path),
          output: outPath,
          width: size.width,
          height: size.height,
        });
        hooks.onProgress(
          5 + (i / count) * 90,
          `Running ${command} (candidate ${i + 1}/${count})`,
        );
        await runCli(command, args, timeoutSeconds, extraEnv, hooks);
        const stat = await Deno.stat(outPath).catch(() => null);
        if (!stat) {
          throw new Error(`${command} finished but did not write an output file`);
        }
        const content = await Deno.readFile(outPath);
        candidates.push({
          content,
          extension: ext,
          mime_type: mediaTypeFor(outPath).mime ?? "application/octet-stream",
          seed: seedForCandidate,
        });
        hooks.onProgress(5 + ((i + 1) / count) * 90, `Candidate ${i + 1}/${count} done`);
      } finally {
        await Deno.remove(outPath).catch(() => {});
      }
    }
    hooks.onProgress(100, "Done");
    return { candidates, seedUsed };
  }
}

// ---------------------------------------------------------------------------
// ComfyUI adapter: submits a workflow to a local ComfyUI server.
// default_settings:
//   endpoint (string, required)  e.g. http://127.0.0.1:8188
//   workflow (object, required)  ComfyUI prompt graph (node map)
//   timeout_seconds (number)     default 600
// String placeholders in the workflow: {{prompt}}, {{seed}} (always rendered
// as an INT — numeric seeds pass through, non-numeric ones like benchmark
// seeds hash deterministically; see comfySeedToInt), {{input:<i>}} (uploaded
// to the server first; the returned file name is substituted).
// ---------------------------------------------------------------------------

interface ComfyFileRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 20000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function substituteWorkflow(
  workflow: Record<string, unknown>,
  ctx: {
    prompt: string;
    seed: string;
    uploads: Map<number, string>;
    width?: number;
    height?: number;
  },
): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (value.trim() === "{{seed}}") {
        return comfySeedToInt(ctx.seed);
      }
      // A bare size placeholder in a numeric field renders as the NUMBER so
      // ComfyUI's input validation accepts it (mirrors {{seed}}).
      if (value.trim() === "{{width}}") return ctx.width;
      if (value.trim() === "{{height}}") return ctx.height;
      return value
        .replace(/\{\{\s*prompt\s*\}\}/g, ctx.prompt)
        .replace(/\{\{\s*seed\s*\}\}/g, ctx.seed)
        .replace(/\{\{\s*width\s*\}\}/g, () => String(ctx.width ?? ""))
        .replace(/\{\{\s*height\s*\}\}/g, () => String(ctx.height ?? ""))
        .replace(/\{\{\s*input:(\d+)\s*\}\}/g, (_m, i: string) => ctx.uploads.get(Number(i)) ?? _m);
    }
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value === "object" && value !== null) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v);
      return out;
    }
    return value;
  };
  return walk(workflow) as Record<string, unknown>;
}

export class ComfyUIAdapter implements ModelAdapter {
  readonly backend = "comfyui";

  async generate(
    input: GenerationAdapterInput,
    hooks: AdapterHooks,
  ): Promise<GenerationAdapterResult> {
    const settings = input.settings;
    const endpoint = typeof settings.endpoint === "string"
      ? settings.endpoint.replace(/\/+$/, "")
      : "";
    if (!endpoint || !/^https?:\/\//.test(endpoint)) {
      throw new Error(
        "comfyui model requires an 'endpoint' http(s) URL in default_settings",
      );
    }
    const workflow = settings.workflow;
    if (
      typeof workflow !== "object" || workflow === null || Array.isArray(workflow) ||
      Object.keys(workflow).length === 0
    ) {
      throw new Error(
        "comfyui model requires a non-empty 'workflow' object in default_settings",
      );
    }
    const timeoutSeconds = settingNumber(settings, "timeout_seconds", 600, 1, 6 * 3600);
    const seedUsed = input.seed && input.seed !== "random" ? input.seed : randomSeed();
    const clientId = crypto.randomUUID();
    const size = resolveOutputSize(settings);

    const workflowJson = JSON.stringify(workflow);
    // Fail early when the workflow references a size placeholder the job can't
    // resolve (auto aspect/resolution with no default_width/height).
    if (/\{\{\s*width\s*\}\}/.test(workflowJson) && size.width === undefined) {
      throw new Error(
        "Workflow references {{width}} but no output width is set — choose a non-Auto aspect ratio/resolution or add a default_width to the model",
      );
    }
    if (/\{\{\s*height\s*\}\}/.test(workflowJson) && size.height === undefined) {
      throw new Error(
        "Workflow references {{height}} but no output height is set — choose a non-Auto aspect ratio/resolution or add a default_height to the model",
      );
    }
    const referencedInputs = [
      ...new Set(
        [...workflowJson.matchAll(/\{\{\s*input:(\d+)\s*\}\}/g)].map((m) => Number(m[1])),
      ),
    ].sort((a, b) => a - b);
    for (const i of referencedInputs) {
      if (i >= input.inputs.length) {
        throw new Error(
          `Workflow references input ${i} but the job has ${input.inputs.length} input(s)`,
        );
      }
    }

    const uploads = new Map<number, string>();
    for (const i of referencedInputs) {
      if (hooks.isCancelled()) throw new CancelledError();
      const ref = input.inputs[i];
      const filename = `cinemaitor-${crypto.randomUUID()}.${ref.format ?? "png"}`;
      const bytes = await Deno.readFile(ref.file_path);
      const form = new FormData();
      form.append("image", new Blob([bytes]), filename);
      form.append("overwrite", "true");
      hooks.onProgress(10, `Uploading input ${i + 1}/${input.inputs.length} to ComfyUI`);
      let uploadRes: Response;
      try {
        uploadRes = await fetchWithTimeout(`${endpoint}/upload/image`, {
          method: "POST",
          body: form,
        });
      } catch (err) {
        throw new Error(
          `ComfyUI unreachable at ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!uploadRes.ok) {
        throw new Error(`ComfyUI /upload/image failed (${uploadRes.status})`);
      }
      const body = (await uploadRes.json().catch(() => ({}))) as { name?: string };
      if (!body.name) {
        throw new Error("ComfyUI /upload/image returned no file name");
      }
      uploads.set(i, body.name);
    }

    const rendered = substituteWorkflow(workflow as Record<string, unknown>, {
      prompt: input.promptText ?? "",
      seed: seedUsed,
      uploads,
      width: size.width,
      height: size.height,
    });

    hooks.onProgress(30, "Submitting workflow");
    let promptRes: Response;
    try {
      promptRes = await fetchWithTimeout(`${endpoint}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: rendered, client_id: clientId }),
      });
    } catch (err) {
      throw new Error(
        `ComfyUI unreachable at ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!promptRes.ok) {
      const text = await promptRes.text().catch(() => "");
      throw new Error(`ComfyUI /prompt failed (${promptRes.status}): ${text.slice(0, 500)}`);
    }
    const promptBody = (await promptRes.json().catch(() => ({}))) as {
      prompt_id?: string;
      error?: unknown;
      node_errors?: unknown;
    };
    if (!promptBody.prompt_id) {
      throw new Error(
        `ComfyUI /prompt rejected the workflow: ${
          JSON.stringify(promptBody.error ?? promptBody.node_errors ?? "unknown error")
            .slice(0, 500)
        }`,
      );
    }
    const promptId = promptBody.prompt_id;

    const startedAt = Date.now();
    let announced = false;
    let entry: Record<string, unknown> | undefined;
    for (;;) {
      if (hooks.isCancelled()) {
        await fetchWithTimeout(`${endpoint}/interrupt`, { method: "POST" }).catch(() => {});
        throw new CancelledError();
      }
      if (Date.now() - startedAt > timeoutSeconds * 1000) {
        await fetchWithTimeout(`${endpoint}/interrupt`, { method: "POST" }).catch(() => {});
        throw new Error(
          `ComfyUI prompt ${promptId} timed out after ${timeoutSeconds}s`,
        );
      }
      if (!announced) {
        hooks.onProgress(50, "Running on ComfyUI");
        announced = true;
      }
      const res = await fetchWithTimeout(`${endpoint}/history/${promptId}`).catch(
        () => null,
      );
      if (res && res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<
          string,
          Record<string, unknown>
        >;
        if (body[promptId]) {
          entry = body[promptId];
          break;
        }
      }
      await sleep(1000);
    }

    const status = entry?.status as
      | { status_str?: string; messages?: { type: string; data: unknown }[] }
      | undefined;
    if (status?.status_str === "error") {
      const detail = (status.messages ?? [])
        .filter((m) => m.type === "execution_error")
        .map((m) => {
          const data = m.data as
            | { exception_message?: string; feedback?: { message?: string }[] }
            | undefined;
          return data?.exception_message ??
            data?.feedback?.[0]?.message ??
            JSON.stringify(m.data);
        })
        .join("; ");
      throw new Error(`ComfyUI execution error: ${detail.slice(0, 500) || "unknown"}`);
    }

    const files: ComfyFileRef[] = [];
    const outputs = (entry?.outputs ?? {}) as Record<string, unknown>;
    for (const nodeOutput of Object.values(outputs)) {
      if (typeof nodeOutput !== "object" || nodeOutput === null) continue;
      for (const key of ["images", "gifs", "videos"]) {
        const list = (nodeOutput as Record<string, unknown>)[key];
        if (!Array.isArray(list)) continue;
        for (const item of list) {
          if (
            item && typeof item === "object" &&
            typeof (item as ComfyFileRef).filename === "string"
          ) {
            files.push(item as ComfyFileRef);
          }
        }
      }
    }
    if (files.length === 0) {
      throw new Error("ComfyUI execution completed without image outputs");
    }

    hooks.onProgress(90, `Collecting ${files.length} output file(s)`);
    const candidates: CandidateFile[] = [];
    for (const file of files) {
      const params = new URLSearchParams({
        filename: file.filename,
        subfolder: file.subfolder ?? "",
        type: file.type ?? "output",
      });
      const res = await fetchWithTimeout(`${endpoint}/view?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`ComfyUI /view failed for ${file.filename} (${res.status})`);
      }
      const content = new Uint8Array(await res.arrayBuffer());
      const extension = file.filename.includes(".")
        ? file.filename.split(".").pop()!.toLowerCase()
        : "png";
      candidates.push({
        content,
        extension,
        mime_type: mediaTypeFor(file.filename).mime ?? "application/octet-stream",
      });
    }
    hooks.onProgress(100, "Done");
    return { candidates, seedUsed };
  }
}

const adapters: Record<string, ModelAdapter> = {
  mock: new MockAdapter(),
  local_cli: new LocalCliAdapter(),
  comfyui: new ComfyUIAdapter(),
};

export function getAdapter(backend: string): ModelAdapter | undefined {
  return adapters[backend];
}
