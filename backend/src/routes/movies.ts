import { Router } from "jsr:@oak/oak/router";
import { authMiddleware } from "../middleware/auth.ts";
import * as schema from "../db/schema.ts";

const movieRouter = new Router()
  .get("/api/movies", authMiddleware, async (ctx, next) => {
    const userId = (ctx as any).userId;
    const movies = schema.getUserMovies(userId);
    ctx.response.body = movies;
  })
  .get("/api/movies/:id", authMiddleware, async (ctx, next) => {
    const userId = (ctx as any).userId;
    const id = Number(ctx.params?.id);
    if (isNaN(id)) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid movie ID" };
      return;
    }
    const movie = schema.getMovieById(id, userId);
    if (!movie) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Movie not found" };
      return;
    }
    ctx.response.body = movie;
  })
  .post("/api/movies", authMiddleware, async (ctx, next) => {
    const userId = (ctx as any).userId;
    const body = ctx.request.body;
    if (body.type !== "json") {
      ctx.response.status = 400;
      ctx.response.body = { error: "Request body must be JSON" };
      return;
    }

    const { title, description, genre, year, runtime_minutes, poster_url, backdrop_url } = body.value as Record<string, unknown>;

    if (!title) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Title is required" };
      return;
    }

    const movieId = schema.createMovie(
      title as string,
      userId,
      description as string | undefined,
      genre as string | undefined,
      year as number | undefined,
      runtime_minutes as number | undefined,
      poster_url as string | undefined,
      backdrop_url as string | undefined,
    );

    ctx.response.status = 201;
    ctx.response.body = { id: movieId, title };
  })
  .put("/api/movies/:id", authMiddleware, async (ctx, next) => {
    const userId = (ctx as any).userId;
    const id = Number(ctx.params?.id);
    if (isNaN(id)) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid movie ID" };
      return;
    }

    const existing = schema.getMovieById(id, userId);
    if (!existing) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Movie not found" };
      return;
    }

    const body = ctx.request.body;
    if (body.type !== "json") {
      ctx.response.status = 400;
      ctx.response.body = { error: "Request body must be JSON" };
      return;
    }

    const updates = body.value as Record<string, unknown>;
    const updated = schema.updateMovie(id, userId, updates);
    if (!updated) {
      ctx.response.status = 400;
      ctx.response.body = { error: "No valid fields to update" };
      return;
    }

    ctx.response.body = { message: "Movie updated" };
  })
  .delete("/api/movies/:id", authMiddleware, async (ctx, next) => {
    const userId = (ctx as any).userId;
    const id = Number(ctx.params?.id);
    if (isNaN(id)) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid movie ID" };
      return;
    }

    const deleted = schema.deleteMovie(id, userId);
    if (!deleted) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Movie not found" };
      return;
    }

    ctx.response.body = { message: "Movie deleted" };
  })
  .get("/api/movies/:id/scenes", authMiddleware, async (ctx, next) => {
    const userId = (ctx as any).userId;
    const movieId = Number(ctx.params?.id);
    if (isNaN(movieId)) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid movie ID" };
      return;
    }

    const movie = schema.getMovieById(movieId, userId);
    if (!movie) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Movie not found" };
      return;
    }

    const scenes = schema.getScenesByMovieId(movieId, userId);
    ctx.response.body = scenes;
  })
  .post("/api/movies/:id/scenes", authMiddleware, async (ctx, next) => {
    const userId = (ctx as any).userId;
    const movieId = Number(ctx.params?.id);
    if (isNaN(movieId)) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Invalid movie ID" };
      return;
    }

    const movie = schema.getMovieById(movieId, userId);
    if (!movie) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Movie not found" };
      return;
    }

    const body = ctx.request.body;
    if (body.type !== "json") {
      ctx.response.status = 400;
      ctx.response.body = { error: "Request body must be JSON" };
      return;
    }

    const { scene_number, description, dialogue, visual_description, duration_seconds } = body.value as Record<string, unknown>;

    if (scene_number === undefined || !description) {
      ctx.response.status = 400;
      ctx.response.body = { error: "scene_number and description are required" };
      return;
    }

    const sceneId = schema.createScene(
      movieId,
      userId,
      Number(scene_number),
      description as string,
      dialogue as string | undefined,
      visual_description as string | undefined,
      duration_seconds as number | undefined,
    );

    ctx.response.status = 201;
    ctx.response.body = { id: sceneId };
  });

export { movieRouter };
