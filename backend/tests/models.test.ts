import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { Application } from "@oak/oak";
import { getDb, resetDb } from "../src/db/database.ts";
import * as schema from "../src/db/schema.ts";
import {
  deleteModel,
  findModelsForTask,
  getModel,
  listModels,
  registerModel,
  setModelHealth,
  setModelInstalled,
  updateModel,
} from "../src/db/models.ts";
import { type StorageLayout, storageLayout } from "../src/storage/paths.ts";
import {
  fileExists,
  installFromLocal,
  installFromUrl,
  modelDir,
  modelFile,
  removeModelFiles,
  verifyModelFile,
} from "../src/services/model_files.ts";
import { checkModelHealth } from "../src/services/model_health.ts";
import {
  detectHardware,
  type HardwareInfo,
  modelRequirementWarnings,
  parseNvidiaSmiMemory,
} from "../src/services/hardware.ts";

let dataDir = "";
let layout: StorageLayout;
let userId: number;

function fakeHardware(overrides: Partial<HardwareInfo> = {}): HardwareInfo {
  return {
    platform: "linux",
    arch: "x86_64",
    cpu_count: 8,
    mem_total_mb: 16_384,
    gpu: {
      vendor: "nvidia",
      model: "Test GPU",
      vram_mb: 4096,
      vram_used_mb: 0,
      driver_version: "550.0",
      cuda_version: "12.4",
    },
    detected_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function writeSourceFile(name: string, content: Uint8Array): Promise<string> {
  const path = join(dataDir, name);
  await Deno.writeFile(path, content);
  return path;
}

describe("model manager", () => {
  beforeEach(() => {
    getDb(":memory:");
    userId = schema.createUser(
      `owner.${Math.random().toString(36).slice(2)}@example.com`,
      "hash123",
      "Owner",
    );
    dataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_models_test_" });
    layout = storageLayout(dataDir);
  });

  afterEach(() => {
    resetDb();
    Deno.removeSync(dataDir, { recursive: true });
  });

  function registerT2I(name = "test-sd", extra: Record<string, unknown> = {}) {
    return registerModel(userId, {
      name,
      version: "1.0",
      backend: "local_cli",
      source: "local",
      license: "OpenRAIL",
      task_types: ["text_to_image"],
      output_types: ["image"],
      default_settings: { steps: 20 },
      vram_requirement_mb: 4096,
      dependencies: ["python3"],
      ...extra,
    });
  }

  it("registers, lists, gets and filters models", () => {
    const m1 = registerT2I("alpha", { enabled: true });
    registerT2I("beta", {
      task_types: ["image_to_video"],
      default_settings: { endpoint: "http://127.0.0.1:9999" },
    });
    registerT2I("gamma", { enabled: false });

    assertEquals(listModels().length, 3);
    assertEquals(listModels({ enabled: true }).length, 2);
    const t2i = listModels({ task_type: "text_to_image" });
    assertEquals(t2i.length, 2);
    assertEquals(t2i.map((m) => m.name).sort(), ["alpha", "gamma"]);
    const i2v = listModels({ task_type: "image_to_video" });
    assertEquals(i2v.length, 1);
    assertEquals(i2v[0].name, "beta");

    const fetched = getModel(m1.id);
    assert(fetched);
    assertEquals(fetched.name, "alpha");
    assertEquals(fetched.backend, "local_cli");
    assertEquals(fetched.task_types, ["text_to_image"]);
    assertEquals(fetched.default_settings, { steps: 20 });
    assertEquals(fetched.license, "OpenRAIL");
    assertEquals(fetched.enabled, true);
    assertEquals(fetched.installed_at, null);
    assertEquals(fetched.health_status, null);
  });

  it("rejects invalid registration input", () => {
    assertThrows(
      () => registerModel(userId, { name: "", version: "1", backend: "mock" }),
      Error,
      "name is required",
    );
    assertThrows(
      () => registerModel(userId, { name: "x", version: "1", backend: "nope" as "mock" }),
      Error,
      "backend must be one of",
    );
    assertThrows(
      () =>
        registerModel(userId, {
          name: "x",
          version: "1",
          backend: "mock",
          task_types: ["bogus_task"],
        }),
      Error,
      "unknown task type",
    );
  });

  it("task mapping returns only usable models for a task", () => {
    const m1 = registerT2I("t2i-model");
    const m2 = registerModel(userId, {
      name: "i2v-model",
      version: "1.0",
      backend: "local_cli",
      task_types: ["image_to_video"],
      enabled: false,
    });
    const t2i = findModelsForTask("text_to_image");
    assertEquals(t2i.map((m) => m.id), [m1.id]);
    const i2vEnabled = findModelsForTask("image_to_video");
    assertEquals(i2vEnabled.length, 0);
    const i2vAll = findModelsForTask("image_to_video", false);
    assertEquals(i2vAll.map((m) => m.id), [m2.id]);
  });

  it("updates models including enable/disable", () => {
    const m = registerT2I();
    const disabled = updateModel(userId, m.id, { enabled: false });
    assert(disabled);
    assertEquals(disabled.enabled, false);
    const reenabled = updateModel(userId, m.id, {
      enabled: true,
      license: "MIT",
      default_settings: { steps: 30 },
    });
    assert(reenabled);
    assertEquals(reenabled.enabled, true);
    assertEquals(reenabled.license, "MIT");
    assertEquals(reenabled.default_settings, { steps: 30 });

    assertEquals(
      updateModel(userId, "missing-id", { enabled: true }),
      undefined,
    );
    assertThrows(
      () => updateModel(userId, m.id, { task_types: ["bogus"] }),
      Error,
      "unknown task type",
    );
  });

  it("installs a local model with checksum", async () => {
    const m = registerT2I();
    const source = await writeSourceFile("model-src.bin", new Uint8Array([1, 2, 3, 4]));

    const result = await installFromLocal(layout, m.id, source);
    assert(result.fileHash.length === 64);
    assertEquals(result.fileBytes, 4);

    const installed = setModelInstalled(m.id, result.fileHash);
    assert(installed);
    assertEquals(installed.file_hash, result.fileHash);
    assertEquals(installed.installed_at !== null, true);
    const file = modelFile(layout, m.id);
    const stat = await Deno.stat(file);
    assertEquals(stat.size, 4);
  });

  it("install from local rejects missing sources", async () => {
    const m = registerT2I();
    await assertRejects(
      () => installFromLocal(layout, m.id, join(dataDir, "nope.bin")),
      Error,
      "does not exist",
    );
  });

  it("verifies checksums and detects tampering", async () => {
    const m = registerT2I();
    const source = await writeSourceFile("m.bin", new Uint8Array([9, 9, 9]));
    const result = await installFromLocal(layout, m.id, source);
    const installed = setModelInstalled(m.id, result.fileHash);
    assert(installed);
    assert(installed.file_hash);

    const ok = await verifyModelFile(layout, m.id, installed.file_hash);
    assertEquals(ok.valid, true);

    await Deno.writeFile(modelFile(layout, m.id), new Uint8Array([0, 0, 0]));
    const bad = await verifyModelFile(layout, m.id, installed.file_hash);
    assertEquals(bad.valid, false);
    assert(bad.message.includes("mismatch"));
  });

  async function mockDownloadServerApp(app: Application): Promise<{
    url: string;
    stop: () => void;
  }> {
    const probe = await Deno.listen({ port: 0, hostname: "127.0.0.1" });
    const port = (probe.addr as Deno.NetAddr).port;
    await probe.close();
    const abort = new AbortController();
    const listenP = app.listen({ port, hostname: "127.0.0.1", signal: abort.signal });
    listenP.catch(() => {}); // aborted in stop(); nothing to do
    // Wait until the mock server answers.
    for (let i = 0; i < 100; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    return { url: `http://127.0.0.1:${port}`, stop: () => abort.abort() };
  }

  function mockDownloadServer(body: Uint8Array) {
    const app = new Application();
    app.use((ctx) => {
      ctx.response.body = body;
      ctx.response.status = 200;
    });
    return mockDownloadServerApp(app);
  }

  interface ScriptedRequest {
    path: string;
    range: string | null;
    attempt: number;
  }

  interface ScriptedResponse {
    status: number;
    body?: Uint8Array;
    /** Advertise this Content-Length; if bigger than the body, simulates a truncated transfer. */
    truncatedContentLength?: number;
    contentRange?: string;
  }

  /** A mock download server driven by a per-path request script. */
  async function scriptedDownloadServer(
    script: (req: ScriptedRequest) => ScriptedResponse,
  ): Promise<{ url: string; requests: ScriptedRequest[]; stop: () => void }> {
    const requests: ScriptedRequest[] = [];
    const attempts = new Map<string, number>();
    const app = new Application();
    app.use((ctx) => {
      const path = ctx.request.url.pathname;
      const attempt = (attempts.get(path) ?? 0) + 1;
      attempts.set(path, attempt);
      const req: ScriptedRequest = { path, range: ctx.request.headers.get("range"), attempt };
      requests.push(req);
      const res = script(req);
      ctx.response.status = res.status;
      if (res.contentRange) ctx.response.headers.set("Content-Range", res.contentRange);
      if (res.status === 416) {
        ctx.response.body = new Uint8Array(0);
        return;
      }
      const body = res.body ?? new Uint8Array(0);
      if (res.truncatedContentLength !== undefined) {
        ctx.response.headers.set("Content-Length", String(res.truncatedContentLength));
        ctx.response.body = new ReadableStream({
          start(c) {
            c.enqueue(body);
            c.close();
          },
        });
      } else {
        ctx.response.body = body;
      }
    });
    return { ...(await mockDownloadServerApp(app)), requests };
  }

  it("installs from a URL source", async () => {
    const m = registerModel(userId, {
      name: "url-model",
      version: "1.0",
      backend: "mock",
      source: "url",
      repository_url: "",
    });
    const payload = new Uint8Array([...Array(256).keys()].map((i) => i % 251));
    const mock = await mockDownloadServer(payload);
    try {
      const result = await installFromUrl(layout, m.id, `${mock.url}/model.bin`, {
        maxBytes: 1024 * 1024,
      });
      assertEquals(result.fileBytes, 256);
      assertEquals(
        (await verifyModelFile(layout, m.id, result.fileHash)).valid,
        true,
      );
    } finally {
      mock.stop();
    }
  });

  it("url install rejects oversized payloads", async () => {
    const m = registerT2I();
    const mock = await mockDownloadServer(new Uint8Array(5).fill(1));
    try {
      await assertRejects(
        () => installFromUrl(layout, m.id, `${mock.url}/big`, { maxBytes: 2 }),
        Error,
        "exceeds limit",
      );
    } finally {
      mock.stop();
    }
  });

  it("url install streams to disk with no size limit when maxBytes is 0", async () => {
    const m = registerT2I();
    const payload = new Uint8Array(64 * 1024);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
    const mock = await mockDownloadServer(payload);
    try {
      const result = await installFromUrl(layout, m.id, `${mock.url}/model.bin`, {
        maxBytes: 0,
      });
      assertEquals(result.fileBytes, payload.length);
      assertEquals((await verifyModelFile(layout, m.id, result.fileHash)).valid, true);
      const dirEntries: string[] = [];
      for await (const entry of Deno.readDir(modelDir(layout, m.id))) {
        dirEntries.push(entry.name);
      }
      assertEquals(dirEntries, ["model.bin"]);
    } finally {
      mock.stop();
    }
  });

  it("url install enforces the cap mid-stream without Content-Length and cleans up", async () => {
    const m = registerT2I();
    const app = new Application();
    app.use((ctx) => {
      if (!ctx.request.url.pathname.endsWith("/model.bin")) {
        ctx.response.body = new Uint8Array(0);
        return;
      }
      // Chunked body (no Content-Length) larger than the 2-byte cap.
      ctx.response.body = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(8).fill(9));
          c.close();
        },
      });
    });
    const mock = await mockDownloadServerApp(app);
    try {
      await assertRejects(
        () => installFromUrl(layout, m.id, `${mock.url}/model.bin`, { maxBytes: 2 }),
        Error,
        "exceeds limit",
      );
    } finally {
      mock.stop();
    }
    assert(!(await fileExists(modelFile(layout, m.id))));
    const leftovers: string[] = [];
    for await (const entry of Deno.readDir(modelDir(layout, m.id))) {
      leftovers.push(entry.name);
    }
    assertEquals(leftovers, []);
  });

  it("url install resumes from the part file after a mid-stream failure", async () => {
    const m = registerT2I();
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const mock = await scriptedDownloadServer((req) => {
      if (req.path !== "/resume") return { status: 200, body: new Uint8Array(0) };
      if (req.attempt === 1) {
        // First pass dies after 4 of 10 bytes.
        return { status: 200, body: payload.subarray(0, 4), truncatedContentLength: 10 };
      }
      // Second pass must resume the Range request.
      return { status: 206, body: payload.subarray(4), contentRange: "bytes 4-9/10" };
    });
    try {
      const result = await installFromUrl(layout, m.id, `${mock.url}/resume`, {
        maxBytes: 0,
        retryBaseDelayMs: 5,
        retryMaxDelayMs: 20,
      });
      assertEquals(result.fileBytes, 10);
      const onDisk = new Uint8Array(await Deno.readFile(modelFile(layout, m.id)));
      assertEquals(onDisk, payload);
      const res = mock.requests.filter((r) => r.path === "/resume");
      assertEquals(res.length, 2);
      assertEquals(res[0].range, null);
      assertEquals(res[1].range, "bytes=4-");
      assert(!(await fileExists(`${modelFile(layout, m.id)}.part`)));
    } finally {
      mock.stop();
    }
  });

  it("url install restarts cleanly when the server ignores Range", async () => {
    const m = registerT2I();
    const payload = new Uint8Array(10).fill(7);
    const mock = await scriptedDownloadServer((req) => {
      if (req.path !== "/full") return { status: 200, body: new Uint8Array(0) };
      if (req.attempt === 1) {
        return { status: 200, body: payload.subarray(0, 3), truncatedContentLength: 10 };
      }
      // Second pass: the server ignores Range and sends the whole file again.
      return { status: 200, body: payload };
    });
    try {
      const result = await installFromUrl(layout, m.id, `${mock.url}/full`, {
        maxBytes: 0,
        retryBaseDelayMs: 5,
        retryMaxDelayMs: 20,
      });
      assertEquals(result.fileBytes, 10);
      // Must be the full 10 bytes, not a 3 + 10 concatenation.
      const onDisk = new Uint8Array(await Deno.readFile(modelFile(layout, m.id)));
      assertEquals(onDisk, payload);
      const res = mock.requests.filter((r) => r.path === "/full");
      assertEquals(res.length, 2);
      assertEquals(res[1].range, "bytes=3-");
    } finally {
      mock.stop();
    }
  });

  it("url install finalizes a complete part file when the server answers 416", async () => {
    const m = registerT2I();
    const payload = new Uint8Array(10).fill(42);
    const mock = await scriptedDownloadServer((req) => {
      if (req.path !== "/done") return { status: 200, body: new Uint8Array(0) };
      return { status: 416, contentRange: "bytes */10" };
    });
    const partUrl = `${mock.url}/done`;
    await Deno.mkdir(modelDir(layout, m.id), { recursive: true });
    await Deno.writeFile(`${modelFile(layout, m.id)}.part`, payload);
    await Deno.writeTextFile(`${modelFile(layout, m.id)}.part.url`, partUrl);
    try {
      const result = await installFromUrl(layout, m.id, `${mock.url}/done`, {
        maxBytes: 0,
        retryBaseDelayMs: 5,
      });
      assertEquals(result.fileBytes, 10);
      const onDisk = new Uint8Array(await Deno.readFile(modelFile(layout, m.id)));
      assertEquals(onDisk, payload);
      assert(!(await fileExists(`${modelFile(layout, m.id)}.part`)));
    } finally {
      mock.stop();
    }
  });

  it("url install discards a part file left by a different source url", async () => {
    const m = registerT2I();
    const payload = new Uint8Array(5).fill(3);
    const mock = await scriptedDownloadServer((req) => {
      if (req.path !== "/other") return { status: 200, body: new Uint8Array(0) };
      return { status: 200, body: payload };
    });
    await Deno.mkdir(modelDir(layout, m.id), { recursive: true });
    await Deno.writeFile(`${modelFile(layout, m.id)}.part`, new Uint8Array(2).fill(99));
    await Deno.writeTextFile(
      `${modelFile(layout, m.id)}.part.url`,
      "https://example.com/some-old-weight.bin",
    );
    try {
      const result = await installFromUrl(layout, m.id, `${mock.url}/other`, {
        maxBytes: 0,
        retryBaseDelayMs: 5,
      });
      assertEquals(result.fileBytes, 5);
      const onDisk = new Uint8Array(await Deno.readFile(modelFile(layout, m.id)));
      assertEquals(onDisk, payload);
      // The stale part was discarded, so exactly one fresh download happened.
      assertEquals(mock.requests.filter((r) => r.path === "/other").length, 1);
    } finally {
      mock.stop();
    }
  });

  it("url install retries transient 5xx responses before succeeding", async () => {
    const m = registerT2I();
    const payload = new Uint8Array(6).fill(9);
    const mock = await scriptedDownloadServer((req) => {
      if (req.path !== "/flaky") return { status: 200, body: new Uint8Array(0) };
      if (req.attempt === 1) return { status: 503, body: new Uint8Array(0) };
      return { status: 200, body: payload };
    });
    try {
      const result = await installFromUrl(layout, m.id, `${mock.url}/flaky`, {
        maxBytes: 0,
        retryBaseDelayMs: 5,
        retryMaxDelayMs: 20,
      });
      assertEquals(result.fileBytes, 6);
      assertEquals(mock.requests.filter((r) => r.path === "/flaky").length, 2);
    } finally {
      mock.stop();
    }
  });

  it("url install leaves no files behind on permanent HTTP errors", async () => {
    const m = registerT2I();
    const mock = await scriptedDownloadServer((req) => {
      if (req.path !== "/missing") return { status: 200, body: new Uint8Array(0) };
      return { status: 404, body: new Uint8Array(0) };
    });
    try {
      await assertRejects(
        () =>
          installFromUrl(layout, m.id, `${mock.url}/missing`, {
            maxBytes: 0,
            retryBaseDelayMs: 5,
          }),
        Error,
        "HTTP 404",
      );
      // Permanent errors are not retried.
      assertEquals(mock.requests.filter((r) => r.path === "/missing").length, 1);
    } finally {
      mock.stop();
    }
    assert(!(await fileExists(modelFile(layout, m.id))));
    const leftovers: string[] = [];
    for await (const entry of Deno.readDir(modelDir(layout, m.id))) {
      leftovers.push(entry.name);
    }
    assertEquals(leftovers, []);
  });

  it("health check: mock, missing file, deps, checksum, endpoint", async () => {
    // mock backend is healthy without files
    const mock = registerModel(userId, {
      name: "mock-model",
      version: "1.0",
      backend: "mock",
      task_types: ["text_to_image"],
    });
    const mockHealth = await checkModelHealth(layout, mock);
    assertEquals(mockHealth.status, "ok");

    // uninstalled non-mock model
    const notInstalled = registerT2I("uninstalled");
    const missingFile = await checkModelHealth(layout, notInstalled);
    assertEquals(missingFile.status, "error");
    assert(missingFile.message.includes("not installed"));

    // installed with no external dependencies: healthy
    const installed = registerModel(userId, {
      name: "health-model",
      version: "1.0",
      backend: "local_cli",
      task_types: ["text_to_image"],
    });
    const src = await writeSourceFile("health-src.bin", new Uint8Array([5, 5]));
    const res = await installFromLocal(layout, installed.id, src);
    const installedRow = setModelInstalled(installed.id, res.fileHash);
    assert(installedRow);
    const healthy = await checkModelHealth(layout, installedRow);
    assertEquals(healthy.status, "ok");

    // missing dependency
    const noDep = registerModel(userId, {
      name: "nodep-model",
      version: "1.0",
      backend: "local_cli",
      task_types: ["text_to_image"],
      dependencies: ["definitely_not_a_real_command_xyz"],
    });
    const src2 = await writeSourceFile("nd-src.bin", new Uint8Array([7]));
    const r2 = await installFromLocal(layout, noDep.id, src2);
    setModelInstalled(noDep.id, r2.fileHash);
    const depHealth = await checkModelHealth(layout, noDep);
    assertEquals(depHealth.status, "error");
    assert(depHealth.message.includes("definitely_not_a_real_command_xyz"));

    // checksum mismatch
    await Deno.writeFile(modelFile(layout, installed.id), new Uint8Array([6, 6]));
    const mismatch = await checkModelHealth(layout, installedRow);
    assertEquals(mismatch.status, "error");
    assert(mismatch.message.includes("mismatch"));

    // http endpoint unreachable
    const http = registerModel(userId, {
      name: "http-model",
      version: "1.0",
      backend: "local_http",
      task_types: ["text_to_image"],
      default_settings: { endpoint: "http://127.0.0.1:1/health" },
    });
    const src3 = await writeSourceFile("h-src.bin", new Uint8Array([8]));
    const r3 = await installFromLocal(layout, http.id, src3);
    setModelInstalled(http.id, r3.fileHash);
    const unreachable = await checkModelHealth(layout, http);
    assertEquals(unreachable.status, "error");
    assert(unreachable.message.includes("unreachable"));

    // health persistence
    const updated = setModelHealth(installedRow.id, "error", "boom");
    assertEquals(updated?.health_status, "error");
    assertEquals(updated?.health_error, "boom");
  });

  it("health check: remote backends are healthy without a local file", async () => {
    const comfyDown = registerModel(userId, {
      name: "comfy-remote-down",
      version: "1.0",
      backend: "comfyui",
      task_types: ["text_to_image"],
      default_settings: { endpoint: "http://127.0.0.1:1/health", workflow: { "1": {} } },
    });
    const unreachable = await checkModelHealth(layout, comfyDown);
    assertEquals(unreachable.status, "error");
    assert(unreachable.message.includes("unreachable"));

    const server = await mockDownloadServer(new Uint8Array([1]));
    try {
      const comfyUp = registerModel(userId, {
        name: "comfy-remote-up",
        version: "1.0",
        backend: "comfyui",
        task_types: ["text_to_image"],
        default_settings: { endpoint: `${server.url}/health`, workflow: { "1": {} } },
      });
      const ok = await checkModelHealth(layout, comfyUp);
      assertEquals(ok.status, "ok");
      assert(ok.message.includes("remote runtime"));
    } finally {
      server.stop();
    }
  });

  it("removes model files and registry entry", async () => {
    const m = registerT2I();
    const src = await writeSourceFile("rm-src.bin", new Uint8Array([3]));
    const res = await installFromLocal(layout, m.id, src);
    setModelInstalled(m.id, res.fileHash);
    assertEquals(await Deno.stat(modelFile(layout, m.id)).then((s) => s.isFile), true);

    const deleted = deleteModel(userId, m.id);
    assertEquals(deleted, true);
    await removeModelFiles(layout, m.id);
    let exists = true;
    try {
      await Deno.stat(modelFile(layout, m.id));
    } catch {
      exists = false;
    }
    assertEquals(exists, false);
    assertEquals(getModel(m.id), undefined);
  });

  it("detects hardware with a stable shape", async () => {
    const hw = await detectHardware();
    assertEquals(hw.platform, Deno.build.os);
    assert(hw.cpu_count >= 1);
    assert(hw.mem_total_mb === null || hw.mem_total_mb > 0);
    if (hw.gpu) {
      assertEquals(typeof hw.gpu.model, "string");
      assert(hw.gpu.vram_mb === null || hw.gpu.vram_mb > 0);
      assert(hw.gpu.vram_used_mb === null || hw.gpu.vram_used_mb >= 0);
    }
  });

  it("parses nvidia-smi memory values with units", () => {
    assertEquals(parseNvidiaSmiMemory("97871 MiB"), 97871);
    assertEquals(parseNvidiaSmiMemory("97871"), 97871);
    assertEquals(parseNvidiaSmiMemory("95.5 GB"), 97792);
    assertEquals(parseNvidiaSmiMemory("1 GB"), 1024);
    assertEquals(parseNvidiaSmiMemory("2048 KB"), 2);
    assertEquals(parseNvidiaSmiMemory("512 B"), 0);
    assertEquals(parseNvidiaSmiMemory(null), null);
    assertEquals(parseNvidiaSmiMemory(""), null);
    assertEquals(parseNvidiaSmiMemory("n/a"), null);
  });

  it("detects an nvidia gpu through nvidia-smi on PATH", async () => {
    const binDir = await Deno.makeTempDir();
    const bin = join(binDir, "nvidia-smi");
    // Argument-aware fake emulating an nvidia-smi where `cuda_version` is
    // still a valid --query-gpu field (drivers < 590).
    await Deno.writeTextFile(
      bin,
      [
        "#!/bin/sh",
        'case "$*" in',
        "  *--query-gpu=cuda_version*) printf '12.6\\n' ;;",
        "  *--query-gpu=*) printf 'NVIDIA RTX PRO 6000 Blackwell Max-Q, 97871 MiB, 2048 MiB, 570.81.09\\n' ;;",
        "  *) printf 'CUDA Version                                         : 12.6\\n' ;;",
        "esac",
        "",
      ].join("\n"),
    );
    await Deno.chmod(bin, 0o755);
    const oldPath = Deno.env.get("PATH") ?? "";
    Deno.env.set("PATH", `${binDir}:${oldPath}`);
    try {
      const hw = await detectHardware();
      assertEquals(hw.gpu?.vendor, "nvidia");
      assertEquals(hw.gpu?.model, "NVIDIA RTX PRO 6000 Blackwell Max-Q");
      assertEquals(hw.gpu?.vram_mb, 97871);
      assertEquals(hw.gpu?.vram_used_mb, 2048);
      assertEquals(hw.gpu?.driver_version, "570.81.09");
      assertEquals(hw.gpu?.cuda_version, "12.6");
    } finally {
      Deno.env.set("PATH", oldPath);
      await Deno.remove(binDir, { recursive: true });
    }
  });

  it("still detects the gpu when cuda_version is not a queryable field (driver >= 590)", async () => {
    const binDir = await Deno.makeTempDir();
    const bin = join(binDir, "nvidia-smi");
    // Emulates nvidia-smi 590+ (e.g. driver 595 on Blackwell): a query that
    // contains `cuda_version` fails the whole command, so the CUDA version
    // can only be read from the `-q` detailed output.
    await Deno.writeTextFile(
      bin,
      [
        "#!/bin/sh",
        'case "$*" in',
        "  *--query-gpu=cuda_version*) echo 'Field \"cuda_version\" is not a valid field to query.' >&2; exit 2 ;;",
        "  *--query-gpu=*) printf 'NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition, 97887 MiB, 85515 MiB, 595.84\\n' ;;",
        "  *) printf 'CUDA Version                                         : 13.2\\n' ;;",
        "esac",
        "",
      ].join("\n"),
    );
    await Deno.chmod(bin, 0o755);
    const oldPath = Deno.env.get("PATH") ?? "";
    Deno.env.set("PATH", `${binDir}:${oldPath}`);
    try {
      const hw = await detectHardware();
      assertEquals(hw.gpu?.vendor, "nvidia");
      assertEquals(hw.gpu?.model, "NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition");
      assertEquals(hw.gpu?.vram_mb, 97887);
      assertEquals(hw.gpu?.vram_used_mb, 85515);
      assertEquals(hw.gpu?.driver_version, "595.84");
      // Fallback to the `-q` detailed output must recover the CUDA version.
      assertEquals(hw.gpu?.cuda_version, "13.2");
    } finally {
      Deno.env.set("PATH", oldPath);
      await Deno.remove(binDir, { recursive: true });
    }
  });

  it("computes requirement warnings from hardware", async () => {
    const modelShape = {
      id: "m1",
      name: "Big Model",
      vram_requirement_mb: 8192,
      ram_requirement_mb: 32_768,
      dependencies: ["definitely_not_a_real_command_xyz"],
    };
    const hw = fakeHardware();
    const warnings = await modelRequirementWarnings(modelShape, hw);
    const text = warnings.map((w) => w.warning);
    assert(
      text.some((t) => t.includes("VRAM")),
      `expected vram warning in ${text}`,
    );
    assert(
      text.some((t) => t.includes("RAM")),
      `expected ram warning in ${text}`,
    );
    assert(
      text.some((t) => t.includes("Missing dependency")),
      `expected dependency warning in ${text}`,
    );

    const satisfied = await modelRequirementWarnings(
      { ...modelShape, vram_requirement_mb: 2048, ram_requirement_mb: 1024, dependencies: [] },
      hw,
    );
    assertEquals(satisfied.length, 0);

    const noGpu = await modelRequirementWarnings(modelShape, fakeHardware({ gpu: null }));
    assert(
      noGpu.some((w) => w.warning.includes("no GPU")),
      "expected missing GPU warning",
    );
  });

  it("writes audit entries for model lifecycle", () => {
    const m = registerT2I();
    updateModel(userId, m.id, { enabled: false });
    deleteModel(userId, m.id);
    const db = getDb();
    const actions = (
      db.prepare("SELECT action FROM audit_logs WHERE entity_type = 'model' ORDER BY rowid")
        .all() as unknown as { action: string }[]
    ).map((r) => r.action);
    assertEquals(actions, ["model.register", "model.disable", "model.remove"]);
  });
});
