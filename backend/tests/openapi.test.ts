import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertEquals, assertExists, assertMatch } from "@std/assert";
import { closeDb } from "../src/db/database.ts";
import {
  buildOpenApiSpec,
  collectRoutes,
  operationIdFor,
  toOpenApiPath,
} from "../src/openapi/spec.ts";
import { allOps, apiRouters } from "../src/openapi/registry.ts";
import { SCHEMAS, TAG_DESCRIPTIONS } from "../src/openapi/schemas.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];

type Paths = Record<string, Record<string, unknown>>;
type Op = Record<string, unknown>;
type Param = Record<string, unknown>;

function pathsOf(doc: Record<string, unknown>): Paths {
  return doc.paths as Paths;
}

function operations(doc: Record<string, unknown>): Op[] {
  const ops: Op[] = [];
  for (const item of Object.values(pathsOf(doc))) {
    for (const [method, op] of Object.entries(item)) {
      if (METHODS.includes(method)) ops.push(op as Op);
    }
  }
  return ops;
}

/** Collect every `$ref` used anywhere in the document. */
function collectRefs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "$ref" && typeof v === "string") out.add(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

describe("openapi spec builder", () => {
  it("builds a well-formed OpenAPI 3.1 document", () => {
    const doc = buildOpenApiSpec();
    assertEquals(doc.openapi, "3.1.0");
    assertEquals((doc.info as Record<string, unknown>).title, "CinemAItor API");
    assertExists(pathsOf(doc));
    assertExists((doc.components as Record<string, unknown>).schemas);
    const opCount = operations(doc).length;
    assertEquals(opCount, Object.keys(allOps()).length);
    assertEquals(opCount, collectRoutes(apiRouters()).length);
  });

  it("keeps mounted routes and openApiOps in lockstep (bidirectional)", () => {
    const routeKeys = new Set(
      collectRoutes(apiRouters()).map(
        (r) => `${r.method} ${toOpenApiPath(r.path)}`,
      ),
    );
    const opKeys = new Set(Object.keys(allOps()));
    const missing = [...routeKeys].filter((k) => !opKeys.has(k));
    const stale = [...opKeys].filter((k) => !routeKeys.has(k));
    assertEquals(
      missing,
      [],
      `routes missing from openApiOps: ${missing.join(", ")}`,
    );
    assertEquals(
      stale,
      [],
      `openApiOps entries without a route: ${stale.join(", ")}`,
    );
  });

  it("resolves every $ref to a defined component schema", () => {
    const doc = buildOpenApiSpec();
    const refs = collectRefs(doc);
    const unresolved = [...refs].filter(
      (r) =>
        !r.startsWith("#/components/schemas/") ||
        !Object.hasOwn(SCHEMAS, r.split("/").pop()!),
    );
    assertEquals(unresolved, []);
  });

  it("defines no unreachable component schemas", () => {
    const doc = buildOpenApiSpec();
    const refs = collectRefs(doc);
    const used = new Set(
      [...refs]
        .filter((r) => r.startsWith("#/components/schemas/"))
        .map((r) => r.split("/").pop()!),
    );
    const unreachable = Object.keys(SCHEMAS).filter((k) => !used.has(k));
    assertEquals(unreachable, []);
  });

  it("assigns unique operationIds and complete operation fields", () => {
    const doc = buildOpenApiSpec();
    const ops = operations(doc);
    const ids = ops.map((o) => o.operationId as string);
    assertEquals(new Set(ids).size, ids.length, "duplicate operationIds");
    const tagNames = new Set(
      (doc.tags as { name: string }[]).map((t) => t.name),
    );
    for (const op of ops) {
      assertExists(op.operationId);
      assertExists(op.summary);
      assertExists(op.responses);
      for (const tag of op.tags as string[]) {
        assertEquals(tagNames.has(tag), true, `unknown tag "${tag}"`);
        assertEquals(
          Object.hasOwn(TAG_DESCRIPTIONS, tag),
          true,
          `tag "${tag}" lacks a description`,
        );
      }
      // Every operation documents at least one success; secured operations
      // must document 401 (public endpoints may be 200-only).
      const statuses = Object.keys(op.responses as Record<string, unknown>);
      assertEquals(
        statuses.some((s) => s.startsWith("2")),
        true,
        `${op.operationId} has no 2xx response`,
      );
      const security = op.security as unknown[] | undefined;
      if (security && security.length > 0) {
        assertEquals(
          (op.responses as Record<string, unknown>)["401"] !== undefined,
          true,
          `${op.operationId} documents no 401`,
        );
      }
    }
  });

  it("derives security only for authenticated routes", () => {
    const doc = buildOpenApiSpec();
    const ops = operations(doc);
    let secured = 0;
    let publicCount = 0;
    for (const op of ops) {
      const security = op.security as unknown[] | undefined;
      if (security && security.length > 0) secured++;
      else publicCount++;
    }
    // Every operation carries an explicit security array (empty = public),
    // never an omitted one.
    assertEquals(ops.every((o) => Array.isArray(o.security)), true);
    assertEquals(ops.length, secured + publicCount);
    assertEquals(secured > 0, true);
    assertEquals(publicCount > 0, true);
  });

  it("marks path parameters correctly (integer ids for users/invitations)", () => {
    const doc = buildOpenApiSpec();
    const userPatch = pathsOf(doc)["/api/v1/users/{id}"].patch as Op;
    const idParam = (userPatch.parameters as Param[]).find((p) => p.name === "id");
    assertExists(idParam);
    assertEquals((idParam.schema as Record<string, unknown>).type, "integer");
    const projectGet = pathsOf(doc)["/api/v1/projects/{id}"].get as Op;
    const projectParam = (projectGet.parameters as Param[]).find((p) => p.name === "id");
    assertExists(projectParam);
    assertEquals(
      (projectParam.schema as Record<string, unknown>).type,
      "string",
    );
  });

  it("converts paths and builds stable operation ids", () => {
    assertEquals(
      toOpenApiPath("/api/v1/assets/:id/versions/:versionId/preview"),
      "/api/v1/assets/{id}/versions/{versionId}/preview",
    );
    assertEquals(operationIdFor("GET", "/api/v1/projects"), "getProjects");
    assertEquals(
      operationIdFor("POST", "/api/v1/auth/login"),
      "postAuthLogin",
    );
    // Legacy /api/* routes must not collide with their v1 twins.
    assertEquals(
      operationIdFor("POST", "/api/auth/login"),
      "postLegacyAuthLogin",
    );
  });
});

describe("openapi endpoints", () => {
  beforeEach(() => {
    freshMemoryDb();
  });

  afterEach(() => {
    closeDb();
  });

  it("serves the spec at /api/v1/openapi.json without auth", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetchWithRetry(`${baseUrl}/api/v1/openapi.json`);
      assertEquals(res.status, 200);
      assertMatch(res.headers.get("content-type") ?? "", /application\/json/);
      const body = (await res.json()) as Record<string, unknown>;
      assertEquals(body.openapi, "3.1.0");
      assertExists(pathsOf(body));
      const pathCount = Object.keys(pathsOf(body)).length;
      assertEquals(
        pathCount,
        Object.keys(pathsOf(buildOpenApiSpec())).length,
      );
    });
  });

  it("serves Swagger UI at /api/v1/docs without auth", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetchWithRetry(`${baseUrl}/api/v1/docs`);
      assertEquals(res.status, 200);
      assertMatch(res.headers.get("content-type") ?? "", /text\/html/);
      const html = await res.text();
      assertMatch(html, /swagger-ui/);
      assertMatch(html, /\/api\/v1\/openapi\.json/);
    });
  });
});
