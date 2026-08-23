import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { closeDb, getDb } from "../src/db/database.ts";
import * as schema from "../src/db/schema.ts";
import {
  createAsset,
  createAssetVersion,
  getAssetById,
  getAssetVersion,
  listAssetVersions,
} from "../src/db/assets.ts";
import { getJob } from "../src/db/jobs.ts";
import { getContentStore, resetContentStore } from "../src/storage/content_store.ts";
import {
  cleanupFilterChain,
  cleanupOutputFormat,
  ffmpegCleanupArgs,
  NORMALIZE_TARGETS,
  requestAudioCleanup,
} from "../src/services/audio_cleanup.ts";
import { type JobRunner, startJobRunner } from "../src/services/job_runner.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

function makeWav(seconds: number, sampleRate = 8000): Uint8Array<ArrayBuffer> {
  const n = Math.floor(seconds * sampleRate);
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
  for (let i = 0; i < n; i++) {
    view.setInt16(44 + i * 2, Math.floor(Math.sin(i / 10) * 3000), true);
  }
  return new Uint8Array(buf);
}

describe("audio cleanup: ffmpeg args", () => {
  it("builds the denoise-only filter chain", () => {
    assertEquals(
      cleanupFilterChain({ denoise: true, normalize: false }),
      "afftdn",
    );
  });

  it("builds the normalize-only filter chain", () => {
    assertEquals(
      cleanupFilterChain({ denoise: false, normalize: true }),
      NORMALIZE_TARGETS,
    );
  });

  it("orders denoise before normalize when both are selected", () => {
    assertEquals(
      cleanupFilterChain({ denoise: true, normalize: true }),
      `afftdn,${NORMALIZE_TARGETS}`,
    );
  });

  it("builds ffmpeg args with the wav codec map by default", () => {
    const args = ffmpegCleanupArgs(
      { denoise: true, normalize: true },
      "/src/master.wav",
      "/out/clean.wav",
      "wav",
    );
    const iInput = args.indexOf("/src/master.wav");
    const iAf = args.indexOf("-af");
    const iOut = args.indexOf("/out/clean.wav");
    assert(iInput > -1 && iAf > -1 && iOut === args.length - 1);
    assertEquals(args[iInput - 1], "-i");
    assertEquals(args[iAf + 1], `afftdn,${NORMALIZE_TARGETS}`);
    const codec = args.indexOf("pcm_s16le");
    assert(codec > iAf);
    assertEquals(args[codec - 1], "-c:a");
  });

  it("maps output codecs per source format", () => {
    const cases: Array<[string, string, string, string]> = [
      ["mp3", "libmp3lame", "mp3", "audio/mpeg"],
      ["m4a", "aac", "m4a", "audio/mp4"],
      ["aac", "aac", "aac", "audio/aac"],
      ["flac", "flac", "flac", "audio/flac"],
      ["ogg", "libvorbis", "ogg", "audio/ogg"],
      ["wav", "pcm_s16le", "wav", "audio/wav"],
      ["unknown", "pcm_s16le", "wav", "audio/wav"],
    ];
    for (const [format, codec, ext, mime] of cases) {
      const out = cleanupOutputFormat(format);
      assertEquals(`${format}:${out.extension}`, `${format}:${ext}`);
      assertEquals(out.mime_type, mime);
      const codecIdx = out.codecArgs.indexOf(codec);
      assert(codecIdx > 0);
      assertEquals(out.codecArgs[codecIdx - 1], "-c:a");
    }
  });
});

describe("audio cleanup: job creation", () => {
  let appDataDir = "";
  let owner: number;
  let other: number;
  let assetId: string;
  let versionId: string;

  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_audio_cleanup_" });
    Deno.env.set("APP_DATA_DIR", appDataDir);
    resetContentStore();
    freshMemoryDb();

    owner = schema.createUser(
      `owner.${Math.random().toString(36).slice(2)}@example.com`,
      "hash123",
      "Owner",
      "admin",
    );
    other = schema.createUser(
      `other.${Math.random().toString(36).slice(2)}@example.com`,
      "hash456",
      "Other",
    );

    const asset = createAsset(
      {
        unique_slug: `cle_${Math.random().toString(36).slice(2, 8)}`,
        display_name: "Cleanup source",
        asset_type: "music",
        library_scope: "global",
      },
      owner,
    );
    assetId = asset.id;

    const store = getContentStore();
    const tempPath = `${store.layout.cache}/.cleanup-src-test.tmp`;
    await Deno.mkdir(store.layout.cache, { recursive: true });
    await Deno.writeFile(tempPath, makeWav(0.25));
    const stored = await store.put(tempPath, "cleanup-src.wav");
    await Deno.remove(tempPath).catch(() => {});
    const version = createAssetVersion(assetId, owner, {
      content_hash: stored.hash,
      file_path: stored.path,
      format: "wav",
      mime_type: "audio/wav",
      file_size: stored.size,
      make_active: true,
    });
    versionId = version.id;
  });

  afterEach(() => {
    resetContentStore();
    closeDb();
    Deno.removeSync(appDataDir, { recursive: true });
  });

  it("enqueues a model-less audio_cleanup job", () => {
    const result = requestAudioCleanup(owner, assetId, versionId, {
      denoise: true,
      normalize: true,
    });
    assertEquals(result.job_type, "audio_cleanup");
    assertEquals(result.asset_id, assetId);
    assertEquals(result.source_version_id, versionId);
    assertEquals(result.source_version_number, 1);
    assertEquals(result.operations, { denoise: true, normalize: true });

    const job = getJob(result.job_id);
    assert(job);
    assertEquals(job.job_type, "audio_cleanup");
    assertEquals(job.model_id, null);
    assertEquals(job.asset_id, assetId);
    assertEquals(job.settings, { denoise: true, normalize: true });
    assertEquals(job.input_asset_versions, [
      { asset_id: assetId, version_number: 1 },
    ]);
  });

  it("rejects bodies without any operation", () => {
    for (const body of [{}, { denoise: false, normalize: false }]) {
      assertThrows(
        () => requestAudioCleanup(owner, assetId, versionId, body),
        Error,
        "denoise or normalize",
      );
    }
  });

  it("rejects unknown options", () => {
    assertThrows(
      () => requestAudioCleanup(owner, assetId, versionId, { loud: true }),
      Error,
      "Unknown cleanup option",
    );
  });

  it("rejects non-audio assets", () => {
    const video = createAsset(
      {
        unique_slug: `vid_${Math.random().toString(36).slice(2, 8)}`,
        display_name: "Video",
        asset_type: "video",
        library_scope: "global",
      },
      owner,
    );
    const v = createAssetVersion(video.id, owner, {
      content_hash: "0".repeat(64),
      file_path: null,
      format: "mp4",
      mime_type: "video/mp4",
      file_size: 1,
    });
    assertThrows(
      () => requestAudioCleanup(owner, video.id, v.id, { denoise: true }),
      Error,
      "not an audio asset",
    );
  });

  it("rejects versions of another asset (404)", () => {
    const second = createAsset(
      {
        unique_slug: `cle2_${Math.random().toString(36).slice(2, 8)}`,
        display_name: "Second",
        asset_type: "music",
        library_scope: "global",
      },
      owner,
    );
    assertThrows(
      () => requestAudioCleanup(owner, second.id, versionId, { denoise: true }),
      Error,
      "Asset version not found",
    );
  });

  it("rejects users without write permission (403)", () => {
    assertThrows(
      () => requestAudioCleanup(other, assetId, versionId, { denoise: true }),
    );
  });

  it("rejects versions whose master file is missing", () => {
    const orphan = createAssetVersion(assetId, owner, {
      content_hash: "0".repeat(64),
      file_path: `${appDataDir}/missing.wav`,
      format: "wav",
      mime_type: "audio/wav",
      file_size: 44,
    });
    assertThrows(
      () => requestAudioCleanup(owner, assetId, orphan.id, { denoise: true }),
      Error,
      "missing from the content store",
    );
  });
});

describe("audio cleanup: runner", () => {
  let appDataDir = "";
  let owner: number;
  let assetId: string;
  let versionId: string;
  const runners: JobRunner[] = [];
  let fakeDir = "";

  function writeFakeScripts(mode: "ok" | "fail"): { ffmpeg: string; ffprobe: string } {
    const ffmpeg = `${fakeDir}/ffmpeg`;
    if (mode === "ok") {
      Deno.writeTextFileSync(
        ffmpeg,
        [
          "#!/bin/sh",
          'case "$1" in -version) echo "ffmpeg fake version"; exit 0;; esac',
          "for last; do :; done",
          'case "$last" in -) exit 0;; esac',
          'printf "FAKE-CLEANUP-AUDIO" > "$last"',
          "exit 0",
        ].join("\n"),
      );
    } else {
      // -version succeeds so availability checks pass; the actual
      // conversion fails, which is the path under test.
      Deno.writeTextFileSync(
        ffmpeg,
        [
          "#!/bin/sh",
          'case "$1" in -version) echo "ffmpeg fake version"; exit 0;; esac',
          "echo 'boom: fake ffmpeg failure' 1>&2",
          "exit 1",
        ].join("\n"),
      );
    }
    Deno.chmodSync(ffmpeg, 0o755);
    const ffprobe = `${fakeDir}/ffprobe`;
    Deno.writeTextFileSync(ffprobe, "#!/bin/sh\nexit 1\n");
    Deno.chmodSync(ffprobe, 0o755);
    return { ffmpeg, ffprobe };
  }

  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_audio_cleanup_run_" });
    fakeDir = Deno.makeTempDirSync({ prefix: "cinemaitor_audio_cleanup_fake_" });
    Deno.env.set("APP_DATA_DIR", appDataDir);
    resetContentStore();
    freshMemoryDb();

    owner = schema.createUser(
      `run.${Math.random().toString(36).slice(2)}@example.com`,
      "hash789",
      "Runner owner",
      "admin",
    );

    const asset = createAsset(
      {
        unique_slug: `crun_${Math.random().toString(36).slice(2, 8)}`,
        display_name: "Cleanup runner source",
        asset_type: "voiceover",
        library_scope: "global",
      },
      owner,
    );
    assetId = asset.id;

    const store = getContentStore();
    const tempPath = `${store.layout.cache}/.runner-src-test.wav`;
    await Deno.mkdir(store.layout.cache, { recursive: true });
    await Deno.writeFile(tempPath, makeWav(0.25));
    const stored = await store.put(tempPath, "runner-src.wav");
    await Deno.remove(tempPath).catch(() => {});
    const version = createAssetVersion(assetId, owner, {
      content_hash: stored.hash,
      file_path: stored.path,
      format: "wav",
      mime_type: "audio/wav",
      file_size: stored.size,
      make_active: true,
    });
    versionId = version.id;
  });

  afterEach(() => {
    for (const runner of runners.splice(0)) runner.stop();
    resetContentStore();
    closeDb();
    Deno.removeSync(appDataDir, { recursive: true });
    if (fakeDir) {
      Deno.removeSync(fakeDir, { recursive: true });
      fakeDir = "";
    }
    Deno.env.delete("FFMPEG_PATH");
    Deno.env.delete("FFPROBE_PATH");
  });

  async function waitForJobTerminal(jobId: string): Promise<void> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const job = getJob(jobId);
      if (job && ["succeeded", "failed"].includes(job.status)) return;
      if (Date.now() > deadline) throw new Error(`job ${jobId} did not settle`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  it("runs an ffmpeg cleanup into a new non-active version", async () => {
    const { ffmpeg, ffprobe } = writeFakeScripts("ok");
    Deno.env.set("FFMPEG_PATH", ffmpeg);
    Deno.env.set("FFPROBE_PATH", ffprobe);

    const result = requestAudioCleanup(owner, assetId, versionId, {
      denoise: true,
      normalize: true,
    });
    const runner = startJobRunner({ pollMs: 5 });
    runners.push(runner);
    await waitForJobTerminal(result.job_id);

    const job = getJob(result.job_id);
    assert(job);
    assertEquals(job.status, "succeeded");
    const events = getDb()
      .prepare("SELECT event_type FROM job_events WHERE job_id = ?")
      .all(job.id) as Array<{ event_type: string }>;
    assert(events.some((e) => e.event_type === "cleanup.generated"));

    const versions = listAssetVersions(assetId); // DESC by version_number
    assertEquals(versions.length, 2);
    const cleaned = versions[0];
    assertEquals(cleaned.version_number, 2);
    assertEquals(cleaned.format, "wav");

    const meta = JSON.parse(cleaned.technical_metadata_json ?? "{}") as {
      audio: Record<string, unknown>;
      cleanup: {
        operations: { denoise: boolean; normalize: boolean };
        engine: string;
        source_version_id: string;
        source_version_number: number;
        job_id: string;
      };
    };
    assertEquals(meta.cleanup.engine, "ffmpeg");
    assertEquals(meta.cleanup.operations, { denoise: true, normalize: true });
    assertEquals(meta.cleanup.source_version_id, versionId);
    assertEquals(meta.cleanup.source_version_number, 1);
    assertEquals(meta.cleanup.job_id, job.id);
    // fake ffprobe fails and the fake ffmpeg writes no analysis stdout,
    // so the analysis falls back to the unavailable state.
    assertEquals(meta.audio.analysis_status, "unavailable");

    const bytes = await Deno.readFile(cleaned.file_path as string);
    assert(bytes.length > 0);
    assertEquals(
      new TextDecoder().decode(bytes).slice(0, 18),
      "FAKE-CLEANUP-AUDIO",
    );

    const assetRow = getAssetById(assetId);
    assert(assetRow);
    assertEquals(assetRow.active_version_id, versionId);
    assertEquals(job.output_asset_version_id, cleaned.id);
  });

  it("falls back to the mock engine when ffmpeg is unavailable", async () => {
    Deno.env.set("FFMPEG_PATH", `${fakeDir}/does-not-exist`);
    Deno.env.set("FFPROBE_PATH", `${fakeDir}/does-not-exist-probe`);

    const result = requestAudioCleanup(owner, assetId, versionId, {
      denoise: true,
    });
    const runner = startJobRunner({ pollMs: 5 });
    runners.push(runner);
    await waitForJobTerminal(result.job_id);

    const job = getJob(result.job_id);
    assert(job);
    assertEquals(job.status, "succeeded");
    const versions = listAssetVersions(assetId); // DESC by version_number
    assertEquals(versions.length, 2);
    const cleaned = versions[0];
    const meta = JSON.parse(cleaned.technical_metadata_json ?? "{}") as {
      cleanup: { engine: string };
    };
    assertEquals(meta.cleanup.engine, "mock");
    const head = new TextDecoder().decode(
      (await Deno.readFile(cleaned.file_path as string)).slice(0, 64),
    );
    assert(head.startsWith("MOCKCLEANUP:denoise:"), `got: ${head}`);
  });

  it("fails the job when ffmpeg exits non-zero", async () => {
    const { ffmpeg } = writeFakeScripts("fail");
    Deno.env.set("FFMPEG_PATH", ffmpeg);

    const result = requestAudioCleanup(owner, assetId, versionId, {
      normalize: true,
    });
    const runner = startJobRunner({ pollMs: 5 });
    runners.push(runner);
    await waitForJobTerminal(result.job_id);

    const job = getJob(result.job_id);
    assert(job);
    assertEquals(job.status, "failed");
    assert((job.error_text ?? "").includes("fake ffmpeg failure"));
    const versions = listAssetVersions(assetId);
    assertEquals(versions.length, 1);
  });
});

describe("audio cleanup: api", () => {
  let baseUrl = "";
  let ownerToken = "";
  let otherToken = "";
  let appDataDir = "";

  async function req(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<{ status: number; json: unknown }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as unknown;
    return { status: res.status, json };
  }

  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_audio_cleanup_api_" });
    Deno.env.set("APP_DATA_DIR", appDataDir);
    resetContentStore();

    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(health.status, 200);

      const admin = await req(
        "POST",
        "/api/v1/auth/bootstrap",
        {
          email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Studio Admin",
        },
      );
      assertEquals(admin.status, 201);
      ownerToken = (admin.json as { token: string }).token;

      const other = await req(
        "POST",
        "/api/auth/register",
        {
          email: `member.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Member",
        },
      );
      assertEquals(other.status, 201);
      otherToken = (other.json as { token: string }).token;
    });
  });

  afterEach(() => {
    resetContentStore();
    closeDb();
    Deno.removeSync(appDataDir, { recursive: true });
  });

  async function uploadWav(): Promise<{ assetId: string; versionId: string }> {
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([makeWav(0.5)], { type: "audio/wav" }),
      "take.wav",
    );
    const res = await fetch(`${baseUrl}/api/v1/audio/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownerToken}` },
      body: fd,
    });
    assertEquals(res.status, 201);
    const json = (await res.json()) as {
      asset: { id: string };
      version: { id: string };
    };
    return { assetId: json.asset.id, versionId: json.version.id };
  }

  it("rejects invalid cleanup bodies with 400", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { assetId, versionId } = await uploadWav();
        for (
          const body of [
            {},
            { denoise: false, normalize: false },
            { oops: true },
          ]
        ) {
          const res = await req(
            "POST",
            `/api/v1/audio/assets/${assetId}/versions/${versionId}/cleanup`,
            body,
            ownerToken,
          );
          assertEquals(res.status, 400);
        }
      })();
    });
  });

  it("rejects users without write access with 403", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { assetId, versionId } = await uploadWav();
        const res = await req(
          "POST",
          `/api/v1/audio/assets/${assetId}/versions/${versionId}/cleanup`,
          { denoise: true },
          otherToken,
        );
        assertEquals(res.status, 403);
      })();
    });
  });

  it("enqueues, runs, and creates a cleanup version", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const { assetId, versionId } = await uploadWav();
        const res = await req(
          "POST",
          `/api/v1/audio/assets/${assetId}/versions/${versionId}/cleanup`,
          { denoise: true, normalize: true },
          ownerToken,
        );
        assertEquals(res.status, 202);
        const queued = res.json as {
          job_id: string;
          job_type: string;
          source_version_number: number;
          operations: { denoise: boolean; normalize: boolean };
        };
        assertEquals(queued.job_type, "audio_cleanup");
        assertEquals(queued.source_version_number, 1);
        assertEquals(queued.operations, { denoise: true, normalize: true });

        // The in-test server runs the job runner: poll the job to a terminal state.
        let job: {
          status: string;
          output_asset_version_id: string | null;
          candidate_version_ids: string[];
        } | undefined;
        const deadline = Date.now() + 30_000;
        for (;;) {
          const poll = await req(
            "GET",
            `/api/v1/jobs/${queued.job_id}`,
            undefined,
            ownerToken,
          );
          assertEquals(poll.status, 200);
          job = poll.json as typeof job;
          if (job && ["succeeded", "failed"].includes(job.status)) break;
          if (Date.now() > deadline) throw new Error("cleanup job did not settle");
          await new Promise((r) => setTimeout(r, 50));
        }
        assert(job);
        assertEquals(job.status, "succeeded");
        assert(job.output_asset_version_id);
        assert(job.candidate_version_ids.length === 1);

        const cleaned = getAssetVersion(job.output_asset_version_id as string);
        assert(cleaned);
        assertEquals(cleaned.asset_id, assetId);
        assertEquals(cleaned.version_number, 2);
        const meta = JSON.parse(cleaned.technical_metadata_json ?? "{}") as {
          cleanup: { operations: Record<string, boolean>; engine: string };
        };
        assert(["ffmpeg", "mock"].includes(meta.cleanup.engine));
        // The source version stays active; the cleaned version is additive.
        const row = getAssetById(assetId);
        assert(row);
        assertEquals(row.active_version_id, versionId);
      })();
    });
  });
});
