/**
 * Adapter interface (GEN-007): every model runtime exposes the same
 * generation contract. The core never talks to runtimes directly.
 */

export interface CandidateFile {
  content: Uint8Array;
  extension: string;
  mime_type: string;
}

export interface AdapterHooks {
  onProgress(progress: number, message: string | null): void;
  isCancelled(): boolean;
}

export interface GenerationAdapterInput {
  jobType: string;
  seed: string | null;
  settings: Record<string, unknown>;
  inputs: { asset_id: string; version_number: number }[];
  promptText: string | null;
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

// ---------------------------------------------------------------------------
// Mock adapter (GEN-008/009/010): deterministic pseudo-output so tests and
// development can simulate generation without model binaries.
// ---------------------------------------------------------------------------

const VIDEO_TASKS = ["image_to_video", "text_to_video"];
const AUDIO_TASKS = ["audio", "music", "voice"];

function candidateCount(settings: Record<string, unknown>): number {
  const value = settings.candidates;
  if (typeof value !== "number" || !Number.isInteger(value)) return 1;
  return Math.min(Math.max(value, 1), 8);
}

function outputForTask(jobType: string): { extension: string; mime_type: string } {
  if (VIDEO_TASKS.includes(jobType)) return { extension: "mp4", mime_type: "video/mp4" };
  if (AUDIO_TASKS.includes(jobType)) {
    return { extension: "wav", mime_type: "audio/wav" };
  }
  return { extension: "png", mime_type: "image/png" };
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
      input.jobType === "image_to_image";
    if (needsInput && input.inputs.length === 0) {
      throw new Error(
        `Job type ${input.jobType} requires at least one input asset version`,
      );
    }

    const seedUsed = input.seed && input.seed !== "random" ? input.seed : randomSeed();
    const count = candidateCount(input.settings);
    const out = outputForTask(input.jobType);
    const size = AUDIO_TASKS.includes(input.jobType) ? 2048 : 4096;

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
      candidates.push({
        content: synthesize(seedUsed, i, size),
        extension: out.extension,
        mime_type: out.mime_type,
      });
    }
    hooks.onProgress(100, "Done");
    return { candidates, seedUsed };
  }
}

const adapters: Record<string, ModelAdapter> = {
  mock: new MockAdapter(),
};

export function getAdapter(backend: string): ModelAdapter | undefined {
  return adapters[backend];
}
