import { html, nothing } from "lit";
import { api } from "../api.js";
import { demoPreflight } from "./demo-content.js";
import { DemoRun } from "./demo-engine.js";
import "./demo-launcher.js";
import "./demo-runner.js";

/**
 * Runs kept alive across a route change, keyed by the host's
 * `demoKeepAliveKey`. A run parked here keeps executing while its host page is
 * unmounted; the next time that page mounts it is reattached (see
 * `_reattachLiveDemo`). Module-level so it outlives the page component, which
 * the router tears down on every navigation.
 */
const liveDemoRuns = new Map();

/**
 * DemoHost — mixin that adds the demo-mode entry point to a page component
 * (docs/demo.md).
 *
 * Host contract:
 *   - `demoTitle` — a string (property or getter) shown on the control panel.
 *   - `demoSubtitle` — optional string (e.g. the object the demo works on).
 *   - `buildDemoSteps(mode, preflight)` — the ordered engine steps for the
 *     page. Steps are plain functions that drive the page's real handlers
 *     (its own methods, its form elements), so both modes run the same step
 *     list — the engine differs: auto runs the steps back to back, guided
 *     pauses after each prepare so the user can edit anything before
 *     continuing.
 *
 * The host renders:
 *   - `${this.demoLauncher}` — the demo launcher (put it in the page header),
 *   - `${this.demoRunnerPanel}` — the control panel while a run is alive.
 *
 * Lifecycle: by default a run that is still alive when the page is disconnected
 * (route change) is stopped — the jobs it queued finish server-side, the
 * narration ends with the page. A host that opts into `demoKeepAliveKey` keeps
 * its run alive across the navigation instead: the run (whose steps must drive
 * the API, not the page's form) keeps executing while the page is gone, and the
 * next time the page mounts the still-running run is reattached so the progress
 * card reappears mid-run (issue #197).
 */
export const DemoHost = (superClass) =>
  class extends superClass {
    constructor() {
      super();
      this._demoRun = null;
      this._demoStarting = false;
      this._demoError = "";
      this._demoNavHandler = null;
    }

    connectedCallback() {
      super.connectedCallback?.();
      this._demoNavHandler = () => this._onDemoNavigate();
      window.addEventListener("hashchange", this._demoNavHandler);
      this._reattachLiveDemo();
    }

    disconnectedCallback() {
      super.disconnectedCallback?.();
      if (this._demoNavHandler) {
        window.removeEventListener("hashchange", this._demoNavHandler);
        this._demoNavHandler = null;
      }
      const key = this.demoKeepAliveKey;
      const run = this._demoRun;
      if (key && run && !run.finished && !run.stopped) {
        // Keep it running; the next mount of this page reattaches it.
        liveDemoRuns.set(key, run);
      } else {
        if (key) liveDemoRuns.delete(key);
        run?.stop();
      }
      this._demoRun = null;
    }

    /**
     * Opt into cross-navigation keep-alive by returning a stable non-empty key.
     * Only valid for hosts whose steps drive the API rather than the page's own
     * form (so they can run with the page unmounted) — the Projects-page auto
     * movie demo. Empty (default) keeps the run tied to the page.
     */
    get demoKeepAliveKey() {
      return "";
    }

    /** Readopt a run that survived a navigation to another page and back. */
    _reattachLiveDemo() {
      const key = this.demoKeepAliveKey;
      if (!key || this._demoRun) return;
      const run = liveDemoRuns.get(key);
      if (!run) return;
      if (run.finished || run.stopped) {
        liveDemoRuns.delete(key);
        return;
      }
      run.ctx.host = this; // steps that do reference the host see the live page
      this._demoRun = run;
      this.requestUpdate?.();
    }

    /**
     * The "Demo: auto / guided" launcher, for the page header. A host may set
     * `demoHideGuided` to show only the auto button — the Projects page does,
     * because its guided run is the separate cross-page "Guided movie demo", so
     * a single-page guided button would just be a redundant subset of it.
     */
    get demoLauncher() {
      return html`
        ${this._demoError
          ? html`<div class="error" style="font-size:13px;">${this._demoError}</div>`
          : nothing}
        <demo-launcher
          .busy=${this._demoStarting || Boolean(this._demoRun)}
          .starting=${this._demoStarting}
          .title=${this.demoTitle ?? "Demo"}
          .hideGuided=${this.demoHideGuided === true}
          @start-demo=${this._onStartDemo}></demo-launcher>
      `;
    }

    /** The control panel, rendered while a run is alive (nothing when idle). */
    get demoRunnerPanel() {
      if (!this._demoRun) return nothing;
      return html`
        <demo-runner
          .run=${this._demoRun}
          title=${this.demoTitle ?? "Demo"}
          subtitle=${this.demoSubtitle ?? ""}
          @continue=${() => this._demoRun?.continue()}
          @skip=${() => this._demoRun?.skip()}
          @stop=${this._demoStop}
          @close=${this._demoClose}></demo-runner>
      `;
    }

    /** `start-demo` handler: preflight → build steps → create + start the run. */
    async _onStartDemo(e) {
      const mode = e?.detail?.mode ?? "auto";
      if (this._demoStarting || this._demoRun) return;
      this._demoStarting = true;
      this._demoError = "";
      this.requestUpdate?.();
      try {
        const preflight = await demoPreflight(api);
        const steps = this.buildDemoSteps(mode, preflight);
        const run = new DemoRun({
          steps,
          mode,
          ctx: { api, host: this, mode, preflight, scratch: {} },
        });
        this._demoStarting = false;
        this._demoRun = run;
        this.requestUpdate?.();
        await run.start();
      } catch (err) {
        this._demoStarting = false;
        this._demoError = err instanceof Error ? err.message : String(err);
        this.requestUpdate?.();
      }
    }

    _onDemoNavigate() {
      // A keep-alive host parks its run in `disconnectedCallback` (which fires
      // right after this, once the router swaps the view) — don't stop it here.
      if (this.demoKeepAliveKey) return;
      const run = this._demoRun;
      if (!run) return;
      if (run.finished) {
        this._demoRun = null;
        this.requestUpdate?.();
        return;
      }
      run.stop();
    }

    _demoStop() {
      if (this.demoKeepAliveKey) liveDemoRuns.delete(this.demoKeepAliveKey);
      this._demoRun?.stop();
    }

    _demoClose() {
      if (this.demoKeepAliveKey) liveDemoRuns.delete(this.demoKeepAliveKey);
      this._demoRun?.stop();
      this._demoRun = null;
      this.requestUpdate?.();
    }
  };
