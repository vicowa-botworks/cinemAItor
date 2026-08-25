import { after, afterEach, before, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  ffmpegArgs,
  generateProxyMedia,
  isFfmpegAvailable,
  proxyKindFor,
} from "../src/services/media_proxy.ts";

const NO_FFMPEG = "/nonexistent/ffmpeg-for-tests";

describe("media_proxy", () => {
  before(() => {
    Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
    Deno.env.set("FFMPEG_PATH", NO_FFMPEG);
  });
  after(() => {
    Deno.env.delete("FFMPEG_PATH");
    Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
  });

  describe("proxyKindFor", () => {
    it("classifies by mime type first", () => {
      assertEquals(proxyKindFor("video/mp4", "image"), "video");
      assertEquals(proxyKindFor("audio/wav", "video"), "audio");
      assertEquals(proxyKindFor("image/png", "video"), "image");
    });

    it("falls back to the asset type when the mime is missing", () => {
      assertEquals(proxyKindFor(null, "video"), "video");
      assertEquals(proxyKindFor(null, "audio"), "audio");
      assertEquals(proxyKindFor(null, "image"), "image");
    });

    it("returns null for non-media types", () => {
      assertEquals(proxyKindFor("text/plain", "document"), null);
      assertEquals(proxyKindFor(null, "document"), null);
    });
  });

  describe("isFfmpegAvailable", () => {
    it("is false for a missing binary", async () => {
      assertEquals(await isFfmpegAvailable(), false);
    });
  });

  describe("ffmpegArgs", () => {
    it("builds kind-specific transcode arguments", () => {
      const video = ffmpegArgs("video", "/tmp/in.mp4", "/tmp/out.mp4");
      assert(video.includes("/tmp/in.mp4"));
      assertEquals(video[video.length - 1], "/tmp/out.mp4");
      assert(video.includes("-b:a"));
      assert(video.includes("128k"));
      assert(video.includes("scale=1280:720:force_original_aspect_ratio=decrease"));
      assert(video.includes("libx264"));
      assert(video.includes("aac"));

      const audio = ffmpegArgs("audio", "/tmp/in.wav", "/tmp/out.mp3");
      assert(audio.includes("libmp3lame"));
      assertEquals(audio[audio.length - 1], "/tmp/out.mp3");

      const image = ffmpegArgs("image", "/tmp/in.png", "/tmp/out.jpg");
      assert(image.includes("scale=1280:1280:force_original_aspect_ratio=decrease"));
      assertEquals(image[image.length - 1], "/tmp/out.jpg");
    });
  });

  describe("generateProxyMedia (mock fallback)", () => {
    let dir = "";
    let src = "";
    let out = "";

    beforeEach(async () => {
      dir = await Deno.makeTempDir({ prefix: "media-proxy-test-" });
      src = `${dir}/src.wav`;
      out = `${dir}/proxy.bin`;
      await Deno.writeFile(src, new Uint8Array([1, 2, 3]));
    });
    afterEach(async () => {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    });

    const okHooks = { onProgress: () => {}, isCancelled: () => false };

    it("writes a deterministic mock proxy per seed", async () => {
      const r1 = await generateProxyMedia(src, "audio", out, "seed-a", okHooks);
      const first = await Deno.readFile(out);
      assertEquals(r1.engine, "mock");
      assertEquals(r1.extension, "mp3");
      assertEquals(r1.mime_type, "audio/mpeg");

      const r2 = await generateProxyMedia(src, "audio", out, "seed-a", okHooks);
      assertEquals(await Deno.readFile(out), first);
      assertEquals(r2.engine, "mock");

      await generateProxyMedia(src, "audio", out, "seed-b", okHooks);
      assertNotEquals(await Deno.readFile(out), first);
    });

    it("reports the right container per kind", async () => {
      assertEquals((await generateProxyMedia(src, "video", out, "s", okHooks)).extension, "mp4");
      assertEquals((await generateProxyMedia(src, "audio", out, "s", okHooks)).extension, "mp3");
      assertEquals((await generateProxyMedia(src, "image", out, "s", okHooks)).extension, "jpg");
    });

    it("throws before writing when already cancelled", async () => {
      const hooks = { onProgress: () => {}, isCancelled: () => true };
      await assertRejects(
        () => generateProxyMedia(src, "audio", out, "s", hooks),
        Error,
        "cancelled",
      );
      await assertRejects(
        () => Deno.stat(out),
        Deno.errors.NotFound,
      );
    });

    it("progress hooks fire from start to 100", async () => {
      const seen: number[] = [];
      await generateProxyMedia(src, "video", out, "s", {
        onProgress: (p) => seen.push(p),
        isCancelled: () => false,
      });
      assert(seen[0] === 10);
      assert(seen[seen.length - 1] === 100);
    });
  });
});
