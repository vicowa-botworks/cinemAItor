import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { closeDb } from "../src/db/database.ts";
import { createAsset, createAssetVersion } from "../src/db/assets.ts";
import { createProject } from "../src/db/projects.ts";
import {
  clampThumbnailWidth,
  ffmpegThumbnailArgs,
  quantizeTimestamp,
  THUMBNAIL_WIDTH_DEFAULT,
  THUMBNAIL_WIDTH_MAX,
  THUMBNAIL_WIDTH_MIN,
  thumbnailCachePath,
  thumbnailKindFor,
} from "../src/services/thumbnails.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

// --- pure helpers (no server) ---

describe("thumbnails service helpers", () => {
  it("ffmpegThumbnailArgs: video grabs one frame at the seek time", () => {
    const args = ffmpegThumbnailArgs("video", "src.mp4", 2.5, 320, "out.jpg");
    assertEquals(args[args.indexOf("-ss") + 1], "2.5");
    assertEquals(args[args.indexOf("-frames:v") + 1], "1");
    const vf = args[args.indexOf("-vf") + 1];
    assertStringIncludes(vf, "scale=320:-2");
    assertStringIncludes(vf, "force_original_aspect_ratio=decrease");
    assertEquals(args[args.length - 1], "out.jpg");
  });

  it("ffmpegThumbnailArgs: image has no seek, still scales and outputs JPEG", () => {
    const args = ffmpegThumbnailArgs("image", "pic.png", 0, 640, "out.jpg");
    assert(!args.includes("-ss"));
    assert(!args.includes("-frames:v"));
    assertStringIncludes(args[args.indexOf("-vf") + 1], "scale=640:-2");
    assertEquals(args[args.length - 1], "out.jpg");
  });

  it("thumbnailKindFor maps mime first, then asset type; audio gets none", () => {
    assertEquals(thumbnailKindFor("video/mp4"), "video");
    assertEquals(thumbnailKindFor("VIDEO/QUICKTIME"), "video");
    assertEquals(thumbnailKindFor("image/png"), "image");
    assertEquals(thumbnailKindFor("audio/mpeg", "audio"), null);
    assertEquals(thumbnailKindFor(null, "video"), "video");
    assertEquals(thumbnailKindFor(null, "image"), "image");
    assertEquals(thumbnailKindFor(null, "audio"), null);
    assertEquals(thumbnailKindFor(null, null), null);
  });

  it("quantizeTimestamp rounds to 100 ms and clamps negatives", () => {
    assertEquals(quantizeTimestamp(0), 0);
    assertEquals(quantizeTimestamp(0.04), 0);
    assertEquals(quantizeTimestamp(1.234), 1.2);
    assertEquals(quantizeTimestamp(-3), 0);
  });

  it("clampThumbnailWidth bounds invalid and out-of-range widths", () => {
    assertEquals(clampThumbnailWidth(NaN), THUMBNAIL_WIDTH_DEFAULT);
    assertEquals(clampThumbnailWidth(10), THUMBNAIL_WIDTH_MIN);
    assertEquals(clampThumbnailWidth(99999), THUMBNAIL_WIDTH_MAX);
    assertEquals(clampThumbnailWidth(320.4), 320);
  });

  it("thumbnailCachePath is deterministic per version, quantized time, width", () => {
    const a = thumbnailCachePath("/data", "v1", 2.54, 320);
    const b = thumbnailCachePath("/data", "v1", 2.5, 320);
    assertEquals(a, b);
    assertStringIncludes(a, join("/data", "assets", "thumbnails"));
    assertStringIncludes(a, "v1-2.5-320.jpg");
    const c = thumbnailCachePath("/data", "v1", 0, 640);
    assert(a !== c);
  });
});

// --- API ---

const FAKE_MARKER = "FAKEJPG";

describe("GET /api/v1/assets/:id/versions/:versionId/thumbnail", () => {
  let baseUrl = "";
  let ownerToken = "";
  let ownerId: number;
  let projectId: string;
  let appData: string;
  let videoAssetId = "";
  let videoVersionId = "";
  let imageAssetId = "";
  let imageVersionId = "";
  let audioAssetId = "";
  let audioVersionId = "";
  let fakeFfmpeg = "";
  let counterFile = "";

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
  ): Promise<{ status: number; json: unknown; text: string }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: headers(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = {};
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      // non-JSON body (should not happen for API routes)
    }
    return { status: res.status, json, text };
  }

  /** Stand-in ffmpeg: answers -version, writes a fake JPEG to the last arg. */
  function writeFakeFfmpeg(counterPath: string): string {
    const dir = Deno.makeTempDirSync({ prefix: "fake_thumb_ffmpeg_" });
    const path = join(dir, "ffmpeg");
    const body = [
      'if [ "$1" = "-version" ]; then echo "ffmpeg version 8.0-fake"; exit 0; fi',
      'out=""',
      'for a in "$@"; do out="$a"; done',
      `printf '\\377\\330\\377\\340${FAKE_MARKER}' > "$out"`,
      `echo 1 >> ${counterPath}`,
      "exit 0",
    ].join("\n");
    Deno.writeTextFileSync(path, `#!/bin/sh\n${body}\n`);
    Deno.chmodSync(path, 0o755);
    return path;
  }

  function counterCount(): number {
    try {
      const text = Deno.readTextFileSync(counterFile);
      return text.split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  }

  function makeVersionedAsset(
    name: string,
    slug: string,
    type: string,
    mime: string | null,
  ): { assetId: string; versionId: string } {
    const asset = createAsset(
      {
        unique_slug: slug,
        display_name: name,
        asset_type: type,
        library_scope: "project",
        project_id: projectId,
      },
      ownerId,
    );
    const src = join(appData, `${slug}.src`);
    Deno.writeFileSync(src, new TextEncoder().encode("fake-source"));
    const version = createAssetVersion(asset.id, ownerId, {
      content_hash: "ab".repeat(32),
      file_path: src,
      format: mime?.split("/")[1] ?? null,
      mime_type: mime,
      file_size: 11,
      make_active: true,
    });
    return { assetId: asset.id, versionId: version.id };
  }

  beforeEach(async () => {
    appData = Deno.makeTempDirSync({ prefix: "cinemaitor_thumb_api_" });
    Deno.env.set("APP_DATA_DIR", appData);
    counterFile = join(appData, "fake-thumb-count.txt");
    fakeFfmpeg = writeFakeFfmpeg(counterFile);
    Deno.env.set("FFMPEG_PATH", fakeFfmpeg);

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

      projectId = createProject({ name: "Thumb Film" }, ownerId).id;
      const vid = makeVersionedAsset(
        "Clip A",
        `vid_${Math.random().toString(36).slice(2, 8)}`,
        "video",
        "video/mp4",
      );
      videoAssetId = vid.assetId;
      videoVersionId = vid.versionId;
      const img = makeVersionedAsset(
        "Poster",
        `img_${Math.random().toString(36).slice(2, 8)}`,
        "image",
        "image/png",
      );
      imageAssetId = img.assetId;
      imageVersionId = img.versionId;
      const aud = makeVersionedAsset(
        "Score",
        `aud_${Math.random().toString(36).slice(2, 8)}`,
        "audio",
        "audio/mpeg",
      );
      audioAssetId = aud.assetId;
      audioVersionId = aud.versionId;
    });
  });

  afterEach(() => {
    Deno.env.delete("FFMPEG_PATH");
    closeDb();
    Deno.removeSync(appData, { recursive: true });
  });

  it("rejects unauthenticated requests with 401", () =>
    withServer((base) => {
      baseUrl = base;
      return req("GET", `/api/v1/assets/${videoAssetId}/versions/${videoVersionId}/thumbnail`)
        .then((r) => assertEquals(r.status, 401));
    }));

  it("generates a cached JPEG, serving repeats from disk", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const path = `/api/v1/assets/${videoAssetId}/versions/${videoVersionId}/thumbnail`;
        const first = await req("GET", path, undefined, ownerToken);
        assertEquals(first.status, 200);
        assertStringIncludes(first.text, FAKE_MARKER);
        assertEquals(counterCount(), 1);

        const cacheFile = join(
          appData,
          "assets",
          "thumbnails",
          `${videoVersionId}-0.0-320.jpg`,
        );
        const cacheStat = await Deno.stat(cacheFile).catch(() => null);
        assert(cacheStat !== null && cacheStat.isFile);

        // Same params again: served from cache, ffmpeg not re-run.
        const second = await req("GET", path, undefined, ownerToken);
        assertEquals(second.status, 200);
        assertStringIncludes(second.text, FAKE_MARKER);
        assertEquals(counterCount(), 1);
      })();
    }));

  it("seeks to ?at= and quantizes nearby timestamps to one cache entry", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const base = `/api/v1/assets/${videoAssetId}/versions/${videoVersionId}/thumbnail`;
        const first = await req("GET", `${base}?at=2.5`, undefined, ownerToken);
        assertEquals(first.status, 200);
        assertEquals(counterCount(), 1);
        const file1 = join(
          appData,
          "assets",
          "thumbnails",
          `${videoVersionId}-2.5-320.jpg`,
        );
        const stat1 = await Deno.stat(file1).catch(() => null);
        assert(stat1 !== null);

        // 2.54s quantizes to the same 2.5s cache entry.
        const near = await req("GET", `${base}?at=2.54`, undefined, ownerToken);
        assertEquals(near.status, 200);
        assertEquals(counterCount(), 1);

        // A genuinely different frame runs ffmpeg again.
        const different = await req(
          "GET",
          `${base}?at=5`,
          undefined,
          ownerToken,
        );
        assertEquals(different.status, 200);
        assertEquals(counterCount(), 2);
      })();
    }));

  it("clamps ?w into the supported range", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const r = await req(
          "GET",
          `/api/v1/assets/${imageAssetId}/versions/${imageVersionId}/thumbnail?w=99999`,
          undefined,
          ownerToken,
        );
        assertEquals(r.status, 200);
        const file = join(
          appData,
          "assets",
          "thumbnails",
          `${imageVersionId}-0.0-${THUMBNAIL_WIDTH_MAX}.jpg`,
        );
        const stat = await Deno.stat(file).catch(() => null);
        assert(stat !== null && stat.isFile);
      })();
    }));

  it("returns 404 for versions that belong to another asset", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const other = makeVersionedAsset(
          "Other",
          `oth_${Math.random().toString(36).slice(2, 8)}`,
          "video",
          "video/mp4",
        );
        const r = await req(
          "GET",
          `/api/v1/assets/${videoAssetId}/versions/${other.versionId}/thumbnail`,
          undefined,
          ownerToken,
        );
        assertEquals(r.status, 404);
      })();
    }));

  it("rejects audio assets with 404 (no thumbnails for audio)", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const r = await req(
          "GET",
          `/api/v1/assets/${audioAssetId}/versions/${audioVersionId}/thumbnail`,
          undefined,
          ownerToken,
        );
        assertEquals(r.status, 404);
      })();
    }));

  it("scales image assets through the same ffmpeg path", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        const before = counterCount();
        const r = await req(
          "GET",
          `/api/v1/assets/${imageAssetId}/versions/${imageVersionId}/thumbnail`,
          undefined,
          ownerToken,
        );
        assertEquals(r.status, 200);
        assertStringIncludes(r.text, FAKE_MARKER);
        assertEquals(counterCount(), before + 1);
      })();
    }));

  it("returns 503 when ffmpeg is unavailable", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        Deno.env.set("FFMPEG_PATH", "/nonexistent/ffmpeg-thumb-test");
        try {
          const r = await req(
            "GET",
            `/api/v1/assets/${videoAssetId}/versions/${videoVersionId}/thumbnail?at=9`,
            undefined,
            ownerToken,
          );
          assertEquals(r.status, 503);
        } finally {
          Deno.env.set("FFMPEG_PATH", fakeFfmpeg);
        }
      })();
    }));
});
