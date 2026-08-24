import { Application, type Middleware } from "@oak/oak";
import { router as authRouter } from "@cinemaItor/routes/auth.ts";
import { router as usersRouter } from "@cinemaItor/routes/users.ts";
import { router as invitationsRouter } from "@cinemaItor/routes/invitations.ts";
import { assetRouter } from "@cinemaItor/routes/assets.ts";
import { audioRouter } from "@cinemaItor/routes/audio.ts";
import { jobRouter } from "@cinemaItor/routes/jobs.ts";
import { reviewRouter } from "@cinemaItor/routes/review.ts";
import { renderRouter } from "@cinemaItor/routes/renders.ts";
import { diagnosticsRouter } from "@cinemaItor/routes/diagnostics.ts";
import { timelineRouter } from "@cinemaItor/routes/timelines.ts";
import { modelRouter } from "@cinemaItor/routes/models.ts";
import { sceneRouter } from "@cinemaItor/routes/scenes.ts";
import { storyboardRouter } from "@cinemaItor/routes/storyboards.ts";
import { projectRouter } from "@cinemaItor/routes/projects.ts";
import { skillsRouter } from "@cinemaItor/routes/skills.ts";
import { templateRouter } from "@cinemaItor/routes/templates.ts";
import { promptRouter } from "@cinemaItor/routes/prompts.ts";
import { referenceRouter } from "@cinemaItor/routes/references.ts";
import { healthRouter } from "@cinemaItor/routes/health.ts";
import { router as openApiRouter } from "@cinemaItor/routes/openapi.ts";
import { type AppConfig, loadConfig } from "@cinemaItor/config.ts";
import { createLogger } from "@cinemaItor/logger.ts";
import { createDiagnosticLogSink } from "@cinemaItor/db/diagnostics.ts";
import { errorHandler } from "@cinemaItor/errors.ts";
import { getDb } from "@cinemaItor/db/database.ts";
import { seedSystemSkills } from "@cinemaItor/db/skills.ts";
import { ensureLayout } from "@cinemaItor/storage/paths.ts";
import { type JobRunner, startJobRunner } from "@cinemaItor/services/job_runner.ts";
import { type RenderRunner, startRenderRunner } from "@cinemaItor/services/render_runner.ts";

function corsOriginsFromEnv(): string[] {
  const raw = Deno.env.get("CORS_ORIGINS") ?? "";
  const origins = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return origins.length > 0 ? origins : ["http://localhost:8124"];
}

const CORS_ORIGINS = corsOriginsFromEnv();
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
): Application & { jobRunner?: JobRunner; renderRunner?: RenderRunner } {
  const diagnosticSink = createDiagnosticLogSink();
  const logger = createLogger(config.logLevel, { component: "http" }, diagnosticSink);
  getDb();
  seedSystemSkills();
  ensureLayout(config.appDataDir);

  const jobRunner = startJobRunner({
    gpuConcurrency: config.jobConcurrencyGpu,
    cpuConcurrency: config.jobConcurrencyCpu,
  });
  const renderRunner = startRenderRunner();

  const app = new Application() as Application & {
    jobRunner?: JobRunner;
    renderRunner?: RenderRunner;
  };
  app.jobRunner = jobRunner;
  app.renderRunner = renderRunner;
  app.use(corsMiddleware());
  app.use(requestLogger(logger));
  app.use(errorHandler(logger));
  app.use(healthRouter.routes());
  app.use(authRouter.routes());
  app.use(usersRouter.routes());
  app.use(invitationsRouter.routes());
  app.use(projectRouter.routes());
  app.use(skillsRouter.routes());
  app.use(templateRouter.routes());
  app.use(assetRouter.routes());
  app.use(audioRouter.routes());
  app.use(modelRouter.routes());
  app.use(jobRouter.routes());
  app.use(reviewRouter.routes());
  app.use(renderRouter.routes());
  app.use(diagnosticsRouter.routes());
  app.use(timelineRouter.routes());
  app.use(storyboardRouter.routes());
  app.use(sceneRouter.routes());
  app.use(promptRouter.routes());
  app.use(referenceRouter.routes());
  app.use(openApiRouter.routes());
  app.use(healthRouter.allowedMethods());
  app.use(authRouter.allowedMethods());
  app.use(usersRouter.allowedMethods());
  app.use(skillsRouter.allowedMethods());
  app.use(projectRouter.allowedMethods());
  app.use(assetRouter.allowedMethods());
  app.use(audioRouter.allowedMethods());
  app.use(modelRouter.allowedMethods());
  app.use(jobRouter.allowedMethods());
  app.use(reviewRouter.allowedMethods());
  app.use(renderRouter.allowedMethods());
  app.use(diagnosticsRouter.allowedMethods());
  app.use(timelineRouter.allowedMethods());
  app.use(storyboardRouter.allowedMethods());
  app.use(sceneRouter.allowedMethods());
  app.use(promptRouter.allowedMethods());
  app.use(referenceRouter.allowedMethods());
  app.use(openApiRouter.allowedMethods());

  return app;
}

if (import.meta.main) {
  const config = loadConfig();
  const serverLogger = createLogger(
    config.logLevel,
    { component: "server" },
    createDiagnosticLogSink(),
  );
  const app = createApp(config);
  serverLogger.info("server listening", { port: config.port });
  await app.listen({ port: config.port });
}
