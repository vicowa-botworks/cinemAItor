import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertThrows } from "@std/assert";
import {
  computeImageSize,
  MAX_IMAGE_EDGE,
  MIN_IMAGE_EDGE,
  resolveAspectRatio,
  resolveResolution,
} from "../src/services/asset_generation.ts";
import { resolveOutputSize } from "../src/services/adapters.ts";

describe("resolveAspectRatio", () => {
  it("passes through a valid w:h string", () => {
    assertEquals(resolveAspectRatio("16:9"), "16:9");
    assertEquals(resolveAspectRatio("1:1"), "1:1");
  });

  it("returns undefined for absent values", () => {
    assertEquals(resolveAspectRatio(undefined), undefined);
    assertEquals(resolveAspectRatio(null), undefined);
    assertEquals(resolveAspectRatio(""), undefined);
  });

  it("throws a bad request for malformed ratios", () => {
    assertThrows(() => resolveAspectRatio("16"), Error, "aspect_ratio must be");
    assertThrows(() => resolveAspectRatio("a:b"), Error, "aspect_ratio must be");
    assertThrows(() => resolveAspectRatio(" 16:9 "), Error, "aspect_ratio must be");
    assertThrows(() => resolveAspectRatio("16:9:1"), Error, "aspect_ratio must be");
    assertThrows(() => resolveAspectRatio(16.9), Error, "aspect_ratio must be");
  });
});

describe("resolveResolution", () => {
  it("accepts in-range integers (inclusive bounds)", () => {
    assertEquals(resolveResolution(1024), 1024);
    assertEquals(resolveResolution(512), 512);
    assertEquals(resolveResolution(MIN_IMAGE_EDGE), MIN_IMAGE_EDGE);
    assertEquals(resolveResolution(MAX_IMAGE_EDGE), MAX_IMAGE_EDGE);
  });

  it("returns undefined for absent values", () => {
    assertEquals(resolveResolution(undefined), undefined);
    assertEquals(resolveResolution(null), undefined);
    assertEquals(resolveResolution(""), undefined);
  });

  it("throws a bad request for non-integer or out-of-range values", () => {
    assertThrows(() => resolveResolution(1024.5), Error, "resolution must be");
    assertThrows(() => resolveResolution("768"), Error, "resolution must be");
    assertThrows(() => resolveResolution("abc"), Error, "resolution must be");
    assertThrows(() => resolveResolution(0), Error, "resolution must be");
    assertThrows(
      () => resolveResolution(MIN_IMAGE_EDGE - 1),
      Error,
      "resolution must be between",
    );
    assertThrows(
      () => resolveResolution(MAX_IMAGE_EDGE + 1),
      Error,
      "resolution must be between",
    );
  });
});

describe("computeImageSize", () => {
  it("returns undefined when either input is missing or the ratio is malformed", () => {
    assertEquals(computeImageSize(undefined, undefined), undefined);
    assertEquals(computeImageSize(undefined, 1024), undefined);
    assertEquals(computeImageSize("16:9", undefined), undefined);
    assertEquals(computeImageSize("abc", 1024), undefined);
  });

  it("keeps the short edge at the base and rounds the long edge to 8px (landscape)", () => {
    assertEquals(computeImageSize("16:9", 1024), { width: 1824, height: 1024 });
    assertEquals(computeImageSize("3:2", 1024), { width: 1536, height: 1024 });
  });

  it("keeps the short edge at the base for portrait ratios", () => {
    assertEquals(computeImageSize("9:16", 1024), { width: 1024, height: 1824 });
    assertEquals(computeImageSize("2:3", 1024), { width: 1024, height: 1536 });
  });

  it("returns a square at the base for 1:1", () => {
    assertEquals(computeImageSize("1:1", 1024), { width: 1024, height: 1024 });
  });

  it("does not clamp the base — range validation is the resolver's job", () => {
    assertEquals(computeImageSize("1:1", 32), { width: 32, height: 32 });
    assertEquals(computeImageSize("1:1", 100000), { width: 100000, height: 100000 });
  });

  it("floors the long edge at 8px for very small bases", () => {
    assertEquals(computeImageSize("16:9", 16), { width: 32, height: 16 });
  });
});

describe("resolveOutputSize", () => {
  it("prefers the job's width/height over the model defaults", () => {
    assertEquals(
      resolveOutputSize({
        width: 1024,
        height: 576,
        default_width: 768,
        default_height: 768,
        aspect_ratio: "16:9",
      }),
      { width: 1024, height: 576, aspect: "16:9" },
    );
  });

  it("falls back to the model defaults when the job has no size", () => {
    assertEquals(
      resolveOutputSize({ default_width: 768, default_height: 512 }),
      { width: 768, height: 512, aspect: undefined },
    );
  });

  it("mixes job and default per axis", () => {
    assertEquals(
      resolveOutputSize({ width: 1024, default_width: 768, default_height: 512 }),
      { width: 1024, height: 512, aspect: undefined },
    );
  });

  it("leaves fields undefined for auto", () => {
    assertEquals(resolveOutputSize({}), { width: undefined, height: undefined, aspect: undefined });
  });

  it("carries the aspect hint even without a computed size", () => {
    assertEquals(
      resolveOutputSize({ aspect_ratio: "21:9" }),
      { width: undefined, height: undefined, aspect: "21:9" },
    );
  });
});
