import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { updateHfToken } from "../src/db/hf_settings.ts";
import { hashPassword } from "../src/services/password.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";
import {
  capHfFiles,
  HF_MAX_FILES,
  HF_README_MAX_CHARS,
  hfTokenForUrl,
  pickWeightFile,
  resolveFileUrl,
  slugifyModelId,
  truncateReadme,
  validateRepoId,
} from "../src/services/huggingface.ts";

interface FakeHfFile {
  // The live HF tree API keys entries by `path` (never `name`).
  path: string;
  size: number;
  type: "file" | "directory";
}

interface FakeHfState {
  repos: Record<string, unknown>[];
  files: FakeHfFile[];
  readme: string | null;
  lastSearchParams: URLSearchParams | null;
  lastTreeSearchParams: URLSearchParams | null;
  /** The branch the fake serves the tree for; other branches 404 like live HF. */
  treeBranch: string;
  treeRequests: string[];
  whoamiStatus: number;
  whoamiBody: Record<string, unknown>;
  calls: number;
  repoPaths: string[];
  lastAuth: string | null;
  unauthorized: boolean;
}

function freshState(): FakeHfState {
  return {
    repos: [
      {
        id: "owner/textgen-v1",
        likes: 42,
        downloads: 1000,
        pipeline_tag: "text-to-video",
        tags: ["text-to-video", "license:mit", "diffusers"],
      },
      {
        id: "owner/imggen-v2",
        likes: 7,
        downloads: 50,
        pipeline_tag: "text-to-image",
        tags: ["text-to-image"],
      },
    ],
    files: [
      { path: "README.md", size: 2048, type: "file" },
      { path: "model.safetensors", size: 5_000_000_000, type: "file" },
      { path: "small.bin", size: 1_000_000, type: "file" },
      { path: "subdir", size: 0, type: "directory" },
      { path: "vae/diffusion_pytorch_model.safetensors", size: 300_000_000, type: "file" },
    ],
    readme: "# textgen-v1\n\nUsage example: `pipe(prompt)` renders a clip.\n",
    lastSearchParams: null,
    lastTreeSearchParams: null,
    treeBranch: "main",
    treeRequests: [],
    whoamiStatus: 200,
    whoamiBody: { name: "hf_tester", fullname: "HF Tester" },
    calls: 0,
    repoPaths: [],
    lastAuth: null,
    unauthorized: false,
  };
}

function startFakeHf(
  state: FakeHfState,
): { url: string; publicUrl: string; shutdown: () => void } {
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1" },
    (req: Request): Response => {
      const url = new URL(req.url);
      state.calls += 1;
      const parts = url.pathname.split("/").filter(Boolean);
      const notFound = () => Response.json({ error: "Not found" }, { status: 404 });
      // README on the public site base: /<owner>/<name>/resolve/<branch>/README.md
      if (
        parts.length === 5 && parts[2] === "resolve" && parts[4] === "README.md"
      ) {
        state.lastAuth = req.headers.get("authorization");
        if (state.readme === null) return notFound();
        return new Response(state.readme, {
          headers: { "Content-Type": "text/markdown" },
        });
      }
      // Token check: /api/whoami-v2
      if (parts[0] === "api" && parts[1] === "whoami-v2") {
        state.lastAuth = req.headers.get("authorization");
        return Response.json(state.whoamiBody, { status: state.whoamiStatus });
      }
      if (parts[0] !== "api" || parts[1] !== "models") return notFound();
      if (parts.length === 2) {
        state.lastSearchParams = url.searchParams;
        const filter = url.searchParams.get("pipeline_tag");
        const results = state.repos.filter((r) =>
          filter === null || (r.pipeline_tag as string) === filter
        );
        return Response.json(results);
      }
      // Real HF contract: /api/models/<owner>/<name>[/tree/main] — two
      // separate path segments. A percent-encoded slash is rejected exactly
      // like the live API (HTTP 400, "url-encoded slash").
      state.repoPaths.push(url.pathname);
      state.lastAuth = req.headers.get("authorization");
      if (/%2[fF]/.test(parts[2])) {
        return Response.json(
          { error: `Invalid repo name: ${parts[2]} - repo name includes an url-encoded slash` },
          { status: 400 },
        );
      }
      if (state.unauthorized) {
        return Response.json({ error: "Invalid username or password." }, { status: 401 });
      }
      const repoId = `${decodeURIComponent(parts[2])}/${decodeURIComponent(parts[3] ?? "")}`;
      const repo = state.repos.find((r) => r.id === repoId);
      if (!repo) return notFound();
      if (parts.length === 4) return Response.json(repo);
      if (parts.length === 6 && parts[4] === "tree") {
        state.treeRequests.push(parts[5] ?? "");
        state.lastTreeSearchParams = url.searchParams;
        if (parts[5] !== state.treeBranch) return notFound();
        return Response.json(state.files);
      }
      return notFound();
    },
  );
  const addr = server.addr;
  return {
    url: `http://127.0.0.1:${addr.port}/api`,
    publicUrl: `http://127.0.0.1:${addr.port}`,
    shutdown: () => server.shutdown(),
  };
}

let baseUrl = "";
let adminToken = "";
let userToken = "";
let fake: { url: string; publicUrl: string; shutdown: () => void };
let state: FakeHfState;

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function post(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function get(path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: headers(token) });
}

function patch(path: string, body: unknown, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

describe("huggingface service (pure)", () => {
  it("slugifyModelId uses the last repo segment", () => {
    assertEquals(slugifyModelId("stabilityai/sdxl-base"), "sdxl_base");
    assertEquals(slugifyModelId("owner/my-model_v2"), "my_model_v2");
    assertEquals(slugifyModelId("a/b"), "b");
  });

  it("slugifyModelId rejects names without alphanumerics", () => {
    assertThrows(() => slugifyModelId("a/___"));
  });

  it("validateRepoId requires owner/name", () => {
    assertEquals(validateRepoId("owner/name"), undefined);
    assertThrows(() => validateRepoId("owner"));
    assertThrows(() => validateRepoId("a/b/c"));
  });

  it("pickWeightFile picks the largest weight file", () => {
    assertEquals(
      pickWeightFile([
        { path: "model.safetensors", size: 100, type: "file" },
        { path: "small.bin", size: 10, type: "file" },
        { path: "README.md", size: 999, type: "file" },
      ]),
      "model.safetensors",
    );
  });

  it("pickWeightFile finds weights in subdirectories", () => {
    assertEquals(
      pickWeightFile([
        { path: "README.md", size: 999, type: "file" },
        { path: "vae/diffusion_pytorch_model.safetensors", size: 300, type: "file" },
        { path: "unet/diffusion_pytorch_model.safetensors", size: 900, type: "file" },
        { path: "text_encoder/model.safetensors", size: 500, type: "file" },
      ]),
      "unet/diffusion_pytorch_model.safetensors",
    );
  });

  it("pickWeightFile honors an explicit file and rejects unknown ones", () => {
    assertEquals(
      pickWeightFile([{ path: "a.bin", size: 1, type: "file" }], "a.bin"),
      "a.bin",
    );
    assertThrows(
      () => pickWeightFile([{ path: "a.bin", size: 1, type: "file" }], "nope.bin"),
    );
    assertThrows(() => pickWeightFile([{ path: "README.md", size: 1, type: "file" }]));
  });

  it("capHfFiles passes small listings through unchanged", () => {
    const files = [
      { path: "a.bin", size: 1, type: "file" as const },
      { path: "b.txt", size: 2, type: "file" as const },
    ];
    assertEquals(capHfFiles(files), { files, truncated: false });
  });

  it("capHfFiles truncates but always keeps weight files", () => {
    const files = [
      ...Array.from({ length: HF_MAX_FILES + 10 }, (_, i) => ({
        path: `filler/${i}.txt`,
        size: i,
        type: "file" as const,
      })),
      { path: "deep/weights/model.safetensors", size: 1, type: "file" as const },
    ];
    const { files: capped, truncated } = capHfFiles(files);
    assert(truncated);
    assertEquals(capped.length, HF_MAX_FILES);
    assert(capped.some((f) => f.path === "deep/weights/model.safetensors"));
  });

  it("capHfFiles keeps weight files even when they alone exceed the cap", () => {
    const files = Array.from({ length: HF_MAX_FILES + 5 }, (_, i) => ({
      path: `w/${i}.safetensors`,
      size: i,
      type: "file" as const,
    }));
    const { files: capped, truncated } = capHfFiles(files);
    assert(truncated);
    assertEquals(capped.length, HF_MAX_FILES);
    for (const f of capped) assert(f.path.endsWith(".safetensors"));
  });

  it("truncateReadme keeps short readmes and caps long ones", () => {
    assertEquals(truncateReadme("short"), "short");
    assertEquals(truncateReadme("   \n "), null);
    const long = "x".repeat(HF_README_MAX_CHARS + 1);
    const out = truncateReadme(long);
    assert(out !== null);
    assert(out.length <= HF_README_MAX_CHARS + 20);
    assertMatch(out, /truncated/);
  });

  it("resolveFileUrl builds the resolve/main URL", () => {
    assertEquals(
      resolveFileUrl("owner/repo", "weights.bin"),
      "https://huggingface.co/owner/repo/resolve/main/weights.bin",
    );
  });

  it("hfTokenForUrl hands out the effective token only for HF-origin URLs", () => {
    const oldToken = Deno.env.get("HF_TOKEN");
    freshMemoryDb();
    try {
      if (oldToken === undefined) Deno.env.delete("HF_TOKEN");
      const hfUrl = "https://huggingface.co/owner/repo/resolve/main/model.bin";
      // No token configured at all.
      assertEquals(hfTokenForUrl(hfUrl), "");
      Deno.env.set("HF_TOKEN", "hf_test_token_123");
      // HF origin gets the effective token (env, then stored wins).
      assertEquals(hfTokenForUrl(hfUrl), "hf_test_token_123");
      updateHfToken("hf_stored_token");
      assertEquals(hfTokenForUrl(hfUrl), "hf_stored_token");
      // Non-HF origins, lookalike hosts, and bad URLs never get the token.
      assertEquals(
        hfTokenForUrl("https://example.com/owner/repo/resolve/main/model.bin"),
        "",
      );
      assertEquals(
        hfTokenForUrl("https://huggingface.co.evil.example/owner/repo/resolve/main/model.bin"),
        "",
      );
      assertEquals(hfTokenForUrl(""), "");
      assertEquals(hfTokenForUrl(null), "");
      assertEquals(hfTokenForUrl(undefined), "");
      assertEquals(hfTokenForUrl("not a url"), "");
    } finally {
      if (oldToken === undefined) Deno.env.delete("HF_TOKEN");
      else Deno.env.set("HF_TOKEN", oldToken);
      closeDb();
    }
  });
});

describe("huggingface routes", () => {
  beforeEach(async () => {
    state = freshState();
    fake = startFakeHf(state);
    Deno.env.set("HF_API_BASE", fake.url);
    Deno.env.set("HF_PUBLIC_BASE", fake.publicUrl);
    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(health.status, 200);
      const res = await post("/api/v1/auth/bootstrap", {
        email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
        password: "password123",
        display_name: "Studio Admin",
      });
      assertEquals(res.status, 201);
      adminToken = ((await res.json()) as { token: string }).token;
    });
  });

  afterEach(() => {
    fake.shutdown();
    Deno.env.delete("HF_API_BASE");
    Deno.env.delete("HF_PUBLIC_BASE");
    closeDb();
  });

  it("requires authentication", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      assertEquals(
        (await get("/api/v1/models/huggingface/search")).status,
        401,
      );
      assertEquals(
        (
          await get(
            `/api/v1/models/huggingface/${encodeURIComponent("owner/textgen-v1")}`,
          )
        ).status,
        401,
      );
      assertEquals(
        (await get("/api/v1/models/huggingface/settings")).status,
        401,
      );
      assertEquals(
        (await post("/api/v1/models/huggingface/settings/test", {})).status,
        401,
      );
      assertEquals((await post("/api/v1/models/from-huggingface", {})).status, 401);
    });
  });

  it("search returns normalized repos and passes through query params", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get("/api/v1/models/huggingface/search?q=text&limit=5", adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        results: {
          id: string;
          likes: number;
          downloads: number;
          pipeline_tag: string | null;
          tags: string[];
          license: string | null;
        }[];
      };
      assertEquals(body.results.length, 2);
      assertEquals(body.results[0].id, "owner/textgen-v1");
      assertEquals(body.results[0].likes, 42);
      assertEquals(body.results[0].license, "mit");
      assertEquals(body.results[1].license, null);
      assertEquals(state.lastSearchParams?.get("search"), "text");
      assertEquals(state.lastSearchParams?.get("limit"), "5");
    });
  });

  it("search applies the pipeline tag filter", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get(
        "/api/v1/models/huggingface/search?filter=text-to-image",
        adminToken,
      );
      assertEquals(res.status, 200);
      const body = (await res.json()) as { results: { id: string }[] };
      assertEquals(body.results.map((r) => r.id), ["owner/imggen-v2"]);
    });
  });

  it("repo returns metadata + recursive files + readme for a known repo", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get(
        `/api/v1/models/huggingface/${encodeURIComponent("owner/textgen-v1")}`,
        adminToken,
      );
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        repo: { id: string; license: string | null };
        files: { path: string; size: number; type: string }[];
        readme: string | null;
        filesTruncated: boolean;
      };
      assertEquals(body.repo.id, "owner/textgen-v1");
      assertEquals(body.repo.license, "mit");
      assertEquals(body.files.length, 4); // directory entries filtered out
      const model = body.files.find((f) => f.path === "model.safetensors");
      assert(model);
      assertEquals(model.size, 5_000_000_000);
      const vae = body.files.find((f) => f.path === "vae/diffusion_pytorch_model.safetensors");
      assert(vae);
      assertEquals(vae.size, 300_000_000);
      assertMatch(body.readme ?? "", /Usage example/);
      assertEquals(body.filesTruncated, false);
      // The upstream tree call must be recursive.
      assertEquals(state.lastTreeSearchParams?.get("recursive"), "true");
    });
  });

  it("repo listings only accept the live HF tree contract (entries keyed by `path`)", async () => {
    // Live HF tree entries carry `path` (+ size/type/oid) and never `name`.
    // Entries in the old (wrong) shape must be dropped, not silently trusted.
    state.files = [
      { name: "model.safetensors", size: 100, type: "file" },
      { path: "real.safetensors", size: 200, type: "file" },
    ] as unknown as FakeHfFile[];
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get(
        `/api/v1/models/huggingface/${encodeURIComponent("owner/textgen-v1")}`,
        adminToken,
      );
      assertEquals(res.status, 200);
      const body = (await res.json()) as { files: { path: string }[] };
      assertEquals(body.files.map((f) => f.path), ["real.safetensors"]);
    });
  });

  it("repo falls back to the master branch when main has no tree", async () => {
    state.treeBranch = "master";
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get(
        `/api/v1/models/huggingface/${encodeURIComponent("owner/textgen-v1")}`,
        adminToken,
      );
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        files: { path: string }[];
        branch: string;
        readme: string | null;
      };
      assertEquals(body.branch, "master");
      assert(body.files.length > 0);
      assertMatch(body.readme ?? "", /Usage example/);
      assertEquals(state.treeRequests, ["main", "master"]);
    });
  });

  it("repo reports readme null when the repo has no README", async () => {
    state.readme = null;
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get(
        `/api/v1/models/huggingface/${encodeURIComponent("owner/textgen-v1")}`,
        adminToken,
      );
      assertEquals(res.status, 200);
      const body = (await res.json()) as { readme: string | null };
      assertEquals(body.readme, null);
    });
  });

  it("repo truncates huge file listings, keeping weight files", async () => {
    state.files = [
      ...Array.from({ length: HF_MAX_FILES + 10 }, (_, i) => ({
        path: `filler/${i}.txt`,
        size: i,
        type: "file" as const,
      })),
      { path: "deep/weights/model.safetensors", size: 42, type: "file" as const },
    ];
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get(
        `/api/v1/models/huggingface/${encodeURIComponent("owner/textgen-v1")}`,
        adminToken,
      );
      assertEquals(res.status, 200);
      const body = (await res.json()) as {
        files: { path: string }[];
        filesTruncated: boolean;
      };
      assertEquals(body.files.length, HF_MAX_FILES);
      assertEquals(body.filesTruncated, true);
      assert(body.files.some((f) => f.path === "deep/weights/model.safetensors"));
    });
  });

  it("requests reach HuggingFace with a literal slash, not %2F", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get(
        `/api/v1/models/huggingface/${encodeURIComponent("owner/textgen-v1")}`,
        adminToken,
      );
      assertEquals(res.status, 200);
      // The live HuggingFace API 400s on owner%2Fname — every upstream URL must
      // carry a real slash between owner and name (meta + tree calls).
      const paths = [...new Set(state.repoPaths)].sort();
      assertEquals(
        paths,
        ["/api/models/owner/textgen-v1", "/api/models/owner/textgen-v1/tree/main"],
      );
      for (const p of state.repoPaths) {
        assert(!p.includes("%2F"), `upstream URL must not encode the slash: ${p}`);
      }
    });
  });

  it("forwards HF_TOKEN to HuggingFace as a Bearer token", async () => {
    const oldToken = Deno.env.get("HF_TOKEN");
    Deno.env.set("HF_TOKEN", "hf_test_token_123");
    try {
      await withServer(async (base) => {
        baseUrl = base;
        const res = await get(
          `/api/v1/models/huggingface/${encodeURIComponent("owner/textgen-v1")}`,
          adminToken,
        );
        assertEquals(res.status, 200);
        assertEquals(state.lastAuth, "Bearer hf_test_token_123");
      });
    } finally {
      if (oldToken === undefined) Deno.env.delete("HF_TOKEN");
      else Deno.env.set("HF_TOKEN", oldToken);
    }
  });

  it("a stored token takes precedence over the HF_TOKEN env", async () => {
    const oldToken = Deno.env.get("HF_TOKEN");
    Deno.env.set("HF_TOKEN", "hf_env_token");
    try {
      updateHfToken("hf_stored_token");
      await withServer(async (base) => {
        baseUrl = base;
        const res = await get(
          `/api/v1/models/huggingface/${encodeURIComponent("owner/textgen-v1")}`,
          adminToken,
        );
        assertEquals(res.status, 200);
        assertEquals(state.lastAuth, "Bearer hf_stored_token");

        const settings = await get("/api/v1/models/huggingface/settings", adminToken);
        assertEquals(settings.status, 200);
        assertEquals((await settings.json()) as Record<string, unknown>, {
          tokenSet: true,
          tokenSource: "settings",
        });
      });
      // Clearing the stored token falls back to the env token.
      updateHfToken("");
      await withServer(async (base) => {
        baseUrl = base;
        const res = await get(
          `/api/v1/models/huggingface/${encodeURIComponent("owner/textgen-v1")}`,
          adminToken,
        );
        assertEquals(res.status, 200);
        assertEquals(state.lastAuth, "Bearer hf_env_token");
      });
    } finally {
      if (oldToken === undefined) Deno.env.delete("HF_TOKEN");
      else Deno.env.set("HF_TOKEN", oldToken);
    }
  });

  it("huggingface settings are admin-only and validate the token", async () => {
    const email = `user.${Math.random().toString(36).slice(2)}@example.com`;
    createUser(email, await hashPassword("password123"), "Regular User");
    // HF_TOKEN stays set for the whole test so the "env" source assertions are
    // stable (clearing the stored token falls back to it).
    const oldToken = Deno.env.get("HF_TOKEN");
    Deno.env.set("HF_TOKEN", "hf_env_token");
    try {
      await withServer(async (base) => {
        baseUrl = base;
        const login = await post("/api/v1/auth/login", {
          email,
          password: "password123",
        });
        userToken = ((await login.json()) as { token: string }).token;

        assertEquals(
          (await get("/api/v1/models/huggingface/settings", userToken)).status,
          403,
        );
        assertEquals(
          (
            await patch(
              "/api/v1/models/huggingface/settings",
              { token: "hf_x" },
              userToken,
            )
          ).status,
          403,
        );
        assertEquals(
          (await post("/api/v1/models/huggingface/settings/test", {}, userToken)).status,
          403,
        );

        // No stored token yet, but HF_TOKEN is set → env source.
        const view = await get("/api/v1/models/huggingface/settings", adminToken);
        assertEquals(view.status, 200);
        assertEquals((await view.json()) as Record<string, unknown>, {
          tokenSet: false,
          tokenSource: "env",
        });

        const stored = await patch(
          "/api/v1/models/huggingface/settings",
          { token: "hf_ui_token" },
          adminToken,
        );
        assertEquals(stored.status, 200);
        assertEquals((await stored.json()) as Record<string, unknown>, {
          tokenSet: true,
          tokenSource: "settings",
        });

        const cleared = await patch(
          "/api/v1/models/huggingface/settings",
          { token: null },
          adminToken,
        );
        assertEquals(cleared.status, 200);
        assertEquals((await cleared.json()) as Record<string, unknown>, {
          tokenSet: false,
          tokenSource: "env",
        });

        assertEquals(
          (await patch("/api/v1/models/huggingface/settings", {}, adminToken)).status,
          400,
        );
        assertEquals(
          (await patch("/api/v1/models/huggingface/settings", { token: 42 }, adminToken))
            .status,
          400,
        );
        assertEquals(
          (
            await patch(
              "/api/v1/models/huggingface/settings",
              { token: "x".repeat(513) },
              adminToken,
            )
          ).status,
          400,
        );
      });
    } finally {
      if (oldToken === undefined) Deno.env.delete("HF_TOKEN");
      else Deno.env.set("HF_TOKEN", oldToken);
    }
  });

  it("huggingface settings test validates the token via whoami", async () => {
    updateHfToken("hf_ui_token");
    await withServer(async (base) => {
      baseUrl = base;
      const ok = await post("/api/v1/models/huggingface/settings/test", {}, adminToken);
      assertEquals(ok.status, 200);
      assertEquals((await ok.json()) as Record<string, unknown>, {
        ok: true,
        name: "HF Tester",
        source: "settings",
      });
      assertEquals(state.lastAuth, "Bearer hf_ui_token");
    });
  });

  it("huggingface settings test 400s without any token", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await post("/api/v1/models/huggingface/settings/test", {}, adminToken);
      assertEquals(res.status, 400);
    });
  });

  it("huggingface settings test surfaces a rejected token as a 502", async () => {
    state.whoamiStatus = 401;
    updateHfToken("hf_bad_token");
    await withServer(async (base) => {
      baseUrl = base;
      const res = await post("/api/v1/models/huggingface/settings/test", {}, adminToken);
      assertEquals(res.status, 502);
      const body = (await res.json()) as { error: { code: string; message: string } };
      assertEquals(body.error.code, "NETWORK_ERROR");
      assertMatch(body.error.message, /rejected the token/);
    });
  });

  it("maps an upstream 401 to a 502 with an actionable message", async () => {
    state.unauthorized = true;
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get(
        `/api/v1/models/huggingface/${encodeURIComponent("owner/textgen-v1")}`,
        adminToken,
      );
      assertEquals(res.status, 502);
      const body = (await res.json()) as { error: { code: string; message: string } };
      assertEquals(body.error.code, "NETWORK_ERROR");
      assertMatch(body.error.message, /HF_TOKEN/);
    });
  });

  it("repo 404s for an unknown repo", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await get(
        `/api/v1/models/huggingface/${encodeURIComponent("owner/unknown")}`,
        adminToken,
      );
      assertEquals(res.status, 404);
      const body = (await res.json()) as { error: { code: string } };
      assertEquals(body.error.code, "NOT_FOUND");
    });
  });

  it("repo rejects malformed repo ids", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      assertEquals((await get("/api/v1/models/huggingface/owner", adminToken)).status, 400);
    });
  });

  it("from-huggingface registers a url-sourced model (admin)", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await post(
        "/api/v1/models/from-huggingface",
        {
          repo_id: "owner/textgen-v1",
          task_types: ["text_to_video"],
          default_settings: { command: "sd-runner" },
        },
        adminToken,
      );
      assertEquals(res.status, 201);
      const body = (await res.json()) as {
        model: {
          id: string;
          name: string;
          source: string;
          repository_url: string;
          task_types: string[];
          license: string | null;
        };
        file: string;
        repo: { id: string };
      };
      assertEquals(body.model.id, "textgen_v1");
      assertEquals(body.model.name, "owner/textgen-v1");
      assertEquals(body.model.source, "url");
      // resolveFileUrl uses the (env-overridable) public base — the fake here.
      assertEquals(
        body.model.repository_url,
        `${fake.publicUrl}/owner/textgen-v1/resolve/main/model.safetensors`,
      );
      assertEquals(body.file, "model.safetensors");
      assertEquals(body.repo.id, "owner/textgen-v1");
      assertEquals(body.model.task_types, ["text_to_video"]);
      assertEquals(body.model.license, "mit");
    });
  });

  it("from-huggingface is admin-only", async () => {
    const email = `user.${Math.random().toString(36).slice(2)}@example.com`;
    createUser(email, await hashPassword("password123"), "Regular User");
    await withServer(async (base) => {
      baseUrl = base;
      const login = await post("/api/v1/auth/login", {
        email,
        password: "password123",
      });
      userToken = ((await login.json()) as { token: string }).token;
      const res = await post(
        "/api/v1/models/from-huggingface",
        { repo_id: "owner/textgen-v1" },
        userToken,
      );
      assertEquals(res.status, 403);
    });
  });

  it("from-huggingface 409s when the model id is already registered", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const first = await post(
        "/api/v1/models/from-huggingface",
        { repo_id: "owner/textgen-v1", default_settings: { command: "sd-runner" } },
        adminToken,
      );
      assertEquals(first.status, 201);
      const second = await post(
        "/api/v1/models/from-huggingface",
        { repo_id: "owner/textgen-v1", default_settings: { command: "sd-runner" } },
        adminToken,
      );
      assertEquals(second.status, 409);
    });
  });

  it("from-huggingface 400s when the repo has no weight file", async () => {
    state.files = [{ path: "README.md", size: 10, type: "file" }];
    await withServer(async (base) => {
      baseUrl = base;
      const res = await post(
        "/api/v1/models/from-huggingface",
        { repo_id: "owner/textgen-v1" },
        adminToken,
      );
      assertEquals(res.status, 400);
    });
  });

  it("from-huggingface picks a weight file from a subdirectory", async () => {
    state.files = [
      { path: "README.md", size: 10, type: "file" },
      { path: "unet/diffusion_pytorch_model.safetensors", size: 2_000_000, type: "file" },
      { path: "vae/diffusion_pytorch_model.safetensors", size: 300_000, type: "file" },
    ];
    await withServer(async (base) => {
      baseUrl = base;
      const res = await post(
        "/api/v1/models/from-huggingface",
        { repo_id: "owner/textgen-v1", default_settings: { command: "sd-runner" } },
        adminToken,
      );
      assertEquals(res.status, 201);
      const body = (await res.json()) as {
        file: string;
        model: { repository_url: string };
      };
      assertEquals(body.file, "unet/diffusion_pytorch_model.safetensors");
      assertMatch(body.model.repository_url, /unet\/diffusion_pytorch_model\.safetensors$/);
    });
  });

  it("from-huggingface honors an explicit file", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await post(
        "/api/v1/models/from-huggingface",
        {
          repo_id: "owner/textgen-v1",
          file: "small.bin",
          default_settings: { command: "sd-runner" },
        },
        adminToken,
      );
      assertEquals(res.status, 201);
      const body = (await res.json()) as { file: string };
      assertEquals(body.file, "small.bin");
    });
  });
});
