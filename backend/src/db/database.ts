import { Database } from "jsr:@db/sqlite";

let db: Database | null = null;

export function getDb(memory = false): Database {
  if (!db) {
    const dbPath = memory ? ":memory:" : (Deno.env.get("DB_PATH") || "./cinemaItor.db");
    db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        genre TEXT,
        year INTEGER,
        runtime_minutes INTEGER,
        poster_url TEXT,
        backdrop_url TEXT,
        rating REAL DEFAULT 0,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS scenes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movie_id INTEGER NOT NULL,
        scene_number INTEGER NOT NULL,
        description TEXT NOT NULL,
        dialogue TEXT,
        visual_description TEXT,
        duration_seconds INTEGER,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movie_id INTEGER,
        scene_id INTEGER,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE SET NULL,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE SET NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_movies_user_id ON movies(user_id);
      CREATE INDEX IF NOT EXISTS idx_scenes_movie_id ON scenes(movie_id);
      CREATE INDEX IF NOT EXISTS idx_scenes_user_id ON scenes(user_id);
      CREATE INDEX IF NOT EXISTS idx_prompts_movie_id ON prompts(movie_id);
      CREATE INDEX IF NOT EXISTS idx_prompts_scene_id ON prompts(scene_id);
      CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id);
    `);
  }
  return db;
}

export function resetDb(): void {
  if (db) {
    db.exec("DELETE FROM prompts");
    db.exec("DELETE FROM scenes");
    db.exec("DELETE FROM movies");
    db.exec("DELETE FROM users");
    db.exec("DELETE FROM sqlite_sequence");
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
