import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  auditReferences,
  getReference,
  REFERENCE_SOURCE_TYPES,
  REFERENCE_STATUSES,
  replaceReference,
  resolveReferenceText,
  saveResolvedReferences,
} from "@cinemaItor/db/references.ts";
import { badRequest, notFound, unauthorized } from "@cinemaItor/errors.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { errorResponses, ref } from "@cinemaItor/openapi/types.ts";

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

interface ParamContext extends AuthedContext {
  params: { id?: string };
}

function requireIdParam(ctx: ParamContext): string {
  const id = ctx.params.id ?? "";
  if (!id) throw notFound("Reference not found");
  return id;
}

function rolesMap(body: Record<string, unknown>): Record<string, string> {
  const value = body.roles;
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("roles must be an object mapping slug to role");
  }
  const roles: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "string" || !v) {
      throw badRequest(`roles.${k} must be a non-empty string`);
    }
    roles[k] = v;
  }
  return roles;
}

function persistTarget(
  body: Record<string, unknown>,
): { scope_type: string; scope_id: string } | null {
  const value = body.persist;
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null) {
    throw badRequest("persist must be an object with scope_type and scope_id");
  }
  const p = value as Record<string, unknown>;
  const scopeType = p.scope_type;
  const scopeId = p.scope_id;
  if (typeof scopeType !== "string" || !scopeType) {
    throw badRequest("persist.scope_type is required");
  }
  if (!REFERENCE_SOURCE_TYPES.includes(scopeType as (typeof REFERENCE_SOURCE_TYPES)[number])) {
    throw badRequest(
      `persist.scope_type must be one of: ${REFERENCE_SOURCE_TYPES.join(", ")}`,
    );
  }
  if (typeof scopeId !== "string" || !scopeId) {
    throw badRequest("persist.scope_id is required");
  }
  return { scope_type: scopeType, scope_id: scopeId };
}

function warningFor(ref: { status: string; notes: string | null; slug: string }): string | null {
  if (ref.status === "resolved") return null;
  return ref.notes ?? `@${ref.slug} is not a known asset`;
}

export const referenceRouter = new Router()
  .post("/api/v1/references/parse", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const text = body.text;
    if (typeof text !== "string" || !text) throw badRequest("text is required");
    if (text.length > 100_000) throw badRequest("text must be at most 100000 characters");

    const resolved = resolveReferenceText(userId, text, rolesMap(body));
    const target = persistTarget(body);
    let references: unknown[] = resolved.map((r) => ({
      raw: r.token.raw,
      slug: r.token.slug,
      version: r.token.version,
      start: r.token.start,
      end: r.token.end,
      status: r.status,
      role: r.role,
      notes: r.notes,
      asset: r.asset
        ? {
          id: r.asset.id,
          slug: r.asset.unique_slug,
          display_name: r.asset.display_name,
          asset_type: r.asset.asset_type,
          active_version_id: r.asset.active_version_id,
          // The version this token resolves to (active for bare slugs, the
          // requested one for `@slug:vN`) plus its media type — the UI uses
          // these to render an inline thumbnail for image/video references.
          version_id: r.asset_version?.id ?? null,
          mime_type: r.asset_version?.mime_type ?? null,
        }
        : null,
    }));

    if (target) {
      const saved = saveResolvedReferences(
        userId,
        target.scope_type,
        target.scope_id,
        resolved,
      );
      references = resolved.map((_r, i) => ({
        ...(references[i] as object),
        id: saved[i].id,
      }));
    }

    const warnings = resolved
      .map((r) => warningFor({ status: r.status, notes: r.notes, slug: r.token.slug }))
      .filter((w): w is string => w !== null);

    ctx.response.body = { tokens: references, warnings };
  })
  .get("/api/v1/references/audit", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    const get = (key: string) => search.searchParams.get(key) ?? undefined;

    const status = get("status");
    if (status && !REFERENCE_STATUSES.includes(status as (typeof REFERENCE_STATUSES)[number])) {
      throw badRequest(`status must be one of: ${REFERENCE_STATUSES.join(", ")}`);
    }
    const entries = auditReferences({
      source_type: get("source_type"),
      source_id: get("source_id"),
      asset_id: get("asset_id"),
      status: status as (typeof REFERENCE_STATUSES)[number] | undefined,
    });
    ctx.response.body = entries;
  })
  .get("/api/v1/references/:id", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const reference = getReference(requireIdParam(ctx));
    if (!reference) throw notFound("Reference not found");
    ctx.response.body = reference;
  })
  .post("/api/v1/references/:id/replace", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const referenceId = requireIdParam(ctx);
    if (!getReference(referenceId)) throw notFound("Reference not found");

    const body = await readJsonBody(ctx);
    const slug = body.slug;
    if (typeof slug !== "string" || !slug) throw badRequest("slug is required");
    const version = body.version;
    if (
      version !== undefined &&
      (typeof version !== "number" || !Number.isInteger(version) || version <= 0)
    ) {
      throw badRequest("version must be a positive integer");
    }

    const updated = replaceReference(userId, referenceId, {
      slug,
      version: version as number | undefined,
    });
    if (!updated) throw notFound("Reference not found");
    ctx.response.body = updated;
  });

export const openApiOps: Record<string, OperationMeta> = {
  "POST /api/v1/references/parse": {
    summary: "Resolve @asset tokens in text",
    description: "Parses the text for @slug (optionally @slug:vN) reference tokens and " +
      "resolves each against the caller's accessible assets. With a " +
      "persist target the resolved references are stored against that " +
      "scope (e.g. a scene or shot) and the response tokens carry their " +
      "ids.",
    requestBody: { schema: ref("ReferenceParseRequest") },
    responses: {
      200: {
        description: "The resolved tokens and unresolved-token warnings",
        schema: {
          type: "object",
          required: ["tokens", "warnings"],
          properties: {
            tokens: { type: "array", items: ref("ReferenceToken") },
            warnings: { type: "array", items: { type: "string" } },
          },
        },
      },
      ...errorResponses(400, 401),
    },
  },
  "GET /api/v1/references/audit": {
    summary: "Audit stored references",
    description: "Lists stored reference rows, optionally filtered by source, asset, " +
      "or status.",
    parameters: {
      source_type: {
        schema: {
          type: "string",
          enum: ["prompt", "scene", "shot", "storyboard_panel"],
        },
        description: "Only references from this source type",
      },
      source_id: {
        schema: { type: "string" },
        description: "Only references from this source object",
      },
      asset_id: {
        schema: { type: "string" },
        description: "Only references pointing at this asset",
      },
      status: {
        schema: {
          type: "string",
          enum: ["resolved", "missing", "ambiguous"],
        },
        description: "Only references with this status",
      },
    },
    responses: {
      200: {
        description: "Matching reference rows",
        schema: { type: "array", items: ref("Reference") },
      },
      ...errorResponses(400, 401),
    },
  },
  "GET /api/v1/references/{id}": {
    summary: "One stored reference",
    responses: {
      200: {
        description: "The reference row",
        schema: ref("Reference"),
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/references/{id}/replace": {
    summary: "Retarget a reference to another asset (broken-reference repair)",
    requestBody: { schema: ref("ReferenceReplaceRequest") },
    responses: {
      200: {
        description: "The updated reference row",
        schema: ref("Reference"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
};
