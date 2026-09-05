import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { storageLayout } from "@cinemaItor/storage/paths.ts";
import { loadConfig } from "@cinemaItor/config.ts";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { getUserById } from "@cinemaItor/db/schema.ts";
import {
  deleteModel,
  getModel,
  listBenchmarkResults,
  listModels,
  MODEL_SOURCES,
  registerModel,
  type RegisterModelInput,
  setModelHealth,
  setModelInstalled,
  updateModel,
  type UpdateModelInput,
} from "@cinemaItor/db/models.ts";
import {
  getInstallProgress,
  installModelById,
  listInstallProgress,
  removeModelFiles,
  verifyModelFile,
} from "@cinemaItor/services/model_files.ts";
import { checkModelHealth } from "@cinemaItor/services/model_health.ts";
import { requestBenchmark } from "@cinemaItor/services/model_benchmark.ts";
import {
  detectHardware,
  invalidateHardwareCache,
  modelRequirementWarnings,
} from "@cinemaItor/services/hardware.ts";
import {
  getHuggingFaceRepo,
  hfEffectiveToken,
  registerModelFromHuggingFace,
  searchHuggingFaceModels,
  testHfToken,
  validateRepoId,
} from "@cinemaItor/services/huggingface.ts";
import { getHfSettingsView, updateHfToken } from "@cinemaItor/db/hf_settings.ts";
import {
  getVramUnloadSettings,
  updateVramUnloadSettings,
} from "@cinemaItor/db/vram_unload_settings.ts";
import {
  detectVramServices,
  freeVram,
  type VramServiceKind,
} from "@cinemaItor/services/vram_free.ts";
import { logAudit } from "@cinemaItor/services/audit.ts";
import { badRequest, forbidden, notFound, unauthorized } from "@cinemaItor/errors.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { errorResponses, ref } from "@cinemaItor/openapi/types.ts";

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

function requireAdmin(ctx: Context): number {
  const userId = requireUserId(ctx);
  const user = getUserById(userId);
  if (!user || user.role !== "admin") {
    throw forbidden("Admin role required for model management");
  }
  return userId;
}

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

interface ParamContext extends AuthedContext {
  params: { id?: string; repoId?: string };
}

function requireIdParam(ctx: ParamContext): string {
  const id = ctx.params.id ?? "";
  if (!id) throw notFound("Model not found");
  return id;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function optionalInt(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw badRequest(`${key} must be a non-negative integer`);
  }
  return value;
}

function stringArray(body: Record<string, unknown>, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw badRequest(`${key} must be an array of strings`);
  }
  return value;
}

function numberArray(body: Record<string, unknown>, key: string): number[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "number" || v < 0)) {
    throw badRequest(`${key} must be an array of non-negative numbers`);
  }
  return value;
}

function jsonObject(
  body: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`${key} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function optionalBool(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw badRequest(`${key} must be a boolean`);
  return value;
}

function layout() {
  return storageLayout(loadConfig().appDataDir);
}

function handleHfSettingsGet(ctx: Context): void {
  requireAdmin(ctx);
  ctx.response.body = getHfSettingsView();
}

async function handleHfSettingsUpdate(ctx: Context): Promise<void> {
  const adminId = requireAdmin(ctx);
  const body = await readJsonBody(ctx);
  if (!("token" in body)) throw badRequest("token is required");
  const token = body.token;
  if (token !== null && (typeof token !== "string" || token.length > 512)) {
    throw badRequest("token must be a string of at most 512 characters, or null to clear");
  }
  const value = token === null ? "" : token.trim();
  const view = updateHfToken(value);
  logAudit(
    adminId,
    "hf.settings_update",
    "setting",
    value ? "token set" : "token cleared",
  );
  ctx.response.body = view;
}

async function handleHfSettingsTest(ctx: Context): Promise<void> {
  requireAdmin(ctx);
  if (!hfEffectiveToken()) {
    throw badRequest(
      "No HuggingFace token configured — set one above or via the HF_TOKEN env variable",
    );
  }
  const name = await testHfToken();
  ctx.response.body = {
    ok: true,
    name,
    source: getHfSettingsView().tokenSource,
  };
}

export const modelRouter = new Router()
  .get("/api/v1/models", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    const params = search.searchParams;
    const enabledParam = params.get("enabled");
    const models = listModels({
      enabled: enabledParam === "true" ? true : enabledParam === "false" ? false : undefined,
      task_type: params.get("task_type") ?? undefined,
      query: params.get("query") ?? undefined,
    });
    ctx.response.body = models;
  })
  .post("/api/v1/models", authMiddleware, async (ctx, _next) => {
    const userId = requireAdmin(ctx);
    const body = await readJsonBody(ctx);
    const input: RegisterModelInput = {
      name: optionalString(body, "name") ?? "",
      version: optionalString(body, "version") ?? "",
      backend: optionalString(body, "backend") as RegisterModelInput["backend"],
      source: optionalString(body, "source") as RegisterModelInput["source"],
      repository_url: optionalString(body, "repository_url"),
      source_path: optionalString(body, "source_path"),
      license: optionalString(body, "license"),
      task_types: stringArray(body, "task_types"),
      input_types: stringArray(body, "input_types"),
      output_types: stringArray(body, "output_types"),
      supported_resolutions: stringArray(body, "supported_resolutions"),
      supported_frame_rates: numberArray(body, "supported_frame_rates"),
      supported_duration: numberArray(body, "supported_duration"),
      vram_requirement_mb: optionalInt(body, "vram_requirement_mb"),
      ram_requirement_mb: optionalInt(body, "ram_requirement_mb"),
      dependencies: stringArray(body, "dependencies"),
      default_settings: jsonObject(body, "default_settings"),
      draft_settings: jsonObject(body, "draft_settings"),
      production_settings: jsonObject(body, "production_settings"),
      known_limitations: stringArray(body, "known_limitations"),
      enabled: optionalBool(body, "enabled"),
    };
    if (
      input.source !== undefined &&
      !MODEL_SOURCES.includes(input.source as (typeof MODEL_SOURCES)[number])
    ) {
      throw badRequest(`source must be one of: ${MODEL_SOURCES.join(", ")}`);
    }
    const model = registerModel(userId, input);
    ctx.response.status = 201;
    ctx.response.body = model;
  })
  .get("/api/v1/models/hardware", authMiddleware, async (ctx, _next) => {
    requireUserId(ctx);
    // ?refresh=1 bypasses the 60s detection cache — the pre-generation VRAM
    // re-check (free-up-VRAM flow) needs a live reading, not a stale one.
    const params = (ctx.request.url as unknown as URL).searchParams;
    if (params.get("refresh") === "1") invalidateHardwareCache();
    const hardware = await detectHardware();
    const warnings = (
      await Promise.all(
        listModels({ enabled: true }).map((m) => modelRequirementWarnings(m, hardware)),
      )
    ).flat();
    ctx.response.body = { hardware, warnings };
  })
  .get("/api/v1/models/huggingface/search", authMiddleware, async (ctx, _next) => {
    requireUserId(ctx);
    const params = (ctx.request.url as unknown as URL).searchParams;
    const query = params.get("q") ?? "";
    const filter = params.get("filter");
    const limitRaw = params.get("limit");
    const limit = limitRaw === null ? 12 : Math.min(50, Math.max(1, Number(limitRaw) || 12));
    const results = await searchHuggingFaceModels(query.trim(), filter, limit);
    ctx.response.body = { results };
  })
  .get("/api/v1/models/huggingface/settings", authMiddleware, (ctx, _next) => {
    handleHfSettingsGet(ctx);
  })
  .patch("/api/v1/models/huggingface/settings", authMiddleware, async (ctx, _next) => {
    await handleHfSettingsUpdate(ctx);
  })
  .post("/api/v1/models/huggingface/settings/test", authMiddleware, async (ctx, _next) => {
    await handleHfSettingsTest(ctx);
  })
  .get("/api/v1/models/huggingface/:repoId", authMiddleware, async (ctx, _next) => {
    requireUserId(ctx);
    const repoId = ((ctx as ParamContext).params.repoId ?? "").trim();
    validateRepoId(repoId);
    ctx.response.body = await getHuggingFaceRepo(repoId);
  })
  .post("/api/v1/models/from-huggingface", authMiddleware, async (ctx, _next) => {
    const userId = requireAdmin(ctx);
    const body = await readJsonBody(ctx);
    const repoId = optionalString(body, "repo_id");
    if (!repoId) throw badRequest("repo_id is required");
    const result = await registerModelFromHuggingFace(userId, repoId, {
      file: optionalString(body, "file"),
      backend: optionalString(body, "backend"),
      name: optionalString(body, "name"),
      version: optionalString(body, "version"),
      task_types: stringArray(body, "task_types"),
      min_vram_mb: optionalInt(body, "min_vram_mb"),
      dependencies: stringArray(body, "dependencies"),
      known_limitations: stringArray(body, "known_limitations"),
      default_settings: jsonObject(body, "default_settings"),
    });
    ctx.response.status = 201;
    ctx.response.body = result;
  })
  .get("/api/v1/models/vram-unload", authMiddleware, (ctx, _next) => {
    // Auth-only (not admin): the booleans feed the pre-generation auto-free
    // guard, which must be able to read the master toggle for every user.
    requireUserId(ctx);
    ctx.response.body = getVramUnloadSettings();
  })
  .patch("/api/v1/models/vram-unload", authMiddleware, async (ctx, _next) => {
    const adminId = requireAdmin(ctx);
    const body = await readJsonBody(ctx);
    const patch: { enabled?: boolean; comfyui?: boolean; llama?: boolean } = {};
    for (const key of ["enabled", "comfyui", "llama"] as const) {
      if (key in body) {
        const value = body[key];
        if (typeof value !== "boolean") throw badRequest(`${key} must be a boolean`);
        patch[key] = value;
      }
    }
    if (Object.keys(patch).length === 0) {
      throw badRequest("at least one of enabled, comfyui or llama is required");
    }
    const view = updateVramUnloadSettings(patch);
    logAudit(adminId, "vram_unload.settings_update", "setting", JSON.stringify(patch));
    ctx.response.body = view;
  })
  .get("/api/v1/models/vram-unload/services", authMiddleware, async (ctx, _next) => {
    requireAdmin(ctx);
    const params = (ctx.request.url as unknown as URL).searchParams;
    ctx.response.body = await detectVramServices(params.get("refresh") === "1");
  })
  .post("/api/v1/models/vram-unload/free", authMiddleware, async (ctx, _next) => {
    const adminId = requireAdmin(ctx);
    const body: Record<string, unknown> = ctx.request.body.type() === "json"
      ? ((await ctx.request.body.json()) as Record<string, unknown>)
      : {};
    let targetKinds: VramServiceKind[] | undefined;
    if (body.targets !== undefined) {
      const valid: VramServiceKind[] = ["comfyui", "llama-server"];
      if (
        !Array.isArray(body.targets) ||
        body.targets.some((t) => !valid.includes(t as VramServiceKind))
      ) {
        throw badRequest("targets must be an array of 'comfyui' and/or 'llama-server'");
      }
      targetKinds = body.targets as VramServiceKind[];
    }
    const { results } = await freeVram(targetKinds);
    logAudit(adminId, "vram_unload.free", "setting", JSON.stringify(targetKinds ?? "all-enabled"));
    ctx.response.body = { results };
  })
  .get("/api/v1/models/install-progress", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    ctx.response.body = { installs: listInstallProgress() };
  })
  .get("/api/v1/models/:id", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const model = getModel(requireIdParam(ctx));
    if (!model) throw notFound("Model not found");
    ctx.response.body = model;
  })
  .patch("/api/v1/models/:id", authMiddleware, async (ctx, _next) => {
    const userId = requireAdmin(ctx);
    const id = requireIdParam(ctx);
    if (!getModel(id)) throw notFound("Model not found");
    const body = await readJsonBody(ctx);
    const patch: UpdateModelInput = {
      name: optionalString(body, "name"),
      version: optionalString(body, "version"),
      license: optionalString(body, "license"),
      backend: optionalString(body, "backend") as UpdateModelInput["backend"],
      repository_url: optionalString(body, "repository_url"),
      source_path: optionalString(body, "source_path"),
      task_types: stringArray(body, "task_types"),
      input_types: stringArray(body, "input_types"),
      output_types: stringArray(body, "output_types"),
      supported_resolutions: stringArray(body, "supported_resolutions"),
      supported_frame_rates: numberArray(body, "supported_frame_rates"),
      supported_duration: numberArray(body, "supported_duration"),
      vram_requirement_mb: optionalInt(body, "vram_requirement_mb"),
      ram_requirement_mb: optionalInt(body, "ram_requirement_mb"),
      dependencies: stringArray(body, "dependencies"),
      default_settings: jsonObject(body, "default_settings"),
      draft_settings: jsonObject(body, "draft_settings"),
      production_settings: jsonObject(body, "production_settings"),
      known_limitations: stringArray(body, "known_limitations"),
      enabled: optionalBool(body, "enabled"),
      agent_auto_approve: optionalBool(body, "agent_auto_approve"),
    };
    const updated = updateModel(userId, id, patch);
    if (!updated) throw notFound("Model not found");
    ctx.response.body = updated;
  })
  .delete("/api/v1/models/:id", authMiddleware, async (ctx, _next) => {
    const userId = requireAdmin(ctx);
    const id = requireIdParam(ctx);
    const model = getModel(id);
    if (!model) throw notFound("Model not found");
    deleteModel(userId, id);
    await removeModelFiles(layout(), id);
    ctx.response.body = { deleted: true, id };
  })
  .post("/api/v1/models/:id/install", authMiddleware, async (ctx, _next) => {
    requireAdmin(ctx);
    const id = requireIdParam(ctx);
    const body = await readJsonBody(ctx);
    const result = await installModelById(id, {
      consent: optionalBool(body, "consent"),
      sourcePath: optionalString(body, "source_path"),
      repositoryUrl: optionalString(body, "repository_url"),
    });
    ctx.response.status = 201;
    ctx.response.body = result;
  })
  .get("/api/v1/models/:id/install-progress", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const id = requireIdParam(ctx);
    if (!getModel(id)) throw notFound("Model not found");
    const progress = getInstallProgress(id);
    ctx.response.body = progress ? { in_progress: true, ...progress } : { in_progress: false };
  })
  .post("/api/v1/models/:id/verify", authMiddleware, async (ctx, _next) => {
    requireUserId(ctx);
    const id = requireIdParam(ctx);
    const model = getModel(id);
    if (!model) throw notFound("Model not found");

    const lay = layout();
    const result = await verifyModelFile(lay, id, model.file_hash);
    let storedModel = model;
    if (result.valid && !model.file_hash && result.fileHash) {
      storedModel = setModelInstalled(id, result.fileHash) ?? model;
    }
    ctx.response.body = { ...result, model: storedModel };
  })
  .post("/api/v1/models/:id/health-check", authMiddleware, async (ctx, _next) => {
    requireUserId(ctx);
    const id = requireIdParam(ctx);
    const model = getModel(id);
    if (!model) throw notFound("Model not found");

    const result = await checkModelHealth(layout(), model);
    const updated = setModelHealth(
      id,
      result.status,
      result.status === "ok" ? null : result.message,
    );
    if (!updated) throw notFound("Model not found");
    ctx.response.body = { ...result, model: updated };
  })
  .post("/api/v1/models/:id/benchmark", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const id = requireIdParam(ctx);
    const result = requestBenchmark(id, userId);
    ctx.response.status = 202;
    ctx.response.body = result;
  })
  .get("/api/v1/models/:id/benchmarks", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const id = requireIdParam(ctx);
    if (!getModel(id)) throw notFound("Model not found");
    ctx.response.body = { benchmarks: listBenchmarkResults(id) };
  });

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/models": {
    summary: "List models in the registry",
    parameters: {
      enabled: {
        schema: { type: "boolean" },
        description: "true/false to filter by enabled state",
      },
      task_type: { schema: { type: "string" } },
      query: { schema: { type: "string" }, description: "Match name / id" },
    },
    responses: {
      200: {
        description: "The models",
        schema: { type: "array", items: ref("Model") },
      },
      ...errorResponses(401),
    },
  },
  "POST /api/v1/models": {
    summary: "Register a model (admin)",
    adminOnly: true,
    requestBody: { schema: ref("ModelCreateRequest") },
    responses: {
      201: { description: "The registered model", schema: ref("Model") },
      ...errorResponses(400, 401, 403),
    },
  },
  "GET /api/v1/models/hardware": {
    summary: "Hardware report + requirement warnings",
    description: "Detects CPU/RAM/GPU/OS and checks every enabled model's " +
      "requirements against it (VRAM/RAM warnings). Results are cached for " +
      "60s; pass refresh=1 to force a live re-probe (used by the " +
      "pre-generation VRAM re-check after the user frees up memory).",
    parameters: {
      refresh: {
        schema: { type: "string", enum: ["1"] },
        description: "Set to 1 to bypass the 60s detection cache and re-probe now",
      },
    },
    responses: {
      200: {
        description: "Hardware and warnings",
        schema: {
          type: "object",
          required: ["hardware", "warnings"],
          properties: {
            hardware: { $ref: "#/components/schemas/HardwareInfo" },
            warnings: {
              type: "array",
              items: {
                type: "object",
                required: ["model_id", "model_name", "warning"],
                properties: {
                  model_id: { type: "string" },
                  model_name: { type: "string" },
                  warning: { type: "string" },
                },
              },
            },
          },
        },
      },
      ...errorResponses(401),
    },
  },
  "GET /api/v1/models/huggingface/search": {
    summary: "Search public HuggingFace model repos",
    description: "Server-side proxy of the public HuggingFace API " +
      "(`https://huggingface.co/api/models`).",
    parameters: {
      q: { schema: { type: "string" }, description: "Free-text search (empty → popular)" },
      filter: {
        schema: { type: "string" },
        description: "Pipeline tag filter, e.g. text-to-image",
      },
      limit: { schema: { type: "integer", minimum: 1, maximum: 50 } },
    },
    responses: {
      200: {
        description: "Matching repos",
        schema: {
          type: "object",
          required: ["results"],
          properties: { results: { $ref: "#/components/schemas/HuggingFaceRepos" } },
        },
      },
      ...errorResponses(401, 502),
    },
  },
  "GET /api/v1/models/huggingface/settings": {
    summary: "HuggingFace token settings (admin)",
    description: "Where the effective HuggingFace token comes from: the admin-stored " +
      "token (this settings row), the `HF_TOKEN` env variable, or neither.",
    adminOnly: true,
    responses: {
      200: {
        description: "Token status",
        schema: ref("HuggingFaceTokenSettings"),
      },
      ...errorResponses(401, 403),
    },
  },
  "PATCH /api/v1/models/huggingface/settings": {
    summary: "Store or clear the HuggingFace token (admin)",
    description: "The stored token is forwarded as a Bearer credential to HuggingFace " +
      "(it takes precedence over the `HF_TOKEN` env variable). Pass `token: null` to clear.",
    adminOnly: true,
    requestBody: { schema: ref("HuggingFaceTokenUpdate") },
    responses: {
      200: {
        description: "Updated token status",
        schema: ref("HuggingFaceTokenSettings"),
      },
      ...errorResponses(400, 401, 403),
    },
  },
  "POST /api/v1/models/huggingface/settings/test": {
    summary: "Test the effective HuggingFace token (admin)",
    description: "Calls HuggingFace `/whoami-v2` with the effective token (stored token, " +
      "else `HF_TOKEN`) and reports the authenticated account.",
    adminOnly: true,
    responses: {
      200: {
        description: "Token accepted",
        schema: ref("HuggingFaceTokenTest"),
      },
      ...errorResponses(400, 401, 403, 502),
    },
  },
  "GET /api/v1/models/huggingface/{repoId}": {
    summary: "HuggingFace repo metadata + file listing",
    description: "Repo id is the percent-encoded `owner/name` (e.g. " +
      "`stabilityai%2Fsd-xl`). Files are the recursive `/tree/main?recursive=true` entries " +
      "with sizes (weights in subfolders such as `vae/` or `transformer/` are included; the " +
      "list is capped at 500 files, weight files always kept — see `filesTruncated`). " +
      "`readme` is a truncated `README.md` excerpt or null.",
    responses: {
      200: {
        description: "Repo metadata, files and README excerpt",
        schema: ref("HuggingFaceRepo"),
      },
      ...errorResponses(400, 401, 404, 502),
    },
  },
  "POST /api/v1/models/from-huggingface": {
    summary: "Register a model row from a HuggingFace repo (admin)",
    description: "Picks the weight file (explicit `file` or the largest " +
      ".safetensors/.gguf/.ckpt/.bin) and registers the model with `source: url` and the " +
      "resolve URL as `repository_url`. Weights are NOT downloaded — install afterwards " +
      "with POST /api/v1/models/{id}/install and consent: true.",
    adminOnly: true,
    requestBody: { schema: ref("HuggingFaceRegisterRequest") },
    responses: {
      201: {
        description: "The registered model + picked file + repo summary",
        schema: {
          type: "object",
          required: ["model", "file", "repo"],
          properties: {
            model: { $ref: "#/components/schemas/Model" },
            file: { type: "string" },
            repo: { $ref: "#/components/schemas/HuggingFaceRepoSummary" },
          },
        },
      },
      ...errorResponses(400, 401, 403, 404, 409, 502),
    },
  },
  "GET /api/v1/models/vram-unload": {
    summary: "VRAM auto-unload settings",
    description: "Master toggle (auto-free local GPU services in the pre-generation VRAM " +
      "guard) + per-target toggles for which detected services to free. Disabled by default. " +
      "Endpoints are auto-detected (not stored). Auth-only: the guard reads the master " +
      "toggle for every user; only admins may change it (PATCH).",
    responses: {
      200: {
        description: "Settings",
        schema: {
          type: "object",
          required: ["enabled", "targets"],
          properties: {
            enabled: { type: "boolean" },
            targets: {
              type: "object",
              required: ["comfyui", "llama"],
              properties: { comfyui: { type: "boolean" }, llama: { type: "boolean" } },
            },
          },
        },
      },
      ...errorResponses(401, 403),
    },
  },
  "PATCH /api/v1/models/vram-unload": {
    summary: "Update VRAM auto-unload settings (admin)",
    adminOnly: true,
    requestBody: {
      schema: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          comfyui: { type: "boolean" },
          llama: { type: "boolean" },
        },
      },
    },
    responses: {
      200: {
        description: "Updated settings",
        schema: {
          type: "object",
          required: ["enabled", "targets"],
          properties: {
            enabled: { type: "boolean" },
            targets: {
              type: "object",
              required: ["comfyui", "llama"],
              properties: { comfyui: { type: "boolean" }, llama: { type: "boolean" } },
            },
          },
        },
      },
      ...errorResponses(400, 401, 403),
    },
  },
  "GET /api/v1/models/vram-unload/services": {
    summary: "Detect local GPU services (admin)",
    description: "Lists the local ComfyUI / llama-server (router) instances found via " +
      "`nvidia-smi` + `/proc/<pid>/cmdline`, with each one's endpoint and VRAM use. Remote " +
      "endpoints never appear (they are not local processes). `?refresh=1` bypasses the " +
      "cache. Empty `services` means no local GPU service is running.",
    adminOnly: true,
    responses: {
      200: {
        description: "Detected services",
        schema: {
          type: "object",
          required: ["platform", "services"],
          properties: {
            platform: { type: "string", nullable: true },
            gpu: { type: "object", nullable: true },
            services: {
              type: "array",
              items: {
                type: "object",
                required: ["kind", "endpoint", "vram_mb", "loaded_models", "unloadable"],
                properties: {
                  kind: { type: "string", enum: ["comfyui", "llama-server"] },
                  endpoint: { type: "string" },
                  vram_mb: { type: "integer" },
                  loaded_models: { type: "array", items: { type: "string" } },
                  router: { type: "object", nullable: true },
                  unloadable: { type: "boolean" },
                },
              },
            },
            detected_at: { type: "string" },
          },
        },
      },
      ...errorResponses(401, 403),
    },
  },
  "POST /api/v1/models/vram-unload/free": {
    summary: "Free VRAM from enabled local services (admin)",
    description: "Frees VRAM now: ComfyUI `POST /free`, and `POST /models/unload` for every " +
      "loaded model on a detected llama router. `targets` narrows which kinds to free; " +
      "omitted means every detected service whose target toggle is on. The master `enabled` " +
      "flag is ignored here (explicit admin action).",
    adminOnly: true,
    requestBody: {
      schema: {
        type: "object",
        properties: {
          targets: {
            type: "array",
            items: { type: "string", enum: ["comfyui", "llama-server"] },
          },
        },
      },
    },
    responses: {
      200: {
        description: "Per-service result",
        schema: {
          type: "object",
          required: ["results"],
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                required: ["kind", "endpoint", "ok", "detail"],
                properties: {
                  kind: { type: "string", enum: ["comfyui", "llama-server"] },
                  endpoint: { type: "string" },
                  ok: { type: "boolean" },
                  detail: { type: "string" },
                  freed_models: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      },
      ...errorResponses(400, 401, 403),
    },
  },
  "GET /api/v1/models/{id}": {
    summary: "Get one model",
    responses: {
      200: { description: "The model", schema: ref("Model") },
      ...errorResponses(401, 404),
    },
  },
  "PATCH /api/v1/models/{id}": {
    summary: "Update a model (admin)",
    adminOnly: true,
    requestBody: { schema: ref("ModelUpdateRequest") },
    responses: {
      200: {
        description: "The updated model",
        schema: ref("Model"),
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "DELETE /api/v1/models/{id}": {
    summary: "Remove a model and its files (admin)",
    adminOnly: true,
    responses: {
      200: {
        description: "Deletion confirmation",
        schema: {
          type: "object",
          required: ["deleted", "id"],
          properties: {
            deleted: { type: "boolean" },
            id: { type: "string" },
          },
        },
      },
      ...errorResponses(401, 403, 404),
    },
  },
  "POST /api/v1/models/{id}/install": {
    summary: "Install a model's files (admin)",
    adminOnly: true,
    description: "Installs from the model's source_path or repository_url. Network " +
      "sources (repository_url) require explicit consent: true " +
      "(MOD-013). Mock backends record the model hash without files.",
    requestBody: {
      schema: {
        type: "object",
        properties: {
          source_path: { type: "string" },
          repository_url: { type: "string" },
          consent: {
            type: "boolean",
            description: "Required true for network sources",
          },
        },
      },
    },
    responses: {
      201: {
        description: "The installed model and install result",
        schema: {
          type: "object",
          required: ["model", "install"],
          properties: {
            model: { $ref: "#/components/schemas/Model" },
            install: {
              type: "object",
              required: ["fileHash", "fileBytes"],
              properties: {
                fileHash: { type: "string" },
                fileBytes: { type: "integer" },
              },
            },
          },
        },
      },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "GET /api/v1/models/install-progress": {
    summary: "List installs currently running (all authenticated users)",
    description: "One entry per in-flight model install (route POST or copilot " +
      "install_model), with live download progress. Lets a reloaded page " +
      "re-attach to an install whose POST request is no longer pending.",
    responses: {
      200: {
        description: "The in-flight installs (empty when idle)",
        schema: {
          type: "object",
          required: ["installs"],
          properties: {
            installs: {
              type: "array",
              items: {
                type: "object",
                required: ["model_id"],
                allOf: [{ $ref: "#/components/schemas/InstallProgress" }],
                properties: {
                  model_id: { type: "string" },
                },
              },
            },
          },
        },
      },
      ...errorResponses(401),
    },
  },
  "GET /api/v1/models/{id}/install-progress": {
    summary: "Live progress of a model install (all authenticated users)",
    description: "`in_progress: false` when no install is running for the model. " +
      "While running, carries the part-file byte count and the remote file " +
      "size when the server advertises one (total_bytes null = indeterminate).",
    responses: {
      200: {
        description: "Idle, or the install progress state",
        schema: {
          anyOf: [
            {
              type: "object",
              required: ["in_progress"],
              properties: {
                in_progress: { type: "boolean", enum: [false] },
              },
            },
            {
              type: "object",
              required: ["in_progress"],
              allOf: [{ $ref: "#/components/schemas/InstallProgress" }],
              properties: {
                in_progress: { type: "boolean", enum: [true] },
              },
            },
          ],
        },
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/models/{id}/verify": {
    summary: "Verify a model's file checksum (SHA-256)",
    description: "Re-hashes the stored file and compares it to the recorded hash. " +
      "If the file is valid but the model has no hash yet, the hash is " +
      "recorded.",
    responses: {
      200: {
        description: "Verification result and the model",
        schema: {
          type: "object",
          required: ["valid", "fileHash", "message", "model"],
          properties: {
            valid: { type: "boolean" },
            fileHash: { type: "string" },
            expectedHash: { type: ["string", "null"] },
            message: { type: "string" },
            model: { $ref: "#/components/schemas/Model" },
          },
        },
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/models/{id}/health-check": {
    summary: "Run a model health check and record the result",
    responses: {
      200: {
        description: "Health result and the updated model",
        schema: {
          type: "object",
          required: ["status", "message", "model"],
          properties: {
            status: { type: "string", enum: ["ok", "error"] },
            message: { type: ["string", "null"] },
            model: { $ref: "#/components/schemas/Model" },
          },
        },
      },
      ...errorResponses(401, 404),
    },
  },
  "POST /api/v1/models/{id}/benchmark": {
    summary: "Queue a benchmark run (any authenticated user)",
    description: "Measurement only — no creative outputs. Uses deterministic per-" +
      "task prompts with 2 candidates each; rows land in " +
      "model_benchmarks. The model must be enabled and installed.",
    responses: {
      202: {
        description: "The benchmark job and the tasks it covers",
        schema: {
          type: "object",
          required: ["job_id", "tasks", "seed"],
          properties: {
            job_id: { type: "string" },
            tasks: { type: "array", items: { type: "string" } },
            seed: { type: "string" },
          },
        },
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "GET /api/v1/models/{id}/benchmarks": {
    summary: "List benchmark results for a model (newest first)",
    responses: {
      200: {
        description: "The benchmark rows (last 20)",
        schema: {
          type: "object",
          required: ["benchmarks"],
          properties: {
            benchmarks: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "id",
                  "model_id",
                  "task_type",
                  "benchmarked_at",
                  "duration_ms",
                  "candidate_count",
                  "output_bytes",
                ],
                properties: {
                  id: { type: "string" },
                  model_id: { type: "string" },
                  task_type: { type: "string" },
                  benchmarked_at: { type: "string" },
                  duration_ms: { type: "number" },
                  candidate_count: { type: "integer" },
                  output_bytes: { type: "integer" },
                  seed: { type: ["string", "null"] },
                  job_id: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      },
      ...errorResponses(401, 404),
    },
  },
};
