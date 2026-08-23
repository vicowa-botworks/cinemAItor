import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { type Model, registerModel } from "../src/db/models.ts";
import {
  BENCHMARK_CANDIDATES,
  BENCHMARK_PROMPTS,
  BENCHMARKABLE_TASKS,
  benchmarkableTasksFor,
} from "../src/services/model_benchmark.ts";
import { type ModelBenchmarkResult } from "../src/db/models.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";
import { resetContentStore } from "../src/storage/content_store.ts";

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

function fakeModel(taskTypes: string[]): Model {
  return {
    task_types: taskTypes,
  } as unknown as Model;
}

describe("model benchmark units", () => {
  it("keeps only input-less task types, in benchmark order", () => {
    assertEquals(
      benchmarkableTasksFor(
        fakeModel(["transcribe", "music", "text_to_image"]),
      ),
      ["text_to_image", "music"],
    );
    assertEquals(
      benchmarkableTasksFor(fakeModel(["image_to_video", "transcribe"])),
      [],
    );
    assertEquals(
      benchmarkableTasksFor(
        fakeModel(["text_to_image", "text_to_video", "audio", "music", "voice"]),
      ),
      [...BENCHMARKABLE_TASKS],
    );
  });

  it("covers every benchmarkable task with a deterministic prompt", () => {
    for (const task of BENCHMARKABLE_TASKS) {
      assert(BENCHMARK_PROMPTS[task].length > 0, `missing prompt for ${task}`);
    }
  });
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

let baseUrl = "";
let ownerToken: string;
let ownerId: number;
let benchModelId: string;
let inputOnlyModelId: string;
let appDataDir = "";

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, json };
}

async function waitJob(
  jobId: string,
  token: string,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const { status, json } = await req(
      "GET",
      `/api/v1/jobs/${jobId}`,
      undefined,
      token,
    );
    assertEquals(status, 200);
    const job = json as Record<string, unknown>;
    if (["succeeded", "failed", "cancelled"].includes(String(job.status))) {
      assertEquals(job.status, "succeeded");
      return job;
    }
    if (Date.now() - start > 8000) throw new Error("job stuck");
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function installModel(modelId: string): Promise<void> {
  const res = await req(
    "POST",
    `/api/v1/models/${modelId}/install`,
    {},
    ownerToken,
  );
  assertEquals(res.status, 201);
}

function runBenchmark(
  modelId: string,
  token: string = ownerToken,
): Promise<{ status: number; json: unknown }> {
  return req("POST", `/api/v1/models/${modelId}/benchmark`, {}, token);
}

describe("model benchmark api", () => {
  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_bench_api_" });
    Deno.env.set("APP_DATA_DIR", appDataDir);
    resetContentStore();

    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(health.status, 200);

      const res = await req(
        "POST",
        "/api/v1/auth/bootstrap",
        {
          email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Studio Admin",
        },
      );
      assertEquals(res.status, 201);
      const user = res.json as { token: string; user: { id: number } };
      ownerToken = user.token;
      ownerId = user.user.id;

      benchModelId = registerModel(ownerId, {
        name: "api-mock-bench",
        version: "1.0",
        backend: "mock",
        task_types: ["image_to_video", "text_to_image", "music", "voice"],
        enabled: true,
      }).id;
      await installModel(benchModelId);

      inputOnlyModelId = registerModel(ownerId, {
        name: "api-mock-inputs",
        version: "1.0",
        backend: "mock",
        task_types: ["image_to_video", "transcribe"],
        enabled: true,
      }).id;
      await installModel(inputOnlyModelId);
    });
  });

  afterEach(() => {
    closeDb();
    Deno.removeSync(appDataDir, { recursive: true });
  });

  it("benchmarks each input-less task type and records measurement rows", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await runBenchmark(benchModelId);
        assertEquals(res.status, 202);
        const body = res.json as {
          job_id: string;
          tasks: string[];
          seed: string;
        };
        assertEquals(body.tasks, ["text_to_image", "music", "voice"]);
        assertEquals(body.seed, `bench-${benchModelId}`);

        const job = await waitJob(body.job_id, ownerToken);
        // Two candidates per task for the three benchmarkable tasks.
        assertEquals(job.candidate_count, BENCHMARK_CANDIDATES * 3);

        const listRes = await req(
          "GET",
          `/api/v1/models/${benchModelId}/benchmarks`,
          undefined,
          ownerToken,
        );
        assertEquals(listRes.status, 200);
        const rows = (listRes.json as { benchmarks: ModelBenchmarkResult[] })
          .benchmarks;
        assertEquals(rows.length, 3);
        const seenTasks = rows.map((r) => r.task_type).sort();
        assertEquals(seenTasks, ["music", "text_to_image", "voice"]);
        for (const row of rows) {
          assertEquals(row.model_id, benchModelId);
          assertEquals(row.job_id, body.job_id);
          assertEquals(row.candidate_count, BENCHMARK_CANDIDATES);
          assert(row.duration_ms >= 1);
          assert(row.output_bytes > 0);
          assertEquals(row.seed, `bench-${benchModelId}`);
        }

        // Benchmarks are measurements only: nothing lands in the asset library.
        const assets = await req(
          "GET",
          "/api/v1/assets",
          undefined,
          ownerToken,
        );
        assertEquals(assets.status, 200);
        assertEquals(assets.json, []);
      })();
    });
  });

  it("lists results newest-first and a second run appends rows", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const first = await runBenchmark(benchModelId);
        const jobId1 = (first.json as { job_id: string }).job_id;
        await waitJob(jobId1, ownerToken);

        const second = await runBenchmark(benchModelId);
        const jobId2 = (second.json as { job_id: string }).job_id;
        await waitJob(jobId2, ownerToken);

        const listRes = await req(
          "GET",
          `/api/v1/models/${benchModelId}/benchmarks`,
          undefined,
          ownerToken,
        );
        const rows = (listRes.json as { benchmarks: Record<string, unknown>[] })
          .benchmarks;
        assertEquals(rows.length, 6);
        assertEquals(rows.slice(0, 3).every((r) => r.job_id === jobId2), true);
        assertEquals(rows.slice(3).every((r) => r.job_id === jobId1), true);

        // Other models stay empty.
        const other = await req(
          "GET",
          `/api/v1/models/${inputOnlyModelId}/benchmarks`,
          undefined,
          ownerToken,
        );
        assertEquals(other.status, 200);
        assertEquals((other.json as { benchmarks: unknown[] }).benchmarks, []);
      })();
    });
  });

  it("rejects invalid benchmark requests", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const missing = await runBenchmark("no-such-model");
        assertEquals(missing.status, 404);

        const uninstalled = registerModel(ownerId, {
          name: "api-mock-uninstalled",
          version: "1.0",
          backend: "mock",
          task_types: ["text_to_image"],
          enabled: true,
        }).id;
        const notInstalled = await runBenchmark(uninstalled);
        assertEquals(notInstalled.status, 400);
        assertEquals(
          (notInstalled.json as { error: { message: string } }).error.message,
          "Model is not installed",
        );

        const inputOnly = await runBenchmark(inputOnlyModelId);
        assertEquals(inputOnly.status, 400);
        assert(
          (inputOnly.json as { error: { message: string } }).error.message
            .includes("benchmarkable"),
        );

        const disable = await req(
          "PATCH",
          `/api/v1/models/${benchModelId}`,
          { enabled: false },
          ownerToken,
        );
        assertEquals(disable.status, 200);
        const disabled = await runBenchmark(benchModelId);
        assertEquals(disabled.status, 400);
        assertEquals(
          (disabled.json as { error: { message: string } }).error.message,
          "Model is disabled",
        );

        const noAuth = await req(
          "POST",
          `/api/v1/models/${benchModelId}/benchmark`,
          {},
        );
        assertEquals(noAuth.status, 401);
      })();
    });
  });

  it("removes benchmark rows when the model is deleted", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await runBenchmark(benchModelId);
        await waitJob((res.json as { job_id: string }).job_id, ownerToken);

        const del = await req(
          "DELETE",
          `/api/v1/models/${benchModelId}`,
          undefined,
          ownerToken,
        );
        assertEquals(del.status, 200);

        const listRes = await req(
          "GET",
          `/api/v1/models/${benchModelId}/benchmarks`,
          undefined,
          ownerToken,
        );
        assertEquals(listRes.status, 404);
      })();
    });
  });
});
