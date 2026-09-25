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

| Module                                    | What it is                                                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/components/demo-engine.js`  | `DemoRun` — pure, DOM-free, unit-tested. Runs an ordered list of steps in auto/guided mode and reports everything through an `onEvent` callback.                                                                  |
| `frontend/src/components/demo-runner.js`  | `<demo-runner>` — the Lit control bar: step checklist (with progress + narration), a scrolling "what I'm doing and why" log, Continue/Skip/Stop buttons.                                                          |
| `frontend/src/components/demo-content.js` | The demo film **"The Lighthouse"** (script, assets, panels, shots, score, timeline plan) plus `demoPreflight` — checks which enabled models cover the film's task types and names the parts that will be skipped. |

Tests: `frontend/tests/demo-mode.test.js` (content shape, preflight, engine lifecycle — gated sleep
injections, no real timers, no DOM).

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

| Page                  | Component           | Demonstrates                                                        |
| --------------------- | ------------------- | ------------------------------------------------------------------- |
| Scripts               | `script-detail`     | create a script, write/extend with AI, save a version               |
| Assets                | `asset-list`        | create + generate image assets with references                      |
| Storyboard            | `storyboard-detail` | create a board, add panels, enhance, preview (t2i)                  |
| Scenes                | `scene-detail`      | import/create scenes, shots, enhance, single + batch generate (i2v) |
| Timeline + Audio      | `timeline-detail`   | tracks, items, score suggestion, render, export                     |
| Projects (full movie) | `project-list`      | the whole film, start to finish, ending with a rendered movie       |

A page demo is self-contained: if the page's object does not exist yet, the demo creates it first
(narrated). The full movie demo (Projects page) has a fully automatic variant (one continuous run
with a progress HUD) and a guided variant that steps through every stage and lets the user adjust
each one, with progress kept in `localStorage` so it can be resumed.
