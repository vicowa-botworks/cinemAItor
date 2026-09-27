# Demo mode

Demo mode lets a new user learn CinemAItor by watching (or co-piloting) the app do real work: each
page that creates something offers demo runs that fill the _real_ forms, call the _real_ handlers,
queue _real_ jobs, and narrate every setting and step — so the user learns the app from watching,
then repeats the steps themselves.

## The two modes

| Mode     | Behavior                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto`   | Fully automatic: each step prepares (fills the form), dwells briefly so the filled settings are visible, executes, and polls to completion.        |
| `guided` | Step-by-step: each step prepares, then the run **pauses** — the user can edit the real form however they like — and press **Continue** to execute. |

Both modes share the same engine, the same step contract, and the same narration. `guided` is `auto`
plus a pause at every step boundary.

## Modules

| Module                                        | What it is                                                                                                                                                                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/components/demo-engine.js`      | `DemoRun` — pure, DOM-free, unit-tested. Runs an ordered list of steps in auto/guided mode and reports everything through an `onEvent` callback.                                                                                                         |
| `frontend/src/components/demo-runner.js`      | `<demo-runner>` — the Lit control bar: step checklist (with progress + narration), a scrolling "what I'm doing and why" log, Continue/Skip/Stop buttons.                                                                                                 |
| `frontend/src/components/demo-content.js`     | The demo film **"The Lighthouse"** (script, assets, panels, shots, score, timeline plan) plus `demoPreflight` — checks which enabled models cover the film's task types and names the parts that will be skipped.                                        |
| `frontend/src/components/demo-movie-state.js` | `localStorage` state + `stage`→`page`/route map for the guided cross-page movie demo: `saveMovieState` / `loadMovieState` / `clearMovieState`, `moviePageForStage`, `routeForMoviePage`, and `nextMoviePage`. Pure, DOM-free (only `localStorage`).      |
| `frontend/src/components/movie-demo-host.js`  | `MovieDemoHost` mixin — runs the guided movie demo _across_ pages: hosts only the current page's stage segment, auto-navigates to the next page on each boundary, persists progress to `localStorage`, and resumes a stored run when its page is opened. |
| `frontend/src/components/demo-movie.js`       | `buildMovieDemoSteps` (the full step list, calls the API directly — used by the Projects-page automatic demo) and `movieDemoStepsForPage` (per-page segments for the guided cross-page demo).                                                            |

Tests: `frontend/tests/demo-mode.test.js` (content shape, preflight, engine lifecycle + `seed` —
gated sleep injections, no real timers, no DOM), `demo-movie.test.js` (full step list + per-page
segments), `demo-movie-state.test.js` (state module over a fake `localStorage`), and
`demo-movie-host.test.js` (mixin state transitions + navigation).

## The step contract

A demo run is an ordered list of plain objects:

```js
{
  id: "assets",               // unique within the run
  title: "Create the assets", // checklist label
  stage: "Assets",            // optional group label (the movie demo)
  async prepare(ctx) {},      // fill form fields / create objects — the user sees this happen
  async describe(ctx) => string,  // narration: what was set, and why
  async execute(ctx) => work | null,
    // submit via the page's REAL handler or the API.
    // work: null | { kind: "none" } | { kind: "asset", asset_id }
    //      | { kind: "jobs", job_ids: string[] } | { kind: "render", render_id }
  async poll(ctx, work) => ({ done, failed?, error?, progress?, note?, result? })
    // required when execute returned a jobs/render work handle.
}
```

`ctx` is the run's context object, passed to every step function untouched (typically
`{ api,
page, project }` plus per-page state). Steps are defined by the page that hosts the demo —
the engine knows nothing about specific pages.

**Steps drive the host's own code paths.** `prepare` fills the page's actual form fields and
`execute` calls the page's actual submit handler, so every validation, enhancement, and API call the
user would make by hand happens for real. Demo mode bypasses the pre-generation VRAM dialog (the
runner's own GPU→CPU auto-fallback still applies), and it works best with an LLM configured —
auto-enhance runs when the page's preferences say so, and degrades silently without one.

## Engine events

`DemoRun` communicates exclusively through `onEvent({ type, index, ... })`; `demo-runner` renders
them:

| Event           | When                                                        | Payload                    |
| --------------- | ----------------------------------------------------------- | -------------------------- |
| `start`         | the run begins                                              | `{ total, mode }`          |
| `step-start`    | a step starts preparing                                     | `{ step }`                 |
| `step-ready`    | prepared — the form is filled; (guided) the run pauses here | `{ step, narration }`      |
| `step-running`  | executing                                                   | `{ step }`                 |
| `step-progress` | each poll reports progress                                  | `{ step, progress, note }` |
| `step-done`     | the step completed                                          | `{ step, result }`         |
| `step-failed`   | prepare/execute/poll failed — the run stops here            | `{ step, error }`          |
| `step-skipped`  | the step was skipped                                        | `{ step }`                 |
| `pause`         | (guided) the run is waiting for Continue                    | `{ step }`                 |
| `done`          | every step completed                                        | `{ results }`              |
| `failed`        | the run stopped on a step failure                           | `{ step, error }`          |
| `stopped`       | the user stopped the run                                    | `{ completed }`            |

Step state is readable at any time via `run.states` — one row per step:
`{ index, id, title,
stage, status, narration, note, progress, error }` with status
`pending | preparing | ready | running | done | failed | skipped`. Per-step results (the `work`
handle / `poll` result) land in `run.results` keyed by step id, which later steps and the movie demo
use to thread asset ids through the film.

## The runner UI

`<demo-runner>` is a separate component following the `ai-assist-dialog` convention — the host owns
it:

```html
<demo-runner id="runner"></demo-runner>
```

```js
// host
this.runner = new DemoRun({ steps, mode, ctx: { api: this.api, ... }, onEvent: undefined });
this.$("runner").open = true;
this.$("runner").run = this.runner;   // assigns the run (auto-starts via .start() unless already started)

// events back
this.$("runner").addEventListener("demo-continue", () => this.runner?.continue());
this.$("runner").addEventListener("demo-skip",     () => this.runner?.skip());
this.$("runner").addEventListener("demo-stop",     () => this.runner?.stop());
this.$("runner").addEventListener("demo-closed",   () => { /* run?.stop() if not finished */ });
```

The control bar shows the step checklist (current step highlighted, progress bars, failures in red,
stages as section labels), the narration log (auto-scrolling; the latest line is the narration,
older lines are history), and the mode-dependent action buttons: **Continue** (guided, while
paused), **Skip** (while a step is ready), **Stop** (any time until finished).

## The demo film: "The Lighthouse"

`demo-content.js` holds one small film that exercises the whole pipeline — used by the per-page
demos and, from the Projects page, by the full movie demo:

- **Script** — a 3-scene Fountain-lite screenplay (DUSK / NIGHT / DAWN) that parses cleanly with
  `parseScript` (see `docs/scripts.md`).
- **Assets** — three image assets (`lighthouse`, `keeper`, `boat`) with text-to-image prompts.
- **Storyboard** — one board, four panels whose prompts use `@lighthouse` / `@keeper` / `@boat`
  references (the text-to-image preview path).
- **Scenes** — three scenes, one per script scene, with one shot each; the shots use the image-to-
  video path (first frame from the linked panel's preview).
- **Score** — a music prompt generated from the cut (the timeline score path).
- **Timeline** — the assembly plan: one video track (the three clips) and one audio track (the
  score), then a draft render.

`demoPreflight(api)` probes the model registry for every task type the film needs and reports
`{ ok, missing: [{ taskType, label }], notes }` — a film part whose model is missing is announced in
the narration and skipped rather than failing the run.

## Entry points

Each page that creates something gets a **Demo** control offering **Automatic** and **Guided**:

| Page                  | Component           | Demonstrates                                                  |
| --------------------- | ------------------- | ------------------------------------------------------------- |
| Scripts               | `script-detail`     | create a script, write/extend with AI, save a version         |
| Assets                | `asset-list`        | create + generate image assets with references                |
| Storyboard            | `storyboard-detail` | panels on the opened board: add, enhance, preview (t2i)       |
| Scenes                | `scene-detail`      | fill the opened scene, add a shot, single + batch clip (i2v)  |
| Timeline + Audio      | `timeline-detail`   | tracks, items, score suggestion, render, export               |
| Projects (full movie) | `project-list`      | the whole film, start to finish, ending with a rendered movie |

A page demo is self-contained: on pages whose route does not require an existing object (Scripts,
Assets), the demo creates the object first (narrated). The Storyboard and Scenes demos run on the
object the route already opened (those pages need an id) and treat it as the film's board/first
scene.

The Projects page offers **two** full-movie demos, side by side:

- **Full movie demo** (this page) — the fully automatic variant from PR5: one continuous run,
  entirely on the Projects page, ending with a rendered movie. It never leaves the page.
- **Guided movie** — the cross-page variant: it walks the real workflow through the actual pages
  (Projects → Assets → Storyboard → Scenes → Timeline), pausing at each step so it can be watched,
  stopped, and resumed, and persists its progress to `localStorage` (below).

## The guided cross-page movie demo

Where a page demo is self-contained (one page, one run), the guided movie demo is **one logical run
spread across the app's pages**. It is guided: each step prepares and narrates, the run pauses with
a **Continue** / **Skip** / **Stop** control, and the user presses Continue to run the step. When
the current page's segment is exhausted the run auto-navigates to the next page and re-hosts there.

The movie steps are API-driven from `DEMO_FILM` and idempotent (a step reuses an object an earlier
run already created), so the guided value is in _watching the run proceed page by page_,
**stopping** to inspect a page or work on it by hand, and **resuming** — the idempotent steps pick
up where the run left off and the persisted scratch carries the cross-page object ids. To change
_what_ a step generates, stop the run, make the change by hand on the page, then resume. (This
differs from the per-page demos, whose steps drive the page's real forms and so do apply in-form
edits.)

**How it works**

- The full step list (`buildMovieDemoSteps`) is unchanged from the automatic demo — the same
  objects, the same API calls, the same idempotency. The cross-page demo only changes _where_ the
  steps run and _when_ it moves.
- Steps are grouped by `stage` (Overview / Project / Assets / Storyboard / Scenes / Clips / Timeline
  / Score / Render). Each page hosts exactly the stages that live on it, in order: Projects =
  Overview + Project, Assets = Assets, Storyboard = Storyboard, Scenes = Scenes + Clips, Timeline =
  Timeline + Score + Render. `movieDemoStepsForPage(page)` slices the full list into that page's
  contiguous segment.
- The run is **re-hosted per page**: a `DemoRun` is created fresh on each page with only that page's
  segment. Because every step is idempotent and reads prior state from the shared `ctx.scratch`, the
  segment only needs to be told _which earlier steps are already done_.
- That knowledge is the `localStorage` state (`demo-movie-state.js`):
  `{ page, doneIds, scratch,
  startedAt }`. `scratch` is the engine's shared scratch object
  (project/storyboard/scene ids, the panel→shot id map, the placed clip ids, …) that the automatic
  demo threads through a single run; across pages it must survive navigation, so it is persisted.
- On the next page, `DemoRun` is constructed with `ctx.scratch` restored and a `seed`
  (`{ doneIds }`): the done step ids are pre-marked done and the scratch is in place, so the segment
  resumes exactly where it left off and its idempotent steps reuse the objects the earlier pages
  created.
- **Auto-navigate + resume**: the `MovieDemoHost` mixin persists the state after every completed
  step. When the current page's segment is exhausted it finds the next movie page (in pipeline
  order) that still has a pending step, persists `page` set to that page, and sets the hash to
  navigate there. When a page loads (or reloads), the mixin re-hosts the persisted run if the
  state's page is that page — seeding the already-done step ids and restoring the scratch, so the
  run resumes exactly where it left off. A _stopped_ (not finished) run stays resumable: its state
  remains in `localStorage`, and opening the page it belongs to picks it back up. When the whole
  movie is done the state is cleared.

So a user can start the guided movie on the Projects page, stop it midway to inspect a page (or make
a hand edit), get interrupted, and come back later (same or a fresh tab) — opening the page the run
is on resumes it where it left off and continues through to the rendered movie.
