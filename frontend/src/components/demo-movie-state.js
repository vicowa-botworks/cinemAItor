// Persistent state for the guided cross-page movie demo (PR6).
//
// The guided movie walks through the film stage by stage, auto-navigating
// between pages (Projects → Assets → Storyboard → Scenes → Timeline) and
// pausing at each step so the user can edit the real objects. Each page hosts
// the run for its own stage segment; this module persists the run's progress
// (done step ids + the scratch object ids) in localStorage so a navigation or
// refresh resumes exactly where it left off.
//
// The shape is tiny and defensive: a corrupted or partial record degrades to
// "no active movie" rather than crashing the host page.

const KEY = "cinemaitor:demo:movie";

// The pages the guided movie walks through, in order. `route` builds the hash
// to navigate to from the run's scratch (the ids created so far).
export const MOVIE_PAGES = [
  { page: "projects", title: "Projects", route: () => "#/projects" },
  {
    page: "assets",
    title: "Assets",
    route: (s) =>
      s?.project?.id ? `#/project/${encodeURIComponent(s.project.id)}/assets` : "#/assets",
  },
  {
    page: "storyboard",
    title: "Storyboard",
    route: (s) =>
      s?.storyboard?.id ? `#/storyboard/${encodeURIComponent(s.storyboard.id)}` : "#/storyboards",
  },
  { page: "scenes", title: "Scenes", route: () => "#/scenes" },
  {
    page: "timeline",
    title: "Timeline",
    route: (s) =>
      s?.timeline?.id ? `#/timeline/${encodeURIComponent(s.timeline.id)}` : "#/timelines",
  },
];

// The PR5 builder's `stage` labels → the movie page that hosts that stage.
const STAGE_TO_PAGE = {
  Overview: "projects",
  Project: "projects",
  Assets: "assets",
  Storyboard: "storyboard",
  Scenes: "scenes",
  Clips: "scenes",
  Timeline: "timeline",
  Score: "timeline",
  Render: "timeline",
};

/** The movie page that hosts a step's `stage` label. */
export function pageForStage(stage) {
  return STAGE_TO_PAGE[stage] ?? "projects";
}

/** 0-based index of a movie page, or -1 if it is not one. */
export function pageIndex(page) {
  const i = MOVIE_PAGES.findIndex((p) => p.page === page);
  return i < 0 ? -1 : i;
}

/** Whether `page` is one of the guided-movie pages. */
export function isMoviePage(page) {
  return pageIndex(page) >= 0;
}

/** The next movie page after `page`, or null at the end (the movie is done). */
export function nextMoviePage(page) {
  const i = pageIndex(page);
  return i >= 0 && i + 1 < MOVIE_PAGES.length ? MOVIE_PAGES[i + 1] : null;
}

/** The hash to navigate to for `page`, built from the run's scratch. */
export function routeForPage(page, scratch) {
  const i = pageIndex(page);
  return i >= 0 ? MOVIE_PAGES[i].route(scratch) : "#/projects";
}

/**
 * Load the active guided-movie state, or null when there is none / it is
 * malformed. Never throws.
 */
export function loadMovieState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object" || !isMoviePage(s.page)) return null;
    s.doneIds = Array.isArray(s.doneIds) ? s.doneIds.filter((x) => typeof x === "string") : [];
    s.scratch = s.scratch && typeof s.scratch === "object" ? s.scratch : {};
    s.navigating = Boolean(s.navigating);
    s.startedAt = typeof s.startedAt === "number" ? s.startedAt : Date.now();
    return s;
  } catch {
    return null;
  }
}

/** Persist the guided-movie state. Never throws (quota / privacy mode). */
export function saveMovieState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // localStorage full or unavailable — resume degrades; the run continues in memory.
  }
}

/** Clear any active guided-movie state. Never throws. */
export function clearMovieState() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
