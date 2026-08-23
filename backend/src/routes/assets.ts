import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { join } from "@std/path";
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
import { getContentStore } from "@cinemaItor/storage/content_store.ts";
import { mediaTypeFor } from "@cinemaItor/storage/media_types.ts";
import { loadConfig } from "@cinemaItor/config.ts";
import { queueProxyGeneration } from "@cinemaItor/services/job_runner.ts";
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
  .post("/api/v1/assets/:id/upload", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = requireAsset(ctx);
    if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();

    const body = ctx.request.body;
    if (body.type() !== "form-data") {
      throw badRequest("Request body must be multipart form data");
    }
    const lengthHeader = ctx.request.headers.get("content-length");
    const declaredSize = lengthHeader ? Number(lengthHeader) : 0;
    if (declaredSize > loadConfig().uploadMaxBytes) {
      throw badRequest(
        `Upload exceeds the maximum size of ${loadConfig().uploadMaxBytes} bytes`,
      );
    }

    const formData = await body.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw badRequest("file field is required");
    }
    const notesField = formData.get("notes");
    const notes = typeof notesField === "string" && notesField ? notesField : null;

    const store = getContentStore();
    const tempPath = join(store.layout.cache, `upload-${crypto.randomUUID()}`);
    try {
      const buffer = await file.arrayBuffer();
      await Deno.writeFile(tempPath, new Uint8Array(buffer));
      const stored = await store.put(tempPath, file.name || "upload.bin");
      const type = mediaTypeFor(file.name || stored.path);
      const version = createAssetVersion(asset.id, userId, {
        content_hash: stored.hash,
        file_path: stored.path,
        format: type.format,
        mime_type: type.mime,
        file_size: stored.size,
        notes,
      });
      queueProxyGeneration(asset.id, version, userId, asset.project_id);
      ctx.response.status = 201;
      ctx.response.body = {
        asset: assetDetail(getAssetById(asset.id) as Asset),
        version,
      };
    } finally {
      await Deno.remove(tempPath).catch(() => {});
    }
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
