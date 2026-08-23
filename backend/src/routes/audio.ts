import { Router } from "@oak/oak/router";
import type { Context, Next } from "@oak/oak";
import { join } from "@std/path";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  type Asset,
  type AssetScope,
  createAsset,
  createAssetVersion,
  getAssetById,
  hasAssetPermission,
  listAssets,
} from "@cinemaItor/db/assets.ts";
import { getDb } from "@cinemaItor/db/database.ts";
import {
  AUDIO_ASSET_TYPES,
  type AudioAssetType,
  getAudioVersion,
  isAudioAssetType,
  setAudioAdjustments,
  setAudioAnalysis,
} from "@cinemaItor/db/audio.ts";
import { getContentStore } from "@cinemaItor/storage/content_store.ts";
import { mediaTypeFor } from "@cinemaItor/storage/media_types.ts";
import { loadConfig } from "@cinemaItor/config.ts";
import {
  analyzeAudioFile,
  AudioAdjustmentError,
  buildAudioMetadata,
  validateAdjustments,
} from "@cinemaItor/services/audio_info.ts";
import { queueProxyGeneration } from "@cinemaItor/services/job_runner.ts";
import {
  AUDIO_GENERATION_KINDS,
  type AudioGenerationKind,
  generateAudio,
  generateSubtitles,
} from "@cinemaItor/services/creative_generation.ts";
import { requestAudioCleanup } from "@cinemaItor/services/audio_cleanup.ts";
import {
  badRequest,
  forbidden,
  notFound,
  serviceUnavailable,
  unauthorized,
} from "@cinemaItor/errors.ts";

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

interface ParamsContext extends AuthedContext {
  params: { id?: string; versionId?: string };
}

function param(ctx: ParamsContext, key: "id" | "versionId"): string {
  const value = ctx.params[key] ?? "";
  if (!value) throw notFound("Not found");
  return value;
}

async function saveUpload(
  ctx: Context,
  file: File,
): Promise<{ stored: { hash: string; path: string; size: number }; tempPath: string }> {
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
  const store = getContentStore();
  const tempPath = join(store.layout.cache, `upload-${crypto.randomUUID()}`);
  const buffer = await file.arrayBuffer();
  await Deno.writeFile(tempPath, new Uint8Array(buffer));
  const stored = await store.put(tempPath, file.name || "audio.bin");
  return { stored, tempPath };
}

function audioTypeFromFormData(formData: FormData): AudioAssetType {
  const raw = formData.get("asset_type");
  const value = typeof raw === "string" && raw ? raw : "audio";
  if (!isAudioAssetType(value)) {
    throw badRequest(`asset_type must be one of: ${AUDIO_ASSET_TYPES.join(", ")}`);
  }
  return value;
}

function readOptionalBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") return Promise.resolve({});
  return body.json() as Promise<Record<string, unknown>>;
}

export const audioRouter = new Router()
  .get("/api/v1/audio/assets", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    const params = search.searchParams;
    const assetType = params.get("asset_type") ?? undefined;
    let assetTypes: string[] = AUDIO_ASSET_TYPES as unknown as string[];
    if (assetType) {
      if (!isAudioAssetType(assetType)) {
        throw badRequest(`asset_type must be one of: ${AUDIO_ASSET_TYPES.join(", ")}`);
      }
      assetTypes = [assetType];
    }
    const results: Asset[] = [];
    for (const type of assetTypes) {
      results.push(
        ...listAssets(userId, {
          asset_type: type,
          project_id: params.get("project_id") ?? undefined,
          library_scope: (params.get("library_scope") as AssetScope) ?? undefined,
        }),
      );
    }
    const unique = new Map(results.map((a) => [a.id, a]));
    ctx.response.body = [...unique.values()];
  })
  .post("/api/v1/audio/generate", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const raw = await readOptionalBody(ctx);
    const kind = raw.kind as AudioGenerationKind;
    if (!AUDIO_GENERATION_KINDS.some((k) => k === kind)) {
      throw badRequest(
        `kind must be one of: ${AUDIO_GENERATION_KINDS.join(", ")}`,
      );
    }
    const result = generateAudio(userId, {
      kind,
      prompt: typeof raw.prompt === "string" ? raw.prompt : "",
      project_id: typeof raw.project_id === "string" ? raw.project_id : undefined,
      scene_id: typeof raw.scene_id === "string" ? raw.scene_id : undefined,
      model_id: typeof raw.model_id === "string" ? raw.model_id : undefined,
      seed: typeof raw.seed === "string" ? raw.seed : undefined,
      settings: raw.settings && typeof raw.settings === "object"
        ? raw.settings as Record<string, unknown>
        : undefined,
    });
    ctx.response.status = 202;
    ctx.response.body = result;
  })
  .post("/api/v1/audio/upload", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = ctx.request.body;
    if (body.type() !== "form-data") {
      throw badRequest("Request body must be multipart form data");
    }
    const formData = await body.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw badRequest("file field is required");
    }
    const media = mediaTypeFor(file.name || "audio.bin");
    if (!media.mime?.startsWith("audio/")) {
      throw badRequest("file must be an audio format (wav, mp3, flac, ogg, m4a, aac)");
    }
    const assetType = audioTypeFromFormData(formData);
    const nameField = formData.get("display_name");
    const displayName = typeof nameField === "string" && nameField.trim()
      ? nameField.trim()
      : (file.name ? file.name.replace(/\.[^.]+$/, "") : "audio");
    const projectField = formData.get("project_id");
    const projectId = typeof projectField === "string" && projectField ? projectField : undefined;
    const notesField = formData.get("notes");
    const notes = typeof notesField === "string" && notesField ? notesField : null;

    const { stored, tempPath } = await saveUpload(ctx, file);
    try {
      const analysis = await analyzeAudioFile(stored.path);
      let uniqueSlug = "audio";
      const db = getDb();
      const exists = (slug: string) =>
        db.prepare("SELECT id FROM assets WHERE unique_slug = ?").get(slug);
      let suffix = 0;
      while (exists(uniqueSlug)) {
        suffix += 1;
        uniqueSlug = `audio_${suffix}`;
      }
      const asset = createAsset(
        {
          unique_slug: uniqueSlug,
          display_name: displayName,
          asset_type: assetType,
          library_scope: projectId ? "project" : "global",
          project_id: projectId ?? null,
        },
        userId,
      );
      const version = createAssetVersion(asset.id, userId, {
        content_hash: stored.hash,
        file_path: stored.path,
        format: media.format,
        mime_type: media.mime,
        file_size: stored.size,
        technical_metadata_json: JSON.stringify(buildAudioMetadata(analysis)),
        notes,
        make_active: true,
      });
      ctx.response.status = 201;
      ctx.response.body = {
        asset: getAssetById(asset.id) ?? asset,
        version,
        audio: getAudioVersion(version.id)?.audio ?? null,
      };
    } finally {
      await Deno.remove(tempPath).catch(() => {});
    }
  })
  .post("/api/v1/audio/assets/:id/versions", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = getAssetById(param(ctx, "id"));
    if (!asset || asset.status === "deleted") throw notFound("Asset not found");
    if (!isAudioAssetType(asset.asset_type)) {
      throw badRequest(`Asset '@${asset.unique_slug}' is not an audio asset`);
    }
    const body = ctx.request.body;
    const type = body.type();

    if (type === "form-data") {
      const formData = await body.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) throw badRequest("file field is required");
      const media = mediaTypeFor(file.name || "audio.bin");
      if (!media.mime?.startsWith("audio/")) {
        throw badRequest("file must be an audio format");
      }
      const { stored, tempPath } = await saveUpload(ctx, file);
      try {
        const analysis = await analyzeAudioFile(stored.path);
        const notesField = formData.get("notes");
        const version = createAssetVersion(asset.id, userId, {
          content_hash: stored.hash,
          file_path: stored.path,
          format: media.format,
          mime_type: media.mime,
          file_size: stored.size,
          technical_metadata_json: JSON.stringify(buildAudioMetadata(analysis)),
          notes: typeof notesField === "string" && notesField ? notesField : null,
          make_active: true,
        });
        queueProxyGeneration(asset.id, version, userId, asset.project_id);
        ctx.response.status = 201;
        ctx.response.body = { version, audio: getAudioVersion(version.id)?.audio ?? null };
      } finally {
        await Deno.remove(tempPath).catch(() => {});
      }
      return;
    }

    // JSON: register a stored hash (no re-upload).
    const jsonBody = await body.json().catch(() => ({})) as Record<string, unknown>;
    const hash = typeof jsonBody.content_hash === "string" ? jsonBody.content_hash : "";
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw badRequest("Provide a multipart file or a valid content_hash");
    }
    const store = getContentStore();
    const storedPath = store.resolve(hash);
    if (!storedPath) {
      throw badRequest("content_hash is not present in the content store");
    }
    const media = mediaTypeFor(storedPath);
    if (!media.mime?.startsWith("audio/")) {
      throw badRequest("Stored content is not an audio file");
    }
    const analysis = await analyzeAudioFile(storedPath);
    const notes = typeof jsonBody.notes === "string" ? jsonBody.notes : null;
    const version = createAssetVersion(asset.id, userId, {
      content_hash: hash,
      file_path: storedPath,
      format: media.format,
      mime_type: media.mime,
      file_size: Deno.statSync(storedPath).size,
      technical_metadata_json: JSON.stringify(buildAudioMetadata(analysis)),
      notes,
      make_active: true,
    });
    queueProxyGeneration(asset.id, version, userId, asset.project_id);
    ctx.response.status = 201;
    ctx.response.body = { version, audio: getAudioVersion(version.id)?.audio ?? null };
  })
  .patch(
    "/api/v1/audio/assets/:id/versions/:versionId/adjustments",
    authMiddleware,
    async (ctx: Context, _next: Next) => {
      const userId = requireUserId(ctx);
      const asset = getAssetById(param(ctx as ParamsContext, "id"));
      if (!asset || asset.status === "deleted") throw notFound("Asset not found");
      const view = getAudioVersion(param(ctx as ParamsContext, "versionId"));
      if (!view) throw notFound("Asset version not found");
      const versionDb = getDb()
        .prepare("SELECT asset_id FROM asset_versions WHERE id = ?")
        .get(view.version.id) as { asset_id: string };
      if (versionDb.asset_id !== asset.id) {
        throw notFound("Asset version not found");
      }
      if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();

      const body = await readOptionalBody(ctx);
      let adjustments;
      try {
        adjustments = validateAdjustments(body, view.audio?.duration as number | null);
      } catch (err) {
        if (err instanceof AudioAdjustmentError) throw badRequest(err.message);
        throw err;
      }
      const updated = setAudioAdjustments(
        view.version.id,
        adjustments as unknown as Record<string, unknown>,
      );
      if (!updated) throw notFound("Asset version not found");
      ctx.response.body = {
        version: updated.version,
        audio: updated.audio,
      };
    },
  )
  .post(
    "/api/v1/audio/assets/:id/versions/:versionId/cleanup",
    authMiddleware,
    async (ctx, _next) => {
      const userId = requireUserId(ctx);
      const raw = await readOptionalBody(ctx);
      const result = requestAudioCleanup(
        userId,
        param(ctx as ParamsContext, "id"),
        param(ctx as ParamsContext, "versionId"),
        raw,
      );
      ctx.response.status = 202;
      ctx.response.body = result;
    },
  )
  .post(
    "/api/v1/audio/assets/:id/versions/:versionId/subtitles",
    authMiddleware,
    async (ctx, _next) => {
      const userId = requireUserId(ctx);
      const raw = await readOptionalBody(ctx);
      const modelId = typeof raw.model_id === "string" ? raw.model_id : undefined;
      const seed = typeof raw.seed === "string" ? raw.seed : undefined;
      const settings =
        raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings)
          ? (raw.settings as Record<string, unknown>)
          : undefined;
      const result = generateSubtitles(
        userId,
        param(ctx as ParamsContext, "id"),
        param(ctx as ParamsContext, "versionId"),
        { model_id: modelId, seed, settings },
      );
      ctx.response.status = 202;
      ctx.response.body = result;
    },
  )
  .get(
    "/api/v1/audio/assets/:id/versions/:versionId/waveform",
    authMiddleware,
    async (ctx, _next) => {
      await waveformHandler(ctx);
    },
  );

function waveformHandler(ctx: Context): Promise<void> {
  return wrap(ctx);

  async function wrap(ctx: Context): Promise<void> {
    const userId = requireUserId(ctx);
    const asset = getAssetById(param(ctx as ParamsContext, "id"));
    if (!asset || asset.status === "deleted") throw notFound("Asset not found");
    if (!isAudioAssetType(asset.asset_type)) {
      throw badRequest(`Asset '@${asset.unique_slug}' is not an audio asset`);
    }
    const view = getAudioVersion(param(ctx as ParamsContext, "versionId"));
    if (!view) throw notFound("Asset version not found");
    void userId;

    let audio = view.audio;
    const status = audio?.analysis_status as string | undefined;
    if (!audio?.waveform && view.version.file_path) {
      // Try to analyze now if the file is still on disk (e.g. the version
      // was created before ffmpeg became available).
      const reanalysis = await analyzeAudioFile(view.version.file_path);
      if (reanalysis.analysis_status !== status || reanalysis.waveform) {
        const persisted = setAudioAnalysis(
          view.version.id,
          buildAudioMetadata(reanalysis).audio as Record<string, unknown>,
        );
        if (persisted) audio = persisted.audio;
      }
    }
    const waveform = audio?.waveform;
    if (!waveform) {
      throw serviceUnavailable(
        "Audio waveform unavailable (ffmpeg not configured or analysis failed)",
      );
    }
    ctx.response.body = {
      version_id: view.version.id,
      waveform: waveform as { bucket_count: number; peaks: number[] },
      duration: (audio?.duration as number | null) ?? null,
    };
  }
}
