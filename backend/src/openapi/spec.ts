/**
 * Builds the OpenAPI 3.1 document for the CinemAItor API from the live
 * routers.
 *
 * What is derived automatically (single source of truth = the mounted
 * routes):
 *  - paths, HTTP methods, path parameters (names and string/integer type)
 *  - security: an operation requires the bearer token exactly when its
 *    middleware stack contains `authMiddleware`
 *  - rate limiting: `x-rate-limited` when the stack contains the auth
 *    rate-limit middleware
 *
 * What is declared per operation (next to the route, in each module under
 * src/routes/ as `openApiOps`): summaries, request bodies, response
 * schemas, query parameters, admin-only flags.
 *
 * buildOpenApiSpec() throws when the two sides drift: every mounted route
 * needs an operation entry and every operation entry must match a mounted
 * route. backend/tests/openapi.test.ts asserts the same in CI.
 */

import { authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { authRateLimitMiddleware } from "@cinemaItor/middleware/rate_limit.ts";
import type { OperationMeta } from "./types.ts";
import { allOps, type ApiRouterRef, apiRouters } from "./registry.ts";
import { SCHEMAS, TAG_DESCRIPTIONS } from "./schemas.ts";

const METHOD_ORDER = ["get", "put", "post", "delete", "patch", "head", "options"];

/** Tags whose path parameters are integer ids (users, invitations). */
const INTEGER_ID_TAGS = new Set(["users", "invitations"]);

interface ResolvedRoute {
  tag: string;
  method: string; // uppercase, HEAD excluded
  path: string; // raw route path with :params
  paramNames: string[];
  hasAuth: boolean;
  rateLimited: boolean;
}

export function collectRoutes(routers: ApiRouterRef[]): ResolvedRoute[] {
  const out: ResolvedRoute[] = [];
  for (const { tag, router } of routers) {
    for (const route of router) {
      const method = (route.methods as string[]).find((m) => m !== "HEAD");
      if (!method) continue; // middleware-only layers (use) have no verb
      out.push({
        tag,
        method: method.toUpperCase(),
        path: route.path,
        paramNames: route.paramNames as string[],
        hasAuth: (route.middleware as unknown[]).includes(authMiddleware),
        rateLimited: (route.middleware as unknown[]).includes(
          authRateLimitMiddleware,
        ),
      });
    }
  }
  return out;
}

/** Convert an Oak route path (`/api/v1/users/:id`) to an OpenAPI path. */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export function operationIdFor(method: string, path: string): string {
  let segments: string[];
  // The legacy /api/* routes (no version segment) share their path tails
  // with the v1 routes, so their operation ids carry a "Legacy" infix.
  const legacy = !path.startsWith("/ws/") &&
    !path.startsWith("/api/v1/") && path.startsWith("/api/");
  if (path.startsWith("/api/v1/")) {
    segments = path.slice("/api/v1".length).split("/").filter(Boolean);
  } else if (path.startsWith("/api/")) {
    segments = path.slice("/api".length).split("/").filter(Boolean);
  } else if (path.startsWith("/ws/v1/")) {
    segments = [
      "ws",
      ...path.slice("/ws/v1".length).split("/").filter(Boolean),
    ];
  } else {
    segments = path.split("/").filter(Boolean);
  }
  const pascal = segments.map((s) => {
    const clean = s.replace(/[{}]/g, "");
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  });
  return method.toLowerCase() + (legacy ? "Legacy" : "") + pascal.join("");
}

function buildResponses(
  meta: OperationMeta,
): Record<string, Record<string, unknown>> {
  const responses: Record<string, Record<string, unknown>> = {};
  const ordered = Object.keys(meta.responses).sort((a, b) => {
    if (a === "default") return 1;
    if (b === "default") return -1;
    return Number(a) - Number(b);
  });
  for (const status of ordered) {
    const r = meta.responses[status];
    const body: Record<string, unknown> = { description: r.description };
    if (r.mediaType) {
      body.content = {
        [r.mediaType]: { schema: { type: "string", format: "binary" } },
      };
    } else if (r.schema) {
      body.content = { "application/json": { schema: r.schema } };
    }
    responses[status] = body;
  }
  return responses;
}

function buildOperation(
  route: ResolvedRoute,
  meta: OperationMeta,
): Record<string, unknown> {
  const openApiPath = toOpenApiPath(route.path);
  const op: Record<string, unknown> = {
    operationId: operationIdFor(route.method, route.path),
    tags: [route.tag],
    summary: meta.summary ?? `${route.method} ${openApiPath}`,
  };
  if (meta.description) op.description = meta.description;

  // Path parameters are auto-derived; a declaration with the same name
  // overrides the derived schema/description. Other declarations become
  // query parameters.
  const declared = meta.parameters ?? {};
  const parameters = [
    ...route.paramNames.map((name) => ({
      name,
      in: "path",
      required: true,
      ...(declared[name]?.description ? { description: declared[name]?.description } : {}),
      schema: declared[name]?.schema ??
        (INTEGER_ID_TAGS.has(route.tag) ? { type: "integer" } : { type: "string" }),
    })),
    ...Object.entries(declared)
      .filter(([name]) => !route.paramNames.includes(name))
      .map(([name, p]) => ({
        name,
        in: "query",
        ...(p.required !== undefined ? { required: p.required } : {}),
        schema: p.schema,
        ...(p.description ? { description: p.description } : {}),
      })),
  ];
  if (parameters.length) op.parameters = parameters;

  if (meta.requestBody) {
    op.requestBody = {
      required: true,
      ...(meta.requestBody.description ? { description: meta.requestBody.description } : {}),
      content: {
        [meta.requestBody.contentType ?? "application/json"]: {
          schema: meta.requestBody.schema,
        },
      },
    };
  }

  op.security = route.hasAuth ? [{ bearerAuth: [] }] : [];
  if (meta.adminOnly) op["x-admin-only"] = true;
  if (route.rateLimited) op["x-rate-limited"] = true;
  if (route.path.startsWith("/ws/")) {
    op["x-transport"] = "websocket";
  }
  op.responses = buildResponses(meta);
  if (meta.deprecated) op.deprecated = true;
  return op;
}

/**
 * Assemble the full OpenAPI document. Throws with the complete list of
 * mismatches when routes and operation metadata are out of sync.
 */
export function buildOpenApiSpec(): Record<string, unknown> {
  const routers = apiRouters();
  const ops = allOps();
  const routes = collectRoutes(routers);

  const routeKeys = new Set(
    routes.map((r) => `${r.method} ${toOpenApiPath(r.path)}`),
  );
  const opKeys = new Set(Object.keys(ops));
  const missing = [...routeKeys].filter((k) => !opKeys.has(k));
  const stale = [...opKeys].filter((k) => !routeKeys.has(k));
  if (missing.length || stale.length) {
    throw new Error(
      `OpenAPI metadata out of sync with mounted routes.\n` +
        `  routes missing from openApiOps: ${JSON.stringify(missing, null, 2)}\n` +
        `  openApiOps entries without a route: ${JSON.stringify(stale, null, 2)}`,
    );
  }

  const seenIds = new Map<string, string>();
  const paths: Record<string, Record<string, unknown>> = {};
  const seenTags = new Set<string>();

  for (const route of routes) {
    const openApiPath = toOpenApiPath(route.path);
    const meta = ops[`${route.method} ${openApiPath}`];
    const op = buildOperation(route, meta);
    const opId = op.operationId as string;
    const dup = seenIds.get(opId);
    if (dup) {
      throw new Error(
        `Duplicate operationId "${opId}" for ${dup} and ${route.method} ${openApiPath}`,
      );
    }
    seenIds.set(opId, `${route.method} ${openApiPath}`);
    seenTags.add(route.tag);

    paths[openApiPath] ??= {};
    (paths[openApiPath] as Record<string, unknown>)[route.method.toLowerCase()] = op;
  }

  const sortedPaths: Record<string, Record<string, unknown>> = {};
  for (const p of Object.keys(paths).sort()) {
    const item = paths[p] as Record<string, unknown>;
    sortedPaths[p] = Object.fromEntries(
      Object.keys(item).sort((a, b) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b)).map((
        m,
      ) => [m, item[m]]),
    );
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "CinemAItor API",
      version: "1.0.0",
      description: "REST API for the CinemAItor AI movie-creation studio. " +
        "All requests and responses are JSON unless noted. " +
        "Authenticated endpoints require an Authorization: Bearer <token> " +
        "header; tokens are issued by the auth endpoints. " +
        "Errors use the Error envelope. Endpoints flagged x-rate-limited " +
        "are protected by a fixed-window limiter. " +
        "The job event stream is a WebSocket (x-transport: websocket), not a " +
        "plain HTTP GET.",
    },
    servers: [
      {
        url: "/",
        description: "Same origin as the API (port 8123, or 8124 via the frontend proxy)",
      },
    ],
    tags: Object.keys(TAG_DESCRIPTIONS)
      .filter((t) => seenTags.has(t))
      .map((t) => ({ name: t, description: TAG_DESCRIPTIONS[t] })),
    paths: sortedPaths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Session JWT from /api/v1/auth/bootstrap or /api/v1/auth/login",
        },
      },
      schemas: SCHEMAS,
    },
  };
}
