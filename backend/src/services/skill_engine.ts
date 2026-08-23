import {
  createRun,
  getSkillOrThrow,
  interpolateText,
  resolveSkillInputs,
  type SkillRun,
  type SkillRunStep,
  type SkillStep,
} from "@cinemaItor/db/skills.ts";
import {
  AUDIO_KIND_TASK_TYPES,
  type AudioGenerationKind,
  generateAudio,
} from "@cinemaItor/services/creative_generation.ts";
import { findModelsForTask, getModel } from "@cinemaItor/db/models.ts";
import { badRequest } from "@cinemaItor/errors.ts";

function requireModelForStep(step: SkillStep, index: number): void {
  const taskType = AUDIO_KIND_TASK_TYPES[step.type as AudioGenerationKind];
  const where = `step ${index + 1} (${step.type})`;
  if (step.model_id) {
    const model = getModel(step.model_id);
    if (!model) {
      throw badRequest(`${where} references unknown model '${step.model_id}'`);
    }
    if (!model.enabled) {
      throw badRequest(`${where} model '${step.model_id}' is not enabled`);
    }
    if (!model.task_types.includes(taskType)) {
      throw badRequest(
        `${where} model '${step.model_id}' does not support task type '${taskType}'`,
      );
    }
    return;
  }
  if (findModelsForTask(taskType).length === 0) {
    throw badRequest(
      `no enabled model supports task type '${taskType}' required by ${where}`,
    );
  }
}

/**
 * Execute a skill: resolve + validate inputs, pre-check model availability,
 * pre-interpolated prompts and enqueue one generation job per step. The run
 * row is created only after every step is enqueued, so a validation failure
 * never leaves a half-run behind.
 *
 * Note: generateAudio itself re-checks project write permission and
 * re-resolves the model, so the pre-checks here only improve the error
 * message (all steps fail with a single 400 instead of a partial success).
 */
export function runSkill(
  userId: number,
  skillId: string,
  request: { project_id: string; inputs?: Record<string, unknown> },
): { run: SkillRun; jobs: { step_index: number; job_id: string; asset_id: string }[] } {
  const skill = getSkillOrThrow(skillId);
  if (!skill.enabled) {
    throw badRequest(`skill '${skillId}' is disabled`);
  }
  if (!request.project_id || typeof request.project_id !== "string") {
    throw badRequest("project_id is required");
  }
  const resolved = resolveSkillInputs(skill.definition, request.inputs);
  skill.definition.steps.forEach(requireModelForStep);

  const steps: SkillRunStep[] = [];
  const jobs: { step_index: number; job_id: string; asset_id: string }[] = [];
  skill.definition.steps.forEach((step, index) => {
    const result = generateAudio(
      userId,
      {
        kind: step.type as AudioGenerationKind,
        prompt: interpolateText(step.prompt, resolved, `step ${index + 1} prompt`),
        project_id: request.project_id,
        model_id: step.model_id ?? undefined,
        seed: step.seed ?? undefined,
      },
    );
    steps.push({
      step_index: index,
      kind: step.type,
      job_type: result.job_type,
      job_id: result.job_id,
      asset_id: result.asset_id,
      model_id: result.model_id,
    });
    jobs.push({ step_index: index, job_id: result.job_id, asset_id: result.asset_id });
  });

  const run = createRun(skillId, request.project_id, resolved, steps, userId);
  return { run, jobs };
}
