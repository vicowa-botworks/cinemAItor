import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { getDb, resetDb } from "../src/db/database.ts";
import * as schema from "../src/db/schema.ts";

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
}

describe("Database", () => {
  let userId: number;

  beforeEach(() => {
    getDb(true);
    userId = schema.createUser(uniqueEmail("test"), "hash123", "Test User");
  });

  afterEach(() => {
    resetDb();
  });

  it("should create and retrieve a user", () => {
    const user = schema.getUserById(userId);
    assert(user !== undefined, "user should be defined");
    assertEquals(user?.email.includes("test"), true);
    assertEquals(user?.display_name, "Test User");
  });

  it("should find user by email", () => {
    const email = uniqueEmail("findByEmail");
    schema.createUser(email, "hash456", "Find User");
    const user = schema.getUserByEmail(email);
    assert(user !== undefined, "user should be defined");
    assertEquals(user?.display_name, "Find User");
  });

  it("should return undefined for non-existent user", () => {
    const user = schema.getUserById(99999);
    assert(user === undefined, "user should be undefined");
  });

  it("should assign distinct ids to consecutive users", () => {
    const secondId = schema.createUser(
      uniqueEmail("second"),
      "hash111",
      "Second User",
    );
    assert(secondId !== userId, "second user should get a distinct id");
    const second = schema.getUserById(secondId);
    assert(
      second !== undefined,
      "second user should be retrievable by returned id",
    );
    assertEquals(second?.display_name, "Second User");
  });
});

describe("Movies", () => {
  let userId: number;

  beforeEach(() => {
    getDb(true);
    userId = schema.createUser(
      uniqueEmail("movietest"),
      "hash789",
      "Movie User",
    );
  });

  afterEach(() => {
    resetDb();
  });

  it("should create and retrieve a movie", () => {
    const movieId = schema.createMovie(
      "Test Movie",
      userId,
      "A test description",
      "Sci-Fi",
      2024,
      120,
    );

    assert(movieId > 0, "movieId should be greater than 0");

    const movie = schema.getMovieById(movieId, userId);
    assert(movie !== undefined, "movie should be defined");
    assertEquals(movie?.title, "Test Movie");
    assertEquals(movie?.genre, "Sci-Fi");
    assertEquals(movie?.year, 2024);
  });

  it("should list all movies for a user", () => {
    const _movieId1 = schema.createMovie("Movie 1", userId, "Desc 1");
    const _movieId2 = schema.createMovie("Movie 2", userId, "Desc 2");

    const movies = schema.getUserMovies(userId);
    assertEquals(movies.length, 2);
  });

  it("should not return movies from other users", () => {
    const otherUser = schema.createUser(
      uniqueEmail("other"),
      "hashghi",
      "Other",
    );
    const movies = schema.getUserMovies(otherUser);
    assertEquals(movies.length, 0, "other user should have no movies");
  });

  it("should update a movie", () => {
    const movieId = schema.createMovie("Original Title", userId);

    const updated = schema.updateMovie(movieId, userId, {
      title: "Updated Title",
      rating: 4.5,
    });
    assertEquals(updated, true);

    const movie = schema.getMovieById(movieId, userId);
    assertEquals(movie?.title, "Updated Title");
    assertEquals(movie?.rating, 4.5);
  });

  it("should delete a movie", () => {
    const movieId = schema.createMovie("ToDelete", userId);

    const deleted = schema.deleteMovie(movieId, userId);
    assertEquals(deleted, true);

    const movie = schema.getMovieById(movieId, userId);
    assert(movie === undefined, "movie should be undefined after delete");
  });
});

describe("Scenes", () => {
  let userId: number;
  let movieId: number;

  beforeEach(() => {
    getDb(true);
    userId = schema.createUser(
      uniqueEmail("scenetest"),
      "hashpqr",
      "Scene User",
    );
    movieId = schema.createMovie("Scene Movie", userId);
  });

  afterEach(() => {
    resetDb();
  });

  it("should create and retrieve scenes for a movie", () => {
    const sceneId = schema.createScene(
      movieId,
      userId,
      1,
      "Opening scene",
      "Hello world",
      "Wide shot",
      60,
    );

    assert(sceneId > 0, "sceneId should be greater than 0");

    const scenes = schema.getScenesByMovieId(movieId, userId);
    assertEquals(scenes.length, 1);
    assertEquals(scenes[0].description, "Opening scene");
    assertEquals(scenes[0].dialogue, "Hello world");
  });
});
