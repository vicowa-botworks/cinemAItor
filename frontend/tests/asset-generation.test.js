import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import {
  formatGb,
  generationKindForAsset,
  generationTaskType,
  isValidSlug,
  normalizeCandidates,
  normalizeSeed,
  slugify,
  validateGenerationForm,
  vramPreCheck,
  vramSufficient,
} from "../src/components/asset-generation.js";

describe("generationKindForAsset", () => {
  it("maps image asset types to the image kind", () => {
    for (const t of ["image", "character", "location", "prop"]) {
      assertEquals(generationKindForAsset({ asset_type: t }), "image");
    }
  });

  it("maps video asset types to the video kind", () => {
    for (const t of ["video"]) {
      assertEquals(generationKindForAsset({ asset_type: t }), "video");
    }
  });

  it("returns null for non-generatable types", () => {
    for (const t of ["audio", "music", "sfx", "voiceover", "notes"]) {
      assertEquals(generationKindForAsset({ asset_type: t }), null);
    }
    assertEquals(generationKindForAsset(null), null);
    assertEquals(generationKindForAsset({}), null);
  });
});

describe("generationTaskType", () => {
  it("picks the text task without inputs", () => {
    assertEquals(generationTaskType("image", false), "text_to_image");
    assertEquals(generationTaskType("video", false), "text_to_video");
  });

  it("picks the reference task with inputs", () => {
    assertEquals(generationTaskType("image", true), "image_to_image");
    assertEquals(generationTaskType("video", true), "image_to_video");
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase alphanumerics and underscores", () => {
    assert(isValidSlug("abc"));
    assert(isValidSlug("a1_b2"));
    assert(isValidSlug("1abc"));
  });

  it("rejects empty, uppercase, punctuated and leading-underscore slugs", () => {
    assert(!isValidSlug(""));
    assert(!isValidSlug("ABC"));
    assert(!isValidSlug("abc-def"));
    assert(!isValidSlug("_abc"));
    assert(!isValidSlug("has space"));
    assert(!isValidSlug(42));
  });
});

describe("slugify", () => {
  it("lowercases and joins words with underscores", () => {
    assertEquals(slugify("My Generated Hero!"), "my_generated_hero");
    assertEquals(slugify("  Spaced  Out  "), "spaced_out");
  });

  it("strips leading/trailing separators and caps length", () => {
    assertEquals(slugify("---leading---"), "leading");
    assertEquals(slugify("a".repeat(200)).length, 80);
  });

  it("handles null/undefined", () => {
    assertEquals(slugify(null), "");
    assertEquals(slugify(undefined), "");
  });
});

describe("normalizeSeed", () => {
  it("returns undefined for empty or invalid values", () => {
    assertEquals(normalizeSeed(""), undefined);
    assertEquals(normalizeSeed(null), undefined);
    assertEquals(normalizeSeed(undefined), undefined);
    assertEquals(normalizeSeed("abc"), undefined);
    assertEquals(normalizeSeed("-1"), undefined);
    assertEquals(normalizeSeed("1.5"), undefined);
  });

  it("returns the integer as a string", () => {
    assertEquals(normalizeSeed("42"), "42");
    assertEquals(normalizeSeed(7), "7");
    assertEquals(normalizeSeed("0"), "0");
  });
});

describe("normalizeCandidates", () => {
  it("clamps into 1..8", () => {
    assertEquals(normalizeCandidates(1), 1);
    assertEquals(normalizeCandidates(8), 8);
    assertEquals(normalizeCandidates(0), 1);
    assertEquals(normalizeCandidates("9"), 8);
    assertEquals(normalizeCandidates(-3), 1);
  });

  it("falls back to 2 for non-integers", () => {
    assertEquals(normalizeCandidates("abc"), 2);
    assertEquals(normalizeCandidates(1.5), 2);
  });
});

describe("validateGenerationForm", () => {
  it("accepts a valid new-asset form", () => {
    assertEquals(
      validateGenerationForm(
        {
          kind: "image",
          prompt: "a lighthouse at dusk",
          unique_slug: "lighthouse_dusk",
          library_scope: "global",
        },
        { isNew: true },
      ),
      [],
    );
  });

  it("accepts a valid edit form without a slug", () => {
    assertEquals(
      validateGenerationForm(
        { kind: "video", prompt: "make it night", references: [] },
        { isNew: false },
      ),
      [],
    );
  });

  it("rejects a missing or oversized prompt", () => {
    assert(
      validateGenerationForm(
        { kind: "image", prompt: "  ", unique_slug: "abc" },
        { isNew: true },
      ).some((e) => e.includes("prompt")),
    );
    const long = "x".repeat(4001);
    assert(
      validateGenerationForm(
        { kind: "image", prompt: long, unique_slug: "abc" },
        { isNew: true },
      ).some((e) => e.includes("4000")),
    );
  });

  it("rejects an unknown kind", () => {
    assert(
      validateGenerationForm(
        { kind: "audio", prompt: "x", unique_slug: "abc" },
        { isNew: true },
      ).length > 0,
    );
  });

  it("requires a valid slug only for new assets", () => {
    assert(
      validateGenerationForm(
        { kind: "image", prompt: "x", unique_slug: "Bad Slug" },
        { isNew: true },
      ).some((e) => e.toLowerCase().includes("slug")),
    );
    assertEquals(
      validateGenerationForm(
        { kind: "image", prompt: "x", unique_slug: "Bad Slug" },
        { isNew: false },
      ),
      [],
    );
  });

  it("requires a project for project-scoped new assets", () => {
    assert(
      validateGenerationForm(
        {
          kind: "image",
          prompt: "x",
          unique_slug: "abc",
          library_scope: "project",
          project_id: null,
        },
        { isNew: true },
      ).some((e) => e.includes("project")),
    );
    assertEquals(
      validateGenerationForm(
        {
          kind: "image",
          prompt: "x",
          unique_slug: "abc",
          library_scope: "project",
          project_id: 7,
        },
        { isNew: true },
      ),
      [],
    );
  });

  it("rejects non-array references", () => {
    assert(
      validateGenerationForm(
        { kind: "image", prompt: "x", unique_slug: "abc", references: "nope" },
        { isNew: true },
      ).some((e) => e.toLowerCase().includes("references")),
    );
  });
});

describe("vramPreCheck", () => {
  const localCli = { backend: "local_cli", vram_requirement_mb: 51200 };

  it("needs a choice when free VRAM is below the requirement", () => {
    const check = vramPreCheck(localCli, {
      gpu: { model: "RTX", vram_mb: 100 * 1024, vram_used_mb: 95 * 1024 },
    });
    assertEquals(check.needed, true);
    assertEquals(check.freeMb, 5 * 1024);
    assertEquals(check.requirementMb, 51200);
    assertEquals(check.gpuModel, "RTX");
  });

  it("needs no choice when free VRAM covers the requirement", () => {
    const check = vramPreCheck(localCli, {
      gpu: { model: "RTX", vram_mb: 100 * 1024, vram_used_mb: 10 * 1024 },
    });
    assertEquals(check.needed, false);
  });

  it("ignores non-local_cli backends (comfyui/mock)", () => {
    for (const backend of ["comfyui", "mock"]) {
      const check = vramPreCheck(
        { backend, vram_requirement_mb: 51200 },
        { gpu: { vram_mb: 1024, vram_used_mb: 1024 } },
      );
      assertEquals(check.needed, false);
    }
  });

  it("ignores models with no VRAM requirement", () => {
    const check = vramPreCheck(
      { backend: "local_cli", vram_requirement_mb: 0 },
      { gpu: { vram_mb: 1024, vram_used_mb: 1024 } },
    );
    assertEquals(check.needed, false);
    assertEquals(check.requirementMb, null);
  });

  it("ignores hardware without a GPU (no VRAM numbers)", () => {
    const check = vramPreCheck(localCli, { gpu: null });
    assertEquals(check.needed, false);
    assertEquals(check.freeMb, null);
  });

  it("ignores a GPU whose VRAM is unknown", () => {
    const check = vramPreCheck(localCli, {
      gpu: { model: "RTX", vram_mb: null, vram_used_mb: null },
    });
    assertEquals(check.needed, false);
    assertEquals(check.freeMb, null);
  });

  it("tolerates a missing model or hardware", () => {
    assertEquals(vramPreCheck(null, { gpu: { vram_mb: 1, vram_used_mb: 1 } }).needed, false);
    assertEquals(vramPreCheck(localCli, null).needed, false);
    assertEquals(vramPreCheck(undefined, undefined).needed, false);
  });
});

describe("vramSufficient", () => {
  const model = { backend: "local_cli", vram_requirement_mb: 2048 };

  it("is true when free VRAM meets the requirement", () => {
    assertEquals(
      vramSufficient(model, { gpu: { vram_mb: 4096, vram_used_mb: 2048 } }),
      true,
    );
  });

  it("is false when free VRAM is below the requirement", () => {
    assertEquals(
      vramSufficient(model, { gpu: { vram_mb: 4096, vram_used_mb: 3072 } }),
      false,
    );
  });

  it("is false when there is no GPU", () => {
    assertEquals(vramSufficient(model, { gpu: null }), false);
  });

  it("is true when the model declares no requirement", () => {
    assertEquals(
      vramSufficient({ backend: "local_cli", vram_requirement_mb: 0 }, {
        gpu: null,
      }),
      true,
    );
  });
});

describe("formatGb", () => {
  it("formats megabytes as a GB label", () => {
    assertEquals(formatGb(51200), "50.0 GB");
    assertEquals(formatGb(1024), "1.0 GB");
    assertEquals(formatGb(1536), "1.5 GB");
  });

  it("renders unknown values as a question mark", () => {
    assertEquals(formatGb(null), "?");
    assertEquals(formatGb(undefined), "?");
  });
});
