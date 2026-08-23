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

    it("getAssetDependencies gets /api/v1/assets/:id/dependencies", async () => {
      await api.getAssetDependencies("a-1");
      assertEquals(captured[0].url, "/api/v1/assets/a-1/dependencies");
    });

    it("uploadAsset posts the raw file body with metadata headers", async () => {
      const file = new File(["bytes"], "a.png", { type: "image/png" });
      await api.uploadAsset("a-1", file, "first take");
      const { url, options } = captured[0];
      assertEquals(url, "/api/v1/assets/a-1/upload");
      assertEquals(options.method, "POST");
      assert(options.body instanceof Blob);
      assertEquals(options.headers["Content-Type"], "application/octet-stream");
      assertEquals(options.headers["X-File-Name"], encodeURIComponent("a.png"));
      assertEquals(
        options.headers["X-Upload-Notes"],
        encodeURIComponent("first take"),
      );
    });

    it("uploadAsset omits the notes header when no notes are given", async () => {
      const file = new File(["bytes"], "b.png", { type: "image/png" });
      await api.uploadAsset("a-1", file);
      const { options } = captured[0];
      assertEquals(options.headers["X-Upload-Notes"], undefined);
      assertEquals(options.headers["X-File-Name"], encodeURIComponent("b.png"));
    });

    it("uploadAsset percent-encodes optional technical metadata", async () => {
      const file = new File(["bytes"], "c.glb", { type: "model/gltf-binary" });
      const metadata = { provenance: { kind: "derived_view", view: "front" } };
      await api.uploadAsset("a-1", file, "take", metadata);
      const { options } = captured[0];
      assertEquals(
        JSON.parse(decodeURIComponent(options.headers["X-Technical-Metadata"])),
        metadata,
      );
    });

    it("uploadAsset omits the metadata header when no metadata is given", async () => {
      const file = new File(["bytes"], "d.png", { type: "image/png" });
      await api.uploadAsset("a-1", file);
      const { options } = captured[0];
      assertEquals(options.headers["X-Technical-Metadata"], undefined);
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

    it("benchmark endpoints hit the model benchmark subpaths", async () => {
      await api.requestModelBenchmark("m 1");
      await api.getModelBenchmarks("m 1");
      assertEquals(captured[0].url, "/api/v1/models/m%201/benchmark");
      assertEquals(captured[0].options.method, "POST");
      assertEquals(captured[1].url, "/api/v1/models/m%201/benchmarks");
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

    it("importScriptScenes posts the parsed scenes under the project", async () => {
      await api.importScriptScenes("p 1", [{ name: "INT. OFFICE - DAY", prompt: "p" }]);
      assertEquals(captured[0].url, "/api/v1/projects/p%201/scenes/from-script");
      assertEquals(captured[0].options.method, "POST");
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.scenes[0].name, "INT. OFFICE - DAY");
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

  describe("v1 timeline endpoints", () => {
    it("listTimelines filters by project_id query param", async () => {
      await api.listTimelines({ project_id: "p1" });
      assertEquals(captured[0].url, "/api/v1/timelines?project_id=p1");
    });

    it("listTimelines with no filter omits the query string", async () => {
      await api.listTimelines();
      assertEquals(captured[0].url, "/api/v1/timelines");
    });

    it("createTimeline posts name and project_id", async () => {
      await api.createTimeline({ name: "Cut v1", project_id: "p1" });
      assertEquals(captured[0].url, "/api/v1/timelines");
      assertEquals(captured[0].options.method, "POST");
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.name, "Cut v1");
      assertEquals(body.project_id, "p1");
    });

    it("getTimeline requests the id subpath", async () => {
      await api.getTimeline("tl-1");
      assertEquals(captured[0].url, "/api/v1/timelines/tl-1");
    });

    it("updateTimeline patches the id subpath", async () => {
      await api.updateTimeline("tl-1", { name: "Renamed" });
      assertEquals(captured[0].url, "/api/v1/timelines/tl-1");
      assertEquals(captured[0].options.method, "PATCH");
      assertEquals(JSON.parse(captured[0].options.body).name, "Renamed");
    });

    it("deleteTimeline deletes the id subpath", async () => {
      await api.deleteTimeline("tl-1");
      assertEquals(captured[0].url, "/api/v1/timelines/tl-1");
      assertEquals(captured[0].options.method, "DELETE");
    });

    it("track methods hit the tracks subpaths", async () => {
      await api.createTimelineTrack("tl-1", { track_type: "video", name: "V1" });
      assertEquals(captured[0].url, "/api/v1/timelines/tl-1/tracks");
      assertEquals(captured[0].options.method, "POST");

      await api.updateTimelineTrack("tl-1", "tr-1", { locked: true });
      assertEquals(captured[1].url, "/api/v1/timelines/tl-1/tracks/tr-1");
      assertEquals(captured[1].options.method, "PATCH");
      assertEquals(JSON.parse(captured[1].options.body).locked, true);

      await api.deleteTimelineTrack("tl-1", "tr-1");
      assertEquals(captured[2].url, "/api/v1/timelines/tl-1/tracks/tr-1");
      assertEquals(captured[2].options.method, "DELETE");
    });

    it("item methods hit the items subpaths", async () => {
      await api.createTimelineItem("tl-1", {
        track_id: "tr-1",
        asset_version_id: null,
        start_time: 0,
        end_time: 2,
        text: "hello",
      });
      assertEquals(captured[0].url, "/api/v1/timelines/tl-1/items");
      assertEquals(captured[0].options.method, "POST");
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.track_id, "tr-1");
      assertEquals(body.text, "hello");

      await api.updateTimelineItem("tl-1", "it-1", { speed: 1.5 });
      assertEquals(captured[1].url, "/api/v1/timelines/tl-1/items/it-1");
      assertEquals(captured[1].options.method, "PATCH");

      await api.duplicateTimelineItem("tl-1", "it-1", 5);
      assertEquals(captured[2].url, "/api/v1/timelines/tl-1/items/it-1/duplicate");
      assertEquals(captured[2].options.method, "POST");
      assertEquals(JSON.parse(captured[2].options.body).at_time, 5);

      await api.deleteTimelineItem("tl-1", "it-1");
      assertEquals(captured[3].url, "/api/v1/timelines/tl-1/items/it-1");
      assertEquals(captured[3].options.method, "DELETE");
    });

    it("marker methods hit the markers subpaths", async () => {
      await api.createTimelineMarker("tl-1", { time: 4.5, label: "cut" });
      assertEquals(captured[0].url, "/api/v1/timelines/tl-1/markers");
      assertEquals(captured[0].options.method, "POST");
      assertEquals(JSON.parse(captured[0].options.body).time, 4.5);

      await api.listTimelineMarkers("tl-1");
      assertEquals(captured[1].url, "/api/v1/timelines/tl-1/markers");
      assertEquals(captured[1].options.method ?? "GET", "GET");

      await api.deleteTimelineMarker("tl-1", "mk-1");
      assertEquals(captured[2].url, "/api/v1/timelines/tl-1/markers/mk-1");
      assertEquals(captured[2].options.method, "DELETE");
    });

    it("snapshot methods hit the snapshots subpaths", async () => {
      await api.createTimelineSnapshot("tl-1", { name: "Before recut" });
      assertEquals(captured[0].url, "/api/v1/timelines/tl-1/snapshots");
      assertEquals(captured[0].options.method, "POST");

      await api.listTimelineSnapshots("tl-1");
      assertEquals(captured[1].url, "/api/v1/timelines/tl-1/snapshots");

      await api.restoreTimelineSnapshot("tl-1", "sn-1");
      assertEquals(captured[2].url, "/api/v1/timelines/tl-1/snapshots/sn-1/restore");
      assertEquals(captured[2].options.method, "POST");
    });
  });

  describe("v1 render endpoints", () => {
    it("listRenderPresets requests the presets endpoint", async () => {
      await api.listRenderPresets();
      assertEquals(captured[0].url, "/api/v1/render-presets");
    });

    it("createRenderPreset posts the preset payload", async () => {
      await api.createRenderPreset({
        name: "Draft 720",
        kind: "draft",
        codec: "h264",
        width: 1280,
        height: 720,
        fps: 24,
        audio: { enabled: true },
        fx: { enabled: true },
      });
      assertEquals(captured[0].url, "/api/v1/render-presets");
      assertEquals(captured[0].options.method, "POST");
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.name, "Draft 720");
      assertEquals(body.kind, "draft");
    });

    it("queueRender posts project/timeline/preset ids", async () => {
      await api.queueRender({
        project_id: "p1",
        timeline_id: "tl-1",
        preset_id: "p-9",
      });
      assertEquals(captured[0].url, "/api/v1/renders");
      assertEquals(captured[0].options.method, "POST");
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.project_id, "p1");
      assertEquals(body.timeline_id, "tl-1");
      assertEquals(body.preset_id, "p-9");
    });

    it("render job methods hit the renders subpaths", async () => {
      await api.getRenderJob("rj-1");
      assertEquals(captured[0].url, "/api/v1/renders/rj-1");

      await api.getRenderJobLog("rj-1");
      assertEquals(captured[1].url, "/api/v1/renders/rj-1/log");

      await api.cancelRenderJob("rj-1");
      assertEquals(captured[2].url, "/api/v1/renders/rj-1/cancel");
      assertEquals(captured[2].options.method, "POST");
    });

    it("listExports filters by project_id", async () => {
      await api.listExports({ project_id: "p1" });
      assertEquals(captured[0].url, "/api/v1/exports?project_id=p1");
    });
  });

  describe("v1 audio endpoints", () => {
    it("listAudioAssets builds query params from filters", async () => {
      await api.listAudioAssets({
        project_id: "p1",
        asset_type: "music",
      });
      assertEquals(
        captured[0].url,
        "/api/v1/audio/assets?project_id=p1&asset_type=music",
      );
    });

    it("listAudioAssets with no filter omits the query string", async () => {
      await api.listAudioAssets();
      assertEquals(captured[0].url, "/api/v1/audio/assets");
    });

    it("generateAudio posts kind and prompt", async () => {
      await api.generateAudio({
        kind: "music",
        prompt: "tense drone",
        project_id: "p1",
      });
      assertEquals(captured[0].url, "/api/v1/audio/generate");
      assertEquals(captured[0].options.method, "POST");
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.kind, "music");
      assertEquals(body.prompt, "tense drone");
      assertEquals(body.project_id, "p1");
    });

    it("updateAudioAdjustments patches the adjustments subpath", async () => {
      await api.updateAudioAdjustments("a-1", "v-1", { trim_in_s: 1.5 });
      assertEquals(
        captured[0].url,
        "/api/v1/audio/assets/a-1/versions/v-1/adjustments",
      );
      assertEquals(captured[0].options.method, "PATCH");
      assertEquals(
        JSON.parse(captured[0].options.body).trim_in_s,
        1.5,
      );
    });

    it("getAudioWaveform hits the waveform subpath", async () => {
      await api.getAudioWaveform("a-1", "v-1");
      assertEquals(
        captured[0].url,
        "/api/v1/audio/assets/a-1/versions/v-1/waveform",
      );
    });

    it("cleanupAudioVersion posts operations to the cleanup subpath", async () => {
      await api.cleanupAudioVersion("a-1", "v-1", {
        denoise: true,
        normalize: true,
      });
      assertEquals(
        captured[0].url,
        "/api/v1/audio/assets/a-1/versions/v-1/cleanup",
      );
      assertEquals(captured[0].options.method, "POST");
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.denoise, true);
      assertEquals(body.normalize, true);
    });

    it("generateSubtitles posts to the subtitles subpath", async () => {
      await api.generateSubtitles("a-1", "v-1", { candidates: 2 });
      assertEquals(
        captured[0].url,
        "/api/v1/audio/assets/a-1/versions/v-1/subtitles",
      );
      assertEquals(captured[0].options.method, "POST");
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.candidates, 2);
    });
  });

  describe("v1 skill endpoints", () => {
    it("listSkills hits the skills index", async () => {
      await api.listSkills();
      assertEquals(captured[0].url, "/api/v1/skills");
    });

    it("createSkill posts id and definition", async () => {
      await api.createSkill("my-score", { name: "My Score", steps: [] });
      assertEquals(captured[0].url, "/api/v1/skills");
      assertEquals(captured[0].options.method, "POST");
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.id, "my-score");
      assertEquals(body.definition.name, "My Score");
    });

    it("updateSkill puts the definition on the skill path", async () => {
      await api.updateSkill("my-score", { name: "v2", inputs: {} });
      assertEquals(captured[0].url, "/api/v1/skills/my-score");
      assertEquals(captured[0].options.method, "PUT");
      assertEquals(JSON.parse(captured[0].options.body).definition.name, "v2");
    });

    it("toggleSkill posts the enabled flag", async () => {
      await api.toggleSkill("my-score", false);
      assertEquals(captured[0].url, "/api/v1/skills/my-score/toggle");
      assertEquals(captured[0].options.method, "POST");
      assertEquals(JSON.parse(captured[0].options.body).enabled, false);
    });

    it("deleteSkill deletes the skill path", async () => {
      await api.deleteSkill("my-score");
      assertEquals(captured[0].url, "/api/v1/skills/my-score");
      assertEquals(captured[0].options.method, "DELETE");
    });

    it("listSkillVersions hits the versions subpath", async () => {
      await api.listSkillVersions("my-score");
      assertEquals(captured[0].url, "/api/v1/skills/my-score/versions");
    });

    it("runSkill posts project and inputs", async () => {
      await api.runSkill("my-score", {
        projectId: "p-1",
        inputs: { mood: "tense" },
      });
      assertEquals(captured[0].url, "/api/v1/skills/my-score/run");
      assertEquals(captured[0].options.method, "POST");
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.project_id, "p-1");
      assertEquals(body.inputs.mood, "tense");
    });

    it("runSkill omits inputs when not provided", async () => {
      await api.runSkill("my-score", { projectId: "p-1" });
      const body = JSON.parse(captured[0].options.body);
      assertEquals(body.inputs, {});
    });

    it("listSkillRuns builds query params from filters", async () => {
      await api.listSkillRuns("my-score", { projectId: "p-1" });
      assertEquals(captured[0].url, "/api/v1/skills/my-score/runs?project_id=p-1");
    });

    it("listSkillRuns with no filter omits the query string", async () => {
      await api.listSkillRuns("my-score");
      assertEquals(captured[0].url, "/api/v1/skills/my-score/runs");
    });

    it("getSkillRun hits the run subpath", async () => {
      await api.getSkillRun("my-score", "run-1");
      assertEquals(captured[0].url, "/api/v1/skills/my-score/runs/run-1");
    });
  });

  describe("v1 diagnostics endpoints", () => {
    it("report getters hit the report subpaths", async () => {
      await api.getDiagnosticsHardware();
      assertEquals(captured[0].url, "/api/v1/diagnostics/hardware");

      await api.getDiagnosticsModels();
      assertEquals(captured[1].url, "/api/v1/diagnostics/models");

      await api.getDiagnosticsStorage();
      assertEquals(captured[2].url, "/api/v1/diagnostics/storage");
    });

    it("getDiagnosticsLogs filters by category, severity, window and limit", async () => {
      await api.getDiagnosticsLogs({
        category: "job",
        severity: "error",
        since_hours: 24,
        limit: 50,
      });
      assertEquals(
        captured[0].url,
        "/api/v1/diagnostics/logs?category=job&severity=error&since_hours=24&limit=50",
      );
    });

    it("exportDiagnostics posts to the export subpath", async () => {
      await api.exportDiagnostics();
      assertEquals(captured[0].url, "/api/v1/diagnostics/export");
      assertEquals(captured[0].options.method, "POST");
    });

    it("backup methods hit the backups subpaths", async () => {
      await api.createProjectBackup("p1");
      assertEquals(captured[0].url, "/api/v1/diagnostics/backups");
      assertEquals(captured[0].options.method, "POST");
      assertEquals(JSON.parse(captured[0].options.body).project_id, "p1");

      await api.listBackups();
      assertEquals(captured[1].url, "/api/v1/diagnostics/backups");

      await api.restoreBackup("b-1", "Restored name");
      assertEquals(
        captured[2].url,
        "/api/v1/diagnostics/backups/b-1/restore",
      );
      assertEquals(captured[2].options.method, "POST");
      assertEquals(
        JSON.parse(captured[2].options.body).project_name,
        "Restored name",
      );

      await api.deleteBackup("b-1");
      assertEquals(captured[3].url, "/api/v1/diagnostics/backups/b-1");
      assertEquals(captured[3].options.method, "DELETE");
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

  describe("getAssetVersionPreviewUrl", () => {
    it("requests the per-version preview endpoint", async () => {
      const blob = new Blob(["img"], { type: "image/png" });
      const url = { value: "" };
      globalThis.fetch = async (input) => {
        url.value = String(input);
        return { ok: true, status: 200, blob: async () => blob };
      };
      const media = await api.getAssetVersionPreviewUrl("a-1", "v-9");
      assert(media.url.startsWith("blob:"));
      assertEquals(media.type, "image/png");
      assert(url.value.includes("/assets/a-1/versions/v-9/preview"));
      URL.revokeObjectURL(media.url);
    });
  });

  describe("getAssetThumbnailUrl", () => {
    function mockFetch(url, type = "image/jpeg", label = "jpg") {
      globalThis.fetch = async (input) => {
        url.value = String(input);
        const blob = new Blob([label], { type });
        return { ok: true, status: 200, blob: async () => blob };
      };
    }

    it("requests the version thumbnail endpoint with quantized at and width", async () => {
      const url = { value: "" };
      mockFetch(url);
      const media = await api.getAssetThumbnailUrl("a-1", "v-1", 2.54, 640);
      assert(media.url.startsWith("blob:"));
      assertEquals(media.type, "image/jpeg");
      assert(url.value.includes("/assets/a-1/versions/v-1/thumbnail?at=2.5&w=640"));
      URL.revokeObjectURL(media.url);
    });

    it("normalizes negative and non-numeric at to 0 and defaults width", async () => {
      const url = { value: "" };
      mockFetch(url);
      const m1 = await api.getAssetThumbnailUrl("a-1", "v-1", -3);
      assert(url.value.endsWith("/thumbnail?at=0.0&w=320"));
      URL.revokeObjectURL(m1.url);
      const m2 = await api.getAssetThumbnailUrl("a-1", "v-1", "garbage");
      assert(url.value.endsWith("/thumbnail?at=0.0&w=320"));
      URL.revokeObjectURL(m2.url);
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
