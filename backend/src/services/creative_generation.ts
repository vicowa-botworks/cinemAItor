import { badRequest, notFound } from "../errors.ts";
import { findModelsForTask, getModel, type Model } from "../db/models.ts";
import { createJob } from "../db/jobs.ts";
import { createAsset, getAssetBySlug, getAssetVersion } from "../db/assets.ts";
import { type CreativePrompt, creativePrompt, getPanel } from "../db/storyboards.ts";
import { creativePromptFor, getScene } from "../db/scenes.ts";
import { listReferencesForSource, type ReferenceRow } from "../db/references.ts";
import { getDb } from "../db/database.ts";

export interface GenerateOptions {
  model_id?: string;
  seed?: string;
  settings?: Record<string, unknown>;
}

function pickModel(taskType: string, modelId: string | undefined): Model {
  if (modelId) {
    const model = getModel(modelId);
    if (!model) throw badRequest("Model not found");
    if (!model.enabled) throw badRequest("Model is disabled");
    if (!model.task_types.includes(taskType)) {
      throw badRequest(
        `Model '${model.name}' does not support task '${taskType}'`,
      );
    }
    return model;
  }
  const candidates = findModelsForTask(taskType);
  if (candidates.length === 0) {
    throw badRequest(
      `No enabled model available for '${taskType}'. Install and enable a model first.`,
    );
  }
  return candidates[0];
}

function referenceInputs(
  rows: ReferenceRow[],
): { asset_id: string; version_number: number }[] {
  const inputs: { asset_id: string; version_number: number }[] = [];
  for (const row of rows) {
    if (row.status !== "resolved" || !row.asset_id || !row.asset_version_id) {
      continue;
    }
    const version = getAssetVersion(row.asset_version_id);
    if (!version) continue;
    inputs.push({
      asset_id: row.asset_id,
      version_number: version.version_number,
    });
  }
  return inputs;
}

export interface PanelGenerateResult {
  job_id: string;
  asset_id: string;
  model_id: string;
  warnings: string[];
}

/** Generate a storyboard panel preview (t2i job with panel references). */
export function generatePanelPreview(
  userId: number,
  panelId: string,
  options: GenerateOptions = {},
): PanelGenerateResult {
  const panel = getPanel(panelId, userId, "write");
  if (!panel) throw notFound("Panel not found");
  const prompt: CreativePrompt | null = creativePrompt(
    "storyboard_panel",
    panelId,
    userId,
  );
  if (!prompt) throw badRequest("Panel has no prompt");

  const model = pickModel("text_to_image", options.model_id);

  // Target asset: one image asset per panel, created on first use.
  const slug = `panel_${panelId.slice(0, 8)}`;
  let asset = getAssetBySlug(slug);
  if (!asset || asset.status === "deleted") {
    asset = createAsset(
      {
        unique_slug: slug,
        display_name: `Panel ${panelId.slice(0, 8)}`,
        asset_type: "image",
        library_scope: "global",
      },
      userId,
    );
  }

  const inputs = referenceInputs(listReferencesForSource("storyboard_panel", prompt.version_id));

  const job = createJob(userId, {
    job_type: "text_to_image",
    model_id: model.id,
    asset_id: asset.id,
    prompt_text: prompt.content,
    seed: options.seed,
    settings: (options.settings ?? {}) as Record<string, unknown>,
    input_asset_versions: inputs,
    storyboard_panel_id: panelId,
  });

  const db = getDb();
  (db.prepare(
    "UPDATE storyboard_panels SET status = 'generating', updated_at = ? WHERE id = ?",
  ).run as (...params: unknown[]) => unknown)(
    new Date().toISOString(),
    panelId,
  );

  return {
    job_id: job.id,
    asset_id: asset.id,
    model_id: model.id,
    warnings: prompt.warnings,
  };
}

export interface SceneGenerateResult {
  job_id: string;
  job_type: "image_to_video" | "text_to_video";
  asset_id: string;
  model_id: string;
  warnings: string[];
}

/**
 * Generate a scene: image-to-video when a linked panel already has a preview
 * image, text-to-video otherwise.
 */
export function generateScene(
  userId: number,
  sceneId: string,
  options: GenerateOptions = {},
): SceneGenerateResult {
  const scene = getScene(sceneId, userId, "write");
  if (!scene) throw notFound("Scene not found");
  const prompt = creativePromptFor("scene", sceneId, userId);
  if (!prompt) throw badRequest("Scene has no prompt");

  const db = getDb();
  const inputRow = db.prepare(
    `SELECT av.asset_id, av.version_number
       FROM storyboard_panels p
       JOIN asset_versions av ON av.id = p.preview_asset_version_id
       WHERE p.linked_scene_id = ?
         AND p.preview_asset_version_id IS NOT NULL
       ORDER BY p.panel_order DESC
       LIMIT 1`,
  ).get(sceneId) as { asset_id: string; version_number: number } | undefined;

  let jobType: "image_to_video" | "text_to_video";
  let model: Model;
  const inputs: { asset_id: string; version_number: number }[] = [];
  if (inputRow) {
    model = pickModel("image_to_video", options.model_id);
    jobType = "image_to_video";
    inputs.push(inputRow);
  } else if (options.model_id) {
    model = pickModel("text_to_video", options.model_id);
    jobType = "text_to_video";
  } else {
    const t2v = findModelsForTask("text_to_video");
    if (t2v.length === 0) {
      throw badRequest(
        "No image input found and no enabled text_to_video model available. " +
          "Generate a linked panel preview first, or install a text_to_video model.",
      );
    }
    model = t2v[0];
    jobType = "text_to_video";
  }

  const slug = `scene_${sceneId.slice(0, 8)}`;
  let asset = getAssetBySlug(slug);
  if (!asset || asset.status === "deleted") {
    asset = createAsset(
      {
        unique_slug: slug,
        display_name: `Scene ${sceneId.slice(0, 8)}`,
        asset_type: "video",
        library_scope: "global",
      },
      userId,
    );
  }

  const job = createJob(userId, {
    job_type: jobType,
    model_id: model.id,
    asset_id: asset.id,
    project_id: scene.project_id,
    scene_id: sceneId,
    prompt_text: prompt.content,
    seed: options.seed,
    settings: (options.settings ?? {}) as Record<string, unknown>,
    input_asset_versions: inputs,
  });

  return {
    job_id: job.id,
    job_type: jobType,
    asset_id: asset.id,
    model_id: model.id,
    warnings: prompt.warnings,
  };
}
