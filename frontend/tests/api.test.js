import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { api, ApiError } from "../src/api.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("ApiClient", () => {
  let captured;

  beforeEach(() => {
    api.clearToken();
    captured = [];
    globalThis.fetch = async (url, options = {}) => {
      captured.push({ url: String(url), options });
      return { ok: true, status: 200, json: async () => ({}) };
    };
  });

  afterEach(() => {
    api.clearToken();
    delete globalThis.fetch;
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

    it("should attach the bearer token to v1 requests", async () => {
      api.setToken("test-token-123");
      await api.getMe();
      assertEquals(
        captured[0].options.headers.Authorization,
        "Bearer test-token-123",
      );
    });
  });

  describe("v1 auth endpoints", () => {
    it("bootstrap posts to /api/v1/auth/bootstrap with display_name", async () => {
      await api.bootstrap("a@b.c", "password123", "A");
      const { url, options } = captured[0];
      assertEquals(url, "/api/v1/auth/bootstrap");
      assertEquals(options.method, "POST");
      assertEquals(JSON.parse(options.body).display_name, "A");
    });

    it("login posts to /api/v1/auth/login", async () => {
      await api.login("a@b.c", "password123");
      assertEquals(captured[0].url, "/api/v1/auth/login");
      assertEquals(captured[0].options.method, "POST");
    });

    it("logout posts to /api/v1/auth/logout", async () => {
      await api.logout();
      assertEquals(captured[0].url, "/api/v1/auth/logout");
      assertEquals(captured[0].options.method, "POST");
    });

    it("getMe requests /api/v1/auth/me", async () => {
      await api.getMe();
      assertEquals(captured[0].url, "/api/v1/auth/me");
    });
  });

  describe("v1 project endpoints", () => {
    it("listProjects requests /api/v1/projects", async () => {
      await api.listProjects();
      assertEquals(captured[0].url, "/api/v1/projects");
    });

    it("createProject posts to /api/v1/projects", async () => {
      await api.createProject({ name: "X" });
      assertEquals(captured[0].url, "/api/v1/projects");
      assertEquals(captured[0].options.method, "POST");
      assertEquals(JSON.parse(captured[0].options.body).name, "X");
    });

    it("getProject requests /api/v1/projects/:id", async () => {
      await api.getProject("abc-123");
      assertEquals(captured[0].url, "/api/v1/projects/abc-123");
    });

    it("updateProject patches /api/v1/projects/:id", async () => {
      await api.updateProject("abc-123", { name: "Y" });
      assertEquals(captured[0].url, "/api/v1/projects/abc-123");
      assertEquals(captured[0].options.method, "PATCH");
    });

    it("deleteProject deletes /api/v1/projects/:id", async () => {
      await api.deleteProject("abc-123");
      assertEquals(captured[0].url, "/api/v1/projects/abc-123");
      assertEquals(captured[0].options.method, "DELETE");
    });

    it("encodes project ids in paths", async () => {
      await api.getProject("a b/c");
      assertEquals(captured[0].url, "/api/v1/projects/a%20b%2Fc");
    });
  });

  describe("legacy demo endpoints", () => {
    it("keeps movie calls on the /api base", async () => {
      await api.getMovies();
      await api.getMovie(7);
      await api.createScene(7, { scene_number: 1 });
      assertEquals(captured[0].url, "/api/movies");
      assertEquals(captured[1].url, "/api/movies/7");
      assertEquals(captured[2].url, "/api/movies/7/scenes");
    });
  });

  describe("error handling", () => {
    it("throws ApiError with server message and status", async () => {
      globalThis.fetch = async () => jsonResponse({ error: "Invalid credentials" }, 401);
      const err = await assertRejects(
        () => api.login("a@b.c", "bad"),
        ApiError,
      );
      assertEquals(err.status, 401);
      assertEquals(err.message, "Invalid credentials");
    });

    it("falls back to status text when error body is not JSON", async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      });
      const err = await assertRejects(
        () => api.listProjects(),
        ApiError,
      );
      assertEquals(err.status, 500);
      assertEquals(err.message, "Internal Server Error");
    });

    it("returns null for 204 no-content responses", async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 204,
        json: async () => {
          throw new Error("no body on 204");
        },
      });
      assertEquals(await api.logout(), null);
    });
  });
});
