import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  isRunnerPid,
  registerRunnerPid,
  unregisterRunnerPid,
} from "../src/services/runner_registry.ts";

describe("runner pid registry", () => {
  it("starts empty", () => {
    assertEquals(isRunnerPid(123456), false);
  });

  it("registers and unregisters a child pid", () => {
    registerRunnerPid(123456);
    assertEquals(isRunnerPid(123456), true);
    // Re-registering is idempotent (a spawn registers exactly once).
    registerRunnerPid(123456);
    assertEquals(isRunnerPid(123456), true);
    unregisterRunnerPid(123456);
    assertEquals(isRunnerPid(123456), false);
  });
});
