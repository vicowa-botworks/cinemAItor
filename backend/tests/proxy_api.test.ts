import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createAsset, createAssetVersion, setVersionProxy } from "../src/db/assets.ts";
import { createItem, createTimeline, createTrack } from "../src/db/timelines.ts";
import { MockRenderEngine, setRenderEngine } from "../src/services/render_engine.ts";
import { resetContentStore } from "../src/storage/content_store.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

let baseUrl = "";
let ownerToken: string;
let ownerId: number;
let projectId: string;
let appData = "";

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
): Promise<{ status: number; json: unknown; res: Response }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, json, res };
}

interface VersionBody {
  id: string;
  version_number: number;
  file_path: string | null;
  proxy_path: string | null;
  content_hash: string | null;
  mime_type: string | null;
}

interface JobBody {
  id: string;
  job_type: string;
  status: string;
  error_text: string | null;
}

async function listProxyJobs(): Promise<JobBody[]> {
  const r = await req("GET", "/api/v1/jobs?job_type=proxy", undefined, ownerToken);
  assertEquals(r.status, 200);
  return r.json as JobBody[];
}

async function waitForProxyJob(
  jobId: string,
  expected: string,
  timeoutMs = 15000,
): Promise<JobBody> {
  const start = Date.now();
  for (;;) {
    const r = await req("GET", `/api/v1/jobs/${jobId}`, undefined, ownerToken);
    assertEquals(r.status, 200);
    const job = r.json as JobBody;
    if (job.status === expected) return job;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`proxy job stuck in ${job.status}: ${job.error_text}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Minimal valid PCM WAV; ffprobe-parseable on hosts with ffmpeg. */
function makeWav(seconds: number, sampleRate = 8000) {
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

async function uploadWav(assetId: string, seconds: number): Promise<VersionBody> {
  const res = await fetch(`${baseUrl}/api/v1/assets/${assetId}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(`tone-${seconds}.wav`),
    },
    body: makeWav(seconds),
  });
  assertEquals(res.status, 201);
  const body = (await res.json()) as { version: VersionBody };
  return body.version;
}

describe("proxy workflow api", () => {
  let audioAssetId: string;

  beforeEach(async () => {
    appData = Deno.makeTempDirSync({ prefix: "cinemaitor_proxy_api_" });
    Deno.env.set("APP_DATA_DIR", appData);
    Deno.env.set("RENDER_ENGINE", "mock");
    setRenderEngine(new MockRenderEngine());
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

      const { createProject } = await import("../src/db/projects.ts");
      projectId = createProject({ name: "Proxy Film" }, ownerId).id;
      audioAssetId = createAsset(
        {
          unique_slug: `vo_${Math.random().toString(36).slice(2, 8)}`,
          display_name: "Voice Over",
          asset_type: "audio",
          library_scope: "project",
          project_id: projectId,
        },
        ownerId,
      ).id;
    });
  });

  afterEach(() => {
    setRenderEngine(null);
    closeDb();
    Deno.removeSync(appData, { recursive: true });
  });

  it("upload queues a proxy job; the proxy is served and regenerable", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const version = await uploadWav(audioAssetId, 0.5);
        assertEquals(version.proxy_path, null);
        assertEquals(version.mime_type, "audio/wav");

        const jobs = await listProxyJobs();
        assertEquals(jobs.length, 1);
        // The runner may already have claimed the job by the time we list it.
        assert(
          ["queued", "running"].includes(jobs[0].status),
          `unexpected initial status ${jobs[0].status}`,
        );
        const done = await waitForProxyJob(jobs[0].id, "succeeded");
        assertEquals(done.error_text, null);

        const get = await req(
          "GET",
          `/api/v1/assets/${audioAssetId}/versions/${version.id}`,
          undefined,
          ownerToken,
        );
        const updated = get.json as VersionBody;
        assert(updated.proxy_path, "proxy_path should be set after the job succeeds");

        const proxy = await fetch(
          `${baseUrl}/api/v1/assets/${audioAssetId}/versions/${version.id}/proxy`,
          { headers: headers(ownerToken) },
        );
        assertEquals(proxy.status, 200);
        const bytes = new Uint8Array(await proxy.arrayBuffer());
        assert(bytes.length > 0);
        assert(proxy.headers.get("content-type")?.includes("audio/") ?? false);

        // Regeneration queues a fresh job and re-links the proxy.
        const regen = await req(
          "POST",
          `/api/v1/assets/${audioAssetId}/versions/${version.id}/proxy`,
          {},
          ownerToken,
        );
        assertEquals(regen.status, 202);
        const jobsAfter = await listProxyJobs();
        assertEquals(jobsAfter.length, 2);
        const newest = jobsAfter[0];
        assertEquals(newest.id, (regen.json as { job: JobBody }).job.id);
        await waitForProxyJob(newest.id, "succeeded");

        // Errors: unknown version, non-owner.
        const missing = await fetch(
          `${baseUrl}/api/v1/assets/${audioAssetId}/versions/nope/proxy`,
          { headers: headers(ownerToken) },
        );
        assertEquals(missing.status, 404);

        const res = await req(
          "POST",
          "/api/auth/register",
          {
            email: `user.${Math.random().toString(36).slice(2)}@example.com`,
            password: "password123",
            display_name: "Other",
          },
        );
        const otherToken = (res.json as { token: string }).token ?? "";
        const denied = await req(
          "POST",
          `/api/v1/assets/${audioAssetId}/versions/${version.id}/proxy`,
          {},
          otherToken,
        );
        assertEquals(denied.status, 403);
      })();
    }));

  it("draft renders use proxies; final renders use masters (and block without one)", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        // A version with a stored proxy but no master file (evicted media).
        const videoAsset = createAsset(
          {
            unique_slug: `proxyclip_${Math.random().toString(36).slice(2, 8)}`,
            display_name: "Proxy Clip",
            asset_type: "video",
            library_scope: "project",
            project_id: projectId,
          },
          ownerId,
        );
        const versionId = createAssetVersion(videoAsset.id, ownerId, {
          content_hash: null,
          file_path: null,
          format: "mp4",
          mime_type: "video/mp4",
          file_size: 0,
          make_active: false,
        }).id;
        const proxyFile = `${appData}/manual-proxy.mp4`;
        await Deno.writeTextFile(proxyFile, "proxy-bytes");
        setVersionProxy(versionId, proxyFile);

        const timelineId = createTimeline(ownerId, {
          project_id: projectId,
          name: "Proxy TL",
        }).id;
        const track = createTrack(ownerId, timelineId, {
          track_type: "video",
          name: "V1",
        });
        createItem(ownerId, timelineId, {
          track_id: track.id,
          asset_version_id: versionId,
          start_time: 0,
          end_time: 2,
        });

        const startRender = async (presetId: string) => {
          const created = await req(
            "POST",
            "/api/v1/renders",
            { project_id: projectId, timeline_id: timelineId, preset_id: presetId },
            ownerToken,
          );
          assertEquals(created.status, 202);
          const started = (created.json as { id: string }).id;
          const timeoutAt = Date.now() + 10000;
          for (;;) {
            const r = await req("GET", `/api/v1/renders/${started}`, undefined, ownerToken);
            const job = r.json as Record<string, unknown>;
            if (job.status === "succeeded" || job.status === "failed") return job;
            if (Date.now() > timeoutAt) throw new Error(`render stuck: ${JSON.stringify(job)}`);
            await new Promise((r) => setTimeout(r, 50));
          }
        };

        // Draft: falls back to the proxy even though the master is gone.
        const draft = await startRender("preset-draft");
        assertEquals(draft.status, "succeeded");
        const draftReport = draft.validation_report as {
          sources: { proxy: number; master: number };
        };
        assertEquals(draftReport.sources.proxy, 1);
        assertEquals(draftReport.sources.master, 0);

        // Final: blocked because the master is missing.
        const final = await startRender("preset-final");
        assertEquals(final.status, "failed");
        assert(
          (final.error_text as string).includes("No file for asset version"),
          `unexpected error: ${final.error_text}`,
        );
      })();
    }));
});
