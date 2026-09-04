import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import {
  buildHighlightSegments,
  hashSlug,
  isVisualAsset,
  REFERENCE_PALETTE,
  referenceColor,
} from "../src/reference-styles.js";

describe("hashSlug", () => {
  it("is a deterministic non-negative integer", () => {
    const a = hashSlug("hero");
    const b = hashSlug("hero");
    assertEquals(a, b);
    assertEquals(Number.isInteger(a), true);
    assertEquals(a >= 0, true);
  });

  it("varies with the slug", () => {
    assertEquals(hashSlug("hero"), hashSlug("hero"));
    assertNotEquals(hashSlug("hero"), hashSlug("sword"));
  });
});

describe("referenceColor", () => {
  it("is stable for a slug (same slug, same color)", () => {
    assertEquals(referenceColor("hero_sword"), referenceColor("hero_sword"));
    assertEquals(referenceColor("@hero_sword"), referenceColor("@hero_sword"));
  });

  it("always returns a palette entry", () => {
    for (const slug of ["a", "hero", "bg", "vfx_smoke", "long_slug_here"]) {
      assertEquals(REFERENCE_PALETTE.includes(referenceColor(slug)), true);
    }
  });

  it("distributes distinct slugs across multiple colors", () => {
    const colors = new Set(
      ["hero", "sword", "castle", "smoke", "drone", "villain"].map(
        referenceColor,
      ),
    );
    assertEquals(colors.size > 1, true);
  });

  it("returns a valid hex color", () => {
    for (const slug of ["a", "hero", "bg"]) {
      assertEquals(/^#[0-9a-f]{6}$/i.test(referenceColor(slug)), true);
    }
  });
});

describe("isVisualAsset", () => {
  it("is true for image/video MIME types", () => {
    assertEquals(isVisualAsset({ mime_type: "image/png" }), true);
    assertEquals(isVisualAsset({ mime_type: "video/mp4" }), true);
    assertEquals(isVisualAsset({ mime_type: "audio/wav" }), false);
  });

  it("falls back to asset_type when MIME is unknown", () => {
    assertEquals(isVisualAsset({ asset_type: "image" }), true);
    assertEquals(isVisualAsset({ asset_type: "video" }), true);
    assertEquals(isVisualAsset({ asset_type: "audio" }), false);
    assertEquals(isVisualAsset({ asset_type: "character" }), false);
  });

  it("is false for null/empty", () => {
    assertEquals(isVisualAsset(null), false);
    assertEquals(isVisualAsset({}), false);
  });
});

describe("buildHighlightSegments", () => {
  it("returns [] for empty text", () => {
    assertEquals(buildHighlightSegments("", []), []);
  });

  it("returns one text run when there are no tokens", () => {
    assertEquals(buildHighlightSegments("hello world", []), [
      { type: "text", text: "hello world" },
    ]);
  });

  it("splits around a resolved token with color + visual flag", () => {
    const segs = buildHighlightSegments("meet @hero now", [
      {
        slug: "hero",
        start: 5,
        end: 10,
        status: "resolved",
        asset: { id: "a1", asset_type: "image", mime_type: "image/png", version_id: "v1" },
      },
    ]);
    assertEquals(segs.length, 3);
    assertEquals(segs[0], { type: "text", text: "meet " });
    assertEquals(segs[1].type, "ref");
    assertEquals(segs[1].raw, "@hero");
    assertEquals(segs[1].slug, "hero");
    assertEquals(segs[1].color, referenceColor("hero"));
    assertEquals(segs[1].visual, true);
    assertEquals(segs[1].assetId, "a1");
    assertEquals(segs[1].versionId, "v1");
    assertEquals(segs[1].index, 0);
    assertEquals(segs[2], { type: "text", text: " now" });
  });

  it("marks non-visual (e.g. audio) tokens as not thumbnailable", () => {
    const segs = buildHighlightSegments("play @sfx", [
      {
        slug: "sfx",
        start: 5,
        end: 9,
        status: "resolved",
        asset: { id: "a2", asset_type: "audio", mime_type: "audio/wav" },
      },
    ]);
    assertEquals(segs[1].visual, false);
    assertEquals(segs[1].assetId, "a2");
    assertEquals(segs[1].versionId, null);
  });

  it("marks missing tokens (no asset) as non-visual with null ids", () => {
    const segs = buildHighlightSegments("see @ghost", [
      { slug: "ghost", start: 4, end: 10, status: "missing", asset: null },
    ]);
    assertEquals(segs[1].status, "missing");
    assertEquals(segs[1].visual, false);
    assertEquals(segs[1].assetId, null);
  });

  it("preserves versioned token raw text and uses the resolved version", () => {
    const segs = buildHighlightSegments("use @hero:v2", [
      {
        slug: "hero",
        version: 2,
        start: 4,
        end: 12,
        status: "resolved",
        asset: { id: "a1", active_version_id: "v1", version_id: "v2", mime_type: "image/png" },
      },
    ]);
    assertEquals(segs[1].raw, "@hero:v2");
    assertEquals(segs[1].versionId, "v2");
  });

  it("supports repeated mentions with a stable per-slug color", () => {
    const segs = buildHighlightSegments("@a then @a", [
      { slug: "a", start: 0, end: 2, status: "resolved", asset: null },
      { slug: "a", start: 8, end: 10, status: "resolved", asset: null },
    ]);
    const refs = segs.filter((s) => s.type === "ref");
    assertEquals(refs.length, 2);
    assertEquals(refs[0].color, refs[1].color);
    assertEquals(refs[0].index, 0);
    assertEquals(refs[1].index, 1);
  });

  it("drops out-of-range spans and skips overlaps", () => {
    const text = "abc @x def";
    const segs = buildHighlightSegments(text, [
      { slug: "x", start: 4, end: 6, status: "resolved", asset: null },
      { slug: "bad", start: 100, end: 200, status: "resolved", asset: null },
      { slug: "dup", start: 5, end: 7, status: "resolved", asset: null },
    ]);
    const refs = segs.filter((s) => s.type === "ref");
    // only the valid, non-overlapping "@x" survives
    assertEquals(refs.length, 1);
    assertEquals(refs[0].raw, "@x");
    // the full text is still covered
    assertEquals(
      segs.map((s) => (s.type === "text" ? s.text : s.raw)).join(""),
      text,
    );
  });
});
