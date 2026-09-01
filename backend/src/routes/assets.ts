import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  addAlias,
  addTag,
  type Asset,
  type AssetFilter,
  type AssetInput,
  type AssetUpdates,
  createAsset,
  createAssetVersion,
  deleteAsset,
  getAssetAccessible,
  getAssetById,
  getAssetVersion,
  hasAssetPermission,
  listAliases,
  listAssets,
  listAssetVersions,
  listTags,
  removeAlias,
  removeTag,
  restoreAssetVersion,
  updateAsset,
} from "@cinemaItor/db/assets.ts";
import { getAssetDependencies } from "@cinemaItor/db/asset_dependencies.ts";
import { getContentStore } from "@cinemaItor/storage/content_store.ts";
import { mediaTypeFor } from "@cinemaItor/storage/media_types.ts";
import { loadConfig } from "@cinemaItor/config.ts";
import { readRawUpload } from "@cinemaItor/routes/upload.ts";
import { queueProxyGeneration } from "@cinemaItor/services/job_runner.ts";
import {
  type AssetReferenceInput,
  generateIntoAsset,
  generateNewAsset,
} from "@cinemaItor/services/asset_generation.ts";
import {
  clampThumbnailWidth,
  generateThumbnail,
  quantizeTimestamp,
  THUMBNAIL_WIDTH_DEFAULT,
  thumbnailCachePath,
  ThumbnailGenerationError,
  thumbnailKindFor,
  ThumbnailUnavailableError,
} from "@cinemaItor/services/thumbnails.ts";
import {
  AppError,
  badRequest,
  ERROR_CODES,
  forbidden,
  notFound,
  unauthorized,
} from "@cinemaItor/errors.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { errorResponses, ref } from "@cinemaItor/openapi/types.ts";

const SLUG_RE = /^[a-z0-9][a-z0-9_]{0,63}$/;
const ASSET_TYPE_RE = /^[a-z0-9][a-z0-9_+-]{0,49}$/;
const TAG_RE = /^[a-z0-9][a-z0-9_+-]{0,39}$/;
const UPDATABLE_STATUSES = ["draft", "approved", "rejected", "archived"];

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

function requireSlug(body: Record<string, unknown>, key: string): string {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  if (!value) throw badRequest(`${key} is required`);
  if (!SLUG_RE.test(value)) {
    throw badRequest(
      `${key} must match ${SLUG_RE} (lowercase letters, digits, underscore; max 64)`,
    );
  }
  return value;
}

function requireDisplayName(
  body: Record<string, unknown>,
): string {
  const value = typeof body.display_name === "string" ? body.display_name.trim() : "";
  if (!value) throw badRequest("display_name is required");
  if (value.length > 200) throw badRequest("display_name must be at most 200 characters");
  return value;
}

function requireAssetType(
  body: Record<string, unknown>,
): string {
  const value = typeof body.asset_type === "string" ? body.asset_type.trim() : "";
  if (!value) throw badRequest("asset_type is required");
  if (!ASSET_TYPE_RE.test(value)) {
    throw badRequest("asset_type must match [a-z0-9_+-], max 50 characters");
  }
  return value;
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value) {
    throw badRequest(`${key} must be a string`);
  }
  return value;
}

function nullableString(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw badRequest(`${key} must be a string or null`);
  }
  return value;
}

function validateAssetInput(body: Record<string, unknown>): AssetInput {
  const scope = body.library_scope;
  if (scope !== undefined && scope !== "global" && scope !== "project") {
    throw badRequest("library_scope must be 'global' or 'project'");
  }
  return {
    unique_slug: requireSlug(body, "unique_slug"),
    display_name: requireDisplayName(body),
    asset_type: requireAssetType(body),
    library_scope: (scope as "global" | "project" | undefined) ?? "global",
    project_id: optionalString(body, "project_id"),
    description: nullableString(body, "description"),
    license: nullableString(body, "license"),
    rights_status: nullableString(body, "rights_status"),
    attribution: nullableString(body, "attribution"),
  };
}

function validateAssetUpdates(
  body: Record<string, unknown>,
): AssetUpdates {
  const updates: AssetUpdates = {};
  if ("display_name" in body) updates.display_name = requireDisplayName(body);
  if ("asset_type" in body) updates.asset_type = requireAssetType(body);
  if ("description" in body) updates.description = nullableString(body, "description");
  if ("license" in body) updates.license = nullableString(body, "license");
  if ("rights_status" in body) {
    updates.rights_status = nullableString(body, "rights_status");
  }
  if ("attribution" in body) {
    updates.attribution = nullableString(body, "attribution");
  }
  if ("status" in body) {
    const status = body.status;
    if (typeof status !== "string" || !UPDATABLE_STATUSES.includes(status)) {
      throw badRequest(
        `status must be one of: ${UPDATABLE_STATUSES.join(", ")}`,
      );
    }
    updates.status = status;
  }
  if (Object.keys(updates).length === 0) {
    throw badRequest("No valid asset fields to update");
  }
  return updates;
}

function parseReferences(value: unknown): AssetReferenceInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw badRequest("references must be an array");
  if (value.length > 8) throw badRequest("At most 8 references");
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw badRequest(`references[${index}] must be an object`);
    }
    const ref = entry as Record<string, unknown>;
    const assetId = typeof ref.asset_id === "string" ? ref.asset_id.trim() : "";
    if (!assetId) throw badRequest(`references[${index}].asset_id is required`);
    let versionNumber: number | undefined;
    if (ref.version_number !== undefined) {
      if (
        typeof ref.version_number !== "number" ||
        !Number.isInteger(ref.version_number) || ref.version_number < 1
      ) {
        throw badRequest(`references[${index}].version_number must be a positive integer`);
      }
      versionNumber = ref.version_number;
    }
    return { asset_id: assetId, version_number: versionNumber };
  });
}

interface ParamContext extends AuthedContext {
  params: Record<string, string | undefined>;
}

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

function requireAssetId(ctx: ParamContext): string {
  const id = ctx.params.id;
  if (!id) throw notFound("Asset not found");
  return id;
}

function requireAsset(ctx: ParamContext): Asset {
  const asset = getAssetById(requireAssetId(ctx));
  if (!asset || asset.status === "deleted") throw notFound("Asset not found");
  return asset;
}

function assetDetail(asset: Asset): Record<string, unknown> {
  const activeVersion = asset.active_version_id
    ? getAssetVersion(asset.active_version_id)
    : undefined;
  return {
    ...asset,
    aliases: listAliases(asset.id),
    tags: listTags(asset.id),
    active_version: activeVersion ?? null,
  };
}

export const assetRouter = new Router()
  .get("/api/v1/assets", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    const filter: AssetFilter = {
      project_id: search.searchParams.get("project_id") ?? undefined,
      library_scope: (search.searchParams.get("library_scope") as
        | "global"
        | "project"
        | null) ?? undefined,
      asset_type: search.searchParams.get("asset_type") ?? undefined,
      status: search.searchParams.get("status") ?? undefined,
      tag: search.searchParams.get("tag") ?? undefined,
      q: search.searchParams.get("q") ?? undefined,
    };
    ctx.response.body = listAssets(userId, filter);
  })
  .post("/api/v1/assets", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const input = validateAssetInput(await readJsonBody(ctx));
    const asset = createAsset(input, userId);
    ctx.response.status = 201;
    ctx.response.body = assetDetail(asset);
  })
  .post("/api/v1/assets/generate", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const result = generateNewAsset(userId, {
      kind: body.kind,
      prompt: optionalString(body, "prompt"),
      unique_slug: typeof body.unique_slug === "string" ? body.unique_slug : "",
      display_name: optionalString(body, "display_name"),
      asset_type: optionalString(body, "asset_type"),
      library_scope: body.library_scope as "global" | "project" | undefined,
      project_id: optionalString(body, "project_id"),
      model_id: optionalString(body, "model_id"),
      seed: optionalString(body, "seed"),
      candidates: body.candidates,
      references: parseReferences(body.references),
      device: body.device,
    });
    ctx.response.status = 202;
    ctx.response.body = result;
  })
  .post("/api/v1/assets/:id/generate", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const asset = requireAsset(ctx as ParamContext);
    const result = generateIntoAsset(userId, asset.id, {
      kind: body.kind,
      prompt: optionalString(body, "prompt"),
      model_id: optionalString(body, "model_id"),
      seed: optionalString(body, "seed"),
      candidates: body.candidates,
      include_current: body.include_current === true,
      references: parseReferences(body.references),
      device: body.device,
    });
    ctx.response.status = 202;
    ctx.response.body = result;
  })
  .get("/api/v1/assets/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = getAssetAccessible(ctx.params.id, userId);
    if (!asset) throw notFound("Asset not found");
    ctx.response.body = assetDetail(asset);
  })
  .patch("/api/v1/assets/:id", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = requireAsset(ctx);
    if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();

    const updates = validateAssetUpdates(await readJsonBody(ctx));
    const updated = updateAsset(asset.id, userId, updates);
    if (!updated) throw notFound("Asset not found");
    ctx.response.body = assetDetail(updated);
  })
  .delete("/api/v1/assets/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = requireAsset(ctx);
    if (!hasAssetPermission(userId, asset.id, "admin")) throw forbidden();

    const result = deleteAsset(asset.id, userId);
    if (!result) throw notFound("Asset not found");
    ctx.response.body = {
      message: "Asset deleted",
      referenced_by: result.referenced_by,
      warnings: result.referenced_by > 0
        ? [
          `${result.referenced_by} reference(s) point to this deleted asset`,
        ]
        : [],
    };
  })
  .get("/api/v1/assets/:id/dependencies", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = getAssetAccessible(ctx.params.id, userId);
    if (!asset) throw notFound("Asset not found");
    ctx.response.body = getAssetDependencies(asset.id);
  })
  .post("/api/v1/assets/:id/upload", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = requireAsset(ctx);
    if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();

    const maxBytes = loadConfig().uploadMaxBytes;
    const { stream, filename, notes, technicalMetadata } = readRawUpload(ctx, maxBytes);
    const stored = await getContentStore().putStream(stream, filename, maxBytes);
    const type = mediaTypeFor(filename || stored.path);
    const version = createAssetVersion(asset.id, userId, {
      content_hash: stored.hash,
      file_path: stored.path,
      format: type.format,
      mime_type: type.mime,
      file_size: stored.size,
      technical_metadata_json: technicalMetadata,
      notes,
    });
    queueProxyGeneration(asset.id, version, userId, asset.project_id);
    ctx.response.status = 201;
    ctx.response.body = {
      asset: assetDetail(getAssetById(asset.id) as Asset),
      version,
    };
  })
  .post("/api/v1/assets/:id/versions", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = requireAsset(ctx);
    if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();

    const body = await readJsonBody(ctx);
    const hash = typeof body.content_hash === "string" ? body.content_hash : "";
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw badRequest("content_hash must be a 64-character sha256 hex string");
    }
    const storedPath = getContentStore().resolve(hash);
    if (!storedPath) {
      throw badRequest("content_hash is not present in the content store");
    }
    const stat = await Deno.stat(storedPath);
    const type = mediaTypeFor(storedPath);

    const metadataField = body.technical_metadata;
    let technicalMetadata: string | null | undefined;
    if (metadataField !== undefined) {
      if (metadataField === null) {
        technicalMetadata = null;
      } else if (typeof metadataField === "string") {
        try {
          JSON.parse(metadataField);
        } catch {
          throw badRequest("technical_metadata must be valid JSON");
        }
        technicalMetadata = metadataField;
      } else if (typeof metadataField === "object") {
        technicalMetadata = JSON.stringify(metadataField);
      } else {
        throw badRequest("technical_metadata must be an object or JSON string");
      }
    }

    const version = createAssetVersion(asset.id, userId, {
      content_hash: hash,
      file_path: storedPath,
      format: type.format,
      mime_type: type.mime,
      file_size: stat.size,
      technical_metadata_json: technicalMetadata,
      notes: typeof body.notes === "string" ? body.notes : null,
      make_active: body.make_active !== false,
    });
    queueProxyGeneration(asset.id, version, userId, asset.project_id);
    ctx.response.status = 201;
    ctx.response.body = version;
  })
  .get("/api/v1/assets/:id/versions", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = getAssetAccessible(ctx.params.id, userId);
    if (!asset) throw notFound("Asset not found");
    ctx.response.body = listAssetVersions(asset.id);
  })
  .get("/api/v1/assets/:id/versions/:versionId", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = getAssetAccessible(ctx.params.id, userId);
    if (!asset) throw notFound("Asset not found");
    const version = getAssetVersion(ctx.params.versionId);
    if (!version || version.asset_id !== asset.id) {
      throw notFound("Version not found");
    }
    ctx.response.body = version;
  })
  .post(
    "/api/v1/assets/:id/versions/:versionId/restore",
    authMiddleware,
    (ctx, _next) => {
      const userId = requireUserId(ctx);
      const asset = requireAsset(ctx);
      if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();

      const version = restoreAssetVersion(
        asset.id,
        userId,
        ctx.params.versionId,
      );
      if (!version) throw notFound("Version not found");
      ctx.response.body = {
        message: "Version restored",
        asset: assetDetail(getAssetById(asset.id) as Asset),
        version,
      };
    },
  )
  .post("/api/v1/assets/:id/aliases", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = requireAsset(ctx);
    if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();

    const aliasSlug = requireSlug(await readJsonBody(ctx), "alias_slug");
    addAlias(asset.id, userId, aliasSlug);
    ctx.response.status = 201;
    ctx.response.body = {
      message: "Alias added",
      aliases: listAliases(asset.id),
    };
  })
  .delete("/api/v1/assets/:id/aliases/:aliasSlug", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = requireAsset(ctx);
    if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();

    const removed = removeAlias(asset.id, userId, ctx.params.aliasSlug);
    if (!removed) throw notFound("Alias not found");
    ctx.response.body = {
      message: "Alias removed",
      aliases: listAliases(asset.id),
    };
  })
  .post("/api/v1/assets/:id/tags", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = requireAsset(ctx);
    if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();

    const body = await readJsonBody(ctx);
    const tag = typeof body.tag === "string" ? body.tag.trim() : "";
    if (!TAG_RE.test(tag)) {
      throw badRequest("tag must match [a-z0-9_+-], max 40 characters");
    }
    addTag(asset.id, userId, tag);
    ctx.response.status = 201;
    ctx.response.body = { message: "Tag added", tags: listTags(asset.id) };
  })
  .delete("/api/v1/assets/:id/tags/:tag", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = requireAsset(ctx);
    if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();

    const removed = removeTag(asset.id, userId, ctx.params.tag);
    if (!removed) throw notFound("Tag not found");
    ctx.response.body = { message: "Tag removed", tags: listTags(asset.id) };
  })
  .get("/api/v1/assets/:id/preview", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = getAssetAccessible(ctx.params.id, userId);
    if (!asset) throw notFound("Asset not found");

    const versionId = asset.preview_version_id ?? asset.active_version_id;
    if (!versionId) throw notFound("Asset has no versions");
    const version = getAssetVersion(versionId);
    if (!version?.file_path) throw notFound("Version has no stored file");

    const file = await Deno.open(version.file_path).catch(() => {
      throw new AppError(
        ERROR_CODES.MISSING_FILE,
        "Media file is missing from storage",
        { status: 404 },
      );
    });
    const stat = await file.stat();
    ctx.response.status = 200;
    ctx.response.headers.set(
      "content-type",
      version.mime_type ?? "application/octet-stream",
    );
    ctx.response.headers.set("content-length", String(stat.size));
    ctx.response.body = file.readable;
  })
  .get(
    "/api/v1/assets/:id/versions/:versionId/preview",
    authMiddleware,
    async (ctx, _next) => {
      const userId = requireUserId(ctx);
      const asset = getAssetAccessible(ctx.params.id, userId);
      if (!asset) throw notFound("Asset not found");

      const version = getAssetVersion(ctx.params.versionId);
      if (!version || version.asset_id !== asset.id) {
        throw notFound("Version not found");
      }
      if (!version.file_path) throw notFound("Version has no stored file");

      const file = await Deno.open(version.file_path).catch(() => {
        throw new AppError(
          ERROR_CODES.MISSING_FILE,
          "Media file is missing from storage",
          { status: 404 },
        );
      });
      const stat = await file.stat();
      ctx.response.status = 200;
      ctx.response.headers.set(
        "content-type",
        version.mime_type ?? "application/octet-stream",
      );
      ctx.response.headers.set("content-length", String(stat.size));
      ctx.response.body = file.readable;
    },
  )
  .get(
    "/api/v1/assets/:id/versions/:versionId/thumbnail",
    authMiddleware,
    async (ctx, _next) => {
      const userId = requireUserId(ctx);
      const asset = getAssetAccessible(ctx.params.id, userId);
      if (!asset) throw notFound("Asset not found");

      const version = getAssetVersion(ctx.params.versionId);
      if (!version || version.asset_id !== asset.id) {
        throw notFound("Version not found");
      }
      if (!version.file_path) throw notFound("Version has no stored file");

      const kind = thumbnailKindFor(version.mime_type, asset.asset_type);
      if (!kind) throw notFound("This media type has no thumbnails");

      const params = ctx.request.url.searchParams;
      const atRaw = params.get("at");
      const at = atRaw === null || atRaw === "" ? 0 : Number(atRaw);
      if (!Number.isFinite(at) || at < 0) {
        throw badRequest("at must be a non-negative number of seconds");
      }
      const widthRaw = params.get("w");
      const width = clampThumbnailWidth(
        widthRaw === null ? THUMBNAIL_WIDTH_DEFAULT : Number(widthRaw),
      );
      const atQuantized = quantizeTimestamp(at);

      const config = loadConfig();
      const cachePath = thumbnailCachePath(
        config.appDataDir,
        version.id,
        atQuantized,
        width,
      );
      const cachedStat = await Deno.stat(cachePath).catch(() => null);
      const cached = cachedStat !== null && cachedStat.isFile;
      if (!cached) {
        try {
          await generateThumbnail({
            sourcePath: version.file_path,
            kind,
            atSec: atQuantized,
            width,
            outPath: cachePath,
          });
        } catch (error) {
          if (error instanceof ThumbnailUnavailableError) {
            throw new AppError(ERROR_CODES.INTERNAL, error.message, {
              status: 503,
            });
          }
          if (error instanceof ThumbnailGenerationError) {
            throw new AppError(
              ERROR_CODES.GENERATION_FAILED,
              "Thumbnail generation failed",
              { status: 502, details: error.stderr },
            );
          }
          throw error;
        }
      }

      const file = await Deno.open(cachePath).catch(() => {
        throw new AppError(
          ERROR_CODES.MISSING_FILE,
          "Thumbnail file is missing from storage",
          { status: 404 },
        );
      });
      const stat = await file.stat();
      ctx.response.status = 200;
      ctx.response.headers.set("content-type", "image/jpeg");
      ctx.response.headers.set("content-length", String(stat.size));
      ctx.response.headers.set("cache-control", "private, max-age=86400");
      ctx.response.body = file.readable;
    },
  )
  .get("/api/v1/assets/:id/versions/:versionId/proxy", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = getAssetAccessible(ctx.params.id, userId);
    if (!asset) throw notFound("Asset not found");

    const version = getAssetVersion(ctx.params.versionId);
    if (!version || version.asset_id !== asset.id) {
      throw notFound("Version not found");
    }
    if (!version.proxy_path) throw notFound("Proxy is not available");
    const file = await Deno.open(version.proxy_path).catch(() => {
      throw new AppError(
        ERROR_CODES.MISSING_FILE,
        "Proxy file is missing from storage",
        { status: 404 },
      );
    });
    const stat = await file.stat();
    ctx.response.status = 200;
    ctx.response.headers.set(
      "content-type",
      mediaTypeFor(version.proxy_path).mime ?? "application/octet-stream",
    );
    ctx.response.headers.set("content-length", String(stat.size));
    ctx.response.body = file.readable;
  })
  .post("/api/v1/assets/:id/versions/:versionId/proxy", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = requireAsset(ctx);
    if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();

    const version = getAssetVersion(ctx.params.versionId);
    if (!version || version.asset_id !== asset.id) {
      throw notFound("Version not found");
    }
    const job = queueProxyGeneration(asset.id, version, userId, asset.project_id);
    if (!job) throw badRequest("Version is not proxyable");
    ctx.response.status = 202;
    ctx.response.body = { message: "Proxy regeneration queued", job };
  });

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/assets": {
    summary: "List accessible assets",
    parameters: {
      project_id: { schema: { type: "string" }, description: "Only this project's assets" },
      library_scope: {
        schema: { type: "string", enum: ["global", "project"] },
      },
      asset_type: { schema: { type: "string" } },
      status: {
        schema: {
          type: "string",
          enum: ["draft", "approved", "rejected", "archived", "deleted"],
        },
      },
      tag: { schema: { type: "string" } },
      q: {
        schema: { type: "string" },
        description: "Search slugs, display names, aliases and tags",
      },
    },
    responses: {
      200: {
        description: "Accessible assets",
        schema: { type: "array", items: ref("Asset") },
      },
      ...errorResponses(401),
    },
  },
  "POST /api/v1/assets": {
    summary: "Create a metadata-only asset",
    requestBody: { schema: ref("AssetCreateRequest") },
    responses: {
      201: {
        description: "The created asset",
        schema: ref("AssetDetail"),
      },
      ...errorResponses(400, 401, 409),
    },
  },
  "POST /api/v1/assets/generate": {
    summary: "Generate a new image/video asset from a prompt",
    description: "Creates the asset and enqueues a generation job. Without " +
      "references the task is text_to_image / text_to_video; with image or " +
      "video references it becomes image_to_image / image_to_video. " +
      "Candidates are stored as versions of the new asset and picked in the " +
      "review workflow.",
    requestBody: { schema: ref("AssetGenerateRequest") },
    responses: {
      202: {
        description: "The queued job and its target asset",
        schema: ref("AssetGenerateResult"),
      },
      ...errorResponses(400, 401, 404, 409),
    },
  },
  "POST /api/v1/assets/{id}/generate": {
    summary: "Generate/edit an existing asset from a prompt",
    description: "Enqueues a generation job whose candidates are stored as new " +
      "versions of the target asset (the last candidate becomes the active " +
      "version; use the review board to compare and approve). With " +
      "include_current or references the task is image_to_image / " +
      "image_to_video, otherwise text_to_image / text_to_video.",
    requestBody: { schema: ref("AssetEditRequest") },
    responses: {
      202: {
        description: "The queued job and its target asset",
        schema: ref("AssetGenerateResult"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "GET /api/v1/assets/{id}": {
    summary: "Get an asset with its active version, aliases and tags",
    responses: {
      200: { description: "The asset", schema: ref("AssetDetail") },
      ...errorResponses(401, 404),
    },
  },
  "PATCH /api/v1/assets/{id}": {
    summary: "Update asset metadata",
    requestBody: { schema: ref("AssetUpdateRequest") },
    responses: {
      200: { description: "The updated asset", schema: ref("AssetDetail") },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "DELETE /api/v1/assets/{id}": {
    summary: "Delete an asset (soft, with dependency report)",
    description: "Marks the asset deleted and reports how many references still point " +
      "at it (those become 'missing' in the reference audit).",
    responses: {
      200: {
        description: "Deletion result and dangling-reference warning",
        schema: ref("AssetDeleted"),
      },
      ...errorResponses(401, 403, 404),
    },
  },
  "GET /api/v1/assets/{id}/dependencies": {
    summary: "What uses this asset (dependency view)",
    description: "Timeline items, panel/shot pointers and prompt references that " +
      "point at the asset — feeds the 'Used in' view and delete warnings.",
    responses: {
      200: {
        description: "The dependency report",
        schema: ref("AssetDependencies"),
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/assets/{id}/upload": {
    summary: "Upload a new version (raw bytes)",
    description: "The request body is the raw file bytes. Metadata travels in " +
      "headers: X-File-Name (percent-encoded), optional X-Upload-Notes " +
      "(percent-encoded) and optional X-Technical-Metadata " +
      "(percent-encoded JSON object, e.g. provenance). A media proxy is " +
      "queued for the new version.",
    requestBody: {
      description: "Raw file bytes with X-File-Name header",
      contentType: "application/octet-stream",
      schema: { type: "string", format: "binary" },
    },
    responses: {
      201: {
        description: "The asset with its new active version",
        schema: ref("AssetUploadResult"),
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "POST /api/v1/assets/{id}/versions": {
    summary: "Register a version from an existing content-store hash",
    description: "For content that is already in the content store (e.g. produced by " +
      "a job). The hash must be present in the store.",
    requestBody: { schema: ref("AssetVersionHashRequest") },
    responses: {
      201: {
        description: "The new version",
        schema: ref("AssetVersion"),
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "GET /api/v1/assets/{id}/versions": {
    summary: "List all versions of an asset",
    responses: {
      200: {
        description: "All versions",
        schema: { type: "array", items: ref("AssetVersion") },
      },
      ...errorResponses(401, 404),
    },
  },
  "GET /api/v1/assets/{id}/versions/{versionId}": {
    summary: "One version of an asset",
    responses: {
      200: {
        description: "The version",
        schema: ref("AssetVersion"),
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/assets/{id}/versions/{versionId}/restore": {
    summary: "Restore a version (make it active)",
    responses: {
      200: {
        description: "The asset with the restored active version",
        schema: ref("AssetVersionRestored"),
      },
      ...errorResponses(401, 403, 404),
    },
  },
  "POST /api/v1/assets/{id}/aliases": {
    summary: "Add a @alias slug",
    requestBody: {
      schema: {
        type: "object",
        required: ["alias_slug"],
        properties: {
          alias_slug: {
            type: "string",
            pattern: "^[a-z0-9][a-z0-9_]{0,63}$",
          },
        },
      },
    },
    responses: {
      201: {
        description: "All aliases of the asset",
        schema: ref("AssetAliasChange"),
      },
      ...errorResponses(400, 401, 403, 404, 409),
    },
  },
  "DELETE /api/v1/assets/{id}/aliases/{aliasSlug}": {
    summary: "Remove an alias",
    responses: {
      200: {
        description: "Remaining aliases",
        schema: ref("AssetAliasChange"),
      },
      ...errorResponses(401, 403, 404),
    },
  },
  "POST /api/v1/assets/{id}/tags": {
    summary: "Add a tag",
    requestBody: {
      schema: {
        type: "object",
        required: ["tag"],
        properties: {
          tag: {
            type: "string",
            pattern: "^[a-z0-9][a-z0-9_+-]{0,39}$",
          },
        },
      },
    },
    responses: {
      201: {
        description: "All tags of the asset",
        schema: ref("AssetTagChange"),
      },
      ...errorResponses(400, 401, 403, 404, 409),
    },
  },
  "DELETE /api/v1/assets/{id}/tags/{tag}": {
    summary: "Remove a tag",
    responses: {
      200: {
        description: "Remaining tags",
        schema: ref("AssetTagChange"),
      },
      ...errorResponses(401, 403, 404),
    },
  },
  "GET /api/v1/assets/{id}/preview": {
    summary: "Stream the preview (or active) version's media",
    description: "Raw media bytes with the version's MIME type. Serves the " +
      "preview_version when set, else the active version.",
    responses: {
      200: {
        description: "The media file",
        mediaType: "application/octet-stream",
      },
      ...errorResponses(401, 404),
    },
  },
  "GET /api/v1/assets/{id}/versions/{versionId}/preview": {
    summary: "Stream one specific version's media (A/B compare)",
    responses: {
      200: {
        description: "The media file",
        mediaType: "application/octet-stream",
      },
      ...errorResponses(401, 404),
    },
  },
  "GET /api/v1/assets/{id}/versions/{versionId}/thumbnail": {
    summary: "Cached JPEG thumbnail (video frame or scaled image)",
    parameters: {
      at: {
        schema: { type: "number", minimum: 0 },
        description: "Video frame time in seconds (quantized for caching)",
      },
      w: {
        schema: { type: "integer", minimum: 1 },
        description: "Thumbnail width in px (clamped)",
      },
    },
    responses: {
      200: { description: "JPEG thumbnail", mediaType: "image/jpeg" },
      ...errorResponses(400, 401, 404, 502, 503),
    },
  },
  "GET /api/v1/assets/{id}/versions/{versionId}/proxy": {
    summary: "Stream the low-res media proxy of a version",
    responses: {
      200: {
        description: "The proxy file",
        mediaType: "application/octet-stream",
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/assets/{id}/versions/{versionId}/proxy": {
    summary: "Queue proxy regeneration for a version",
    responses: {
      202: {
        description: "The queued proxy job",
        schema: {
          type: "object",
          required: ["message", "job"],
          properties: {
            message: { type: "string" },
            job: { $ref: "#/components/schemas/Job" },
          },
        },
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
};
