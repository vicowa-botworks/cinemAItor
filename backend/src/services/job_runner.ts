import {
  addJobEvent,
  AUDIO_CLEANUP_JOB_TYPE,
  BENCHMARK_JOB_TYPE,
  claimJob,
  countRunningJobs,
  createJob,
  finishJob,
  type GenerationJob,
  getJob,
  listJobs,
  PROXY_JOB_TYPE,
  recoverStaleJobs,
  retryJob,
  setJobSettings,
  updateJobLease,
  updateJobProgress,
} from "../db/jobs.ts";
import { isAudioAssetType } from "../db/audio.ts";
import {
  type CleanupOperations,
  cleanupOperationsLabel,
  cleanupOutputFormat,
  generateAudioCleanup,
} from "./audio_cleanup.ts";
import { executeBenchmarkJob } from "./model_benchmark.ts";
import { hfTokenForUrl } from "./huggingface.ts";
import { analyzeAudioFile, buildAudioMetadata } from "./audio_info.ts";
import { getModel, type Model, touchModelLastUsed } from "../db/models.ts";
import {
  type AssetVersion,
  createAsset,
  createAssetVersion,
  getAssetById,
  getAssetVersionByNumber,
  setVersionProxy,
} from "../db/assets.ts";
import { setPanelPreview } from "../db/storyboards.ts";
import { setShotGenerated } from "../db/scenes.ts";
import { getContentStore } from "../storage/content_store.ts";
import { type AdapterInputRef, CancelledError, getAdapter, randomSeed } from "./adapters.ts";
import { generateProxyMedia, PROXY_OUTPUT, proxyKindFor } from "./media_proxy.ts";
import { badRequest, notFound } from "../errors.ts";

export interface JobRunnerOptions {
  pollMs?: number;
  leaseSeconds?: number;
  gpuConcurrency?: number;
  cpuConcurrency?: number;
}

export interface JobRunner {
  readonly owner: string;
  stop(): Promise<void>;
}

const IMAGE_TASKS = ["text_to_image", "image_to_image"];

function randomHex(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Merge a model's generation profile settings (Workstream 18, issue #155):
 * default_settings <- profile <- job settings. When job.settings.profile is
 * "draft" / "production", the model's matching profile object is merged over
 * default_settings. Job-level keys always win, so operational settings
 * (candidates, device, min_free_vram_mb) — and the invocation itself
 * (command/endpoint/workflow) — can never be overridden or dropped by a
 * profile. A requested-but-absent (or empty) profile is a no-op, so models
 * without profiles keep their exact previous behavior.
 */
export function mergeProfileSettings(
  model: Model,
  jobSettings: Record<string, unknown>,
): Record<string, unknown> {
  const profile = jobSettings.profile;
  const profileSettings = profile === "draft"
    ? model.draft_settings
    : profile === "production"
    ? model.production_settings
    : {};
  return { ...model.default_settings, ...profileSettings, ...jobSettings };
}

/**
 * In-process job runner (GEN-003/016/017): polls the queue, claims jobs with
 * leases, executes them through the model adapter, and stores candidates as
 * asset versions with full provenance.
 */
export function startJobRunner(options: JobRunnerOptions = {}): JobRunner {
  const pollMs = options.pollMs ?? 250;
  const leaseSeconds = options.leaseSeconds ?? 60;
  const gpuConcurrency = options.gpuConcurrency ?? 1;
  const cpuConcurrency = options.cpuConcurrency ?? 2;
  const owner = `runner-${randomHex()}`;

  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const executing = new Set<Promise<void>>();

  async function storeCandidate(
    job: GenerationJob,
    targetAssetId: string,
    userId: number,
    candidate: {
      content: Uint8Array;
      extension: string;
      mime_type: string;
      seed?: string;
    },
    index: number,
    count: number,
    seedUsed: string,
  ): Promise<string> {
    const model = getModel(job.model_id!);
    const store = getContentStore();
    await Deno.mkdir(store.layout.cache, { recursive: true });
    const tempPath = `${store.layout.cache}/.jobgen-${job.id}-${index}`;
    try {
      await Deno.writeFile(tempPath, candidate.content);
      const stored = await store.put(
        tempPath,
        `gen-${job.id.slice(0, 8)}-${index}.${candidate.extension}`,
      );

      const version = createAssetVersion(targetAssetId, userId, {
        content_hash: stored.hash,
        file_path: stored.path,
        format: candidate.extension,
        mime_type: candidate.mime_type,
        file_size: stored.size,
        // The last stored candidate becomes the active version.
        make_active: index === count - 1,
        technical_metadata_json: JSON.stringify({
          job_id: job.id,
          job_type: job.job_type,
          model_id: model?.id,
          model_name: model?.name,
          model_version: model?.version,
          backend: model?.backend,
          prompt_text: job.prompt_text,
          negative_prompt: job.negative_prompt,
          seed_used: candidate.seed ?? seedUsed,
          settings: job.settings,
          input_asset_versions: job.input_asset_versions,
          request: {
            project_id: job.project_id,
            scene_id: job.scene_id,
            shot_id: job.shot_id,
            storyboard_panel_id: job.storyboard_panel_id,
            prompt_version_id: job.prompt_version_id,
          },
          candidate_index: index,
          candidate_count: count,
          generated_at: new Date().toISOString(),
        }),
        notes: `Generated by job ${job.id}`,
      });
      queueProxyGeneration(targetAssetId, version, userId, job.project_id);
      return version.id;
    } finally {
      await Deno.remove(tempPath).catch(() => {});
    }
  }

  /** Execute a queued proxy job: transcode the version's master to a proxy. */
  async function executeProxyJob(job: GenerationJob): Promise<void> {
    const jobId = job.id;
    try {
      if (!job.asset_id) {
        throw new Error("Proxy job requires an asset_id");
      }
      const input = job.input_asset_versions[0];
      if (!input) {
        throw new Error("Proxy job requires an input asset version");
      }
      const version = getAssetVersionByNumber(job.asset_id, input.version_number);
      if (!version) {
        throw new Error(`Asset version ${input.version_number} no longer exists`);
      }
      const asset = getAssetById(job.asset_id);
      const kind = version.mime_type
        ? proxyKindFor(version.mime_type, asset?.asset_type ?? "")
        : null;
      if (!kind) {
        throw new Error("Asset type is not proxyable");
      }
      if (!version.file_path) {
        throw new Error("Version has no stored master file");
      }
      await Deno.stat(version.file_path);

      const store = getContentStore();
      await Deno.mkdir(store.layout.cache, { recursive: true });
      // ffmpeg infers the output format from the file extension, so the
      // scratch path must carry the target kind's extension.
      const tempPath = `${store.layout.cache}/.proxygen-${job.id}.${PROXY_OUTPUT[kind].extension}`;
      const hooks = {
        onProgress(progress: number, message: string | null): void {
          updateJobProgress(jobId, progress);
          if (message) addJobEvent(jobId, "progress", message, { progress });
        },
        onLog(message: string): void {
          addJobEvent(jobId, "runner.log", message);
        },
        isCancelled(): boolean {
          return getJob(jobId)?.status === "cancelling";
        },
      };
      try {
        const result = await generateProxyMedia(
          version.file_path,
          kind,
          tempPath,
          version.content_hash ?? version.id,
          hooks,
        );
        const stored = await store.put(
          tempPath,
          `proxy-${version.id.slice(0, 8)}.${result.extension}`,
        );
        setVersionProxy(version.id, stored.path);
        addJobEvent(jobId, "proxy.generated", "Proxy generated and linked", {
          version_id: version.id,
          engine: result.engine,
        });
        finishJob(jobId, "succeeded", {
          outputAssetVersionId: version.id,
          progress: 100,
        });
      } finally {
        await Deno.remove(tempPath).catch(() => {});
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finishJob(jobId, "failed", { errorText: message });
    }
  }

  /** Execute a queued audio cleanup job: denoise/normalize the source
   * version into a new version of the same asset. */
  async function executeAudioCleanupJob(job: GenerationJob): Promise<void> {
    const jobId = job.id;
    const userId = job.created_by_user_id ?? 0;
    try {
      if (!job.asset_id) {
        throw new Error("Cleanup job requires an asset_id");
      }
      const input = job.input_asset_versions[0];
      if (!input) {
        throw new Error("Cleanup job requires an input asset version");
      }
      const version = getAssetVersionByNumber(job.asset_id, input.version_number);
      if (!version) {
        throw new Error(`Asset version ${input.version_number} no longer exists`);
      }
      const asset = getAssetById(job.asset_id);
      if (!asset || asset.status === "deleted") {
        throw new Error("Target asset has been deleted");
      }
      if (!isAudioAssetType(asset.asset_type)) {
        throw new Error("Asset is not an audio asset");
      }
      if (!version.file_path) {
        throw new Error("Version has no stored master file");
      }
      await Deno.stat(version.file_path);

      const settings = job.settings ?? {};
      const operations: CleanupOperations = {
        denoise: settings.denoise === true,
        normalize: settings.normalize === true,
      };
      if (!operations.denoise && !operations.normalize) {
        throw new Error("Cleanup job has no operations");
      }

      const out = cleanupOutputFormat(version.format ?? "wav");
      const store = getContentStore();
      await Deno.mkdir(store.layout.cache, { recursive: true });
      // ffmpeg infers the output format from the file extension, so the
      // scratch path must carry the target extension.
      const tempPath = `${store.layout.cache}/.audclean-${job.id}.${out.extension}`;
      const hooks = {
        onProgress(progress: number, message: string | null): void {
          updateJobProgress(jobId, progress);
          if (message) addJobEvent(jobId, "progress", message, { progress });
        },
        onLog(message: string): void {
          addJobEvent(jobId, "runner.log", message);
        },
        isCancelled(): boolean {
          return getJob(jobId)?.status === "cancelling";
        },
      };
      try {
        const result = await generateAudioCleanup(
          version.file_path,
          tempPath,
          operations,
          version.format ?? "wav",
          job.id,
          hooks,
        );
        const stored = await store.put(
          tempPath,
          `clean-${version.id.slice(0, 8)}.${result.extension}`,
        );
        const analysis = await analyzeAudioFile(tempPath);
        const metadata = {
          ...buildAudioMetadata(analysis),
          cleanup: {
            operations,
            engine: result.engine,
            source_version_id: version.id,
            source_version_number: version.version_number,
            job_id: jobId,
          },
        };
        const cleaned = createAssetVersion(job.asset_id, userId, {
          content_hash: stored.hash,
          file_path: stored.path,
          format: result.extension,
          mime_type: result.mime_type,
          file_size: stored.size,
          technical_metadata_json: JSON.stringify(metadata),
          notes: `Cleanup of v${version.version_number} (${
            cleanupOperationsLabel(operations)
          }) by job ${jobId}`,
          make_active: false,
        });
        queueProxyGeneration(job.asset_id, cleaned, userId, job.project_id);
        addJobEvent(jobId, "cleanup.generated", "Cleanup version stored", {
          version_id: cleaned.id,
          engine: result.engine,
        });
        finishJob(jobId, "succeeded", {
          outputAssetVersionId: cleaned.id,
          candidateCount: 1,
          candidateVersionIds: [cleaned.id],
          progress: 100,
        });
      } finally {
        await Deno.remove(tempPath).catch(() => {});
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      finishJob(jobId, "failed", { errorText: message });
    }
  }

  /** Resolve a job's input asset versions to on-disk master files. */
  async function resolveInputFiles(job: GenerationJob): Promise<AdapterInputRef[]> {
    const refs: AdapterInputRef[] = [];
    for (const ref of job.input_asset_versions) {
      const version = getAssetVersionByNumber(ref.asset_id, ref.version_number);
      if (!version || !version.file_path) {
        throw new Error(
          `Input asset version ${ref.asset_id}#${ref.version_number} no longer exists`,
        );
      }
      await Deno.stat(version.file_path).catch(() => {
        throw new Error(
          `Input file for asset version ${ref.asset_id}#${ref.version_number} is missing from disk`,
        );
      });
      refs.push({
        ...ref,
        file_path: version.file_path,
        format: version.format,
        mime_type: version.mime_type,
      });
    }
    return refs;
  }

  /** Run one claimed job to a terminal state. */
  async function executeJob(job: GenerationJob): Promise<void> {
    const jobId = job.id;
    const userId = job.created_by_user_id ?? 0;
    // Executions longer than one lease must renew it, or recovery re-queues
    // the live job and a second execution of the same job starts. Renew at
    // half-lease intervals; stop when the lease no longer belongs to us
    // (job re-claimed or finished).
    const leaseRenewalMs = Math.max(1000, Math.floor(leaseSeconds / 2) * 1000);
    const leaseRenewal = setInterval(() => {
      if (!updateJobLease(owner, jobId, leaseSeconds)) {
        clearInterval(leaseRenewal);
      }
    }, leaseRenewalMs);
    Deno.unrefTimer(leaseRenewal);
    try {
      if (job.job_type === PROXY_JOB_TYPE) {
        await executeProxyJob(job);
        return;
      }
      if (job.job_type === AUDIO_CLEANUP_JOB_TYPE) {
        await executeAudioCleanupJob(job);
        return;
      }
      if (job.job_type === BENCHMARK_JOB_TYPE) {
        await executeBenchmarkJob(job);
        return;
      }
      const model = getModel(job.model_id!);
      if (!model) {
        throw new Error(`Model ${job.model_id} no longer exists`);
      }
      touchModelLastUsed(model.id);

      const adapter = getAdapter(model.backend);
      if (!adapter) {
        throw new Error(
          `No adapter registered for backend '${model.backend}' yet (GEN-007)`,
        );
      }

      const seed = job.seed && job.seed !== "random" ? job.seed : randomSeed();
      const hooks = {
        onProgress(progress: number, message: string | null): void {
          updateJobProgress(jobId, progress);
          addJobEvent(jobId, "progress", message, { progress });
        },
        onLog(message: string): void {
          addJobEvent(jobId, "runner.log", message);
        },
        isCancelled(): boolean {
          return getJob(jobId)?.status === "cancelling";
        },
      };

      const store = getContentStore();
      await Deno.mkdir(store.layout.cache, { recursive: true });
      const inputRefs = await resolveInputFiles(job);

      // Model presets (default_settings) apply to every backend; the job's
      // quality profile (draft/production), when set, sits in between; job-level
      // settings override them key by key.
      const adapterSettings = mergeProfileSettings(model, job.settings);

      const result = await adapter.generate(
        {
          jobType: job.job_type,
          seed,
          settings: adapterSettings,
          inputs: inputRefs,
          promptText: job.prompt_text,
          workDir: store.layout.cache,
          hfToken: hfTokenForUrl(model.repository_url),
        },
        hooks,
      );

      let targetAssetId = job.asset_id;
      if (!targetAssetId) {
        const assetType = IMAGE_TASKS.includes(job.job_type)
          ? "image"
          : job.job_type.includes("video")
          ? "video"
          : job.job_type === "transcribe"
          ? "subtitle"
          : "audio";
        const asset = createAsset(
          {
            unique_slug: `gen_${randomHex()}`,
            display_name: `Generation ${jobId.slice(0, 8)}`,
            asset_type: assetType,
            library_scope: "global",
          },
          userId,
        );
        targetAssetId = asset.id;
        addJobEvent(jobId, "asset.created", "Created asset for candidates", {
          asset_id: asset.id,
        });
      } else if (getAssetById(targetAssetId)?.status === "deleted") {
        throw new Error("Target asset has been deleted");
      }

      const versionIds: string[] = [];
      for (let i = 0; i < result.candidates.length; i++) {
        if (hooks.isCancelled()) throw new CancelledError();
        const versionId = await storeCandidate(
          job,
          targetAssetId,
          userId,
          result.candidates[i],
          i,
          result.candidates.length,
          result.seedUsed,
        );
        versionIds.push(versionId);
        addJobEvent(jobId, "candidate.created", `Candidate ${i} stored`, {
          asset_id: targetAssetId,
          version_id: versionId,
        });
      }

      // Link the first output back to the creative object that requested it.
      if (versionIds.length > 0) {
        if (job.storyboard_panel_id) {
          setPanelPreview(job.storyboard_panel_id, versionIds[0]);
          addJobEvent(jobId, "panel.linked", "Panel preview linked", {
            version_id: versionIds[0],
          });
        }
        if (job.shot_id) {
          setShotGenerated(job.shot_id, versionIds[0]);
          addJobEvent(jobId, "shot.linked", "Shot output linked", {
            version_id: versionIds[0],
          });
        }
      }

      finishJob(jobId, "succeeded", {
        outputAssetVersionId: versionIds[0] ?? undefined,
        candidateCount: versionIds.length,
        candidateVersionIds: versionIds,
        progress: 100,
      });
    } catch (err) {
      if (err instanceof CancelledError) {
        finishJob(jobId, "cancelled");
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      finishJob(jobId, "failed", { errorText: message });
    } finally {
      clearInterval(leaseRenewal);
    }
  }

  function tick(): void {
    if (stopping) return;
    recoverStaleJobs();

    for (;;) {
      const next = listJobs({ status: "queued", limit: 1 })[0];
      if (!next) break;
      const model = next.model_id ? getModel(next.model_id) : undefined;
      const isGpu = model ? model.backend !== "mock" : false;
      const running = countRunningJobs();
      if (
        isGpu ? running.gpu >= gpuConcurrency : running.cpu >= cpuConcurrency
      ) {
        break;
      }
      const claimed = claimJob(owner, leaseSeconds);
      if (!claimed) break;
      addJobEvent(claimed.id, "claimed", "Job claimed by runner", { owner });
      const p = executeJob(claimed).finally(() => executing.delete(p));
      executing.add(p);
    }
  }

  function armTimer(): void {
    timer = setTimeout(() => {
      tick();
      armTimer();
    }, pollMs);
    Deno.unrefTimer(timer); // never keep the process alive on our own
  }

  // Recover jobs left running by a previous process, then start polling.
  recoverStaleJobs();
  armTimer();

  return {
    owner,
    async stop(): Promise<void> {
      stopping = true;
      if (timer !== undefined) clearTimeout(timer);
      await Promise.allSettled([...executing]);
    },
  };
}

/**
 * Re-queue a job on a different device (e.g. shift a CPU generation to the
 * GPU once it frees up). The old run is cancelled (or is already terminal) and
 * the job is re-queued with only `settings.device` changed — every other
 * setting (prompt, seed, candidates, model, references, …) is preserved.
 * `cpu`/`cuda` are the only devices a runner can honor; other backends
 * (comfyui, mock) ignore `device`, so their jobs are rejected. A running job
 * settles to `cancelled` before the re-queue so the target lane can start it.
 */
export async function requeueJobOnDevice(
  id: string,
  device: string,
): Promise<GenerationJob> {
  const job = getJob(id);
  if (!job) throw notFound("Job not found");
  if (device !== "cpu" && device !== "cuda") {
    throw badRequest("device must be 'cpu' or 'cuda'");
  }
  const model = job.model_id ? getModel(job.model_id) : undefined;
  if (!model || model.backend !== "local_cli") {
    throw badRequest("Only local_cli model jobs can be shifted between devices");
  }
  if (job.status === "cancelling") {
    throw badRequest("Job is already cancelling; wait for it to settle");
  }
  if (job.status === "running") {
    finishJob(id, "cancelling");
    // Wait for the runner's cancel poll to settle the job before re-queueing.
    const deadline = Date.now() + 30_000;
    for (;;) {
      const current = getJob(id);
      if (
        current && (current.status === "cancelled" ||
          current.status === "failed" || current.status === "succeeded")
      ) break;
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } else if (job.status === "queued") {
    finishJob(id, "cancelled", { progress: 0 });
  }
  // Terminal (succeeded/failed/cancelled) jobs need no settling.
  const retried = retryJob(id);
  if (!retried) throw notFound("Job not found");
  setJobSettings(retried.id, { ...job.settings, device });
  const updated = getJob(id);
  if (!updated) throw notFound("Job not found");
  return updated;
}

/**
 * Queue a proxy generation job for a freshly stored version (ingest hook).
 * Returns the job, or null when the version is not proxyable (no master
 * file, or an asset type without a defined proxy).
 */
export function queueProxyGeneration(
  assetId: string,
  version: AssetVersion,
  userId: number,
  projectId: string | null,
): GenerationJob | null {
  const asset = getAssetById(assetId);
  if (!asset) return null;
  const kind = proxyKindFor(version.mime_type, asset.asset_type);
  if (!kind || !version.file_path) return null;
  return createJob(userId, {
    project_id: projectId ?? undefined,
    asset_id: assetId,
    job_type: PROXY_JOB_TYPE,
    settings: { media_kind: kind },
    input_asset_versions: [
      { asset_id: assetId, version_number: version.version_number },
    ],
  });
}
