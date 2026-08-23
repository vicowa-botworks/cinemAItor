import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb, getDb } from "../src/db/database.ts";
import * as schema from "../src/db/schema.ts";
import { hashPassword } from "../src/services/password.ts";
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

function patch(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function del(path: string, token?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: headers(token), method: "DELETE" });
}

async function bootstrap(email: string, password: string): Promise<UserBody> {
  const res = await post(
    "/api/v1/auth/bootstrap",
    { email, password, display_name: "Studio Owner" },
  );
  assertEquals(res.status, 201);
  return (await res.json()) as UserBody;
}

async function createViewer(password: string): Promise<string> {
  const email = `viewer.${Math.random().toString(36).slice(2)}@example.com`;
  schema.createUser(email, await hashPassword(password), "Viewer");
  const login = await post("/api/v1/auth/login", { email, password });
  assertEquals(login.status, 200);
  const body = (await login.json()) as UserBody;
  return body.token;
}

function uniqueSlug(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function randomImageBytes(seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(64 + seed);
  // PNG signature followed by random payload
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  crypto.getRandomValues(bytes.subarray(8));
  return bytes;
}

function upload(
  assetId: string,
  token: string,
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  notes?: string,
): Promise<Response> {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: "image/png" }), filename);
  if (notes) fd.append("notes", notes);
  return fetch(`${baseUrl}/api/v1/assets/${assetId}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
}

describe("assets api", () => {
  let ownerToken: string;
  let ownerEmail: string;

  beforeEach(async () => {
    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      await fetchWithRetry(`${baseUrl}/api/v1/health`);
      ownerEmail = `owner.${Math.random().toString(36).slice(2)}@example.com`;
      const user = await bootstrap(ownerEmail, "password123");
      ownerToken = user.token;
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("requires authentication", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const res = await get("/api/v1/assets");
        assertEquals(res.status, 401);
      })();
    });
  });

  it("creates, lists and fetches assets", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const slug = uniqueSlug("hero");
        const create = await post(
          "/api/v1/assets",
          {
            unique_slug: slug,
            display_name: "Hero",
            asset_type: "character",
            description: "the protagonist",
          },
          ownerToken,
        );
        assertEquals(create.status, 201);
        const created = (await create.json()) as Record<string, unknown>;
        assertEquals(created.unique_slug, slug);
        assertEquals(created.library_scope, "global");
        assertEquals(created.active_version, null);
        assertEquals(created.aliases, []);

        const list = await get("/api/v1/assets", ownerToken);
        assertEquals(list.status, 200);
        const assets = (await list.json()) as unknown[];
        assertEquals(assets.length, 1);

        const detail = await get(`/api/v1/assets/${created.id}`, ownerToken);
        assertEquals(detail.status, 200);
        const body = (await detail.json()) as Record<string, unknown>;
        assertEquals(body.display_name, "Hero");
        assertEquals(body.tags, []);
      })();
    });
  });

  it("rejects invalid input and duplicate slugs", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const bad = await post(
          "/api/v1/assets",
          { unique_slug: "UPPER", display_name: "X", asset_type: "character" },
          ownerToken,
        );
        assertEquals(bad.status, 400);

        const slug = uniqueSlug("hero");
        const first = await post(
          "/api/v1/assets",
          { unique_slug: slug, display_name: "Hero", asset_type: "character" },
          ownerToken,
        );
        assertEquals(first.status, 201);
        const dup = await post(
          "/api/v1/assets",
          { unique_slug: slug, display_name: "Hero 2", asset_type: "character" },
          ownerToken,
        );
        assertEquals(dup.status, 409);
        const dupBody = (await dup.json()) as { error: { code: string } };
        assertEquals(dupBody.error.code, "CONFLICT");
      })();
    });
  });

  it("scopes assets to projects", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const project = await post(
          "/api/v1/projects",
          { name: "Film" },
          ownerToken,
        );
        assertEquals(project.status, 201);
        const projectId = ((await project.json()) as { id: string }).id;

        const asset = await post(
          "/api/v1/assets",
          {
            unique_slug: uniqueSlug("prop"),
            display_name: "Prop",
            asset_type: "prop",
            library_scope: "project",
            project_id: projectId,
          },
          ownerToken,
        );
        assertEquals(asset.status, 201);
        const body = (await asset.json()) as Record<string, unknown>;
        assertEquals(body.project_id, projectId);

        const missing = await post(
          "/api/v1/assets",
          {
            unique_slug: uniqueSlug("prop2"),
            display_name: "Prop 2",
            asset_type: "prop",
            library_scope: "project",
            project_id: "00000000-0000-4000-8000-000000000000",
          },
          ownerToken,
        );
        assertEquals(missing.status, 404);

        const scoped = await get(`/api/v1/assets?project_id=${projectId}`, ownerToken);
        const scopedAssets = (await scoped.json()) as unknown[];
        assertEquals(scopedAssets.length, 1);
      })();
    });
  });

  it("uploads a file, serves previews and versions the asset", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const slug = uniqueSlug("hero");
        const created = (await (
          await post(
            "/api/v1/assets",
            { unique_slug: slug, display_name: "Hero", asset_type: "character" },
            ownerToken,
          )
        ).json()) as { id: string };

        const v1Bytes = randomImageBytes(128);
        const up1 = await upload(created.id, ownerToken, v1Bytes, "hero_v1.png", "first take");
        assertEquals(up1.status, 201);
        const up1Body = (await up1.json()) as {
          asset: { active_version_id: string | null };
          version: { id: string; version_number: number; mime_type: string };
        };
        assertEquals(up1Body.version.version_number, 1);
        assertEquals(up1Body.version.mime_type, "image/png");
        assertEquals(up1Body.asset.active_version_id, up1Body.version.id);

        let preview = await get(`/api/v1/assets/${created.id}/preview`, ownerToken);
        assertEquals(preview.status, 200);
        assertEquals(preview.headers.get("content-type"), "image/png");
        assertEquals(await preview.arrayBuffer(), v1Bytes.buffer);

        const v2Bytes = randomImageBytes(256);
        const up2 = await upload(created.id, ownerToken, v2Bytes, "hero_v2.png");
        assertEquals(up2.status, 201);
        const up2Body = (await up2.json()) as {
          version: { version_number: number; content_hash: string; id: string };
        };
        assertEquals(up2Body.version.version_number, 2);

        preview = await get(`/api/v1/assets/${created.id}/preview`, ownerToken);
        assertEquals(await preview.arrayBuffer(), v2Bytes.buffer);

        const versions = await get(`/api/v1/assets/${created.id}/versions`, ownerToken);
        const versionList = (await versions.json()) as { version_number: number }[];
        assertEquals(versionList.map((v) => v.version_number), [2, 1]);
      })();
    });
  });

  it("serves a specific version's stored file for comparison", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const created = (await (
          await post(
            "/api/v1/assets",
            { unique_slug: uniqueSlug("hero"), display_name: "Hero", asset_type: "character" },
            ownerToken,
          )
        ).json()) as { id: string };

        const v1Bytes = randomImageBytes(128);
        const up1 = (await (
          await upload(created.id, ownerToken, v1Bytes, "hero_v1.png")
        ).json()) as { version: { id: string } };
        const v2Bytes = randomImageBytes(256);
        await upload(created.id, ownerToken, v2Bytes, "hero_v2.png");

        // Older (non-active) version is reachable by version id.
        const versionPreview = await get(
          `/api/v1/assets/${created.id}/versions/${up1.version.id}/preview`,
          ownerToken,
        );
        assertEquals(versionPreview.status, 200);
        assertEquals(versionPreview.headers.get("content-type"), "image/png");
        assertEquals(await versionPreview.arrayBuffer(), v1Bytes.buffer);

        const unknownVersion = await get(
          `/api/v1/assets/${created.id}/versions/version_0000deadbeef0000dead/preview`,
          ownerToken,
        );
        assertEquals(unknownVersion.status, 404);
      })();
    });
  });

  it("restores an older version and registers versions from stored content", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const created = (await (
          await post(
            "/api/v1/assets",
            {
              unique_slug: uniqueSlug("hero"),
              display_name: "Hero",
              asset_type: "character",
            },
            ownerToken,
          )
        ).json()) as { id: string };

        const v1Bytes = randomImageBytes(100);
        await upload(created.id, ownerToken, v1Bytes, "hero_v1.png");
        const v2Bytes = randomImageBytes(200);
        const up2 = (await (
          await upload(created.id, ownerToken, v2Bytes, "hero_v2.png")
        ).json()) as { version: { id: string; content_hash: string } };

        const versions = (await (
          await get(`/api/v1/assets/${created.id}/versions`, ownerToken)
        ).json()) as { id: string; version_number: number }[];
        const v1 = versions.find((v) => v.version_number === 1);
        assert(v1);

        const restore = await post(
          `/api/v1/assets/${created.id}/versions/${v1.id}/restore`,
          {},
          ownerToken,
        );
        assertEquals(restore.status, 200);
        const restoreBody = (await restore.json()) as {
          asset: { active_version_id: string };
        };
        assertEquals(restoreBody.asset.active_version_id, v1.id);

        const preview = await get(`/api/v1/assets/${created.id}/preview`, ownerToken);
        assertEquals(await preview.arrayBuffer(), v1Bytes.buffer);

        const register = await post(
          `/api/v1/assets/${created.id}/versions`,
          {
            content_hash: up2.version.content_hash,
            make_active: false,
            technical_metadata: { width: 512, height: 512 },
          },
          ownerToken,
        );
        assertEquals(register.status, 201);
        const regBody = (await register.json()) as { version_number: number };
        assertEquals(regBody.version_number, 3);

        const still = (await (
          await get(`/api/v1/assets/${created.id}`, ownerToken)
        ).json()) as { active_version_id: string };
        assertEquals(still.active_version_id, v1.id);

        const unknown = await post(
          `/api/v1/assets/${created.id}/versions`,
          { content_hash: "f".repeat(64) },
          ownerToken,
        );
        assertEquals(unknown.status, 400);
      })();
    });
  });

  it("manages aliases and tags", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const created = (await (
          await post(
            "/api/v1/assets",
            { unique_slug: uniqueSlug("hero"), display_name: "Hero", asset_type: "character" },
            ownerToken,
          )
        ).json()) as { id: string };

        const alias = await post(
          `/api/v1/assets/${created.id}/aliases`,
          { alias_slug: uniqueSlug("lead") },
          ownerToken,
        );
        assertEquals(alias.status, 201);
        const aliasBody = (await alias.json()) as { aliases: string[] };
        assertEquals(aliasBody.aliases.length, 1);

        const invalid = await post(
          `/api/v1/assets/${created.id}/aliases`,
          { alias_slug: "UPPER" },
          ownerToken,
        );
        assertEquals(invalid.status, 400);

        const tag = await post(
          `/api/v1/assets/${created.id}/tags`,
          { tag: "lead" },
          ownerToken,
        );
        assertEquals(tag.status, 201);
        const detail = (await (
          await get(`/api/v1/assets/${created.id}`, ownerToken)
        ).json()) as { aliases: string[]; tags: string[] };
        assertEquals(detail.tags, ["lead"]);

        const delTag = await del(`/api/v1/assets/${created.id}/tags/lead`, ownerToken);
        assertEquals(delTag.status, 200);
        const delAlias = await del(
          `/api/v1/assets/${created.id}/aliases/${aliasBody.aliases[0]}`,
          ownerToken,
        );
        assertEquals(delAlias.status, 200);
      })();
    });
  });

  it("denies write access to other users", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const viewerToken = await createViewer("viewer-password-1");

        const slug = uniqueSlug("hero");
        const created = (await (
          await post(
            "/api/v1/assets",
            { unique_slug: slug, display_name: "Hero", asset_type: "character" },
            ownerToken,
          )
        ).json()) as { id: string };

        const read = await get(`/api/v1/assets/${created.id}`, viewerToken);
        assertEquals(read.status, 404);

        const upd = await patch(
          `/api/v1/assets/${created.id}`,
          { display_name: "Hacked" },
          viewerToken,
        );
        assertEquals(upd.status, 403);

        const up = await upload(
          created.id,
          viewerToken,
          randomImageBytes(10),
          "x.png",
        );
        assertEquals(up.status, 403);

        const d = await del(`/api/v1/assets/${created.id}`, viewerToken);
        assertEquals(d.status, 403);
      })();
    });
  });

  it("soft-deletes assets and warns about references", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const created = (await (
          await post(
            "/api/v1/assets",
            { unique_slug: uniqueSlug("hero"), display_name: "Hero", asset_type: "character" },
            ownerToken,
          )
        ).json()) as { id: string };

        const db = getDb();
        const now = new Date().toISOString();
        for (const i of [1, 2]) {
          const stmt = db.prepare(
            `INSERT INTO asset_references (
              id, source_type, source_id, asset_id, raw_text, status, created_at, updated_at
            ) VALUES (?, 'scene', ?, ?, '@hero', 'resolved', ?, ?)`,
          );
          (stmt.run as (...params: unknown[]) => unknown)(
            crypto.randomUUID(),
            `scene-${i}`,
            created.id,
            now,
            now,
          );
        }

        const d = await del(`/api/v1/assets/${created.id}`, ownerToken);
        assertEquals(d.status, 200);
        const body = (await d.json()) as {
          message: string;
          referenced_by: number;
          warnings: string[];
        };
        assertEquals(body.referenced_by, 2);
        assertEquals(body.warnings.length, 1);

        const after = await get(`/api/v1/assets/${created.id}`, ownerToken);
        assertEquals(after.status, 404);
      })();
    });
  });
});
