import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

describe("health endpoint", () => {
  beforeEach(() => {
    freshMemoryDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("returns ok with version", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(res.status, 200);
      const body = (await res.json()) as Record<string, unknown>;
      assertEquals(body.status, "ok");
      assertEquals(body.name, "cinemaItor");
      assertEquals(typeof body.version, "string");
    });
  });
});
