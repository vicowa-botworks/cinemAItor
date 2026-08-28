// Model benchmark (WS 14): runs a fixed, deterministic generation for every
// benchmarkable task type a model supports and records measurement rows
// (wall-clock duration, candidate count, output bytes) in model_benchmarks.
// Results are measurement metadata only - no assets are stored.
import { badRequest, notFound } from "../errors.ts";
import {
  addJobEvent,
  BENCHMARK_JOB_TYPE,
  createJob,
  finishJob,
  type GenerationJob,
  getJob,
  updateJobProgress,
} from "../db/jobs.ts";
import { createBenchmarkResult, getModel, type Model, touchModelLastUsed } from "../db/models.ts";
import { getContentStore } from "../storage/content_store.ts";
import { CancelledError, getAdapter, randomSeed } from "./adapters.ts";
import { hfTokenForUrl } from "./huggingface.ts";

/** Scratch dir for real backends to write temp output (guaranteed to exist). */
async function getBenchmarkWorkDir(): Promise<string> {
  const store = getContentStore();
  await Deno.mkdir(store.layout.cache, { recursive: true });
  return store.layout.cache;
}

/** Task types the v1 benchmark can run without an input asset: text/image and
 * audio generations. Image-to-image, image-to-video, and transcribe need a
 * source asset and are not benchmarked in v1. */
export const BENCHMARKABLE_TASKS = [
  "text_to_image",
  "text_to_video",
  "audio",
  "music",
  "voice",
] as const;
export type BenchmarkableTask = (typeof BENCHMARKABLE_TASKS)[number];

/** Candidates per benchmarked task (fixed for comparability). */
export const BENCHMARK_CANDIDATES = 2;

/** Deterministic benchmark prompts, one per benchmarkable task type. */
export const BENCHMARK_PROMPTS: Record<BenchmarkableTask, string> = {
  text_to_image: "A lighthouse on a cliff at dusk, dramatic clouds, cinematic lighting",
  text_to_video: "A slow push-in on a lighthouse at dusk, waves breaking below, cinematic",
  audio: "Soft ambient room tone with faint rain, loopable, one minute",
  music: "Minimal cinematic underscore, slow rising strings, one minute, no percussion",
  voice: "Calm narrator voice reading: the benchmark has started, clear and even",
};

export interface BenchmarkRequestResult {
  job_id: string;
  tasks: BenchmarkableTask[];
  seed: string;
}

export interface BenchmarkJobSettings {
  tasks?: BenchmarkableTask[];
  candidates?: number;
}

export function benchmarkableTasksFor(model: Model): BenchmarkableTask[] {
  return (BENCHMARKABLE_TASKS as readonly string[]).filter((task) =>
    (model.task_types as string[]).includes(task)
  ) as BenchmarkableTask[];
}

/** Validate the model and enqueue a benchmark job (any authenticated user,
 * like a health check - the run produces measurement rows only). */
export function requestBenchmark(
  modelId: string,
  userId: number,
): BenchmarkRequestResult {
  const model = getModel(modelId);
  if (!model) throw notFound("Model not found");
  if (!model.enabled) throw badRequest("Model is disabled");
  if (!model.installed_at) throw badRequest("Model is not installed");

  const tasks = benchmarkableTasksFor(model);
  if (tasks.length === 0) {
    throw badRequest(
      `Model has no benchmarkable task types (benchmarkable: ${
        BENCHMARKABLE_TASKS.join(", ")
      }; model supports: ${model.task_types.join(", ") || "none"})`,
    );
  }

  const seed = `bench-${model.id}`;
  const job = createJob(userId, {
    job_type: BENCHMARK_JOB_TYPE,
    model_id: model.id,
    prompt_text: `Benchmark of ${model.name} (${model.version})`,
    seed,
    settings: {
      tasks,
      candidates: BENCHMARK_CANDIDATES,
    } satisfies BenchmarkJobSettings,
  });
  return { job_id: job.id, tasks, seed };
}

/**
 * Run one benchmarked generation per task and record a model_benchmarks row
 * each. Progress is reported across the whole job; cancellation mid-task
 * propagates CancelledError to the runner, which marks the job cancelled.
 * Errors other than cancellation fail the job in the runner.
 */
export async function executeBenchmarkJob(job: GenerationJob): Promise<void> {
  const jobId = job.id;
  const model = getModel(job.model_id ?? "");
  if (!model) throw new Error(`Model ${job.model_id} no longer exists`);
  touchModelLastUsed(model.id);

  const adapter = getAdapter(model.backend);
  if (!adapter) {
    throw new Error(`No adapter registered for backend '${model.backend}'`);
  }

  const settings = (job.settings ?? {}) as BenchmarkJobSettings;
  const tasks = (settings.tasks ?? benchmarkableTasksFor(model)).filter((task) =>
    BENCHMARKABLE_TASKS.includes(task)
  );
  if (tasks.length === 0) {
    throw new Error("Benchmark job has no benchmarkable tasks");
  }
  const candidates = typeof settings.candidates === "number" && settings.candidates > 0
    ? Math.min(settings.candidates, 4)
    : BENCHMARK_CANDIDATES;

  const seed = job.seed && job.seed !== "random" ? job.seed : randomSeed();
  const hooks = {
    isCancelled(): boolean {
      return getJob(jobId)?.status === "cancelling";
    },
  };

  let totalCandidates = 0;
  const benchmarkWorkDir = await getBenchmarkWorkDir();
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (hooks.isCancelled()) throw new CancelledError();
    updateJobProgress(jobId, Math.round((i / tasks.length) * 100));
    const startedAt = performance.now();
    const result = await adapter.generate(
      {
        jobType: task,
        seed,
        // Model presets apply so real backends (local_cli/comfyui) run their
        // configured tool; the benchmark candidate count still wins.
        settings: { ...model.default_settings, candidates },
        inputs: [],
        promptText: BENCHMARK_PROMPTS[task],
        workDir: benchmarkWorkDir,
        hfToken: hfTokenForUrl(model.repository_url),
      },
      {
        onProgress(progress: number, _message: string | null): void {
          updateJobProgress(
            jobId,
            Math.round(((i + progress / 100) / tasks.length) * 100),
          );
        },
        isCancelled: hooks.isCancelled,
      },
    );
    const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
    const outputBytes = result.candidates.reduce(
      (sum, c) => sum + c.content.byteLength,
      0,
    );
    totalCandidates += result.candidates.length;
    createBenchmarkResult({
      model_id: model.id,
      task_type: task,
      duration_ms: durationMs,
      candidate_count: result.candidates.length,
      output_bytes: outputBytes,
      seed: result.seedUsed,
      job_id: jobId,
    });
    updateJobProgress(jobId, Math.round(((i + 1) / tasks.length) * 100));
    addJobEvent(jobId, "benchmark.task", `${task} benchmarked`, {
      task_type: task,
      duration_ms: durationMs,
      candidate_count: result.candidates.length,
      output_bytes: outputBytes,
    });
  }

  finishJob(jobId, "succeeded", {
    candidateCount: totalCandidates,
    progress: 100,
  });
}
