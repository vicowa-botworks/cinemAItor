import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import {
  clearMovieState,
  isMoviePage,
  loadMovieState,
  MOVIE_PAGES,
  nextMoviePage,
  pageForStage,
  pageIndex,
  routeForPage,
  saveMovieState,
} from "../src/components/demo-movie-state.js";

// Deno has no native localStorage — a minimal in-memory stand-in.
function fakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}
// Each store-touching test gets a fresh store so execution order can't leak state.
function setStore(s) {
  // Deno's test runtime exposes localStorage as an accessor (getter/setter), so a
  // plain assignment does not redirect subsequent reads; define a data property.
  Object.defineProperty(globalThis, "localStorage", {
    value: s,
    configurable: true,
    writable: true,
  });
}

function freshStore() {
  const s = fakeLocalStorage();
  setStore(s);
  return s;
}

describe("demo-movie-state", () => {
  it("defines the five pages in walkthrough order", () => {
    assertEquals(
      MOVIE_PAGES.map((p) => p.page),
      ["projects", "assets", "storyboard", "scenes", "timeline"],
    );
    for (const p of MOVIE_PAGES) {
      assert(typeof p.title === "string" && p.title.length > 0);
      assert(typeof p.route === "function");
    }
  });

  it("maps the PR5 stage labels onto their hosting page", () => {
    assertEquals(pageForStage("Overview"), "projects");
    assertEquals(pageForStage("Project"), "projects");
    assertEquals(pageForStage("Assets"), "assets");
    assertEquals(pageForStage("Storyboard"), "storyboard");
    assertEquals(pageForStage("Scenes"), "scenes");
    assertEquals(pageForStage("Clips"), "scenes");
    assertEquals(pageForStage("Timeline"), "timeline");
    assertEquals(pageForStage("Score"), "timeline");
    assertEquals(pageForStage("Render"), "timeline");
    assertEquals(
      pageForStage("Bogus"),
      "projects",
      "unknown stages default to projects",
    );
  });

  it("walks pages in order and stops at the end", () => {
    assertEquals(pageIndex("assets"), 1);
    assertEquals(pageIndex("nowhere"), -1);
    assert(isMoviePage("scenes"));
    assert(!isMoviePage("nowhere"));
    assertEquals(nextMoviePage("projects")?.page, "assets");
    assertEquals(nextMoviePage("scenes")?.page, "timeline");
    assertEquals(nextMoviePage("timeline"), null, "timeline is the last page");
    assertEquals(nextMoviePage("nowhere"), null);
  });

  it("builds routes from the scratch object ids, with sane fallbacks", () => {
    assertEquals(routeForPage("projects"), "#/projects");
    assertEquals(routeForPage("scenes"), "#/scenes");
    // No ids yet → the bare list routes.
    assertEquals(routeForPage("assets", {}), "#/assets");
    assertEquals(routeForPage("storyboard", {}), "#/storyboards");
    assertEquals(routeForPage("timeline", {}), "#/timelines");
    // Ids present → the per-object routes (url-encoded).
    const scratch = {
      project: { id: "p 1" },
      storyboard: { id: "board/2" },
      timeline: { id: "tl 3" },
    };
    assertEquals(routeForPage("assets", scratch), "#/project/p%201/assets");
    assertEquals(routeForPage("storyboard", scratch), "#/storyboard/board%2F2");
    assertEquals(routeForPage("timeline", scratch), "#/timeline/tl%203");
    // A non-movie page falls back to the projects route.
    assertEquals(routeForPage("nowhere", scratch), "#/projects");
  });

  it("round-trips a state record and normalises its fields", () => {
    freshStore();
    saveMovieState({
      page: "assets",
      doneIds: ["movie-intro", "movie-project", "assets-lighthouse"],
      scratch: {
        project: { id: "p1" },
        assets: { lighthouse: { version_id: "v1" } },
      },
      navigating: true,
      startedAt: 12345,
    });
    const s = loadMovieState();
    assertEquals(s.page, "assets");
    assertEquals(s.doneIds, [
      "movie-intro",
      "movie-project",
      "assets-lighthouse",
    ]);
    assertEquals(s.scratch.project.id, "p1");
    assert(s.navigating === true);
    assertEquals(s.startedAt, 12345);
  });

  it("coerces partial or malformed records defensively", () => {
    freshStore();
    saveMovieState({ page: "scenes", doneIds: "nope", scratch: "nope" });
    const s = loadMovieState();
    assertEquals(s.page, "scenes");
    assertEquals(s.doneIds, [], "non-array doneIds → []");
    assertEquals(s.scratch, {}, "non-object scratch → {}");
    assert(s.navigating === false, "missing navigating → false");
    assert(typeof s.startedAt === "number");
  });

  it("returns null for absent, malformed, or non-movie records", () => {
    const store = freshStore();
    assertEquals(loadMovieState(), null, "absent → null");
    store.setItem("cinemaitor:demo:movie", "{not json");
    assertEquals(loadMovieState(), null, "corrupt JSON → null");
    store.setItem("cinemaitor:demo:movie", JSON.stringify({ page: "bogus" }));
    assertEquals(loadMovieState(), null, "non-movie page → null");
  });

  it("clearMovieState removes the record", () => {
    freshStore();
    saveMovieState({ page: "projects", doneIds: [], scratch: {} });
    assert(loadMovieState() !== null);
    clearMovieState();
    assertEquals(loadMovieState(), null);
  });

  it("never throws when localStorage is unavailable", () => {
    const prev = globalThis.localStorage;
    try {
      // A throwing store (e.g. privacy mode) must not break the helpers.
      const boom = {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      };
      setStore(boom);
      assertEquals(loadMovieState(), null);
      saveMovieState({ page: "projects" }); // no throw
      clearMovieState(); // no throw
    } finally {
      setStore(prev);
    }
  });
});
