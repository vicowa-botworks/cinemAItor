import { getDb } from "./database.ts";
import { badRequest, forbidden, notFound } from "../errors.ts";
import { getUserById } from "./schema.ts";
import { canonicalTaskType, MODEL_TASK_TYPES } from "./models.ts";

// ---------------------------------------------------------------------------
// Definition shape (v1: JSON only, audio generation steps, no code execution)
// ---------------------------------------------------------------------------

export const SKILL_INPUT_TYPES = ["string", "number", "boolean"] as const;
export type SkillInputType = (typeof SKILL_INPUT_TYPES)[number];

export const SKILL_STEP_TYPES = ["music", "voiceover", "sfx"] as const;
export type SkillStepType = (typeof SKILL_STEP_TYPES)[number];

export interface SkillInputSpec {
  type: SkillInputType;
  required?: boolean;
  default?: unknown;
}

export interface SkillStep {
  type: SkillStepType;
  prompt: string;
  model_id?: string | null;
  seed?: string | null;
}

export interface SkillAssistantExample {
  prompt: string;
  notes: string | null;
}

export interface SkillAssistantBlock {
  /** Task types this prompt guidance applies to (non-empty subset when present). */
  model_task_types: string[];
  /** Model ids this guidance applies to. When non-empty the skill matches only
   *  those models (takes precedence over task-type matching). Absent/empty means
   *  "not model-scoped" — task-type matching applies. parseAssistant always
   *  populates it ([] when unspecified). */
  model_ids?: string[];
  guidance: string | null;
  examples: SkillAssistantExample[];
}

export interface SkillDefinition {
  name: string;
  version: string;
  author?: string | null;
  license?: string | null;
  description?: string | null;
  /** Input specs keyed by input name. */
  inputs: Record<string, SkillInputSpec>;
  steps: SkillStep[];
  /** Optional prompt-creation knowledge for the LLM assistant (see docs/llm.md). */
  assistant?: SkillAssistantBlock | null;
}

export interface Skill {
  id: string;
  name: string;
  description: string | null;
  author: string | null;
  version: string;
  definition: SkillDefinition;
  enabled: boolean;
  is_system: boolean;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface SkillVersion {
  id: number;
  skill_id: string;
  version: string;
  definition: SkillDefinition;
  created_by_user_id: number | null;
  created_at: string;
}

export type SkillRunStatus = "running" | "succeeded" | "failed";

export interface SkillRunStep {
  step_index: number;
  kind: SkillStepType;
  job_type: string;
  job_id: string;
  asset_id: string;
  model_id: string;
}

export interface SkillRun {
  id: string;
  skill_id: string;
  project_id: string;
  status: SkillRunStatus;
  inputs: Record<string, unknown>;
  steps: SkillRunStep[];
  error_text: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Definition parsing / validation
// ---------------------------------------------------------------------------

/** Reserved id prefix for system-seeded skills; user-created ids may not use it. */
export const SYSTEM_SKILL_ID_PREFIX = "sys-";

const SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TEMPLATE_PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function validateSkillId(id: unknown, { isSystem = false } = {}): string {
  if (typeof id !== "string" || !SKILL_ID_PATTERN.test(id)) {
    throw badRequest(
      "skill id must be 1-64 chars of a-z, 0-9, '-' or '_' and start with a letter or digit",
    );
  }
  if (!isSystem && id.startsWith(SYSTEM_SKILL_ID_PREFIX)) {
    throw badRequest(`skill id prefix '${SYSTEM_SKILL_ID_PREFIX}' is reserved for system skills`);
  }
  return id;
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} is required (non-empty string)`);
  }
  if (value.trim().length > max) {
    throw badRequest(`${field} must be at most ${max} characters`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw badRequest(`${field} must be at most ${max} characters`);
  }
  return trimmed;
}

function parseInputs(raw: unknown): Record<string, SkillInputSpec> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw badRequest("inputs must be an object keyed by input name");
  }
  const inputs: Record<string, SkillInputSpec> = {};
  for (const [name, spec] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw badRequest(`input name '${name}' is not a valid identifier`);
    }
    const s = spec as Record<string, unknown>;
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      throw badRequest(`input '${name}' must be an object`);
    }
    if (!SKILL_INPUT_TYPES.includes(s.type as SkillInputType)) {
      throw badRequest(
        `input '${name}' type must be one of: ${SKILL_INPUT_TYPES.join(", ")}`,
      );
    }
    const input: SkillInputSpec = { type: s.type as SkillInputType };
    if (s.required !== undefined) {
      if (typeof s.required !== "boolean") {
        throw badRequest(`input '${name}' required must be a boolean`);
      }
      input.required = s.required;
    }
    if (s.default !== undefined) {
      if (!typeMatches(s.type as SkillInputType, s.default)) {
        throw badRequest(`input '${name}' default does not match its type`);
      }
      input.default = s.default;
    }
    if (input.required && input.default !== undefined) {
      throw badRequest(`input '${name}' cannot be both required and have a default`);
    }
    inputs[name] = input;
  }
  return inputs;
}

function typeMatches(type: SkillInputType, value: unknown): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "boolean";
}

function assertKnownPlaceholders(
  text: string,
  inputs: Record<string, SkillInputSpec>,
  where: string,
): void {
  for (const [, name] of text.matchAll(TEMPLATE_PLACEHOLDER)) {
    if (!(name in inputs)) {
      throw badRequest(`${where} references unknown input '{{ ${name}}}'`);
    }
  }
}

function parseSteps(raw: unknown, inputs: Record<string, SkillInputSpec>): SkillStep[] {
  // An empty array is accepted here so that assistant-only skills (prompt
  // knowledge without generation steps) can parse; parseSkillDefinition
  // rejects `steps: []` unless an assistant block is present.
  if (!Array.isArray(raw)) {
    throw badRequest("steps must be an array");
  }
  if (raw.length > 16) {
    throw badRequest("steps allows at most 16 steps");
  }
  return raw.map((entry, index) => {
    const where = `step ${index + 1}`;
    const s = entry as Record<string, unknown>;
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      throw badRequest(`${where} must be an object`);
    }
    if (!SKILL_STEP_TYPES.includes(s.type as SkillStepType)) {
      throw badRequest(`${where} type must be one of: ${SKILL_STEP_TYPES.join(", ")}`);
    }
    const prompt = requireString(s.prompt, `step ${index + 1} prompt`, 2000);
    assertKnownPlaceholders(prompt, inputs, `${where} prompt`);
    const step: SkillStep = { type: s.type as SkillStepType, prompt };
    const modelId = optionalString(s.model_id, `${where} model_id`, 64);
    const seed = optionalString(s.seed, `${where} seed`, 64);
    if (s.model_id !== undefined && s.model_id !== null) step.model_id = modelId;
    if (s.seed !== undefined && s.seed !== null) step.seed = seed;
    return step;
  });
}

/**
 * Parse and validate a raw skill definition (JSON object, e.g. from the
 * `definition` request body field). Throws badRequest with a precise message
 * on any violation.
 */
function parseAssistant(raw: unknown): SkillAssistantBlock | null {
  // null round-trips through definition_json, so accept it as "no block".
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw badRequest("assistant must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;

  const modelTaskTypes: string[] = [];
  const rawTaskTypes = obj.model_task_types;
  if (rawTaskTypes !== undefined) {
    if (!Array.isArray(rawTaskTypes)) {
      throw badRequest("assistant.model_task_types must be an array");
    }
    // [] round-trips through definition_json after normalization, so an empty
    // array is accepted as "not specified" (a block with no task types and no
    // guidance/examples is still rejected below).
    for (const task of rawTaskTypes) {
      const mapped = typeof task === "string" ? canonicalTaskType(task) : null;
      if (!mapped) {
        throw badRequest(
          `assistant.model_task_types contains unknown task type: ${task}. ` +
            `Allowed: ${MODEL_TASK_TYPES.join(", ")}`,
        );
      }
      if (!modelTaskTypes.includes(mapped)) modelTaskTypes.push(mapped);
    }
  }

  const modelIds: string[] = [];
  const rawModelIds = obj.model_ids;
  if (rawModelIds !== undefined) {
    if (!Array.isArray(rawModelIds)) {
      throw badRequest("assistant.model_ids must be an array");
    }
    // [] round-trips as "not model-scoped" (task-type matching still applies).
    for (const id of rawModelIds) {
      if (
        typeof id !== "string" || id.trim().length === 0 || id.length > 64 ||
        /[^\w.-]/.test(id)
      ) {
        throw badRequest(
          `assistant.model_ids must be model id slugs (letters, digits, _ . -) of ` +
            `at most 64 characters, got: ${String(id)}`,
        );
      }
      if (!modelIds.includes(id)) modelIds.push(id);
    }
  }

  let guidance: string | null = null;
  if (obj.guidance !== undefined) {
    if (typeof obj.guidance !== "string") {
      throw badRequest("assistant.guidance must be a string");
    }
    const trimmed = obj.guidance.trim();
    if (trimmed.length > 32000) {
      throw badRequest("assistant.guidance exceeds 32000 characters");
    }
    guidance = trimmed;
  }

  let examples: SkillAssistantExample[] = [];
  if (obj.examples !== undefined) {
    if (!Array.isArray(obj.examples)) {
      throw badRequest("assistant.examples must be an array");
    }
    if (obj.examples.length > 8) {
      throw badRequest("assistant.examples may contain at most 8 items");
    }
    examples = obj.examples.map((entry, index) => {
      const e = entry as Record<string, unknown>;
      if (typeof e !== "object" || e === null || Array.isArray(e)) {
        throw badRequest(`assistant.examples[${index}] must be a JSON object`);
      }
      if (
        typeof e.prompt !== "string" || e.prompt.trim().length === 0 ||
        e.prompt.trim().length > 2000
      ) {
        throw badRequest(
          `assistant.examples[${index}].prompt must be a non-empty string of at most 2000 characters`,
        );
      }
      let notes: string | null = null;
      if (e.notes !== undefined) {
        if (typeof e.notes !== "string" || e.notes.trim().length > 500) {
          throw badRequest(
            `assistant.examples[${index}].notes must be a string of at most 500 characters`,
          );
        }
        notes = e.notes.trim();
      }
      return { prompt: e.prompt.trim(), notes };
    });
  }

  if (guidance === null && examples.length === 0) {
    throw badRequest("assistant must contain guidance or at least one example");
  }
  return { model_task_types: modelTaskTypes, model_ids: modelIds, guidance, examples };
}

export function parseSkillDefinition(raw: unknown): SkillDefinition {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw badRequest("skill definition must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const name = requireString(obj.name, "name", 120);
  const version = requireString(obj.version, "version", 32);
  const author = optionalString(obj.author, "author", 120);
  const license = optionalString(obj.license, "license", 64);
  const description = optionalString(obj.description, "description", 500);
  const inputs = parseInputs(obj.inputs);
  const steps = parseSteps(obj.steps, inputs);
  const assistant = parseAssistant(obj.assistant);
  if (steps.length === 0 && !assistant) {
    throw badRequest(
      "steps must be a non-empty array (or provide an assistant block)",
    );
  }
  return { name, version, author, license, description, inputs, steps, assistant };
}

/**
 * Resolve a caller-supplied input map against the definition: apply
 * defaults, enforce required inputs and type-check every present value
 * (including values that override a default).
 */
export function resolveSkillInputs(
  definition: SkillDefinition,
  provided: unknown,
): Record<string, unknown> {
  let source: Record<string, unknown>;
  if (provided === undefined || provided === null) {
    source = {};
  } else if (typeof provided !== "object" || Array.isArray(provided)) {
    throw badRequest("inputs must be an object keyed by input name");
  } else {
    source = provided as Record<string, unknown>;
  }
  const resolved: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(definition.inputs)) {
    if (!Object.hasOwn(source, name)) {
      if (spec.default !== undefined) {
        resolved[name] = spec.default;
      } else if (spec.required) {
        throw badRequest(`input '${name}' is required`);
      }
      continue;
    }
    const value = source[name];
    if (value === null || !typeMatches(spec.type, value)) {
      throw badRequest(`input '${name}' must be a ${spec.type}`);
    }
    resolved[name] = value;
  }
  for (const name of Object.keys(source)) {
    if (!(name in definition.inputs)) {
      throw badRequest(`unknown input '${name}'`);
    }
  }
  return resolved;
}

/** Replace every `{{ name }}` placeholder in a string with the resolved value. */
export function interpolateText(
  text: string,
  values: Record<string, unknown>,
  where: string,
): string {
  return text.replace(TEMPLATE_PLACEHOLDER, (_match, name: string) => {
    if (!(name in values)) {
      throw badRequest(`${where} references unknown input '{{ ${name}}}'`);
    }
    return String(values[name]);
  });
}

// ---------------------------------------------------------------------------
// System skill seeding
// ---------------------------------------------------------------------------

/** System-seeded skills (the v1 starter set). */
export const SYSTEM_SKILLS: SkillDefinition[] = [
  {
    name: "Tense Score",
    version: "1.0.0",
    author: "cinemAItor",
    license: "MIT",
    description: "Generates a tense cinematic music track for a project.",
    inputs: {
      mood: { type: "string", default: "tense" },
      length: { type: "string", default: "30 seconds" },
    },
    steps: [
      {
        type: "music",
        prompt:
          "Cinematic score in a {{ mood }} mood, {{ length }}, low strings and subtle percussion",
      },
    ],
  },
  {
    name: "Foley Pass",
    version: "1.0.0",
    author: "cinemAItor",
    license: "MIT",
    description: "Generates a realistic SFX pass from a short action description.",
    inputs: {
      action: { type: "string", required: true },
    },
    steps: [{ type: "sfx", prompt: "Realistic foley sound effects: {{ action }}" }],
  },
  {
    name: "Text-to-Video Prompting",
    version: "1.0.0",
    author: "cinemAItor",
    license: "MIT",
    description: "General text-to-video prompting guidance. Not a generation skill — it feeds " +
      "the LLM assistant (see the Models page, LLM Assistant) when enhancing prompts.",
    inputs: {},
    steps: [],
    assistant: {
      model_task_types: ["text_to_video"],
      guidance: "Write prompts as one continuous shot description in present tense. " +
        "Lead with the subject and its main action, then camera: shot size (wide, medium, " +
        "close-up), angle, and movement (static, slow dolly in, tracking, crane, orbit). " +
        "Add lighting and mood (golden hour, overcast, neon, hard side light), then setting " +
        "details. Prefer concrete nouns and strong verbs over abstract adjectives. " +
        "Keep prompts under ~60 words; one subject, one action, one camera move per prompt. " +
        "Avoid text, logos, watermarks, and fast multi-scene cuts in a single prompt.",
      examples: [
        {
          prompt: "Medium shot, slow dolly in on a lighthouse keeper wiping salt from the glass, " +
            "storm light flickering, dark sea churning below",
          notes: "Subject + action first, one camera move, lighting and mood, concrete nouns.",
        },
        {
          prompt: "Wide static shot of an empty train platform at dawn, low fog, a single figure " +
            "walking into frame from the left, muted blue palette",
          notes: "Setting-led prompt; the single slow action keeps the motion coherent.",
        },
      ],
    },
  },
];

/**
 * Idempotently ensure the system skills exist. Called at server bootstrap;
 * `INSERT OR IGNORE` makes it a no-op when the rows are already present.
 */
export function seedSystemSkills(): void {
  const db = getDb();
  const now = nowIso();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO skills
       (id, name, description, author, version, definition_json, enabled, is_system, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, NULL, ?, ?)`,
  );
  const entries = [
    ["sys-tense-score", SYSTEM_SKILLS[0]],
    ["sys-foley-pass", SYSTEM_SKILLS[1]],
    ["sys-t2v-prompting", SYSTEM_SKILLS[2]],
  ] as const;
  for (const [id, definition] of entries) {
    insert.run(
      id,
      definition.name,
      definition.description ?? null,
      definition.author ?? null,
      definition.version,
      JSON.stringify(definition),
      now,
      now,
    );
  }
  seedModelGuideSkills();
}

/**
 * Model-specific prompt guides seeded from vendored markdown files. Each entry
 * becomes a system skill scoped to one model (`assistant.model_ids`) so the
 * guide applies only to that model's generation rather than every model sharing
 * its task types. The markdown stays in the repo (diffable against upstream) and
 * is stored verbatim as the skill's guidance.
 */
const MODEL_GUIDE_SKILLS = [
  {
    id: "sys-minimax-h3-video",
    file: "VIDEO_PROMPT_WRITING_GUIDE_base_en.md",
    name: "MiniMax H3 — Video Prompting",
    author: "MiniMax AI (cinemAItor)",
    license: "MIT",
    description:
      "MiniMax H3 T2VA / I2VA / FL2VA / L2VA final-prompt format and prompt-writing guide.",
    model_ids: ["minimax_h3"],
    model_task_types: ["text_to_video", "image_to_video"],
  },
  {
    id: "sys-minimax-h3-reference",
    file: "VIDEO_PROMPT_WRITING_GUIDE_ref_en.md",
    name: "MiniMax H3 — Reference Prompting",
    author: "MiniMax AI (cinemAItor)",
    license: "MIT",
    description: "MiniMax H3 full-reference mode: six-section rewrite format and reference labels.",
    model_ids: ["minimax_h3"],
    model_task_types: ["image_to_video"],
  },
] as const;

export function seedModelGuideSkills(): void {
  const db = getDb();
  const now = nowIso();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO skills
       (id, name, description, author, version, definition_json, enabled, is_system, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, NULL, ?, ?)`,
  );
  for (const guide of MODEL_GUIDE_SKILLS) {
    const guidance = Deno.readTextFileSync(
      new URL(`./skill_guides/${guide.file}`, import.meta.url),
    );
    const definition = {
      name: guide.name,
      version: "1.0.0",
      author: guide.author,
      license: guide.license,
      description: guide.description,
      inputs: {},
      steps: [],
      assistant: {
        model_ids: [...guide.model_ids],
        model_task_types: [...guide.model_task_types],
        guidance,
        examples: [],
      },
    };
    insert.run(
      guide.id,
      guide.name,
      guide.description,
      guide.author,
      "1.0.0",
      JSON.stringify(definition),
      now,
      now,
    );
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function skillFromRow(row: Record<string, unknown>): Skill {
  const definition = parseSkillDefinition(JSON.parse(String(row.definition_json)));
  return {
    id: String(row.id),
    name: definition.name,
    description: definition.description ?? null,
    author: definition.author ?? null,
    version: definition.version,
    definition,
    enabled: Number(row.enabled) === 1,
    is_system: Number(row.is_system) === 1,
    created_by_user_id: row.created_by_user_id === null ? null : Number(row.created_by_user_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function versionFromRow(row: Record<string, unknown>): SkillVersion {
  return {
    id: Number(row.id),
    skill_id: String(row.skill_id),
    version: String(row.version),
    definition: parseSkillDefinition(JSON.parse(String(row.definition_json))),
    created_by_user_id: row.created_by_user_id === null ? null : Number(row.created_by_user_id),
    created_at: String(row.created_at),
  };
}

function runFromRow(row: Record<string, unknown>): SkillRun {
  return {
    id: String(row.id),
    skill_id: String(row.skill_id),
    project_id: String(row.project_id),
    status: String(row.status) as SkillRunStatus,
    inputs: JSON.parse(String(row.inputs_json ?? "{}")) as Record<string, unknown>,
    steps: JSON.parse(String(row.steps_json ?? "[]")) as SkillRunStep[],
    error_text: row.error_text === null ? null : String(row.error_text),
    created_by_user_id: row.created_by_user_id === null ? null : Number(row.created_by_user_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

function requireManagePermission(userId: number, skill: Skill): void {
  if (skill.is_system && getUserById(userId)?.role !== "admin") {
    throw forbidden("System skills can only be modified by an admin");
  }
  if (
    skill.created_by_user_id !== null && skill.created_by_user_id !== userId &&
    getUserById(userId)?.role !== "admin"
  ) {
    throw forbidden("Only the skill creator or an admin can modify this skill");
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function listSkills(assistantOnly = false): Skill[] {
  const rows = getDb().prepare(
    "SELECT * FROM skills ORDER BY (is_system = 0), name",
  ).all() as unknown as Record<string, unknown>[];
  const skills = rows.map(skillFromRow);
  // `?assistant=1` feeds the assist dialog's prompt-creation-skill picker.
  return assistantOnly ? skills.filter((s) => s.definition.assistant !== null) : skills;
}

export function getSkill(id: string): Skill | undefined {
  const row = getDb()
    .prepare("SELECT * FROM skills WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? skillFromRow(row) : undefined;
}

export function getSkillOrThrow(id: string): Skill {
  const skill = getSkill(id);
  if (!skill) throw notFound("Skill not found");
  return skill;
}

export function createSkill(
  id: string,
  definition: SkillDefinition,
  userId: number,
): Skill {
  validateSkillId(id, { isSystem: false });
  if (getSkill(id)) throw badRequest(`skill id '${id}' already exists`);
  const now = nowIso();
  getDb().prepare(
    `INSERT INTO skills (id, name, description, author, version, definition_json, enabled, is_system, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
  ).run(
    id,
    definition.name,
    definition.description ?? null,
    definition.author ?? null,
    definition.version,
    JSON.stringify(definition),
    userId,
    now,
    now,
  );
  insertSkillVersion(id, definition, userId);
  return getSkillOrThrow(id);
}

/**
 * Replace a skill's definition. Validates first, then updates the row and
 * appends an immutable snapshot to skill_versions.
 */
export function updateSkill(
  id: string,
  definition: SkillDefinition,
  userId: number,
): Skill {
  const skill = getSkillOrThrow(id);
  requireManagePermission(userId, skill);
  const now = nowIso();
  getDb().prepare(
    `UPDATE skills
     SET name = ?, description = ?, author = ?, version = ?, definition_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    definition.name,
    definition.description ?? null,
    definition.author ?? null,
    definition.version,
    JSON.stringify(definition),
    now,
    id,
  );
  insertSkillVersion(id, definition, userId);
  return getSkillOrThrow(id);
}

function insertSkillVersion(
  skillId: string,
  definition: SkillDefinition,
  userId: number,
): void {
  getDb().prepare(
    `INSERT INTO skill_versions (skill_id, version, definition_json, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(skillId, definition.version, JSON.stringify(definition), userId, nowIso());
}

export function setSkillEnabled(id: string, enabled: boolean, userId: number): Skill {
  const skill = getSkillOrThrow(id);
  requireManagePermission(userId, skill);
  getDb().prepare("UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ?")
    .run(enabled ? 1 : 0, nowIso(), id);
  return getSkillOrThrow(id);
}

export function deleteSkill(id: string, userId: number): void {
  const skill = getSkillOrThrow(id);
  requireManagePermission(userId, skill);
  if (skill.is_system) {
    // Survives authorization for admins but is still blocked: a seeded
    // system skill would just come back on the next boot, so refuse cleanly
    // instead of deleting and re-seeding.
    throw forbidden("System skills cannot be deleted");
  }
  getDb().prepare("DELETE FROM skills WHERE id = ?").run(id);
}

export function listSkillVersions(skillId: string): SkillVersion[] {
  getSkillOrThrow(skillId);
  const rows = getDb().prepare(
    "SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY id DESC",
  ).all(skillId) as unknown as Record<string, unknown>[];
  return rows.map(versionFromRow);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export function createRun(
  skillId: string,
  projectId: string,
  inputs: Record<string, unknown>,
  steps: SkillRunStep[],
  userId: number,
): SkillRun {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDb().prepare(
    `INSERT INTO skill_runs (id, skill_id, project_id, status, inputs_json, steps_json, error_text, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?, NULL, ?, ?, ?)`,
  ).run(id, skillId, projectId, JSON.stringify(inputs), JSON.stringify(steps), userId, now, now);
  return getRunOrThrow(id);
}

export function getRun(id: string): SkillRun | undefined {
  const row = getDb()
    .prepare("SELECT * FROM skill_runs WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return settleRun(runFromRow(row));
}

export function getRunOrThrow(id: string): SkillRun {
  const run = getRun(id);
  if (!run) throw notFound("Skill run not found");
  return run;
}

export function getRunForSkill(skillId: string, runId: string): SkillRun | undefined {
  const row = getDb()
    .prepare("SELECT * FROM skill_runs WHERE id = ? AND skill_id = ?")
    .get(runId, skillId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return settleRun(runFromRow(row));
}

export function listRuns(
  skillId: string,
  filter: { project_id?: string } = {},
): SkillRun[] {
  getSkillOrThrow(skillId);
  const params: (string | number)[] = [skillId];
  let sql = "SELECT * FROM skill_runs WHERE skill_id = ?";
  if (filter.project_id) {
    sql += " AND project_id = ?";
    params.push(filter.project_id);
  }
  sql += " ORDER BY created_at DESC, rowid DESC LIMIT 100";
  const rows = getDb().prepare(sql).all(...params) as unknown as Record<string, unknown>[];
  return rows.map((row) => settleRun(runFromRow(row)));
}

/**
 * Lazily finalize a 'running' run once every job it queued reached a
 * terminal state (succeeded when all jobs succeeded, failed otherwise).
 * Re-reading job status per request means finalization survives restarts
 * without an in-process subscription.
 */
export function settleRun(run: SkillRun): SkillRun {
  if (run.status !== "running" || run.steps.length === 0) return run;
  const db = getDb();
  let allTerminal = true;
  let allSucceeded = true;
  let firstError: string | null = null;
  for (const step of run.steps) {
    const job = db.prepare(
      "SELECT status, error_text FROM generation_jobs WHERE id = ?",
    ).get(step.job_id) as { status: string; error_text: string | null } | undefined;
    if (!job) continue;
    if (job.status === "succeeded") continue;
    allSucceeded = false;
    if (firstError === null) {
      firstError = job.error_text ??
        (job.status === "cancelled" ? "job was cancelled" : `job ${job.status}`);
    }
    if (
      job.status !== "succeeded" &&
      job.status !== "failed" && job.status !== "cancelled"
    ) {
      allTerminal = false;
    }
  }
  if (!allTerminal) return run;
  const status: SkillRunStatus = allSucceeded ? "succeeded" : "failed";
  const nextError = allSucceeded ? null : firstError;
  if (nextError !== null && nextError.length > 500) {
    firstError = nextError.slice(0, 500);
  }
  db.prepare(
    "UPDATE skill_runs SET status = ?, error_text = ?, updated_at = ? WHERE id = ? AND status = 'running'",
  ).run(status, allSucceeded ? null : firstError, nowIso(), run.id);
  return { ...run, status, error_text: allSucceeded ? null : firstError };
}
