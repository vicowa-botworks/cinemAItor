import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import {
  formatInstallBytes,
  installProgressLabel,
  installProgressPercent,
} from "../src/install-progress.js";

describe("formatInstallBytes", () => {
  it("formats from bytes up to petabytes", () => {
    assertEquals(formatInstallBytes(0), "0 B");
    assertEquals(formatInstallBytes(512), "512 B");
    assertEquals(formatInstallBytes(2048), "2 KiB");
    assertEquals(formatInstallBytes(5 * 1024 ** 2), "5 MiB");
    assertEquals(formatInstallBytes(1536 * 1024 ** 2), "1.5 GiB");
    assertEquals(formatInstallBytes(1234 * 1024 ** 3), "1.2 TiB");
    assertEquals(formatInstallBytes(150 * 1024 ** 3), "150 GiB");
  });

  it("uses whole numbers for large values", () => {
    assertEquals(formatInstallBytes(15000 * 1024 ** 3), "14.6 TiB");
  });

  it("rejects invalid input", () => {
    assertEquals(formatInstallBytes(-1), "—");
    assertEquals(formatInstallBytes(NaN), "—");
    assertEquals(formatInstallBytes(Infinity), "—");
    assertEquals(formatInstallBytes("10"), "—");
    assertEquals(formatInstallBytes(null), "—");
    assertEquals(formatInstallBytes(undefined), "—");
  });
});

describe("installProgressPercent", () => {
  it("computes a clamped percentage with one decimal", () => {
    assertEquals(installProgressPercent({ received_bytes: 1, total_bytes: 4 }), 25);
    assertEquals(installProgressPercent({ received_bytes: 1, total_bytes: 3 }), 33.3);
    assertEquals(installProgressPercent({ received_bytes: 8, total_bytes: 4 }), 100);
    assertEquals(installProgressPercent({ received_bytes: 0, total_bytes: 10 }), 0);
  });

  it("returns null when the total is unknown or malformed", () => {
    assertEquals(installProgressPercent({ received_bytes: 10, total_bytes: null }), null);
    assertEquals(installProgressPercent({ received_bytes: 10, total_bytes: 0 }), null);
    assertEquals(installProgressPercent({ total_bytes: 10 }), null);
    assertEquals(installProgressPercent(null), null);
    assertEquals(installProgressPercent(undefined), null);
  });
});

describe("installProgressLabel", () => {
  it("shows received of total with percent and speed", () => {
    const label = installProgressLabel({
      received_bytes: 1.5 * 1024 ** 3,
      total_bytes: 19.5 * 1024 ** 3,
      speed_bytes_per_sec: 12.5 * 1024 ** 2,
    });
    assertEquals(label, "1.5 GiB of 19.5 GiB (7%) · 12.5 MiB/s");
  });

  it("omits the speed when it is not positive", () => {
    assertEquals(
      installProgressLabel({
        received_bytes: 1024,
        total_bytes: 2048,
        speed_bytes_per_sec: 0,
      }),
      "1 KiB of 2 KiB (50%)",
    );
  });

  it("reports finalizing once the full file is on disk", () => {
    assertEquals(
      installProgressLabel({
        received_bytes: 10 * 1024 ** 3,
        total_bytes: 10 * 1024 ** 3,
        speed_bytes_per_sec: 12.5 * 1024 ** 2,
      }),
      "Download complete — finalizing…",
    );
    assertEquals(
      installProgressLabel({
        received_bytes: 2048,
        total_bytes: 1024,
        speed_bytes_per_sec: 0,
      }),
      "Download complete — finalizing…",
    );
  });

  it("degrades when the total is unknown", () => {
    assertEquals(installProgressLabel({ received_bytes: 4096 }), "4 KiB downloaded");
  });

  it("starts with a connecting placeholder", () => {
    assertEquals(installProgressLabel({}), "Connecting…");
    assertEquals(installProgressLabel(null), "Connecting…");
    assertEquals(installProgressLabel(undefined), "Connecting…");
  });
});
