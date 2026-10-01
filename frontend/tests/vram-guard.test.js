import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";

import { api } from "../src/api.js";
import { demoVramDevice } from "../src/components/vram-guard.js";

// A local_cli model with a 4 GiB requirement — the only backend whose runner
// honors a device override, so it exercises the full guard path.
//
// demoVramDevice returns:
//   { device: null, note: null }   -> nothing to guard (fits / no gpu / no
//                                     requirement / non-local_cli); the runner
//                                     picks the device.
//   { device: "cuda", note: "..." }-> was tight, force-free made it fit.
//   { device: null, note: "..." }  -> still tight after freeing; the runner
//                                     auto-falls back to CPU and the user is
//                                     warned.
const MODEL = { backend: "local_cli", vram_requirement_mb: 4096 };

const origGetHardware = api.getModelsHardware;
const origFreeVram = api.freeVramUnload;
function stubHardware(totalMb, usedMb, model = "Test GPU") {
  return {
    hardware: { gpu: { vram_mb: totalMb, vram_used_mb: usedMb, model } },
  };
}
function install(getHardware, freeVram) {
  api.getModelsHardware = getHardware;
  api.freeVramUnload = freeVram;
}
function restore() {
  api.getModelsHardware = origGetHardware;
  api.freeVramUnload = origFreeVram;
}
function hasNote(r) {
  return typeof r.note === "string" && r.note.length > 0;
}

describe("demoVramDevice", () => {
  it("returns null device + note when there is no model to check", async () => {
    try {
      install(async () => {
        throw new Error("should not probe without a model");
      }, async () => {
        throw new Error("should not free without a model");
      });
      assertEquals(await demoVramDevice(null), { device: null, note: null });
    } finally {
      restore();
    }
  });

  it("returns null device + note for non-local_cli backends", async () => {
    try {
      install(async () => {
        throw new Error("should not probe a mock backend");
      }, async () => {
        throw new Error("should not free for a mock backend");
      });
      assertEquals(
        await demoVramDevice({ backend: "mock", vram_requirement_mb: 4096 }),
        { device: null, note: null },
      );
    } finally {
      restore();
    }
  });

  it("does not free when the model already fits", async () => {
    try {
      // free 12 GiB >= 4 GiB requirement.
      install(async () => stubHardware(16384, 4096), async () => {
        throw new Error("must not free when the model fits");
      });
      const r = await demoVramDevice(MODEL);
      assertEquals(r.device, null);
      assertEquals(r.note, null);
    } finally {
      restore();
    }
  });

  it("force-frees and returns cuda when the freed memory lets it fit", async () => {
    try {
      let calls = 0;
      let freed = 0;
      install(
        async () => {
          calls += 1;
          // 1st probe: free 2 GiB (below 4 GiB). 2nd (re-probe after free):
          // free 12 GiB (fits).
          return calls === 1 ? stubHardware(16384, 14336) : stubHardware(16384, 4096);
        },
        async () => {
          freed += 1;
          return {};
        },
      );
      const r = await demoVramDevice(MODEL);
      assertEquals(r.device, "cuda");
      assertEquals(hasNote(r), true);
      assertEquals(freed, 1);
    } finally {
      restore();
    }
  });

  it("warns (runner falls back) when freeing cannot make it fit", async () => {
    try {
      let freed = 0;
      install(
        async () => stubHardware(16384, 14336), // free stays 2 GiB
        async () => {
          freed += 1;
          return {};
        },
      );
      const r = await demoVramDevice(MODEL);
      assertEquals(r.device, null);
      assertEquals(hasNote(r), true);
      assertEquals(freed, 1);
    } finally {
      restore();
    }
  });

  it("warns without crashing when freeing itself throws", async () => {
    try {
      install(
        async () => stubHardware(16384, 14336),
        async () => {
          throw new Error("ComfyUI unreachable");
        },
      );
      const r = await demoVramDevice(MODEL);
      assertEquals(r.device, null);
      assertEquals(hasNote(r), true);
    } finally {
      restore();
    }
  });

  it("does not free when no GPU is present", async () => {
    try {
      install(async () => ({ hardware: { gpu: null } }), async () => {
        throw new Error("must not free with no GPU");
      });
      const r = await demoVramDevice(MODEL);
      assertEquals(r.device, null);
      assertEquals(r.note, null);
    } finally {
      restore();
    }
  });

  it("does not free when the model declares no VRAM requirement", async () => {
    try {
      install(async () => stubHardware(16384, 14336), async () => {
        throw new Error("must not free without a requirement");
      });
      const r = await demoVramDevice({
        backend: "local_cli",
        vram_requirement_mb: null,
      });
      assertEquals(r.device, null);
      assertEquals(r.note, null);
    } finally {
      restore();
    }
  });
});
