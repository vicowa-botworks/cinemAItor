import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { api, ApiError } from "../src/api.js";
import { creativeAssetIds } from "../src/creative-assets.js";

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

  describe("v1 asset endpoints", () => {
    it("listAssets builds the query from the filter", async () => {
      await api.listAssets({ project_id: "p1", asset_type: "image", q: "hero" });
      assertEquals(
        captured[0].url,
        "/api/v1/assets?project_id=p1&asset_type=image&q=hero",
      );
    });

    it("listAssets omits empty filter values", async () => {
      await api.listAssets({ q: "", tag: undefined, status: null });
      assertEquals(captured[0].url, "/api/v1/assets");
    });

    it("getAsset requests /api/v1/assets/:id", async () => {
      await api.getAsset("a-1");
      assertEquals(captured[0].url, "/api/v1/assets/a-1");
    });

    it("createAsset posts to /api/v1/assets", async () => {
      await api.createAsset({ unique_slug: "hero", display_name: "Hero" });
      assertEquals(captured[0].url, "/api/v1/assets");
      assertEquals(captured[0].options.method, "POST");
      assertEquals(
        JSON.parse(captured[0].options.body).unique_slug,
        "hero",
      );
    });

    it("updateAsset patches /api/v1/assets/:id", async () => {
      await api.updateAsset("a-1", { status: "approved" });
      assertEquals(captured[0].url, "/api/v1/assets/a-1");
      assertEquals(captured[0].options.method, "PATCH");
    });

    it("deleteAsset deletes /api/v1/assets/:id", async () => {
      await api.deleteAsset("a-1");
      assertEquals(captured[0].url, "/api/v1/assets/a-1");
      assertEquals(captured[0].options.method, "DELETE");
    });

    it("uploadAsset posts a multipart body without JSON content type", async () => {
      const file = new File(["bytes"], "a.png", { type: "image/png" });
      await api.uploadAsset("a-1", file, "first take");
      const { url, options } = captured[0];
      assertEquals(url, "/api/v1/assets/a-1/upload");
      assertEquals(options.method, "POST");
      assert(options.body instanceof FormData);
      assertEquals(options.body.get("file"), file);
      assertEquals(options.body.get("notes"), "first take");
      assertEquals(options.headers["Content-Type"], undefined);
    });

    it("listAssetVersions requests /api/v1/assets/:id/versions", async () => {
      await api.listAssetVersions("a-1");
      assertEquals(captured[0].url, "/api/v1/assets/a-1/versions");
    });

    it("restoreAssetVersion posts to the restore path", async () => {
      await api.restoreAssetVersion("a-1", "v-9");
      assertEquals(captured[0].url, "/api/v1/assets/a-1/versions/v-9/restore");
      assertEquals(captured[0].options.method, "POST");
    });

    it("addAssetAlias posts the alias slug", async () => {
      await api.addAssetAlias("a-1", "hero_v2");
      assertEquals(captured[0].url, "/api/v1/assets/a-1/aliases");
      assertEquals(JSON.parse(captured[0].options.body).alias_slug, "hero_v2");
    });

    it("removeAssetAlias deletes the alias path", async () => {
      await api.removeAssetAlias("a-1", "hero_v2");
      assertEquals(captured[0].url, "/api/v1/assets/a-1/aliases/hero_v2");
      assertEquals(captured[0].options.method, "DELETE");
    });

    it("addAssetTag posts the tag", async () => {
      await api.addAssetTag("a-1", "vfx");
      assertEquals(captured[0].url, "/api/v1/assets/a-1/tags");
      assertEquals(JSON.parse(captured[0].options.body).tag, "vfx");
    });

    it("removeAssetTag deletes the tag path", async () => {
      await api.removeAssetTag("a-1", "vfx");
      assertEquals(captured[0].url, "/api/v1/assets/a-1/tags/vfx");
      assertEquals(captured[0].options.method, "DELETE");
    });

    it("regenerateAssetProxy posts to the proxy path", async () => {
      await api.regenerateAssetProxy("a-1", "v-9");
      assertEquals(captured[0].url, "/api/v1/assets/a-1/versions/v-9/proxy");
      assertEquals(captured[0].options.method, "POST");
    });

    it("encodes asset ids and slugs in paths", async () => {
      await api.getAsset("a b/c");
      assertEquals(captured[0].url, "/api/v1/assets/a%20b%2Fc");
      await api.removeAssetAlias("a-1", "has space");
      assertEquals(
        captured[1].url,
        "/api/v1/assets/a-1/aliases/has%20space",
      );
    });
  });

  describe("v1 prompt endpoints", () => {
    it("savePrompt posts scope, id, and content", async () => {
      await api.savePrompt({
        scope_type: "scene",
        scope_id: "scene-42",
        content: "@hero in @room",
        roles: { hero: "character" },
      });
      const { url, options } = captured[0];
      assertEquals(url, "/api/v1/prompts");
      assertEquals(options.method, "POST");
      const body = JSON.parse(options.body);
      assertEquals(body.scope_type, "scene");
      assertEquals(body.scope_id, "scene-42");
      assertEquals(body.content, "@hero in @room");
      assertEquals(body.roles.hero, "character");
    });

    it("savePrompt omits roles when not provided", async () => {
      await api.savePrompt({ scope_type: "prompt", scope_id: "p1", content: "x" });
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.roles, undefined);
    });

    it("listPromptVersions requests the scope path with encoding", async () => {
      await api.listPromptVersions("storyboard panel", "a b/c");
      assertEquals(
        captured[0].url,
        "/api/v1/prompts/storyboard%20panel/a%20b%2Fc",
      );
    });

    it("getLatestPrompt hits the latest subpath", async () => {
      await api.getLatestPrompt("scene", "s1");
      assertEquals(captured[0].url, "/api/v1/prompts/scene/s1/latest");
    });

    it("getPromptVersion requests /api/v1/prompts/:id", async () => {
      await api.getPromptVersion("pv-1");
      assertEquals(captured[0].url, "/api/v1/prompts/pv-1");
    });

    it("restorePrompt posts to the restore path", async () => {
      await api.restorePrompt("pv-1");
      assertEquals(captured[0].url, "/api/v1/prompts/pv-1/restore");
      assertEquals(captured[0].options.method, "POST");
    });
  });

  describe("v1 reference endpoints", () => {
    it("parseReferences posts text only by default", async () => {
      await api.parseReferences({ text: "@hero walks" });
      const { url, options } = captured[0];
      assertEquals(url, "/api/v1/references/parse");
      assertEquals(options.method, "POST");
      const body = JSON.parse(options.body);
      assertEquals(body, { text: "@hero walks" });
    });

    it("parseReferences includes roles and persist when provided", async () => {
      await api.parseReferences({
        text: "@hero",
        roles: { hero: "character" },
        persist: { scope_type: "prompt", scope_id: "p1" },
      });
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.roles.hero, "character");
      assertEquals(body.persist.scope_type, "prompt");
      assertEquals(body.persist.scope_id, "p1");
    });

    it("auditReferences builds the query from the filter", async () => {
      await api.auditReferences({ status: "missing", source_type: "prompt" });
      assertEquals(
        captured[0].url,
        "/api/v1/references/audit?status=missing&source_type=prompt",
      );
    });

    it("auditReferences omits empty filter values", async () => {
      await api.auditReferences({ status: "", asset_id: null });
      assertEquals(captured[0].url, "/api/v1/references/audit");
    });

    it("replaceReference posts slug and optional version", async () => {
      await api.replaceReference("ref-1", { slug: "hero", version: 2 });
      const { url, options } = captured[0];
      assertEquals(url, "/api/v1/references/ref-1/replace");
      assertEquals(options.method, "POST");
      assertEquals(JSON.parse(options.body), { slug: "hero", version: 2 });
    });
  });

  describe("v1 model endpoints", () => {
    it("listModels builds the query from the filter", async () => {
      await api.listModels({ enabled: "true", task_type: "audio", query: "tts" });
      assertEquals(
        captured[0].url,
        "/api/v1/models?enabled=true&task_type=audio&query=tts",
      );
    });

    it("listModels omits empty filter values", async () => {
      await api.listModels({ query: "", task_type: undefined });
      assertEquals(captured[0].url, "/api/v1/models");
    });

    it("registerModel posts to /api/v1/models", async () => {
      await api.registerModel({ name: "M", backend: "mock" });
      assertEquals(captured[0].url, "/api/v1/models");
      assertEquals(captured[0].options.method, "POST");
      assertEquals(JSON.parse(captured[0].options.body).backend, "mock");
    });

    it("updateModel patches /api/v1/models/:id", async () => {
      await api.updateModel("m-1", { enabled: false });
      assertEquals(captured[0].url, "/api/v1/models/m-1");
      assertEquals(captured[0].options.method, "PATCH");
    });

    it("deleteModel deletes /api/v1/models/:id", async () => {
      await api.deleteModel("m-1");
      assertEquals(captured[0].url, "/api/v1/models/m-1");
      assertEquals(captured[0].options.method, "DELETE");
    });

    it("installModel posts consent only when provided", async () => {
      await api.installModel("m-1");
      assertEquals(JSON.parse(captured[0].options.body), {});
      await api.installModel("m-1", { consent: true });
      assertEquals(JSON.parse(captured[1].options.body), { consent: true });
    });

    it("verifyModel and healthCheckModel post to their subpaths", async () => {
      await api.verifyModel("m-1");
      await api.healthCheckModel("m 1");
      assertEquals(captured[0].url, "/api/v1/models/m-1/verify");
      assertEquals(captured[1].url, "/api/v1/models/m%201/health-check");
      assertEquals(captured[0].options.method, "POST");
      assertEquals(captured[1].options.method, "POST");
    });

    it("getModelsHardware requests the hardware report", async () => {
      await api.getModelsHardware();
      assertEquals(captured[0].url, "/api/v1/models/hardware");
    });
  });

  describe("v1 job endpoints", () => {
    it("listJobs builds the query from the filter", async () => {
      await api.listJobs({
        status: "running",
        job_type: "text_to_image",
        project_id: "p1",
        limit: 50,
      });
      assertEquals(
        captured[0].url,
        "/api/v1/jobs?status=running&job_type=text_to_image&project_id=p1&limit=50",
      );
    });

    it("listJobs omits empty filter values", async () => {
      await api.listJobs({ status: "", job_type: undefined });
      assertEquals(captured[0].url, "/api/v1/jobs");
    });

    it("getJob requests /api/v1/jobs/:id", async () => {
      await api.getJob("job-1");
      assertEquals(captured[0].url, "/api/v1/jobs/job-1");
    });

    it("cancelJob posts to the cancel subpath", async () => {
      await api.cancelJob("job 1");
      assertEquals(captured[0].url, "/api/v1/jobs/job%201/cancel");
      assertEquals(captured[0].options.method, "POST");
    });

    it("retryJob posts to the retry subpath", async () => {
      await api.retryJob("job-1");
      assertEquals(captured[0].url, "/api/v1/jobs/job-1/retry");
      assertEquals(captured[0].options.method, "POST");
    });

    it("listJobEvents requests the events subpath", async () => {
      await api.listJobEvents("job-1");
      assertEquals(captured[0].url, "/api/v1/jobs/job-1/events");
    });
  });

  describe("v1 storyboard endpoints", () => {
    it("listStoryboards builds the query from the filter", async () => {
      await api.listStoryboards({ project_id: "p1" });
      assertEquals(captured[0].url, "/api/v1/storyboards?project_id=p1");
    });

    it("listStoryboards omits empty filter values", async () => {
      await api.listStoryboards({ project_id: "" });
      assertEquals(captured[0].url, "/api/v1/storyboards");
    });

    it("createStoryboard posts to /api/v1/storyboards", async () => {
      await api.createStoryboard({ name: "Act one", project_id: "p1" });
      assertEquals(captured[0].url, "/api/v1/storyboards");
      assertEquals(captured[0].options.method, "POST");
      assertEquals(JSON.parse(captured[0].options.body).name, "Act one");
    });

    it("storyboard id routes target /:id", async () => {
      await api.getStoryboard("sb-1");
      assertEquals(captured[0].url, "/api/v1/storyboards/sb-1");
      await api.updateStoryboard("sb-1", { name: "X" });
      assertEquals(captured[1].url, "/api/v1/storyboards/sb-1");
      assertEquals(captured[1].options.method, "PATCH");
      await api.deleteStoryboard("sb-1");
      assertEquals(captured[2].url, "/api/v1/storyboards/sb-1");
      assertEquals(captured[2].options.method, "DELETE");
    });

    it("panel routes nest under the storyboard", async () => {
      await api.listPanels("sb-1");
      assertEquals(captured[0].url, "/api/v1/storyboards/sb-1/panels");
      await api.createPanel("sb-1", { panel_order: 1 });
      assertEquals(captured[1].url, "/api/v1/storyboards/sb-1/panels");
      assertEquals(captured[1].options.method, "POST");
      await api.updatePanel("sb-1", "p-1", { prompt: "close-up" });
      assertEquals(captured[2].url, "/api/v1/storyboards/sb-1/panels/p-1");
      assertEquals(captured[2].options.body, JSON.stringify({ prompt: "close-up" }));
      await api.deletePanel("sb-1", "p-1");
      assertEquals(captured[3].url, "/api/v1/storyboards/sb-1/panels/p-1");
      assertEquals(captured[3].options.method, "DELETE");
    });

    it("generatePanelPreview posts to the generate-preview subpath", async () => {
      await api.generatePanelPreview("sb-1", "p-1", { model_id: "m-1", seed: "42" });
      assertEquals(
        captured[0].url,
        "/api/v1/storyboards/sb-1/panels/p-1/generate-preview",
      );
      assertEquals(captured[0].options.method, "POST");
      assertEquals(JSON.parse(captured[0].options.body).seed, "42");
    });
  });

  describe("v1 scene endpoints", () => {
    it("listScenes builds the query from the filter", async () => {
      await api.listScenes({ project_id: "p1", storyboard_id: "sb-1" });
      assertEquals(
        captured[0].url,
        "/api/v1/scenes?project_id=p1&storyboard_id=sb-1",
      );
    });

    it("scene id routes target /:id", async () => {
      await api.getScene("sc-1");
      assertEquals(captured[0].url, "/api/v1/scenes/sc-1");
      await api.deleteScene("sc-1");
      assertEquals(captured[1].url, "/api/v1/scenes/sc-1");
      assertEquals(captured[1].options.method, "DELETE");
    });

    it("shot routes nest under the scene", async () => {
      await api.listShots("sc-1");
      assertEquals(captured[0].url, "/api/v1/scenes/sc-1/shots");
      await api.createShot("sc-1", { shot_order: 2, name: "Wide" });
      assertEquals(captured[1].url, "/api/v1/scenes/sc-1/shots");
      assertEquals(JSON.parse(captured[1].options.body).shot_order, 2);
      await api.updateShot("sc-1", "sh-1", { prompt: "night shot" });
      assertEquals(captured[2].url, "/api/v1/scenes/sc-1/shots/sh-1");
      assertEquals(captured[2].options.method, "PATCH");
      await api.deleteShot("sc-1", "sh-1");
      assertEquals(captured[3].url, "/api/v1/scenes/sc-1/shots/sh-1");
      assertEquals(captured[3].options.method, "DELETE");
    });

    it("generate and batch-generate post to the scene subpaths", async () => {
      await api.generateScene("sc 1", { model_id: "m-1" });
      assertEquals(
        captured[0].url,
        "/api/v1/scenes/sc%201/generate",
      );
      assertEquals(captured[0].options.method, "POST");
      await api.batchGenerateScene("sc-1", { seed: "9" });
      assertEquals(captured[1].url, "/api/v1/scenes/sc-1/batch-generate");
      assertEquals(captured[1].options.method, "POST");
      assertEquals(JSON.parse(captured[1].options.body).seed, "9");
    });
  });

  describe("v1 review endpoints", () => {
    it("listJobCandidates requests the job candidates subpath", async () => {
      await api.listJobCandidates("job-1");
      assertEquals(captured[0].url, "/api/v1/review/jobs/job-1/candidates");
    });

    it("reviewDecision posts approve/reject/shortlist to the action subpath", async () => {
      await api.reviewDecision("v-1", "approve", "best take");
      assertEquals(captured[0].url, "/api/v1/review/candidates/v-1/approve");
      assertEquals(captured[0].options.method, "POST");
      assertEquals(JSON.parse(captured[0].options.body).notes, "best take");

      await api.reviewDecision("v-2", "shortlist");
      assertEquals(captured[1].url, "/api/v1/review/candidates/v-2/shortlist");
      assertEquals(captured[1].options.body, JSON.stringify({}));
    });
  });

  describe("creative asset slug map", () => {
    it("maps prefix-matched slugs to asset ids", async () => {
      const rows = [
        { unique_slug: "panel_abcd1234", id: "asset-panel-1" },
        { unique_slug: "panel_00000000", id: "asset-panel-2" },
        { unique_slug: "scene_abcd1234", id: "asset-scene-1" },
      ];
      globalThis.fetch = async (url) => {
        const q = new URL(String(url), "http://localhost").searchParams.get("q") ?? "";
        return jsonResponse(
          rows.filter((r) => r.unique_slug.includes(q)),
        );
      };
      const map = await creativeAssetIds("panel", { force: true });
      assertEquals(map.get("panel_abcd1234"), "asset-panel-1");
      assert(map.get("scene_abcd1234") === undefined, "other prefixes excluded");
    });

    it("reuses the cached map until forced", async () => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return jsonResponse([{ unique_slug: "panel_abcd1234", id: "a1" }]);
      };
      await creativeAssetIds("panel", { force: true });
      const map = await creativeAssetIds("panel");
      assertEquals(calls, 1, "second read should not refetch");
      assertEquals(map.get("panel_abcd1234"), "a1");
    });
  });

  describe("fetchMediaUrl", () => {
    it("resolves a blob url and the content type", async () => {
      const blob = new Blob(["img"], { type: "image/png" });
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        blob: async () => blob,
      });
      const media = await api.fetchMediaUrl("/assets/a-1/preview");
      assert(media.url.startsWith("blob:"));
      assertEquals(media.type, "image/png");
      URL.revokeObjectURL(media.url);
    });

    it("throws ApiError for failed media requests", async () => {
      globalThis.fetch = async () => jsonResponse({ error: "not found" }, 404);
      await assertRejects(() => api.fetchMediaUrl("/assets/a-1/preview"), ApiError);
    });
  });

  describe("legacy demo endpoints", () => {
    it("keeps movie calls on the /api base", async () => {
      await api.getMovies();
      await api.getMovie(7);
      await api.createMovieScene(7, { scene_number: 1 });
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
