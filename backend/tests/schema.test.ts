import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { getDb, resetDb } from "../src/db/database.ts";
import * as schema from "../src/db/schema.ts";

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
}

describe("Database", () => {
  let userId: number;

  beforeEach(() => {
    getDb(":memory:");
    userId = schema.createUser(uniqueEmail("test"), "hash123", "Test User");
  });

  afterEach(() => {
    resetDb();
  });

  it("should create and retrieve a user", () => {
    const user = schema.getUserById(userId);
    assert(user !== undefined, "user should be defined");
    assertEquals(user?.email.includes("test"), true);
    assertEquals(user?.display_name, "Test User");
  });

  it("should find user by email", () => {
    const email = uniqueEmail("findByEmail");
    schema.createUser(email, "hash456", "Find User");
    const user = schema.getUserByEmail(email);
    assert(user !== undefined, "user should be defined");
    assertEquals(user?.display_name, "Find User");
  });

  it("should return undefined for non-existent user", () => {
    const user = schema.getUserById(99999);
    assert(user === undefined, "user should be undefined");
  });

  it("should assign distinct ids to consecutive users", () => {
    const secondId = schema.createUser(
      uniqueEmail("second"),
      "hash111",
      "Second User",
    );
    assert(secondId !== userId, "second user should get a distinct id");
    const second = schema.getUserById(secondId);
    assert(
      second !== undefined,
      "second user should be retrievable by returned id",
    );
    assertEquals(second?.display_name, "Second User");
  });
});
