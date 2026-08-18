import { Application } from "@oak/oak";
import { router } from "@cinemaItor/routes/auth.ts";
import { movieRouter } from "@cinemaItor/routes/movies.ts";

const app = new Application();
const PORT = Number(Deno.env.get("PORT") || 8123);

const corsOptions = {
  origin: ["http://localhost:8124"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
};

app.use(async (ctx, next) => {
  const origin = ctx.request.headers.get("origin");
  if (origin && corsOptions.origin.includes(origin)) {
    ctx.response.headers.set("Access-Control-Allow-Origin", origin);
  }
  ctx.response.headers.set(
    "Access-Control-Allow-Methods",
    corsOptions.allowMethods.join(", "),
  );
  ctx.response.headers.set(
    "Access-Control-Allow-Headers",
    corsOptions.allowHeaders.join(", "),
  );

  if (ctx.request.method === "OPTIONS") {
    ctx.response.status = 204;
    return;
  }

  await next();
});

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
    console.error(err);
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

app.use(movieRouter.routes());
app.use(movieRouter.allowedMethods());

console.log(`Server running on http://localhost:${PORT}`);

await app.listen({ port: PORT });
