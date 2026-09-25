import { html, nothing } from "lit";
import { api } from "../api.js";
import { demoPreflight } from "./demo-content.js";
import { DemoRun } from "./demo-engine.js";
import "./demo-launcher.js";
import "./demo-runner.js";

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
 *   - `${this.demoLauncher}` — the button pair (put it in the page header),
 *   - `${this.demoRunnerPanel}` — the control panel while a run is alive.
 *
 * Lifecycle: a run that is still alive when the page is disconnected (route
 * change) is stopped — the jobs it queued finish server-side, the narration
 * ends with the page.
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
    }

    disconnectedCallback() {
      super.disconnectedCallback?.();
      if (this._demoNavHandler) {
        window.removeEventListener("hashchange", this._demoNavHandler);
        this._demoNavHandler = null;
      }
      this._demoRun?.stop();
      this._demoRun = null;
    }

    /** The "Demo: auto / guided" button pair, for the page header. */
    get demoLauncher() {
      return html`
        ${this._demoError
          ? html`<div class="error" style="font-size:13px;">${this._demoError}</div>`
          : nothing}
        <demo-launcher
          .busy=${this._demoStarting || Boolean(this._demoRun)}
          .title=${this.demoTitle ?? "Demo"}
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
          @stop=${() => this._demoRun?.stop()}
          @close=${this._demoClose}></demo-runner>
      `;
    }

    /** `start-demo` handler: preflight → build steps → create + start the run. */
    async _onStartDemo(e) {
      const mode = e?.detail?.mode ?? "auto";
      if (this._demoStarting || this._demoRun) return;
      this._demoStarting = true;
      this._demoError = "";
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
        await run.start();
      } catch (err) {
        this._demoStarting = false;
        this._demoError = err instanceof Error ? err.message : String(err);
      }
    }

    _onDemoNavigate() {
      const run = this._demoRun;
      if (!run) return;
      if (run.finished) {
        this._demoRun = null;
        return;
      }
      run.stop();
    }

    _demoClose() {
      this._demoRun?.stop();
      this._demoRun = null;
    }
  };
