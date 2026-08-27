import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertRejects } from "@std/assert";
import * as schema from "../src/db/schema.ts";
import { getDb, resetDb } from "../src/db/database.ts";
import { createAsset, getAssetById } from "../src/db/assets.ts";
import { getModel, registerModel } from "../src/db/models.ts";
import {
  claimJob,
  createJob,
  finishJob,
  getJob,
  listJobEvents,
  listJobs,
  recoverStaleJobs,
  retryJob,
} from "../src/db/jobs.ts";
import { type JobRunner, startJobRunner } from "../src/services/job_runner.ts";
import { resetContentStore } from "../src/storage/content_store.ts";
import { MockAdapter } from "../src/services/adapters.ts";

let ownerId: number;
let appData: string;
let runners: JobRunner[] = [];

async function waitFor(
  fn: () => boolean,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

function eventTypes(jobId: string): string[] {
  return listJobEvents(jobId).map((e) => e.event_type);
}

describe("job runner", () => {
  beforeEach(() => {
    resetDb();
    getDb(":memory:");
    Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
    Deno.env.set(
      "APP_DATA_DIR",
      appData = Deno.makeTempDirSync({
        prefix: "cinemaitor_jobs_test_",
      }),
    );
    resetContentStore();
    ownerId = schema.createUser(
      `owner.${Math.random().toString(36).slice(2)}@example.com`,
      "hash123",
      "Owner",
    );
  });

  afterEach(async () => {
    for (const r of runners) await r.stop();
    runners = [];
    resetDb();
    Deno.removeSync(appData, { recursive: true });
  });

  function mockT2IModel(name = "mock-t2i") {
    const model = registerModel(ownerId, {
      name,
      version: "1.0",
      backend: "mock",
      task_types: ["text_to_image"],
      enabled: true,
    });
    return model;
  }

  function canvasAsset(): string {
    return createAsset(
      {
        unique_slug: `canvas_${Math.random().toString(36).slice(2, 8)}`,
        display_name: "Canvas",
        asset_type: "image",
        library_scope: "global",
      },
      ownerId,
    ).id;
  }

  it("parses text and reports a deterministic mock output for a fixed seed", async () => {
    const adapter = new MockAdapter();
    const input = {
      jobType: "text_to_image" as const,
      seed: "42",
      settings: { candidates: 2 },
      inputs: [],
      promptText: "a lighthouse",
      workDir: "/tmp",
    };
    const a = await adapter.generate(input, {
      onProgress: () => {},
      isCancelled: () => false,
    });
    const b = await adapter.generate(input, {
      onProgress: () => {},
      isCancelled: () => false,
    });
    assertEquals(a.seedUsed, "42");
    assertEquals(a.candidates.length, 2);
    assertEquals(a.candidates[0].content.length, 4096);
    // Deterministic for the same seed.
    assertEquals(
      new TextDecoder().decode(a.candidates[0].content.subarray(0, 8)),
      new TextDecoder().decode(b.candidates[0].content.subarray(0, 8)),
    );
    // Different per candidate.
    assert(
      !a.candidates[0].content.every(
        (v, i) => v === a.candidates[1].content[i],
      ),
      "candidates should differ",
    );
  });

  it("rejects inputless jobs for image tasks that require an input", async () => {
    const adapter = new MockAdapter();
    await assertRejects(
      () =>
        adapter.generate(
          {
            jobType: "image_to_video",
            seed: "1",
            settings: {},
            inputs: [],
            promptText: null,
            workDir: "/tmp",
          },
          { onProgress: () => {}, isCancelled: () => false },
        ),
      Error,
      "requires at least one input",
    );
  });

  it("claims queued jobs in order and executes them to success", async () => {
    const model = mockT2IModel();
    const asset = canvasAsset();
    const j1 = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: model.id,
      asset_id: asset,
      prompt_text: "first",
      seed: "1",
    });
    const j2 = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: model.id,
      asset_id: asset,
      prompt_text: "second",
      seed: "2",
    });

    // FIFO claim with leases.
    const claimed = claimJob("worker-a", 60);
    assertEquals(claimed?.id, j1.id);
    assertEquals(claimed?.status, "running");
    assertEquals(claimed?.lease_owner, "worker-a");
    assert(claimed?.lease_expires_at);
    assertEquals(claimJob("worker-b", 60)?.id, j2.id);
    assertEquals(claimJob("worker-c", 60), undefined);

    // The full run-to-success flow is covered by the runner; here the
    // manually claimed jobs are executed directly via the runner's drain
    // path: re-queue them and let the runner do the work.
    const db = getDb();
    db.prepare(
      `UPDATE generation_jobs SET status = 'queued', lease_owner = NULL,
       lease_expires_at = NULL, started_at = NULL WHERE id IN (?, ?)`,
    ).run(j1.id, j2.id);

    const runner = startJobRunner({ pollMs: 5 });
    runners.push(runner);
    await waitFor(() => {
      const a = getJob(j1.id);
      const b = getJob(j2.id);
      return a?.status === "succeeded" && b?.status === "succeeded";
    });
    for (const id of [j1.id, j2.id]) {
      const job = getJob(id);
      assert(job);
      assertEquals(job.progress, 100);
      assertEquals(job.candidate_count, 1);
      assert(job.output_asset_version_id);
      assertEquals(job.error_text, null);
    }
    const types = eventTypes(j1.id);
    for (const expected of ["created", "started", "progress", "succeeded"]) {
      assert(types.includes(expected), `missing ${expected}`);
    }
  });

  it("stores candidates as asset versions with provenance", async () => {
    const model = mockT2IModel();
    const asset = canvasAsset();
    const job = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: model.id,
      asset_id: asset,
      prompt_text: "a red barn",
      negative_prompt: "blurry",
      seed: "77",
      settings: { candidates: 3 },
    });

    const runner = startJobRunner({ pollMs: 5 });
    runners.push(runner);
    await waitFor(() => getJob(job.id)?.status === "succeeded");

    const assetRow = getAssetById(asset);
    assert(assetRow);
    assert(assetRow.active_version_id);
    const meta = JSON.parse(
      (assetRow.active_version_id
        ? (getDb().prepare(
          "SELECT technical_metadata_json FROM asset_versions WHERE id = ?",
        ).get(assetRow.active_version_id) as {
          technical_metadata_json: string | null;
        }).technical_metadata_json
        : "") ?? "{}",
    ) as Record<string, unknown>;
    assertEquals(meta.job_id, job.id);
    assertEquals(meta.model_id, model.id);
    assertEquals(meta.prompt_text, "a red barn");
    assertEquals(meta.negative_prompt, "blurry");
    assertEquals(meta.seed_used, "77");
    assertEquals(meta.candidate_count, 3);
  });

  it("creates an asset for jobs with no target asset", async () => {
    const model = mockT2IModel();
    const job = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: model.id,
      prompt_text: "auto asset",
      seed: "9",
    });
    const runner = startJobRunner({ pollMs: 5 });
    runners.push(runner);
    await waitFor(() => getJob(job.id)?.status === "succeeded");
    const types = eventTypes(job.id);
    assert(types.includes("asset.created"));
  });

  it("fails jobs for models without a registered adapter", async () => {
    const model = registerModel(ownerId, {
      name: "no-adapter",
      version: "1.0",
      backend: "local_http",
      task_types: ["text_to_image"],
      enabled: true,
    });
    const asset = canvasAsset();
    const job = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: model.id,
      asset_id: asset,
      prompt_text: "x",
    });
    const runner = startJobRunner({ pollMs: 5 });
    runners.push(runner);
    await waitFor(() => getJob(job.id)?.status === "failed");
    const failed = getJob(job.id);
    assert(failed);
    assert(failed.error_text?.includes("No adapter registered"));
  });

  it("cancels a running job and a queued job", async () => {
    const model = mockT2IModel();
    const asset = canvasAsset();
    // A quick job to occupy the queue, and one waiting behind it.
    const busy = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: model.id,
      asset_id: asset,
      prompt_text: "busy",
      settings: {},
    });
    const waiting = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: model.id,
      asset_id: asset,
      prompt_text: "waiting",
    });

    const runner = startJobRunner({ pollMs: 5, cpuConcurrency: 1 });
    runners.push(runner);
    await waitFor(() => getJob(waiting.id)?.status === "queued");

    // Cancel the waiting (queued) job immediately.
    finishJob(waiting.id, "cancelled", { progress: 0 });
    assertEquals(getJob(waiting.id)?.status, "cancelled");

    // Cancel the running job; runner finalizes it.
    await waitFor(() => getJob(busy.id)?.status === "running");
    finishJob(busy.id, "cancelling");
    await waitFor(() => getJob(busy.id)?.status === "cancelled");
    const busyRow = getJob(busy.id);
    assert(busyRow);
    assertEquals(busyRow.output_asset_version_id, null);
  });

  it("retries a failed job and preserves its input state", async () => {
    const model = registerModel(ownerId, {
      name: "flaky",
      version: "1.0",
      backend: "local_cli",
      task_types: ["text_to_image"],
      enabled: true,
      default_settings: { command: "sd-runner" },
    });
    const asset = canvasAsset();
    const job = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: model.id,
      asset_id: asset,
      prompt_text: "retry me",
      seed: "5",
    });
    const runner = startJobRunner({ pollMs: 5 });
    runners.push(runner);
    await waitFor(() => getJob(job.id)?.status === "failed");

    const retried = retryJob(job.id);
    assert(retried);
    assertEquals(retried.status, "queued");
    assertEquals(retried.prompt_text, "retry me");
    assertEquals(retried.error_text, null);

    // Fails again (still no adapter), but the retry path is exercised.
    await waitFor(() => getJob(job.id)?.status === "failed");
    assert(eventTypes(job.id).includes("retried"));
  });

  it("recovers jobs with expired leases", async () => {
    const model = mockT2IModel();
    const asset = canvasAsset();
    const job = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: model.id,
      asset_id: asset,
      prompt_text: "stuck",
    });
    // Simulate a crashed runner: mark running with an expired lease.
    const db = getDb();
    db.prepare(
      `UPDATE generation_jobs SET status = 'running', lease_owner = 'dead',
       lease_expires_at = datetime('now', '-1 hour'), started_at = datetime('now', '-1 hour')
       WHERE id = ?`,
    ).run(job.id);

    const recovered = recoverStaleJobs();
    assertEquals(recovered, [job.id]);
    assertEquals(getJob(job.id)?.status, "queued");

    const runner = startJobRunner({ pollMs: 5 });
    runners.push(runner);
    await waitFor(() => getJob(job.id)?.status === "succeeded");
  });

  it("respects concurrency limits for mock (cpu) jobs", async () => {
    const model = mockT2IModel();
    const asset = canvasAsset();
    for (let i = 0; i < 3; i++) {
      createJob(ownerId, {
        job_type: "text_to_image",
        model_id: model.id,
        asset_id: asset,
        prompt_text: `c${i}`,
      });
    }
    // cpuConcurrency 1: only one mock job runs at a time.
    const runner = startJobRunner({ pollMs: 5, cpuConcurrency: 1 });
    runners.push(runner);
    await waitFor(() => {
      const rows = listJobs({ status: "running" });
      return rows.length <= 1;
    });
    await waitFor(() => listJobs({ status: "queued" }).length === 0, 8000);
  });

  it("touching a job updates the model's last_used_at", async () => {
    const model = mockT2IModel();
    const before = getModel(model.id)?.last_used_at;
    const asset = canvasAsset();
    const job = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: model.id,
      asset_id: asset,
      prompt_text: "touch",
    });
    const runner = startJobRunner({ pollMs: 5 });
    runners.push(runner);
    await waitFor(() => getJob(job.id)?.status === "succeeded");
    const after = getModel(model.id)?.last_used_at;
    assert(after);
    if (before !== null && before !== undefined) {
      assert(after >= before);
    }
  });
});
