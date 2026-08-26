import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_FRONTEND_URL || "http://127.0.0.1:8224",
  },
});
