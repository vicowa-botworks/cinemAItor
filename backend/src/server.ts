import { Application, type Middleware } from "@oak/oak";
import { router as authRouter } from "@cinemaItor/routes/auth.ts";
import { assetRouter } from "@cinemaItor/routes/assets.ts";
import { jobRouter } from "@cinemaItor/routes/jobs.ts";
import { modelRouter } from "@cinemaItor/routes/models.ts";
import { sceneRouter } from "@cinemaItor/routes/scenes.ts";
import { storyboardRouter } from "@cinemaItor/routes/storyboards.ts";
import { movieRouter } from "@cinemaItor/routes/movies.ts";
import { projectRouter } from "@cinemaItor/routes/projects.ts";
import { promptRouter } from "@cinemaItor/routes/prompts.ts";
import { referenceRouter } from "@cinemaItor/routes/references.ts";
import { healthRouter } from "@cinemaItor/routes/health.ts";
import { type AppConfig, loadConfig } from "@cinemaItor/config.ts";
import { createLogger } from "@cinemaItor/logger.ts";
import { errorHandler } from "@cinemaItor/errors.ts";
import { getDb } from "@cinemaItor/db/database.ts";
import { ensureLayout } from "@cinemaItor/storage/paths.ts";
import { type JobRunner, startJobRunner } from "@cinemaItor/services/job_runner.ts";

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

export function createApp(
  config: AppConfig = loadConfig(),
): Application & { jobRunner?: JobRunner } {
  const logger = createLogger(config.logLevel, { component: "http" });
  getDb();
  ensureLayout(config.appDataDir);

  const jobRunner = startJobRunner({
    gpuConcurrency: config.jobConcurrencyGpu,
    cpuConcurrency: config.jobConcurrencyCpu,
  });

  const app = new Application() as Application & { jobRunner?: JobRunner };
  app.jobRunner = jobRunner;
  app.use(corsMiddleware());
  app.use(requestLogger(logger));
  app.use(errorHandler(logger));
  app.use(healthRouter.routes());
  app.use(authRouter.routes());
  app.use(movieRouter.routes());
  app.use(projectRouter.routes());
  app.use(assetRouter.routes());
  app.use(modelRouter.routes());
  app.use(jobRouter.routes());
  app.use(storyboardRouter.routes());
  app.use(sceneRouter.routes());
  app.use(promptRouter.routes());
  app.use(referenceRouter.routes());
  app.use(healthRouter.allowedMethods());
  app.use(authRouter.allowedMethods());
  app.use(movieRouter.allowedMethods());
  app.use(projectRouter.allowedMethods());
  app.use(assetRouter.allowedMethods());
  app.use(modelRouter.allowedMethods());
  app.use(jobRouter.allowedMethods());
  app.use(storyboardRouter.allowedMethods());
  app.use(sceneRouter.allowedMethods());
  app.use(promptRouter.allowedMethods());
  app.use(referenceRouter.allowedMethods());

  return app;
}

if (import.meta.main) {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, { component: "server" });
  const app = createApp(config);
  logger.info("server listening", { port: config.port });
  await app.listen({ port: config.port });
}
