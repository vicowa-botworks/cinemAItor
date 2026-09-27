import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { MovieDemoHost } from "../src/components/movie-demo-host.js";
import { loadMovieState, saveMovieState } from "../src/components/demo-movie-state.js";

// Apply the mixin to a bare base class so the pure transition logic can be
// exercised without Lit/DOM. The engine steps' `execute` closures (which touch
// the API) are never invoked by the methods under test.
class Base {}
const Host = MovieDemoHost(Base);

// The step ids per movie page, in pipeline order — kept in sync with
// buildMovieDemoSteps in demo-movie.js (a drift here fails the transition
// tests).
const PAGE_IDS = {
  projects: ["movie-intro", "movie-project"],
  assets: ["assets-lighthouse", "assets-keeper", "assets-boat"],
  storyboard: ["movie-storyboard", "movie-panels", "movie-panels-preview"],
  scenes: [
    "movie-scenes",
    "movie-clips-link",
    "movie-clip-1",
    "movie-clip-2",
    "movie-clip-3",
  ],
  timeline: [
    "movie-timeline",
    "movie-tracks",
    "movie-clips-place",
    "movie-score",
    "movie-score-place",
    "movie-render",
    "movie-done",
  ],
};

function freshStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

function mockWindow() {
  const loc = { hash: "" };
  globalThis.window = {
    location: loc,
    addEventListener() {},
    removeEventListener() {},
  };
  return loc;
}

function makeHost(page) {
  const h = new Host();
  Object.defineProperty(h, "movieDemoPage", { value: page, configurable: true });
  h.requestUpdate = () => {};
  return h;
}

describe("MovieDemoHost transition logic", () => {
  it("the first page with pending work is the start page", () => {
    const h = makeHost("projects");
    const next = h._nextPendingPage([]);
    assertEquals(next?.page, "projects");
  });

  it("skips pages whose steps are all settled", () => {
    const h = makeHost("projects");
    assertEquals(h._nextPendingPage(PAGE_IDS.projects)?.page, "assets");
    const throughAssets = [...PAGE_IDS.projects, ...PAGE_IDS.assets];
    assertEquals(h._nextPendingPage(throughAssets)?.page, "storyboard");
    const throughScenes = [
      ...throughAssets,
      ...PAGE_IDS.storyboard,
      ...PAGE_IDS.scenes,
    ];
    assertEquals(h._nextPendingPage(throughScenes)?.page, "timeline");
  });

  it("returns null once every page is settled", () => {
    const h = makeHost("projects");
    const all = Object.values(PAGE_IDS).flat();
    assertEquals(h._nextPendingPage(all), null);
  });

  it("collects done + skipped step ids", () => {
    const h = makeHost("projects");
    const run = {
      states: [
        { id: "a", status: "done" },
        { id: "b", status: "active" },
        { id: "c", status: "skipped" },
        { id: "d", status: "pending" },
      ],
    };
    assertEquals(h._movieDoneIds(run), ["a", "c"]);
  });

  it("deep-copies scratch (mutations do not bleed back)", () => {
    const h = makeHost("projects");
    const src = { a: { b: 1 } };
    const copy = h._clone(src);
    copy.a.b = 2;
    assertEquals(src.a.b, 1);
  });

  it("clones non-serializable scratch to an empty object", () => {
    const h = makeHost("projects");
    const o = {};
    o.self = o;
    assertEquals(h._clone(o), {});
  });

  it("advances to the next page, persists state, and sets the hash", () => {
    const store = freshStore();
    Object.defineProperty(globalThis, "localStorage", {
      value: store,
      writable: true,
      configurable: true,
    });
    const loc = mockWindow();
    saveMovieState({ page: "projects", doneIds: [], scratch: {}, startedAt: 1 });

    const h = makeHost("projects");
    h._movieRun = {
      finished: true,
      failed: false,
      states: [
        { id: "movie-intro", status: "done" },
        { id: "movie-project", status: "done" },
      ],
      ctx: { scratch: { project: { id: "P" } } },
    };
    h._advanceMovieDemo();

    const st = loadMovieState();
    assertEquals(st?.page, "assets");
    assertEquals(st?.scratch.project.id, "P");
    assertEquals(loc.hash, "#/project/P/assets");
  });

  it("clears state and the run when the last page is done", () => {
    const store = freshStore();
    Object.defineProperty(globalThis, "localStorage", {
      value: store,
      writable: true,
      configurable: true,
    });
    mockWindow();
    saveMovieState({ page: "timeline", doneIds: [], scratch: {}, startedAt: 1 });

    const h = makeHost("timeline");
    const all = Object.values(PAGE_IDS).flat();
    h._movieRun = {
      finished: true,
      failed: false,
      states: all.map((id) => ({ id, status: "done" })),
      ctx: { scratch: { project_id: "P" } },
    };
    h._advanceMovieDemo();

    assertEquals(loadMovieState(), null);
    assertEquals(h._movieRun, null);
  });

  it("a finished run is not re-persisted (the advanced page survives)", () => {
    const store = freshStore();
    Object.defineProperty(globalThis, "localStorage", {
      value: store,
      writable: true,
      configurable: true,
    });
    mockWindow();
    // The run finished on "projects"; _advanceMovieDemo already saved the
    // next page. The hashchange / disconnect persist must not clobber it.
    saveMovieState({
      page: "assets",
      doneIds: ["movie-intro", "movie-project"],
      scratch: { project: { id: "P" } },
      startedAt: 1,
    });
    const h = makeHost("projects");
    h._movieRun = {
      finished: true,
      failed: false,
      states: [],
      ctx: { scratch: { project: { id: "P" } } },
    };
    h._persistMovieRun();
    assertEquals(loadMovieState()?.page, "assets");
  });
});
