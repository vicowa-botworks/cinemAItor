import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

interface UserBody {
  token: string;
  user: { id: number; email: string; display_name: string; role: string };
}

let baseUrl = "";

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

async function bootstrap(): Promise<string> {
  const email = `owner.${Math.random().toString(36).slice(2)}@example.com`;
  const res = await post("/api/v1/auth/bootstrap", {
    email,
    password: "password123",
    display_name: "Studio Owner",
  });
  assertEquals(res.status, 201);
  const user = (await res.json()) as UserBody;
  return user.token;
}

function uniqueSlug(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

async function createAsset(token: string, slug: string): Promise<{
  id: string;
  unique_slug: string;
}> {
  const res = await post(
    "/api/v1/assets",
    {
      unique_slug: slug,
      display_name: slug,
      asset_type: "character",
    },
    token,
  );
  assertEquals(res.status, 201);
  return (await res.json()) as { id: string; unique_slug: string };
}

interface PromptVersion {
  id: string;
  version_number: number;
  content: string;
  content_hash: string;
  parent_prompt_id: string | null;
  scope_type: string;
  scope_id: string;
}

interface ReferenceOut {
  id?: string;
  slug: string;
  status: string;
  role: string | null;
  notes: string | null;
  asset: { id: string; slug: string } | null;
}

describe("reference engine api", () => {
  let ownerToken: string;
  let heroSlug: string;
  let roomSlug: string;

  beforeEach(async () => {
    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(health.status, 200);
      ownerToken = await bootstrap();
      heroSlug = uniqueSlug("hero");
      roomSlug = uniqueSlug("room");
      await createAsset(ownerToken, heroSlug);
      await createAsset(ownerToken, roomSlug);
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("requires authentication", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await get(`/api/v1/references/audit`);
        assertEquals(res.status, 401);
      })();
    });
  });

  it("parses text and reports warnings for missing references", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await post(
          `/api/v1/references/parse`,
          {
            text: `@${heroSlug} walks into @${roomSlug} with @ghost`,
            roles: { [heroSlug]: "character", [roomSlug]: "location" },
          },
          ownerToken,
        );
        assertEquals(res.status, 200);
        const body = (await res.json()) as {
          tokens: ReferenceOut[];
          warnings: string[];
        };
        assertEquals(body.tokens.length, 3);
        assertEquals(body.tokens[0].slug, heroSlug);
        assertEquals(body.tokens[0].status, "resolved");
        assertEquals(body.tokens[0].role, "character");
        assertEquals(body.tokens[0].asset?.id, body.tokens[0].asset?.id);
        assertEquals(body.tokens[2].slug, "ghost");
        assertEquals(body.tokens[2].status, "missing");
        assertEquals(body.tokens[2].asset, null);
        assertEquals(body.warnings.length, 1);
        assert(body.warnings[0].includes("@ghost"));
      })();
    });
  });

  it("persists parsed references for a source", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await post(
          `/api/v1/references/parse`,
          {
            text: `@${heroSlug} and @ghost`,
            persist: { scope_type: "prompt", scope_id: "scene-42" },
          },
          ownerToken,
        );
        assertEquals(res.status, 200);
        const body = (await res.json()) as { tokens: (ReferenceOut & { id?: string })[] };
        assert(body.tokens[0].id);

        const audit = await get(
          `/api/v1/references/audit?source_type=prompt&source_id=scene-42`,
          ownerToken,
        );
        assertEquals(audit.status, 200);
        const rows = (await audit.json()) as {
          reference: { raw_text: string; status: string };
          broken: boolean;
        }[];
        assertEquals(rows.length, 2);
        assertEquals(rows[0].reference.status, "resolved");
        assertEquals(rows[1].reference.status, "missing");
      })();
    });
  });

  it("creates prompt versions, detects duplicates, and links parents", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const scope = uniqueSlug("scene");
        const content1 = `@${heroSlug} enters`;
        const v1 = await post(
          `/api/v1/prompts`,
          { scope_type: "scene", scope_id: scope, content: content1 },
          ownerToken,
        );
        assertEquals(v1.status, 201);
        const v1Body = (await v1.json()) as { version: PromptVersion; warnings: string[] };
        assertEquals(v1Body.version.version_number, 1);
        assertEquals(v1Body.version.parent_prompt_id, null);
        assertEquals(v1Body.warnings.length, 0);

        const content2 = `@${heroSlug} leaves`;
        const v2 = await post(
          `/api/v1/prompts`,
          { scope_type: "scene", scope_id: scope, content: content2 },
          ownerToken,
        );
        assertEquals(v2.status, 201);
        const v2Body = (await v2.json()) as { version: PromptVersion };
        assertEquals(v2Body.version.version_number, 2);
        assertEquals(v2Body.version.parent_prompt_id, v1Body.version.id);

        const dup = await post(
          `/api/v1/prompts`,
          { scope_type: "scene", scope_id: scope, content: content2 },
          ownerToken,
        );
        assertEquals(dup.status, 200);
        const dupBody = (await dup.json()) as {
          version: PromptVersion;
          duplicate: boolean;
        };
        assertEquals(dupBody.duplicate, true);
        assertEquals(dupBody.version.id, v2Body.version.id);

        const history = await get(
          `/api/v1/prompts/scene/${scope}`,
          ownerToken,
        );
        assertEquals(history.status, 200);
        const versions = (await history.json()) as PromptVersion[];
        assertEquals(versions.map((v) => v.version_number), [2, 1]);

        const detail = await get(`/api/v1/prompts/${v1Body.version.id}`, ownerToken);
        assertEquals(detail.status, 200);
        const detailBody = (await detail.json()) as {
          content: string;
          references: { raw_text: string; status: string }[];
        };
        assertEquals(detailBody.content, content1);
        assertEquals(detailBody.references.length, 1);
        assertEquals(detailBody.references[0].status, "resolved");
      })();
    });
  });

  it("surfaces warnings when prompt content has missing references", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const scope = uniqueSlug("scene");
        const res = await post(
          `/api/v1/prompts`,
          { scope_type: "scene", scope_id: scope, content: "@ghost only" },
          ownerToken,
        );
        assertEquals(res.status, 201);
        const body = (await res.json()) as {
          warnings: string[];
          references: { status: string }[];
        };
        assertEquals(body.warnings.length, 1);
        assert(body.warnings[0].includes("@ghost"));
        assertEquals(body.references[0].status, "missing");
      })();
    });
  });

  it("restores an older prompt version as a new version", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const scope = uniqueSlug("scene");
        const content1 = `@${heroSlug} v1 text`;
        const v1 = (await (
          await post(
            `/api/v1/prompts`,
            { scope_type: "scene", scope_id: scope, content: content1 },
            ownerToken,
          )
        ).json()) as { version: PromptVersion };
        await post(
          `/api/v1/prompts`,
          { scope_type: "scene", scope_id: scope, content: `@${heroSlug} v2 text` },
          ownerToken,
        );

        const restore = await post(
          `/api/v1/prompts/${v1.version.id}/restore`,
          {},
          ownerToken,
        );
        assertEquals(restore.status, 201);
        const restoreBody = (await restore.json()) as {
          version: PromptVersion;
          duplicate: boolean;
        };
        assertEquals(restoreBody.duplicate, false);
        assertEquals(restoreBody.version.version_number, 3);
        assertEquals(restoreBody.version.content, content1);
        assertEquals(restoreBody.version.parent_prompt_id !== null, true);
      })();
    });
  });

  it("audit endpoint lists all references and filters", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const saveRes = await post(
          `/api/v1/prompts`,
          {
            scope_type: "scene",
            scope_id: "sc-1",
            content: `@${heroSlug} meets @ghost at @${roomSlug}`,
          },
          ownerToken,
        );
        assertEquals(saveRes.status, 201);
        const versionId = ((await saveRes.json()) as { version: { id: string } })
          .version.id;

        const all = (await (
          await get(`/api/v1/references/audit`, ownerToken)
        ).json()) as {
          reference: { raw_text: string; status: string; source_id: string };
          asset_slug: string | null;
          broken: boolean;
        }[];
        assertEquals(all.length, 3);
        assertEquals(all.filter((e) => e.broken).length, 1);

        const byAssetSlug = (await (
          await get(
            `/api/v1/references/audit?status=resolved`,
            ownerToken,
          )
        ).json()) as typeof all;
        assertEquals(byAssetSlug.length, 2);

        // References are keyed by prompt version id, not by scope id.
        const sc1 = (await (
          await get(
            `/api/v1/references/audit?source_type=scene&source_id=${versionId}`,
            ownerToken,
          )
        ).json()) as { reference: { raw_text: string; status: string } }[];
        assertEquals(sc1.length, 3);
      })();
    });
  });

  it("replaces a broken reference via the API", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await post(
          `/api/v1/references/parse`,
          {
            text: "@ghost and @nobody",
            persist: { scope_type: "prompt", scope_id: "fix-me" },
          },
          ownerToken,
        );
        const body = (await res.json()) as { tokens: (ReferenceOut & { id: string })[] };
        const ghost = body.tokens.find((t) => t.slug === "ghost");
        assert(ghost);
        assert(ghost.id);

        const replace = await post(
          `/api/v1/references/${ghost.id}/replace`,
          { slug: heroSlug },
          ownerToken,
        );
        assertEquals(replace.status, 200);
        const replaced = (await replace.json()) as {
          status: string;
          asset_id: string | null;
        };
        assertEquals(replaced.status, "resolved");
        assert(replaced.asset_id);

        const audit = (await (
          await get(
            `/api/v1/references/audit?source_type=prompt&source_id=fix-me`,
            ownerToken,
          )
        ).json()) as { reference: { raw_text: string; status: string } }[];
        assertEquals(
          audit.find((e) => e.reference.raw_text === "@ghost")?.reference.status,
          "resolved",
        );
        assertEquals(
          audit.find((e) => e.reference.raw_text === "@nobody")?.reference.status,
          "missing",
        );

        const missingTarget = await post(
          `/api/v1/references/${ghost.id}/replace`,
          { slug: "not_an_asset" },
          ownerToken,
        );
        assertEquals(missingTarget.status, 400);
      })();
    });
  });

  it("returns a single reference by id", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await post(
          `/api/v1/references/parse`,
          {
            text: `@${heroSlug} and @ghost`,
            persist: { scope_type: "prompt", scope_id: "get-one" },
          },
          ownerToken,
        );
        const body = (await res.json()) as { tokens: (ReferenceOut & { id: string })[] };
        const ghost = body.tokens.find((t) => t.slug === "ghost");
        assert(ghost);

        const idRes = await get(`/api/v1/references/${ghost.id}`, ownerToken);
        assertEquals(idRes.status, 200);
        const row = (await idRes.json()) as { raw_text: string; status: string };
        assertEquals(row.raw_text, "@ghost");
        assertEquals(row.status, "missing");

        const missingRes = await get(`/api/v1/references/does-not-exist`, ownerToken);
        assertEquals(missingRes.status, 404);
      })();
    });
  });

  it("validates request bodies", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const noText = await post(
          `/api/v1/references/parse`,
          { text: "" },
          ownerToken,
        );
        assertEquals(noText.status, 400);

        const noContent = await post(
          `/api/v1/prompts`,
          { scope_type: "scene", scope_id: "x", content: "" },
          ownerToken,
        );
        assertEquals(noContent.status, 400);

        const badScope = await post(
          `/api/v1/prompts`,
          { scope_type: "bogus", scope_id: "x", content: "hi" },
          ownerToken,
        );
        assertEquals(badScope.status, 400);

        const missingRef = await post(
          `/api/v1/references/nope/replace`,
          { slug: "x" },
          ownerToken,
        );
        assertEquals(missingRef.status, 404);
      })();
    });
  });
});
