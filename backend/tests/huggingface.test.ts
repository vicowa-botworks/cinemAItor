import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { hashPassword } from "../src/services/password.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";
import {
  pickWeightFile,
  resolveFileUrl,
  slugifyModelId,
  validateRepoId,
} from "../src/services/huggingface.ts";

interface FakeHfFile {
  name: string;
  size: number;
  type: "file" | "directory";
}

interface FakeHfState {
  repos: Record<string, unknown>[];
  files: FakeHfFile[];
  lastSearchParams: URLSearchParams | null;
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
      { name: "README.md", size: 2048, type: "file" },
      { name: "model.safetensors", size: 5_000_000_000, type: "file" },
      { name: "small.bin", size: 1_000_000, type: "file" },
      { name: "subdir", size: 0, type: "directory" },
    ],
    lastSearchParams: null,
    calls: 0,
    repoPaths: [],
    lastAuth: null,
    unauthorized: false,
  };
}

function startFakeHf(state: FakeHfState): { url: string; shutdown: () => void } {
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1" },
    (req: Request): Response => {
      const url = new URL(req.url);
      state.calls += 1;
      const parts = url.pathname.split("/").filter(Boolean);
      const notFound = () => Response.json({ error: "Not found" }, { status: 404 });
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
      if (parts.length === 6 && parts[4] === "tree" && parts[5] === "main") {
        return Response.json(state.files);
      }
      return notFound();
    },
  );
  const addr = server.addr;
  return {
    url: `http://127.0.0.1:${addr.port}/api`,
    shutdown: () => server.shutdown(),
  };
}

let baseUrl = "";
let adminToken = "";
let userToken = "";
let fake: { url: string; shutdown: () => void };
let state: FakeHfState;

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function post(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function get(path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: headers(token) });
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

  it("resolveFileUrl builds the resolve/main URL", () => {
    assertEquals(
      resolveFileUrl("owner/repo", "weights.bin"),
      "https://huggingface.co/owner/repo/resolve/main/weights.bin",
    );
  });
});

describe("huggingface routes", () => {
  beforeEach(async () => {
    state = freshState();
    fake = startFakeHf(state);
    Deno.env.set("HF_API_BASE", fake.url);
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

  it("repo returns metadata + files for a known repo", async () => {
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
      };
      assertEquals(body.repo.id, "owner/textgen-v1");
      assertEquals(body.repo.license, "mit");
      assertEquals(body.files.length, 3); // directory entries filtered out
      const model = body.files.find((f) => f.path === "model.safetensors");
      assert(model);
      assertEquals(model.size, 5_000_000_000);
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
        { repo_id: "owner/textgen-v1", task_types: ["text_to_video"] },
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
      assertEquals(
        body.model.repository_url,
        "https://huggingface.co/owner/textgen-v1/resolve/main/model.safetensors",
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
        { repo_id: "owner/textgen-v1" },
        adminToken,
      );
      assertEquals(first.status, 201);
      const second = await post(
        "/api/v1/models/from-huggingface",
        { repo_id: "owner/textgen-v1" },
        adminToken,
      );
      assertEquals(second.status, 409);
    });
  });

  it("from-huggingface 400s when the repo has no weight file", async () => {
    state.files = [{ name: "README.md", size: 10, type: "file" }];
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

  it("from-huggingface honors an explicit file", async () => {
    await withServer(async (base) => {
      baseUrl = base;
      const res = await post(
        "/api/v1/models/from-huggingface",
        { repo_id: "owner/textgen-v1", file: "small.bin" },
        adminToken,
      );
      assertEquals(res.status, 201);
      const body = (await res.json()) as { file: string };
      assertEquals(body.file, "small.bin");
    });
  });
});
