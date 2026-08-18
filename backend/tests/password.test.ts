import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { hashPassword, verifyPassword } from "../src/services/password.ts";

describe("password hashing", () => {
  it("hashes and verifies correctly", async () => {
    const hash = await hashPassword("s3cret-value");
    assertEquals(await verifyPassword("s3cret-value", hash), true);
  });

  it("rejects wrong passwords", async () => {
    const hash = await hashPassword("s3cret-value");
    assertEquals(await verifyPassword("wrong-value", hash), false);
  });

  it("produces unique salts", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    assert(a !== b, "hashes should differ due to unique salts");
  });
});
