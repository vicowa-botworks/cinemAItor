import { Application, type Middleware } from "@oak/oak";
import { router as authRouter } from "@cinemaItor/routes/auth.ts";
import { movieRouter } from "@cinemaItor/routes/movies.ts";
import { healthRouter } from "@cinemaItor/routes/health.ts";
import { type AppConfig, loadConfig } from "@cinemaItor/config.ts";
import { createLogger } from "@cinemaItor/logger.ts";
import { errorHandler } from "@cinemaItor/errors.ts";
import { getDb } from "@cinemaItor/db/database.ts";

const CORS_ORIGINS = ["http://localhost:8124"];
const CORS_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const CORS_HEADERS = ["Content-Type", "Authorization"];

function corsMiddleware(): Middleware {
  return async (ctx, next) => {
    const origin = ctx.request.headers.get("origin");
    if (origin && CORS_ORIGINS.includes(origin)) {
      ctx.response.headers.set("Access-Control-Allow-Origin", origin);
    }
    ctx.response.headers.set(
      "Access-Control-Allow-Methods",
      CORS_METHODS.join(", "),
    );
    ctx.response.headers.set(
      "Access-Control-Allow-Headers",
      CORS_HEADERS.join(", "),
    );

    if (ctx.request.method === "OPTIONS") {
      ctx.response.status = 204;
      return;
    }
    await next();
  };
}

function requestLogger(logger: ReturnType<typeof createLogger>): Middleware {
  return async (ctx, next) => {
    const start = performance.now();
    await next();
    logger.debug("request", {
      method: ctx.request.method,
      path: ctx.request.url.pathname,
      status: ctx.response.status,
      durationMs: Math.round(performance.now() - start),
    });
  };
}

export function createApp(config: AppConfig = loadConfig()): Application {
  const logger = createLogger(config.logLevel, { component: "http" });
  getDb();

  const app = new Application();
  app.use(corsMiddleware());
  app.use(requestLogger(logger));
  app.use(errorHandler(logger));
  app.use(healthRouter.routes());
  app.use(authRouter.routes());
  app.use(movieRouter.routes());
  app.use(healthRouter.allowedMethods());
  app.use(authRouter.allowedMethods());
  app.use(movieRouter.allowedMethods());

  return app;
}

if (import.meta.main) {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, { component: "server" });
  const app = createApp(config);
  logger.info("server listening", { port: config.port });
  await app.listen({ port: config.port });
}
