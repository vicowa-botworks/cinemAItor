import { html, nothing } from "lit";
import { api } from "../api.js";
import { demoPreflight } from "./demo-content.js";
import { DemoRun } from "./demo-engine.js";
import { movieDemoStepsForPage } from "./demo-movie.js";
import {
  clearMovieState,
  loadMovieState,
  MOVIE_PAGES,
  routeForPage,
  saveMovieState,
} from "./demo-movie-state.js";
import "./demo-runner.js";

/**
 * MovieDemoHost — mixin that lets a page host a segment of the guided,
 * cross-page "full movie" demo (docs/demo.md).
 *
 * The guided movie demo is one run split across the five movie pages:
 *   Projects → Assets → Storyboard → Scenes → Timeline
 * Each page runs only its own stage segment (see `movieDemoStepsForPage`); the
 * cross-page object ids (project, assets, storyboard, scenes, clips, timeline,
 * tracks) flow through the run's `ctx.scratch`, which is persisted to
 * localStorage after every completed step. Navigating away does NOT stop the
 * run — the next page re-hosts it from the persisted state and picks up where
 * the previous page left off. When a page's segment is exhausted the host
 * auto-navigates to the next movie page; after the last one the state is
 * cleared.
 *
 * Host contract (pages that host a segment):
 *   - `movieDemoPage` — which movie page this host is ("projects" | "assets" |
 *     "storyboard" | "scenes" | "timeline"); null/undefined means this page
 *     never hosts the movie demo (it stays out of the flow).
 *   - `movieDemoStartButton` (the start page, project-list, overrides this to
 *     offer "Start the guided movie demo") — nothing by default.
 *   - render `${this.movieDemoRunnerPanel}` where the live run's control panel
 *     should appear.
 *
 * This is a separate mixin from `DemoHost` (the per-page demos) so a page can
 * host both without name collisions; the two runs are independent.
 */
export const MovieDemoHost = (superClass) =>
  class extends superClass {
    constructor() {
      super();
      this._movieRun = null;
      this._movieStarting = false;
      this._movieError = "";
      this._movieNavHandler = null;
    }

    connectedCallback() {
      super.connectedCallback?.();
      this._movieNavHandler = () => this._onMovieNavigate();
      window.addEventListener("hashchange", this._movieNavHandler);
      // Re-host an in-progress run that belongs to this page (resume after a
      // navigation or a page reload).
      this._maybeHostMovieDemo();
    }

    disconnectedCallback() {
      super.disconnectedCallback?.();
      if (this._movieNavHandler) {
        window.removeEventListener("hashchange", this._movieNavHandler);
        this._movieNavHandler = null;
      }
      // Persist the run up to this point but do NOT stop it: the next movie
      // page (or a later visit) re-hosts it from localStorage.
      this._persistMovieRun();
      this._movieRun = null;
    }

    /** Which movie page this host is; null means it never hosts the demo. */
    get movieDemoPage() {
      return null;
    }

    get movieDemoTitle() {
      return "Full movie demo";
    }

    get movieDemoSubtitle() {
      return "The Lighthouse — guided, page by page";
    }

    /** The start button — only the start page (project-list) overrides this. */
    get movieDemoStartButton() {
      return nothing;
    }

    /** The control panel, rendered while this page hosts a live run. */
    get movieDemoRunnerPanel() {
      if (!this._movieRun) return nothing;
      return html`
        <div class="movie-demo-host">
          ${this._movieError
            ? html`<div class="error" style="font-size:13px;">${this._movieError}</div>`
            : nothing}
          <demo-runner
            .run=${this._movieRun}
            title=${this.movieDemoTitle}
            subtitle=${this.movieDemoSubtitle}
            @continue=${() => this._movieRun?.continue()}
            @skip=${() => this._movieRun?.skip()}
            @stop=${this._onMovieStop}
            @close=${this._onMovieStop}></demo-runner>
        </div>
      `;
    }

    /** Start a fresh guided movie run from this (start) page. */
    async _onStartMovieDemo() {
      if (this._movieStarting || this._movieRun) return;
      if (!this.movieDemoPage) return;
      this._movieStarting = true;
      this._movieError = "";
      this.requestUpdate?.();
      try {
        const preflight = await demoPreflight(api);
        const scratch = {};
        saveMovieState({
          page: this.movieDemoPage,
          doneIds: [],
          scratch,
          startedAt: Date.now(),
        });
        await this._startMovieRun(preflight, scratch, []);
      } catch (err) {
        this._movieError = err instanceof Error ? err.message : String(err);
      } finally {
        this._movieStarting = false;
        this.requestUpdate?.();
      }
    }

    /** Re-host the persisted run if it belongs to this page (resume). */
    async _maybeHostMovieDemo() {
      if (!this.movieDemoPage || this._movieRun) return;
      const state = loadMovieState();
      if (!state || state.page !== this.movieDemoPage) return;
      try {
        const preflight = await demoPreflight(api);
        await this._startMovieRun(
          preflight,
          state.scratch ?? {},
          state.doneIds ?? [],
        );
      } catch (err) {
        this._movieError = err instanceof Error ? err.message : String(err);
      }
    }

    /**
     * Build this page's segment and start a guided run over it. `scratch` is
     * the (possibly restored) cross-page state; `doneIds` are steps already
     * completed on earlier pages (seeded so the engine skips them).
     */
    async _startMovieRun(preflight, scratch, doneIds) {
      const steps = movieDemoStepsForPage(this, preflight, this.movieDemoPage);
      if (steps.length === 0) return;
      const run = new DemoRun({
        steps,
        mode: "guided",
        ctx: { api, host: this, mode: "guided", preflight, scratch },
        seed: { doneIds },
        onEvent: (e) => this._onMovieStepEvent(e),
      });
      this._movieRun = run;
      this.requestUpdate?.();
      await run.start();
      this._settleMovieRun();
    }

    /**
     * Persist the run's progress (done step ids + live scratch) to
     * localStorage so the next page — or a later visit — can re-host it.
     */
    _persistMovieRun() {
      const run = this._movieRun;
      if (!run || !this.movieDemoPage) return;
      // A finished run's state was already settled by _advanceMovieDemo (which
      // saved the NEXT page, or cleared on the last one) — persisting here
      // would clobber it with this page's id when the hash change / disconnect
      // fires right after the navigation. Failed runs are kept resumable too.
      if (run.finished) return;
      saveMovieState({
        page: this.movieDemoPage,
        doneIds: this._movieDoneIds(run),
        scratch: this._clone(run.ctx.scratch),
        startedAt: loadMovieState()?.startedAt ?? Date.now(),
      });
    }

    /** Step ids that reached a settled state (done or skipped). */
    _movieDoneIds(run) {
      return run.states
        .filter((s) => s.status === "done" || s.status === "skipped")
        .map((s) => s.id);
    }

    _clone(value) {
      try {
        return JSON.parse(JSON.stringify(value ?? {}));
      } catch {
        return {};
      }
    }

    /**
     * Engine event sink: persist on every completed step, and when the
     * segment is exhausted, auto-navigate to the next movie page (or clear the
     * state on the last one).
     */
    _onMovieStepEvent(e) {
      if (e.type === "step-done" || e.type === "step-skipped") {
        this._persistMovieRun();
      } else if (e.type === "done") {
        this._advanceMovieDemo();
      }
    }

    /**
     * The segment is exhausted. Move to the next movie page that still has
     * pending work, or clear the state when the whole movie is done.
     */
    _advanceMovieDemo() {
      const run = this._movieRun;
      if (!run) return;
      const doneIds = this._movieDoneIds(run);
      const scratch = this._clone(run.ctx.scratch);
      const next = this._nextPendingPage(doneIds);
      if (!next) {
        clearMovieState();
        this._movieRun = null;
        this.requestUpdate?.();
        return;
      }
      saveMovieState({
        page: next.page,
        doneIds,
        scratch,
        startedAt: loadMovieState()?.startedAt ?? Date.now(),
      });
      window.location.hash = routeForPage(next.page, scratch);
    }

    /**
     * The first movie page (in pipeline order) that still has a step not in
     * `doneIds`, or null when every step is settled.
     */
    _nextPendingPage(doneIds) {
      const done = new Set(doneIds);
      for (const page of MOVIE_PAGES) {
        const hasPending = movieDemoStepsForPage(this, {}, page.page).some(
          (s) => !done.has(s.id),
        );
        if (hasPending) return page;
      }
      return null;
    }

    /**
     * Navigation: if we are leaving the page that hosts the run, persist it.
     * The run is NOT stopped — the next movie page re-hosts it, and a visit to
     * this page later resumes it.
     */
    _onMovieNavigate() {
      this._persistMovieRun();
    }

    /** The user stopped/declined the run — keep it resumable, drop the panel. */
    _onMovieStop() {
      this._persistMovieRun();
      this._movieRun?.stop();
      this._movieRun = null;
      this.requestUpdate?.();
    }

    /** Finalize the run's panel after start() resolves (paused or finished). */
    _settleMovieRun() {
      const run = this._movieRun;
      if (run && run.finished) {
        // The segment was already complete when we re-hosted (e.g. the user
        // navigated back to a finished page) — advance past it.
        if (!run.failed) this._advanceMovieDemo();
      }
      this.requestUpdate?.();
    }
  };
