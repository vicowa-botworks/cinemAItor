import { Router } from "@oak/oak/router";
import { APP_VERSION } from "@cinemaItor/config.ts";

export const healthRouter = new Router().get("/api/v1/health", (ctx, _next) => {
  ctx.response.body = {
    status: "ok",
    name: "cinemaItor",
    version: APP_VERSION,
    time: new Date().toISOString(),
  };
});
