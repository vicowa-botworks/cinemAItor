import { Router } from "@oak/oak/router";
import type { Context, Next } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import {
  createSkill,
  deleteSkill,
  getRunForSkill,
  getSkill,
  getSkillOrThrow,
  listRuns,
  listSkills,
  listSkillVersions,
  parseSkillDefinition,
  setSkillEnabled,
  type SkillDefinition,
  updateSkill,
} from "@cinemaItor/db/skills.ts";
import { runSkill } from "@cinemaItor/services/skill_engine.ts";
import { badRequest, unauthorized } from "@cinemaItor/errors.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { errorResponses, ref } from "@cinemaItor/openapi/types.ts";

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

interface ParamsContext extends AuthedContext {
  params: { id?: string; runId?: string };
}

function param(ctx: ParamsContext, key: "id" | "runId"): string {
  const value = ctx.params[key] ?? "";
  if (!value) throw badRequest("Missing path parameter");
  return value;
}

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  const raw = (await body.json()) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw badRequest("Request body must be a JSON object");
  }
  return raw as Record<string, unknown>;
}

/** The request body must carry a `definition` object. */
function parseDefinitionField(body: Record<string, unknown>): SkillDefinition {
  if (!Object.hasOwn(body, "definition")) {
    throw badRequest("definition field is required");
  }
  return parseSkillDefinition(body.definition);
}

export const skillsRouter = new Router()
  .get("/api/v1/skills", authMiddleware, (ctx, _next) => {
    void requireUserId(ctx);
    // ?assistant=1 narrows the list to prompt-creation skills (an `assistant`
    // block in the definition) for the assist dialog's picker.
    ctx.response.body = listSkills(ctx.request.url.searchParams.get("assistant") === "1");
  })
  .post("/api/v1/skills", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const body = await readJsonBody(ctx);
    const id = body.id;
    if (typeof id !== "string" || !id) {
      throw badRequest("id field is required");
    }
    const skill = updateSkillOrCreate(userId, id, parseDefinitionField(body));
    ctx.response.status = 201;
    ctx.response.body = skill;
  })
  .get("/api/v1/skills/:id", authMiddleware, (ctx: Context, _next: Next) => {
    void requireUserId(ctx);
    ctx.response.body = getSkillOrThrow(param(ctx as ParamsContext, "id"));
  })
  .put("/api/v1/skills/:id", authMiddleware, async (ctx: Context, _next: Next) => {
    const userId = requireUserId(ctx);
    const id = param(ctx as ParamsContext, "id");
    const body = await readJsonBody(ctx);
    ctx.response.body = updateSkill(id, parseDefinitionField(body), userId);
  })
  .delete("/api/v1/skills/:id", authMiddleware, (ctx: Context, _next: Next) => {
    const userId = requireUserId(ctx);
    deleteSkill(param(ctx as ParamsContext, "id"), userId);
    ctx.response.status = 204;
    ctx.response.body = null;
  })
  .post("/api/v1/skills/:id/toggle", authMiddleware, async (ctx: Context, _next: Next) => {
    const userId = requireUserId(ctx);
    const id = param(ctx as ParamsContext, "id");
    const body = await readJsonBody(ctx);
    const enabled = body.enabled;
    if (typeof enabled !== "boolean") {
      throw badRequest("enabled field is required (boolean)");
    }
    ctx.response.body = setSkillEnabled(id, enabled, userId);
  })
  .get("/api/v1/skills/:id/versions", authMiddleware, (ctx: Context, _next: Next) => {
    void requireUserId(ctx);
    ctx.response.body = listSkillVersions(param(ctx as ParamsContext, "id"));
  })
  .post("/api/v1/skills/:id/run", authMiddleware, async (ctx: Context, _next: Next) => {
    const userId = requireUserId(ctx);
    const id = param(ctx as ParamsContext, "id");
    const body = await readJsonBody(ctx);
    const result = runSkill(userId, id, {
      project_id: typeof body.project_id === "string" ? body.project_id : "",
      inputs: body.inputs === undefined ? undefined : (body.inputs as Record<string, unknown>),
    });
    ctx.response.status = 202;
    ctx.response.body = {
      run: result.run,
      jobs: result.jobs.map((j) => ({ ...j })),
    };
  })
  .get(
    "/api/v1/skills/:id/runs",
    authMiddleware,
    (ctx: Context, _next: Next) => {
      void requireUserId(ctx);
      const search = ctx.request.url as unknown as URL;
      const projectId = search.searchParams.get("project_id") ?? undefined;
      ctx.response.body = listRuns(param(ctx as ParamsContext, "id"), { project_id: projectId });
    },
  )
  .get(
    "/api/v1/skills/:id/runs/:runId",
    authMiddleware,
    (ctx: Context, _next: Next) => {
      void requireUserId(ctx);
      const id = param(ctx as ParamsContext, "id");
      const run = getRunForSkill(id, param(ctx as ParamsContext, "runId"));
      if (!run) throw badRequest("Skill run not found");
      ctx.response.body = run;
    },
  );

function updateSkillOrCreate(
  userId: number,
  id: string,
  definition: SkillDefinition,
) {
  // POST is create; an existing id is a conflict (badRequest keeps the error
  // vocabulary small and the message is specific).
  if (getSkill(id)) {
    throw badRequest(`skill id '${id}' already exists`);
  }
  return createSkill(id, definition, userId);
}

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/skills": {
    summary: "List skills (v1: JSON audio-generation definitions)",
    parameters: {
      assistant: {
        schema: { type: "string", enum: ["1"] },
        description:
          'When "1", only skills carrying an assistant block (prompt-creation skills) are listed',
      },
    },
    responses: {
      200: {
        description: "The skills",
        schema: { type: "array", items: ref("Skill") },
      },
      ...errorResponses(401),
    },
  },
  "POST /api/v1/skills": {
    summary: "Create a skill",
    requestBody: { schema: ref("SkillCreateRequest") },
    responses: {
      201: { description: "The created skill", schema: ref("Skill") },
      ...errorResponses(400, 401),
    },
  },
  "GET /api/v1/skills/{id}": {
    summary: "Get one skill",
    responses: {
      200: { description: "The skill", schema: ref("Skill") },
      ...errorResponses(400, 401, 404),
    },
  },
  "PUT /api/v1/skills/{id}": {
    summary: "Replace a skill's definition (snapshots a new version)",
    requestBody: {
      schema: {
        type: "object",
        required: ["definition"],
        properties: { definition: { $ref: "#/components/schemas/SkillDefinition" } },
      },
    },
    responses: {
      200: {
        description: "The updated skill",
        schema: ref("Skill"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "DELETE /api/v1/skills/{id}": {
    summary: "Delete a skill",
    responses: {
      204: { description: "Deleted" },
      ...errorResponses(400, 401, 403, 404),
    },
  },
  "POST /api/v1/skills/{id}/toggle": {
    summary: "Enable or disable a skill",
    requestBody: {
      schema: {
        type: "object",
        required: ["enabled"],
        properties: { enabled: { type: "boolean" } },
      },
    },
    responses: {
      200: {
        description: "The updated skill",
        schema: ref("Skill"),
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "GET /api/v1/skills/{id}/versions": {
    summary: "List a skill's immutable version snapshots",
    responses: {
      200: {
        description: "The versions",
        schema: { type: "array", items: ref("SkillVersion") },
      },
      ...errorResponses(400, 401),
    },
  },
  "POST /api/v1/skills/{id}/run": {
    summary: "Run a skill (one generation job per step)",
    description: "Resolves typed inputs, expands the {{placeholders}} and enqueues " +
      "one generation job per step (all-or-nothing pre-flight). The run " +
      "settles lazily: running → succeeded/failed from the step jobs.",
    requestBody: { schema: ref("SkillRunRequest") },
    responses: {
      202: {
        description: "The run and its step jobs",
        schema: {
          type: "object",
          required: ["run", "jobs"],
          properties: {
            run: { $ref: "#/components/schemas/SkillRun" },
            jobs: { type: "array", items: ref("Job") },
          },
        },
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "GET /api/v1/skills/{id}/runs": {
    summary: "List a skill's runs",
    parameters: {
      project_id: { schema: { type: "string" } },
    },
    responses: {
      200: {
        description: "The runs, newest first",
        schema: { type: "array", items: ref("SkillRun") },
      },
      ...errorResponses(400, 401),
    },
  },
  "GET /api/v1/skills/{id}/runs/{runId}": {
    summary: "Get one skill run",
    responses: {
      200: {
        description: "The run (settled from its step jobs)",
        schema: ref("SkillRun"),
      },
      ...errorResponses(400, 401),
    },
  },
};
