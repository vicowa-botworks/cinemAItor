import { Router } from "@oak/oak/router";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { listTemplates } from "@cinemaItor/db/templates.ts";
import { unauthorized } from "@cinemaItor/errors.ts";

export const templateRouter = new Router().get(
  "/api/v1/templates",
  authMiddleware,
  (ctx, _next) => {
    const userId = (ctx as AuthedContext).userId;
    if (!userId) throw unauthorized("Authentication required");
    ctx.response.body = listTemplates();
  },
);
