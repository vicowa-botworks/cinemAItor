import { css, html, LitElement, nothing } from "lit";

/**
 * demo-runner — the demo-mode control panel (docs/demo.md).
 *
 * Controlled component: the host creates a DemoRun (demo-engine.js), assigns it
 * to `run`, and forwards the user's button intents back to the run:
 *   @continue — guided mode: run the prepared step (user may have edited it)
 *   @skip     — skip the prepared step
 *   @stop     — stop the run
 *   @close    — dismiss the panel (host clears its `run` reference)
 *
 * The runner renders the run's step checklist (grouped by `stage` when set)
 * and a scrolling narration log fed by the engine's events — every setting
 * the demo fills is narrated as it happens, which is the point of the demo:
 * to show the user how the app works.
 */
export class DemoRunner extends LitElement {
  static properties = {
    // A DemoRun instance (plain property: no attribute conversion).
    run: {},
    title: { type: String },
    subtitle: { type: String },
    _states: { state: true },
    _log: { state: true },
    _paused: { type: Boolean, state: true },
    _phase: { type: String, state: true },
  };

  constructor() {
    super();
    this.run = null;
    this.title = "Demo";
    this.subtitle = "";
    this._states = [];
    this._log = [];
    this._paused = false;
    this._phase = "intro";
  }

  set run(value) {
    if (this._runRef) this._runRef._onEvent = () => {};
    this._runRef = value;
    this._paused = false;
    this._phase = "intro";
    this._log = [];
    if (value) {
      value._onEvent = (event) => this._onEvent(event);
      this._states = value.states;
      if (this.renderRoot) this.requestUpdate();
    }
  }

  get run() {
    return this._runRef;
  }

  _emit(type) {
    this.dispatchEvent(
      new CustomEvent(type, { bubbles: true, composed: true }),
    );
  }

  _stepLabel(meta, index, total) {
    return `Step ${index + 1} of ${total} — ${meta.title}`;
  }

  _logEntry(key) {
    return this._log.find((entry) => entry.key === key);
  }

  _syncStates() {
    if (this._runRef) this._states = this._runRef.states;
  }

  _onEvent(e) {
    const total = this._runRef ? this._runRef.states.length : 0;
    switch (e.type) {
      case "start":
        this._phase = "running";
        this._log = [
          {
            key: "start",
            cls: "info",
            title: this.title,
            text: `${e.total} steps (${
              e.mode === "guided" ? "guided" : "automatic"
            }). I'll narrate everything I do as it runs — this is how the app does this by hand.`,
            live: "",
          },
        ];
        break;
      case "step-start":
        this._log.push({
          key: e.step.id,
          cls: "step",
          title: this._stepLabel(e.step, e.index, total),
          text: "Setting things up…",
          live: "",
        });
        break;
      case "step-ready": {
        const entry = this._logEntry(e.step.id);
        if (entry) entry.text = e.narration || "Ready.";
        break;
      }
      case "pause":
        this._paused = true;
        break;
      case "step-running": {
        const entry = this._logEntry(e.step.id);
        if (entry) entry.live = " Running — watching the job…";
        break;
      }
      case "step-progress": {
        const entry = this._logEntry(e.step.id);
        if (entry) {
          const pct = e.progress != null ? `${Math.round(e.progress)}%` : "";
          entry.live = ` ${pct ? `▸ ${pct}` : "▸"}${e.note ? ` — ${e.note}` : "…"}`;
        }
        break;
      }
      case "step-done": {
        const entry = this._logEntry(e.step.id);
        if (entry) entry.live = " ✓ done";
        break;
      }
      case "step-skipped": {
        const entry = this._logEntry(e.step.id);
        if (entry) entry.live = " – skipped";
        break;
      }
      case "step-failed": {
        const entry = this._logEntry(e.step.id);
        if (entry) entry.live = ` ✗ failed: ${e.error}`;
        break;
      }
      case "done":
        this._phase = "done";
        this._paused = false;
        this._log.push({
          key: "end",
          cls: "end",
          title: "Demo complete",
          text:
            "Everything is saved in the app exactly as it would be if you had done it by hand. Explore the pages — that's the next step in learning.",
          live: "",
        });
        break;
      case "failed":
        this._phase = "failed";
        this._paused = false;
        this._log.push({
          key: "end",
          cls: "error",
          title: "Demo stopped",
          text: `The step "${e.step.title}" failed: ${e.error}`,
          live: "",
        });
        break;
      case "stopped":
        this._phase = "stopped";
        this._paused = false;
        this._log.push({
          key: "end",
          cls: "info",
          title: "Demo stopped",
          text: `Stopped after ${e.completed} step${
            e.completed === 1 ? "" : "s"
          }. Anything already created is kept.`,
          live: "",
        });
        break;
      default:
        break;
    }
    this._syncStates();
    this.requestUpdate();
  }

  updated() {
    const log = this.shadowRoot.querySelector(".log");
    if (log) log.scrollTop = log.scrollHeight;
  }

  _statusIcon(state) {
    switch (state.status) {
      case "done":
        return "✓";
      case "failed":
        return "✗";
      case "skipped":
        return "–";
      case "running":
        return "●";
      case "preparing":
        return "…";
      case "ready":
        return "✎";
      default:
        return "·";
    }
  }

  _checklist() {
    const hasStage = this._states.some((s) => s.stage);
    if (!hasStage) {
      return html`
        ${this._states.map(
          (s) =>
            html`
              <div class="row ${s.status} ${this._paused && s.status === "ready"
                ? "awaiting"
                : ""}">
                <span class="icon ${s.status}">${this._statusIcon(s)}</span>
                <span class="label">${s.title}</span>
                ${s.status === "running" && s.progress != null
                  ? html`<span class="pct">${Math.round(s.progress)}%</span>`
                  : nothing}
              </div>
              ${s.status === "running" && s.progress != null
                ? html`
                  <div class="bar">
                    <div class="fill" style="width: ${Math.min(
                      100,
                      Math.max(0, s.progress),
                    )}%"></div>
                  </div>
                `
                : nothing}
            `,
        )}
      `;
    }
    const stages = [];
    for (const s of this._states) {
      if (!stages.includes(s.stage)) stages.push(s.stage);
    }
    return html`
      ${stages.map(
        (stage) =>
          html`
            <div class="stage">${stage}</div>
            ${this._states
              .filter((s) => s.stage === stage)
              .map(
                (s) =>
                  html`
                    <div class="row ${s
                      .status} ${this._paused && s.status === "ready" ? "awaiting" : ""}">
                      <span class="icon ${s.status}">${this._statusIcon(
                        s,
                      )}</span>
                      <span class="label">${s.title}</span>
                      ${s.status === "running" && s.progress != null
                        ? html`<span class="pct">${Math.round(s.progress)}%</span>`
                        : nothing}
                    </div>
                    ${s.status === "running" && s.progress != null
                      ? html`
                        <div class="bar">
                          <div class="fill" style="width: ${Math.min(
                            100,
                            Math.max(0, s.progress),
                          )}%"></div>
                        </div>
                      `
                      : nothing}
                  `,
              )}
          `,
      )}
    `;
  }

  render() {
    if (!this.run) return nothing;
    const finished = this._phase === "done" || this._phase === "failed" ||
      this._phase === "stopped";
    return html`
      <div class="panel">
        <div class="header">
          <span class="title">${this.title}</span>
          ${this.subtitle ? html`<span class="subtitle">${this.subtitle}</span>` : nothing}
          <span class="spacer"></span>
          <button class="btn btn-ghost" ?disabled=${!finished} @click=${() => this._emit("close")}
            title="${finished ? "Close" : "Stop the demo to close"}">
            ✕
          </button>
        </div>
        <div class="body">
          <div class="checklist">${this._checklist()}</div>
          <div class="log">
            ${this._log.map(
              (entry) =>
                html`
                  <div class="entry ${entry.cls}">
                    ${entry.title ? html`<div class="entry-title">${entry.title}</div>` : nothing}
                    <div class="entry-text">${entry.text}</div>
                    ${entry.live
                      ? html`<div class="entry-live ${
                        this._phase === "failed" ? "error" : ""
                      }">${entry.live}</div>`
                      : nothing}
                  </div>
                `,
            )}
          </div>
        </div>
        ${this._paused
          ? html`
            <div class="footer">
              <span
                class="hint">Edit anything above — the prompt, the settings — then continue. Or skip this step.</span>
              <span class="spacer"></span>
              <button class="btn btn-danger" @click=${() => this._emit("stop")}>Stop</button>
              <button class="btn" @click=${() => this._emit("skip")}>Skip</button>
              <button class="btn btn-primary" @click=${() =>
                this._emit("continue")}>Continue →</button>
            </div>
          `
          : html`
            <div class="footer">
              ${finished
                ? html`<span class="hint">${
                  this._phase === "done"
                    ? "Demo complete."
                    : this._phase === "failed"
                    ? "Demo stopped at a failed step."
                    : "Demo stopped."
                }</span>`
                : html`<span class="hint">${
                  this._phase === "intro" ? "Starting…" : "Running — I'll narrate each step."
                }</span>`}
              <span class="spacer"></span>
              ${finished
                ? html`<button class="btn btn-primary" @click=${() =>
                  this._emit("close")}>Close</button>`
                : html`<button class="btn btn-danger" @click=${() =>
                  this._emit("stop")}>Stop</button>`}
            </div>
          `}
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }
    .panel {
      display: flex;
      flex-direction: column;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      max-height: 480px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--color-border);
    }
    .title {
      font-weight: 600;
    }
    .subtitle {
      color: var(--color-text-muted);
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 60%;
    }
    .spacer {
      flex: 1;
    }
    .body {
      display: grid;
      grid-template-columns: 250px 1fr;
      gap: 0;
      flex: 1;
      min-height: 0;
    }
    .checklist {
      border-right: 1px solid var(--color-border);
      padding: 10px 8px;
      overflow-y: auto;
      max-height: 360px;
      font-size: 13px;
    }
    .stage {
      color: var(--color-text-muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 8px 8px 2px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 8px;
      border-radius: 6px;
    }
    .row.awaiting {
      background: var(--color-surface-hover);
      outline: 1px solid var(--color-primary);
    }
    .icon {
      width: 16px;
      text-align: center;
      flex-shrink: 0;
    }
    .icon.done {
      color: var(--color-success);
    }
    .icon.failed {
      color: var(--color-error);
    }
    .icon.running {
      color: var(--color-primary);
    }
    .icon.ready {
      color: var(--color-warning);
    }
    .icon.skipped,
    .icon.pending {
      color: var(--color-text-muted);
    }
    .label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row.done .label,
    .row.skipped .label {
      color: var(--color-text-muted);
    }
    .pct {
      color: var(--color-text-muted);
      font-size: 12px;
    }
    .bar {
      height: 3px;
      background: var(--color-border);
      border-radius: 2px;
      margin: 1px 8px 4px 32px;
      overflow: hidden;
    }
    .fill {
      height: 100%;
      background: var(--color-primary);
    }
    .log {
      padding: 10px 14px;
      overflow-y: auto;
      max-height: 360px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      font-size: 13px;
    }
    .entry {
      line-height: 1.45;
    }
    .entry-title {
      font-weight: 600;
      margin-bottom: 2px;
    }
    .entry.info .entry-title,
    .entry.end .entry-title {
      color: var(--color-primary);
    }
    .entry.error .entry-title {
      color: var(--color-error);
    }
    .entry-text {
      color: var(--color-text);
      white-space: pre-wrap;
    }
    .entry-live {
      color: var(--color-text-muted);
    }
    .entry-live.error {
      color: var(--color-error);
    }
    .footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid var(--color-border);
    }
    .hint {
      color: var(--color-text-muted);
      font-size: 13px;
    }
    .btn {
      font-size: 13px;
      padding: 7px 14px;
      background: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }
    .btn:hover {
      background: var(--color-border);
    }
    .btn:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .btn-primary {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: #fff;
    }
    .btn-primary:hover {
      background: var(--color-primary-hover);
    }
    .btn-danger {
      color: var(--color-error);
    }
    .btn-ghost {
      background: transparent;
      border: none;
      padding: 4px 8px;
      color: var(--color-text-muted);
    }
    .btn-ghost:hover {
      background: var(--color-surface-hover);
      color: var(--color-text);
    }
  `;
}

customElements.define("demo-runner", DemoRunner);
