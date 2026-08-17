import { describe, it, beforeEach, afterEach } from "jsr:@std/testing/bdd";
import { assertEquals, assert } from "jsr:@std/assert";
import { api } from "../src/api.ts";

describe("ApiClient", () => {
  beforeEach(() => {
    api.clearToken();
  });

  afterEach(() => {
    api.clearToken();
  });

  describe("token management", () => {
    it("should start without a token", () => {
      assert(api.getToken() === null, "token should be null initially");
    });

    it("should set and retrieve a token", () => {
      api.setToken("test-token-123");
      assertEquals(api.getToken(), "test-token-123");
    });

    it("should clear the token", () => {
      api.setToken("test-token-123");
      api.clearToken();
      assert(api.getToken() === null, "token should be null after clear");
    });
  });
});
