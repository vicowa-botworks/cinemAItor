import { getDb } from "./database.ts";

export interface User {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Movie {
  id: number;
  title: string;
  description: string | null;
  genre: string | null;
  year: number | null;
  runtime_minutes: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  rating: number;
  user_id: number;
  created_at: string;
  updated_at: string;
}

export interface Scene {
  id: number;
  movie_id: number;
  scene_number: number;
  description: string;
  dialogue: string | null;
  visual_description: string | null;
  duration_seconds: number | null;
  user_id: number;
  created_at: string;
  updated_at: string;
}

export interface Prompt {
  id: number;
  movie_id: number | null;
  scene_id: number | null;
  user_id: number;
  role: string;
  content: string;
  created_at: string;
}

export function createUser(
  email: string,
  passwordHash: string,
  displayName: string,
  role = "user",
): number {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, ?) RETURNING id",
  );
  const row = stmt.get<{ id: number }>(email, passwordHash, displayName, role);
  if (!row) throw new Error("Failed to create user");
  return row.id;
}

export function countUsers(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS n FROM users")
    .get() as unknown as { n: number };
  return row.n;
}

export function getUserById(id: number): User | undefined {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
  return stmt.get(id) as User | undefined;
}

export function getUserByEmail(email: string): User | undefined {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM users WHERE email = ?");
  return stmt.get(email) as User | undefined;
}

export function createMovie(
  title: string,
  userId: number,
  description?: string,
  genre?: string,
  year?: number,
  runtimeMinutes?: number,
  posterUrl?: string,
  backdropUrl?: string,
): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO movies (title, description, genre, year, runtime_minutes, poster_url, backdrop_url, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const row = stmt.get<{ id: number }>(
    title,
    description ?? null,
    genre ?? null,
    year ?? null,
    runtimeMinutes ?? null,
    posterUrl ?? null,
    backdropUrl ?? null,
    userId,
  );
  if (!row) throw new Error("Failed to create movie");
  return row.id;
}

export function getMovieById(id: number, userId: number): Movie | undefined {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM movies WHERE id = ? AND user_id = ?");
  return stmt.get(id, userId) as Movie | undefined;
}

export function getUserMovies(userId: number): Movie[] {
  const db = getDb();
  const stmt = db.prepare(
    "SELECT * FROM movies WHERE user_id = ? ORDER BY created_at DESC",
  );
  return stmt.all(userId) as Movie[];
}

export function updateMovie(
  id: number,
  userId: number,
  updates: Partial<Omit<Movie, "id" | "user_id" | "created_at" | "updated_at">>,
): boolean {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) {
    fields.push("title = ?");
    values.push(updates.title);
  }
  if (updates.description !== undefined) {
    fields.push("description = ?");
    values.push(updates.description);
  }
  if (updates.genre !== undefined) {
    fields.push("genre = ?");
    values.push(updates.genre);
  }
  if (updates.year !== undefined) {
    fields.push("year = ?");
    values.push(updates.year);
  }
  if (updates.runtime_minutes !== undefined) {
    fields.push("runtime_minutes = ?");
    values.push(updates.runtime_minutes);
  }
  if (updates.poster_url !== undefined) {
    fields.push("poster_url = ?");
    values.push(updates.poster_url);
  }
  if (updates.backdrop_url !== undefined) {
    fields.push("backdrop_url = ?");
    values.push(updates.backdrop_url);
  }
  if (updates.rating !== undefined) {
    fields.push("rating = ?");
    values.push(updates.rating);
  }

  if (fields.length === 0) return false;

  fields.push("updated_at = datetime('now')");
  values.push(id, userId);

  const stmt = db.prepare(
    `UPDATE movies SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`,
  );
  return (stmt.run as (...params: unknown[]) => number)(...values) > 0;
}

export function deleteMovie(id: number, userId: number): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM movies WHERE id = ? AND user_id = ?");
  return stmt.run(id, userId) > 0;
}

export function createScene(
  movieId: number,
  userId: number,
  sceneNumber: number,
  description: string,
  dialogue?: string,
  visualDescription?: string,
  durationSeconds?: number,
): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO legacy_scenes (movie_id, scene_number, description, dialogue, visual_description, duration_seconds, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  );
  const row = stmt.get<{ id: number }>(
    movieId,
    sceneNumber,
    description,
    dialogue ?? null,
    visualDescription ?? null,
    durationSeconds ?? null,
    userId,
  );
  if (!row) throw new Error("Failed to create scene");
  return row.id;
}

export function getScenesByMovieId(movieId: number, userId: number): Scene[] {
  const db = getDb();
  const stmt = db.prepare(
    `SELECT s.* FROM legacy_scenes s
     JOIN movies m ON s.movie_id = m.id
     WHERE m.id = ? AND m.user_id = ?
     ORDER BY s.scene_number`,
  );
  return stmt.all(movieId, userId) as Scene[];
}

export function createPrompt(
  userId: number,
  content: string,
  role: string,
  movieId?: number,
  sceneId?: number,
): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO prompts (movie_id, scene_id, user_id, role, content)
     VALUES (?, ?, ?, ?, ?) RETURNING id`,
  );
  const row = stmt.get<{ id: number }>(
    movieId ?? null,
    sceneId ?? null,
    userId,
    role,
    content,
  );
  if (!row) throw new Error("Failed to create prompt");
  return row.id;
}

export function getPromptsByMovieId(movieId: number, userId: number): Prompt[] {
  const db = getDb();
  const stmt = db.prepare(
    `SELECT p.* FROM prompts p
     JOIN movies m ON p.movie_id = m.id
     WHERE m.id = ? AND m.user_id = ?
     ORDER BY p.created_at`,
  );
  return stmt.all(movieId, userId) as Prompt[];
}
