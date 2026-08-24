import { Router } from "@oak/oak/router";
import { APP_VERSION } from "@cinemaItor/config.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { ref } from "@cinemaItor/openapi/types.ts";

export const healthRouter = new Router().get("/api/v1/health", (ctx, _next) => {
  ctx.response.body = {
    status: "ok",
    name: "cinemaItor",
    version: APP_VERSION,
    time: new Date().toISOString(),
  };
});

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/health": {
    summary: "Liveness check",
    responses: {
      200: { description: "Service is up", schema: ref("Health") },
    },
  },
};
