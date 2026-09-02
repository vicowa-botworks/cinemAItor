import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import { createProject } from "../src/db/projects.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

let baseUrl = "";
let ownerToken: string;
let ownerId: number;
let projectId: string;

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, json };
}

interface ScriptDetail {
  script: { id: string; status: string; prompt_version_id: string | null };
  prompt:
    | { content: string; version_number: number; version_id: string; warnings: string[] }
    | null;
  versions: { id: string; version_number: number; content: string }[];
}

describe("movie scripts api", () => {
  beforeEach(async () => {
    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(health.status, 200);

      const res = await req(
        "POST",
        "/api/v1/auth/bootstrap",
        {
          email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Studio Admin",
        },
      );
      assertEquals(res.status, 201);
      const user = res.json as { token: string; user: { id: number } };
      ownerToken = user.token;
      ownerId = user.user.id;
      projectId = createProject({ name: "Test Film" }, ownerId).id;
    });
  });

  afterEach(() => {
    closeDb();
  });

  it("requires authentication", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        assertEquals((await req("GET", "/api/v1/scripts")).status, 401);
        assertEquals(
          (await req("POST", "/api/v1/scripts", { project_id: projectId, name: "x" })).status,
          401,
        );
      })();
    }));

  it("creates a script and saves text versions", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const created = await req(
          "POST",
          "/api/v1/scripts",
          { project_id: projectId, name: "First Draft" },
          ownerToken,
        );
        assertEquals(created.status, 201);
        const scriptId = (created.json as { id: string }).id;
        assertEquals((created.json as { status: string }).status, "draft");

        const got = await req("GET", `/api/v1/scripts/${scriptId}`, undefined, ownerToken);
        assertEquals(got.status, 200);
        const detail = got.json as ScriptDetail;
        assertEquals(detail.prompt, null);
        assertEquals(detail.versions.length, 0);

        const v1 = await req(
          "POST",
          `/api/v1/scripts/${scriptId}/versions`,
          { content: "INT. DOCKS - NIGHT\n\nA figure waits." },
          ownerToken,
        );
        assertEquals(v1.status, 200);
        const d1 = v1.json as ScriptDetail;
        assertEquals(d1.prompt?.version_number, 1);
        assertEquals(d1.versions.length, 1);
        assert(d1.script.prompt_version_id);

        // identical content → duplicate, still one version
        const dup = await req(
          "POST",
          `/api/v1/scripts/${scriptId}/versions`,
          { content: "INT. DOCKS - NIGHT\n\nA figure waits." },
          ownerToken,
        );
        assertEquals(dup.status, 200);
        assertEquals((dup.json as ScriptDetail).versions.length, 1);

        // changed content → version 2
        const v2 = await req(
          "POST",
          `/api/v1/scripts/${scriptId}/versions`,
          { content: "INT. DOCKS - DAWN\n\nLights up." },
          ownerToken,
        );
        const d2 = v2.json as ScriptDetail;
        assertEquals(d2.prompt?.version_number, 2);
        assertEquals(d2.versions.length, 2);
        assertEquals(d2.prompt?.content, "INT. DOCKS - DAWN\n\nLights up.");
      })();
    });
  });

  it("lists versions newest-first and restores a prior version", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const created = await req(
          "POST",
          "/api/v1/scripts",
          { project_id: projectId, name: "Hist" },
          ownerToken,
        );
        const scriptId = (created.json as { id: string }).id;
        await req("POST", `/api/v1/scripts/${scriptId}/versions`, { content: "v1" }, ownerToken);
        await req("POST", `/api/v1/scripts/${scriptId}/versions`, { content: "v2" }, ownerToken);

        const list = await req(
          "GET",
          `/api/v1/scripts/${scriptId}/versions`,
          undefined,
          ownerToken,
        );
        assertEquals(list.status, 200);
        const versions = list.json as { version_number: number; id: string }[];
        assertEquals(versions.map((v) => v.version_number), [2, 1]);

        const v1Id = versions[1].id;
        const restored = await req(
          "POST",
          `/api/v1/scripts/${scriptId}/versions/${v1Id}/restore`,
          undefined,
          ownerToken,
        );
        assertEquals(restored.status, 200);
        const rd = restored.json as ScriptDetail;
        assertEquals(rd.prompt?.content, "v1");
        assertEquals(rd.prompt?.version_number, 3);
      })();
    });
  });

  it("updates and soft-deletes a script", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const created = await req(
          "POST",
          "/api/v1/scripts",
          { project_id: projectId, name: "Temp" },
          ownerToken,
        );
        const scriptId = (created.json as { id: string }).id;

        const patched = await req(
          "PATCH",
          `/api/v1/scripts/${scriptId}`,
          { name: "Renamed", status: "active" },
          ownerToken,
        );
        assertEquals(patched.status, 200);
        const p = patched.json as { name: string; status: string };
        assertEquals(p.name, "Renamed");
        assertEquals(p.status, "active");

        const deleted = await req("DELETE", `/api/v1/scripts/${scriptId}`, undefined, ownerToken);
        assertEquals(deleted.status, 200);
        assertEquals(
          (await req("GET", `/api/v1/scripts/${scriptId}`, undefined, ownerToken)).status,
          404,
        );
      })();
    });
  });

  it("rejects bad input and missing scripts", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        // no name → 400
        assertEquals(
          (await req("POST", "/api/v1/scripts", { project_id: projectId }, ownerToken)).status,
          400,
        );
        // no project_id → 404 (unknown project)
        assertEquals(
          (await req("POST", "/api/v1/scripts", { name: "x" }, ownerToken)).status,
          404,
        );

        const created = await req(
          "POST",
          "/api/v1/scripts",
          { project_id: projectId, name: "c" },
          ownerToken,
        );
        const scriptId = (created.json as { id: string }).id;
        // no content → 400
        assertEquals(
          (await req("POST", `/api/v1/scripts/${scriptId}/versions`, {}, ownerToken)).status,
          400,
        );
        // unknown script → 404
        assertEquals((await req("GET", "/api/v1/scripts/nope", undefined, ownerToken)).status, 404);
      })();
    });
  });
});
