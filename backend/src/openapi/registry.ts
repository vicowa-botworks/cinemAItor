/**
 * Aggregates the routers and their OpenAPI operation metadata for the spec
 * builder. Everything is exposed as functions (not module-level values) so
 * the openapi route module can be part of the registry without a
 * circular-initialization problem: by the time buildOpenApiSpec() runs, all
 * route modules are fully evaluated.
 */

import type { Router } from "@oak/oak/router";
import type { OperationMeta } from "./types.ts";

import { router as authRouter } from "@cinemaItor/routes/auth.ts";
import { openApiOps as authOps } from "@cinemaItor/routes/auth.ts";
import { router as usersRouter } from "@cinemaItor/routes/users.ts";
import { openApiOps as usersOps } from "@cinemaItor/routes/users.ts";
import { router as invitationsRouter } from "@cinemaItor/routes/invitations.ts";
import { openApiOps as invitationsOps } from "@cinemaItor/routes/invitations.ts";
import { healthRouter } from "@cinemaItor/routes/health.ts";
import { openApiOps as healthOps } from "@cinemaItor/routes/health.ts";
import { projectRouter } from "@cinemaItor/routes/projects.ts";
import { openApiOps as projectOps } from "@cinemaItor/routes/projects.ts";
import { templateRouter } from "@cinemaItor/routes/templates.ts";
import { openApiOps as templateOps } from "@cinemaItor/routes/templates.ts";
import { assetRouter } from "@cinemaItor/routes/assets.ts";
import { openApiOps as assetOps } from "@cinemaItor/routes/assets.ts";
import { audioRouter } from "@cinemaItor/routes/audio.ts";
import { openApiOps as audioOps } from "@cinemaItor/routes/audio.ts";
import { modelRouter } from "@cinemaItor/routes/models.ts";
import { openApiOps as modelOps } from "@cinemaItor/routes/models.ts";
import { router as llmRouter } from "@cinemaItor/routes/llm.ts";
import { openApiOps as llmOps } from "@cinemaItor/routes/llm.ts";
import { jobRouter } from "@cinemaItor/routes/jobs.ts";
import { openApiOps as jobOps } from "@cinemaItor/routes/jobs.ts";
import { reviewRouter } from "@cinemaItor/routes/review.ts";
import { openApiOps as reviewOps } from "@cinemaItor/routes/review.ts";
import { skillsRouter as skillRouter } from "@cinemaItor/routes/skills.ts";
import { openApiOps as skillOps } from "@cinemaItor/routes/skills.ts";
import { storyboardRouter } from "@cinemaItor/routes/storyboards.ts";
import { openApiOps as storyboardOps } from "@cinemaItor/routes/storyboards.ts";
import { sceneRouter } from "@cinemaItor/routes/scenes.ts";
import { openApiOps as sceneOps } from "@cinemaItor/routes/scenes.ts";
import { promptRouter } from "@cinemaItor/routes/prompts.ts";
import { openApiOps as promptOps } from "@cinemaItor/routes/prompts.ts";
import { referenceRouter } from "@cinemaItor/routes/references.ts";
import { openApiOps as referenceOps } from "@cinemaItor/routes/references.ts";
import { timelineRouter } from "@cinemaItor/routes/timelines.ts";
import { openApiOps as timelineOps } from "@cinemaItor/routes/timelines.ts";
import { renderRouter } from "@cinemaItor/routes/renders.ts";
import { openApiOps as renderOps } from "@cinemaItor/routes/renders.ts";
import { diagnosticsRouter } from "@cinemaItor/routes/diagnostics.ts";
import { openApiOps as diagnosticsOps } from "@cinemaItor/routes/diagnostics.ts";
import { router as openApiRouter } from "@cinemaItor/routes/openapi.ts";
import { openApiOps as openApiOps } from "@cinemaItor/routes/openapi.ts";

export interface ApiRouterRef {
  tag: string;
  router: Router;
}

/** Every route module mounted by the server, in server.ts order. */
export function apiRouters(): ApiRouterRef[] {
  return [
    { tag: "health", router: healthRouter },
    { tag: "auth", router: authRouter },
    { tag: "users", router: usersRouter },
    { tag: "invitations", router: invitationsRouter },
    { tag: "projects", router: projectRouter },
    { tag: "templates", router: templateRouter },
    { tag: "assets", router: assetRouter },
    { tag: "audio", router: audioRouter },
    { tag: "models", router: modelRouter },
    { tag: "llm", router: llmRouter },
    { tag: "jobs", router: jobRouter },
    { tag: "review", router: reviewRouter },
    { tag: "renders", router: renderRouter },
    { tag: "skills", router: skillRouter },
    { tag: "storyboards", router: storyboardRouter },
    { tag: "scenes", router: sceneRouter },
    { tag: "prompts", router: promptRouter },
    { tag: "references", router: referenceRouter },
    { tag: "timelines", router: timelineRouter },
    { tag: "diagnostics", router: diagnosticsRouter },
    { tag: "openapi", router: openApiRouter },
  ];
}

/**
 * Merge all per-route-module operation metadata, keyed by "METHOD /path".
 * Throws on duplicate keys so two modules cannot document the same route.
 */
export function allOps(): Record<string, OperationMeta> {
  const merged: Record<string, OperationMeta> = {};
  const sources: [string, Record<string, OperationMeta>][] = [
    ["health", healthOps],
    ["auth", authOps],
    ["users", usersOps],
    ["invitations", invitationsOps],
    ["projects", projectOps],
    ["templates", templateOps],
    ["assets", assetOps],
    ["audio", audioOps],
    ["models", modelOps],
    ["llm", llmOps],
    ["jobs", jobOps],
    ["review", reviewOps],
    ["renders", renderOps],
    ["skills", skillOps],
    ["storyboards", storyboardOps],
    ["scenes", sceneOps],
    ["prompts", promptOps],
    ["references", referenceOps],
    ["timelines", timelineOps],
    ["diagnostics", diagnosticsOps],
    ["openapi", openApiOps],
  ];
  for (const [tag, ops] of sources) {
    for (const key of Object.keys(ops)) {
      if (merged[key]) {
        throw new Error(
          `Duplicate OpenAPI operation "${key}" (registered in "${tag}")`,
        );
      }
      merged[key] = ops[key];
    }
  }
  return merged;
}
