import { Router } from "@oak/oak/router";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { listTemplates } from "@cinemaItor/db/templates.ts";
import { unauthorized } from "@cinemaItor/errors.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { errorResponses, ref } from "@cinemaItor/openapi/types.ts";

export const templateRouter = new Router().get(
  "/api/v1/templates",
  authMiddleware,
  (ctx, _next) => {
    const userId = (ctx as AuthedContext).userId;
    if (!userId) throw unauthorized("Authentication required");
    ctx.response.body = listTemplates();
  },
);

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/templates": {
    summary: "List system project templates",
    description: "Templates are seeded by the system and read-only. Creating a " +
      "project with a template_id materializes the template's starting " +
      "timeline and tracks.",
    responses: {
      200: {
        description: "All templates",
        schema: { type: "array", items: ref("Template") },
      },
      ...errorResponses(401),
    },
  },
};
