import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig } from "../src/config.ts";

function envWith(vars: Record<string, string>) {
  return { get: (key: string) => vars[key] };
}

describe("loadConfig", () => {
  it("applies defaults when no env is set", () => {
    const config = loadConfig(envWith({ JWT_SECRET: "test-secret" }));
    assertEquals(config.port, 8123);
    assertEquals(config.dbPath, "./cinemaItor.db");
    assertEquals(config.appDataDir, "./app_data");
    assertEquals(config.jwtSecret, "test-secret");
    assertEquals(config.logLevel, "info");
    assertEquals(config.jobConcurrencyGpu, 1);
    assertEquals(config.jobConcurrencyCpu, 2);
    assertEquals(config.uploadMaxBytes > 0, true);
    assertEquals(config.modelDownloadMaxBytes, 0);
  });

  it("requires JWT_SECRET", () => {
    assertThrows(
      () => loadConfig(envWith({ PORT: "9000" })),
      Error,
      "JWT_SECRET",
    );
  });

  it("reads values from env", () => {
    const config = loadConfig(envWith({
      PORT: "9000",
      DB_PATH: "/tmp/x.db",
      APP_DATA_DIR: "/tmp/data",
      JWT_SECRET: "s3cret",
      LOG_LEVEL: "debug",
      FFMPEG_PATH: "/usr/bin/ffmpeg",
      UPLOAD_MAX_SIZE: "1234",
      MODEL_DOWNLOAD_MAX_SIZE: "1000000",
      JOB_CONCURRENCY_GPU: "2",
      JOB_CONCURRENCY_CPU: "4",
    }));
    assertEquals(config.port, 9000);
    assertEquals(config.dbPath, "/tmp/x.db");
    assertEquals(config.appDataDir, "/tmp/data");
    assertEquals(config.jwtSecret, "s3cret");
    assertEquals(config.logLevel, "debug");
    assertEquals(config.ffmpegPath, "/usr/bin/ffmpeg");
    assertEquals(config.uploadMaxBytes, 1234);
    assertEquals(config.modelDownloadMaxBytes, 1000000);
    assertEquals(config.jobConcurrencyGpu, 2);
    assertEquals(config.jobConcurrencyCpu, 4);
  });

  it("rejects an out-of-range port", () => {
    assertThrows(() => loadConfig(envWith({ PORT: "0" })), Error);
  });

  it("rejects a non-integer port", () => {
    assertThrows(() => loadConfig(envWith({ PORT: "abc" })), Error);
  });

  it("rejects an invalid log level", () => {
    assertThrows(() => loadConfig(envWith({ LOG_LEVEL: "verbose" })), Error);
  });
});
