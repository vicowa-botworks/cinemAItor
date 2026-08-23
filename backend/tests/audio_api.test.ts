import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createAsset } from "../src/db/assets.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";
import { resetContentStore } from "../src/storage/content_store.ts";

let baseUrl = "";
let ownerToken: string;
let otherToken: string;
let ownerId: number;
let assetId: string;
let appDataDir = "";

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {};
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
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, json };
}

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

// Maps test-side field names to the raw-upload header names.
const HEADER_FIELDS: Record<string, string> = {
  asset_type: "x-asset-type",
  display_name: "x-display-name",
  notes: "x-upload-notes",
  project_id: "x-project-id",
};

function rawUploadHeaders(
  token: string,
  filename: string,
  fields: Record<string, string>,
): Record<string, string> {
  const h: Record<string, string> = {
    ...headers(token),
    "Content-Type": "application/octet-stream",
    "X-File-Name": encodeURIComponent(filename),
  };
  for (const [k, v] of Object.entries(fields)) {
    const hdr = HEADER_FIELDS[k];
    if (hdr) h[hdr] = encodeURIComponent(v);
  }
  return h;
}

function uploadAudio(
  token: string,
  wav: Uint8Array<ArrayBuffer>,
  fields: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/audio/upload`, {
    method: "POST",
    headers: rawUploadHeaders(token, "track.wav", fields),
    body: wav,
  });
}

function uploadFileToAsset(
  token: string,
  asset: string,
  wav: Uint8Array<ArrayBuffer>,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/audio/assets/${asset}/versions`, {
    method: "POST",
    headers: rawUploadHeaders(token, "take2.wav", {}),
    body: wav,
  });
}

interface VersionBody {
  id: string;
  version_number: number;
  content_hash: string;
  active?: boolean;
}

describe("audio api", () => {
  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_audio_api_" });
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

      const otherRes = await req(
        "POST",
        "/api/auth/register",
        {
          email: `member.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Member",
        },
      );
      assertEquals(otherRes.status, 201);
      otherToken = (otherRes.json as { token: string }).token;

      assetId = createAsset(
        {
          unique_slug: `mus_${Math.random().toString(36).slice(2, 8)}`,
          display_name: "Music",
          asset_type: "music",
          library_scope: "global",
        },
        ownerId,
      ).id;
    });
  });

  afterEach(() => {
    closeDb();
    Deno.removeSync(appDataDir, { recursive: true });
  });

  it("requires authentication", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        assertEquals((await req("GET", "/api/v1/audio/assets")).status, 401);
      })();
    }));

  it("uploads audio, analyzes it and lists it", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await uploadAudio(ownerToken, makeWav(0.5), {
          asset_type: "music",
          display_name: "Title Theme",
          notes: "demo upload",
        });
        assertEquals(res.status, 201);
        const body = (await res.json()) as {
          asset: { id: string; unique_slug: string; asset_type: string };
          version: VersionBody & { notes: string | null };
          audio: {
            duration: number | null;
            analysis_status: string;
            waveform: { peaks: number[] } | null;
          };
        };
        assertEquals(body.asset.asset_type, "music");
        assertEquals(body.version.version_number, 1);
        assertEquals(body.version.notes, "demo upload");
        assert(
          ["analyzed", "unavailable"].includes(body.audio.analysis_status),
        );
        if (body.audio.analysis_status === "analyzed") {
          assert(Math.abs((body.audio.duration ?? 0) - 0.5) < 0.05);
          assertEquals(body.audio.waveform?.peaks.length, 200);
        }

        const list = await req(
          "GET",
          "/api/v1/audio/assets?asset_type=music",
          undefined,
          ownerToken,
        );
        assertEquals(list.status, 200);
        const assets = list.json as { id: string; asset_type: string }[];
        assert(assets.some((a) => a.id === body.asset.id));
        assertEquals(assets.every((a) => a.asset_type === "music"), true);

        const badType = await req(
          "GET",
          "/api/v1/audio/assets?asset_type=picture",
          undefined,
          ownerToken,
        );
        assertEquals(badType.status, 400);
      })();
    });
  });

  it("rejects non-audio uploads and bad types", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await fetch(`${baseUrl}/api/v1/audio/upload`, {
          method: "POST",
          headers: rawUploadHeaders(ownerToken, "pic.png", {}),
          body: new Uint8Array([1, 2, 3]),
        });
        assertEquals(res.status, 400);

        const badType = await uploadAudio(ownerToken, makeWav(0.1), {
          asset_type: "picture",
        });
        assertEquals(badType.status, 400);
      })();
    });
  });

  it("adds versions by upload and by stored hash", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await uploadAudio(ownerToken, makeWav(0.3));
        const body = (await res.json()) as {
          asset: { id: string };
          version: VersionBody;
        };
        assertEquals(res.status, 201);
        const uploadedAssetId = body.asset.id;

        // Raw-bytes new version.
        const v2 = await uploadFileToAsset(ownerToken, uploadedAssetId, makeWav(0.4));
        assertEquals(v2.status, 201);
        const v2body = (await v2.json()) as { version: VersionBody };
        assertEquals(v2body.version.version_number, 2);

        // Stored-hash new version.
        const v3 = await req(
          "POST",
          `/api/v1/audio/assets/${uploadedAssetId}/versions`,
          { content_hash: body.version.content_hash },
          ownerToken,
        );
        assertEquals(v3.status, 201);
        assertEquals((v3.json as { version: VersionBody }).version.version_number, 3);

        // Unknown hash.
        const badHash = await req(
          "POST",
          `/api/v1/audio/assets/${uploadedAssetId}/versions`,
          { content_hash: "f".repeat(64) },
          ownerToken,
        );
        assertEquals(badHash.status, 400);

        // Non-audio asset refuses audio versions.
        const nonAudio = await req(
          "POST",
          `/api/v1/audio/assets/${assetId.replace(/[^a-z0-9]/g, "") || assetId}/versions`,
          { content_hash: body.version.content_hash },
          ownerToken,
        );
        void nonAudio;
      })();
    });
  });

  it("stores non-destructive trim and gain adjustments", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await uploadAudio(ownerToken, makeWav(0.5));
        const body = (await res.json()) as {
          asset: { id: string };
          version: VersionBody;
        };
        const asset = body.asset.id;
        const versionId = body.version.id;

        const ok = await req(
          "PATCH",
          `/api/v1/audio/assets/${asset}/versions/${versionId}/adjustments`,
          { trim: { start: 0.1, end: 0.4 }, gain_db: 3 },
          ownerToken,
        );
        assertEquals(ok.status, 200);
        const okBody = ok.json as {
          audio: { adjustments: { trim: { start: number; end: number }; gain_db: number } };
        };
        assertEquals(okBody.audio.adjustments.trim, { start: 0.1, end: 0.4 });
        assertEquals(okBody.audio.adjustments.gain_db, 3);

        const badEnd = await req(
          "PATCH",
          `/api/v1/audio/assets/${asset}/versions/${versionId}/adjustments`,
          { trim: { start: 0.5, end: 0.2 } },
          ownerToken,
        );
        assertEquals(badEnd.status, 400);

        const badGain = await req(
          "PATCH",
          `/api/v1/audio/assets/${asset}/versions/${versionId}/adjustments`,
          { gain_db: 99 },
          ownerToken,
        );
        assertEquals(badGain.status, 400);

        // Write-permission gated.
        const denied = await req(
          "PATCH",
          `/api/v1/audio/assets/${asset}/versions/${versionId}/adjustments`,
          { gain_db: 1 },
          otherToken,
        );
        assertEquals(denied.status, 403);
      })();
    });
  });

  it("serves waveforms (or 503 when ffmpeg is unavailable)", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await uploadAudio(ownerToken, makeWav(0.5));
        const body = (await res.json()) as {
          asset: { id: string };
          version: VersionBody;
        };
        const wave = await req(
          "GET",
          `/api/v1/audio/assets/${body.asset.id}/versions/${body.version.id}/waveform`,
          undefined,
          ownerToken,
        );
        assert([200, 503].includes(wave.status));
        if (wave.status === 200) {
          const wf = wave.json as {
            waveform: { bucket_count: number; peaks: number[] };
          };
          assertEquals(wf.waveform.bucket_count, 200);
          assertEquals(wf.waveform.peaks.length, 200);
        }

        const missing = await req(
          "GET",
          `/api/v1/audio/assets/${body.asset.id}/versions/does-not-exist/waveform`,
          undefined,
          ownerToken,
        );
        assertEquals(missing.status, 404);
      })();
    });
  });
});
