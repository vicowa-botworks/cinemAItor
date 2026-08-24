import { Router } from "@oak/oak/router";
import type { Context, Next } from "@oak/oak";
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
import { percentDecode, readRawUpload } from "@cinemaItor/routes/upload.ts";
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
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { errorResponses, ref } from "@cinemaItor/openapi/types.ts";

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

function audioTypeFromHeader(value: string | null): AudioAssetType {
  const raw = value ? percentDecode(value).trim() : "";
  const type = raw !== "" ? raw : "audio";
  if (!isAudioAssetType(type)) {
    throw badRequest(`asset_type must be one of: ${AUDIO_ASSET_TYPES.join(", ")}`);
  }
  return type;
}

function audioHeader(value: string | null): string | null {
  const raw = value ? percentDecode(value).trim() : "";
  return raw !== "" ? raw : null;
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
    const maxBytes = loadConfig().uploadMaxBytes;
    const { stream, filename, notes } = readRawUpload(ctx, maxBytes);
    const media = mediaTypeFor(filename);
    if (!media.mime?.startsWith("audio/")) {
      throw badRequest("file must be an audio format (wav, mp3, flac, ogg, m4a, aac)");
    }
    const assetType = audioTypeFromHeader(ctx.request.headers.get("x-asset-type"));
    const displayName = audioHeader(ctx.request.headers.get("x-display-name")) ??
      (filename.replace(/\.[^.]+$/, "") || "audio");
    const projectId = audioHeader(ctx.request.headers.get("x-project-id")) ?? undefined;

    const stored = await getContentStore().putStream(stream, filename, maxBytes);
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
  })
  .post("/api/v1/audio/assets/:id/versions", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const asset = getAssetById(param(ctx, "id"));
    if (!asset || asset.status === "deleted") throw notFound("Asset not found");
    if (!isAudioAssetType(asset.asset_type)) {
      throw badRequest(`Asset '@${asset.unique_slug}' is not an audio asset`);
    }
    const body = ctx.request.body;
    if (body.type() !== "json") {
      const maxBytes = loadConfig().uploadMaxBytes;
      const { stream, filename, notes } = readRawUpload(ctx, maxBytes);
      const media = mediaTypeFor(filename);
      if (!media.mime?.startsWith("audio/")) {
        throw badRequest("file must be an audio format");
      }
      const stored = await getContentStore().putStream(stream, filename, maxBytes);
      const analysis = await analyzeAudioFile(stored.path);
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
      queueProxyGeneration(asset.id, version, userId, asset.project_id);
      ctx.response.status = 201;
      ctx.response.body = { version, audio: getAudioVersion(version.id)?.audio ?? null };
      return;
    }

    // JSON: register a stored hash (no re-upload).
    if (body.type() !== "json") {
      throw badRequest("Request body must be the raw file bytes or JSON");
    }
    const jsonBody = await body.json().catch(() => ({})) as Record<string, unknown>;
    const hash = typeof jsonBody.content_hash === "string" ? jsonBody.content_hash : "";
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw badRequest("Provide a raw file upload or a valid content_hash");
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

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/audio/assets": {
    summary: "List accessible audio assets",
    description: "Assets whose type is one of audio, music, sfx, voiceover, ambience.",
    parameters: {
      asset_type: {
        schema: {
          type: "string",
          enum: ["audio", "music", "sfx", "voiceover", "ambience"],
        },
        description: "Restrict to one audio type",
      },
      project_id: { schema: { type: "string" } },
      library_scope: {
        schema: { type: "string", enum: ["global", "project"] },
      },
    },
    responses: {
      200: {
        description: "Accessible audio assets",
        schema: { type: "array", items: ref("Asset") },
      },
      ...errorResponses(400, 401),
    },
  },
  "POST /api/v1/audio/generate": {
    summary: "Generate music, voiceover or SFX from a prompt (AUD-009/010/011)",
    description: "Targets a fresh audio asset and enqueues a generation job; the " +
      "candidates are picked in the review workflow. kind maps to the " +
      "job task music / voice / audio.",
    requestBody: { schema: ref("AudioGenerateRequest") },
    responses: {
      202: {
        description: "The queued job and its target asset",
        schema: ref("AudioGenerateResult"),
      },
      ...errorResponses(400, 401, 404, 503),
    },
  },
  "POST /api/v1/audio/upload": {
    summary: "Upload an audio file (creates asset + first version)",
    description: "Raw file bytes (wav, mp3, flac, ogg, m4a, aac) with headers: " +
      "X-File-Name (required, percent-encoded), X-Asset-Type (percent-" +
      "encoded, defaults to 'audio'), X-Display-Name, X-Project-Id, " +
      "X-Upload-Notes — all percent-encoded. A slug is derived " +
      "automatically (audio, audio_2, ...). ffprobe/ffmpeg analysis " +
      "(duration, sample rate, channels, waveform) is best-effort.",
    requestBody: {
      description: "Raw audio bytes with X-File-Name header",
      contentType: "application/octet-stream",
      schema: { type: "string", format: "binary" },
    },
    responses: {
      201: {
        description: "The created asset, version and audio analysis",
        schema: ref("AudioUploadResult"),
      },
      ...errorResponses(400, 401),
    },
  },
  "POST /api/v1/audio/assets/{id}/versions": {
    summary: "Add a version to an audio asset",
    description: "Either raw audio bytes (same header protocol as /audio/upload) or " +
      "JSON registering a content store hash already present.",
    requestBody: {
      description: "Raw audio bytes, or JSON with content_hash (and optional notes)",
      contentType: "application/octet-stream",
      schema: { $ref: "#/components/schemas/AudioVersionCreate" },
    },
    responses: {
      201: {
        description: "The new version and its audio analysis",
        schema: ref("AudioVersionResult"),
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "PATCH /api/v1/audio/assets/{id}/versions/{versionId}/adjustments": {
    summary: "Set non-destructive trim/gain adjustments",
    description: "Applied at render time; the stored media is never modified. " +
      "trim.end must not exceed the known duration.",
    requestBody: { schema: ref("AudioAdjustmentsRequest") },
    responses: {
      200: {
        description: "The version with the stored adjustments",
        schema: ref("AudioVersionResult"),
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "POST /api/v1/audio/assets/{id}/versions/{versionId}/cleanup": {
    summary: "Queue audio cleanup (denoise / normalize, AUD-012)",
    description: "Model-less audio_cleanup job (ffmpeg denoise + EBU R128 normalize, " +
      "mock fallback). The source version stays untouched; the cleaned " +
      "result lands as a new non-active version with cleanup provenance.",
    requestBody: { schema: ref("AudioCleanupRequest") },
    responses: {
      202: {
        description: "The queued cleanup job",
        schema: ref("AudioCleanupResult"),
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "POST /api/v1/audio/assets/{id}/versions/{versionId}/subtitles": {
    summary: "Generate SRT subtitles from the audio (AUD-014)",
    description: "Enqueues a transcribe model job; the SRT candidates land as " +
      "versions on a fresh global subtitle asset and flow through the " +
      "normal review workflow.",
    requestBody: { schema: ref("AudioSubtitleRequest") },
    responses: {
      202: {
        description: "The queued transcription job",
        schema: ref("AudioSubtitleResult"),
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "GET /api/v1/audio/assets/{id}/versions/{versionId}/waveform": {
    summary: "200-bucket waveform peaks of a version",
    description: "If the version was never analyzed and the file is still on disk, " +
      "the analysis runs on demand before answering.",
    responses: {
      200: {
        description: "The waveform",
        schema: {
          type: "object",
          required: ["version_id", "waveform"],
          properties: {
            version_id: { type: "string" },
            waveform: {
              type: "object",
              required: ["bucket_count", "peaks"],
              properties: {
                bucket_count: { type: "integer" },
                peaks: { type: "array", items: { type: "number" } },
              },
            },
            duration: { type: ["number", "null"], description: "Seconds" },
          },
        },
      },
      ...errorResponses(400, 401, 404, 503),
    },
  },
};
