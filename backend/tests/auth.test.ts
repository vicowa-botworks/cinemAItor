import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assert } from "jsr:@std/assert";
import { generateToken, verifyToken } from "../src/middleware/auth.ts";

describe("JWT Auth", () => {
  it("should generate a valid token", async () => {
    const token = await generateToken(1);
    assert(token !== null, "token should not be null");
    assertEquals(token.split(".").length, 2);
  });

  it("should verify a valid token", async () => {
    const token = await generateToken(42);
    const payload = await verifyToken(token);

    assert(payload !== null, "payload should not be null");
    assertEquals(payload?.sub, 42);
  });

  it("should reject an invalid token", async () => {
    const payload = await verifyToken("invalid.token.here");
    assert(payload === null, "payload should be null for invalid token");
  });

  it("should reject a tampered token", async () => {
    const token = await generateToken(1);
    const parts = token.split(".");
    const tampered = `${parts[0]}.tampered`;
    const payload = await verifyToken(tampered);
    assert(payload === null, "payload should be null for tampered token");
  });
});
