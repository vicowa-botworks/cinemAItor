import { css, html, LitElement, nothing } from "lit";

/**
 * demo-launcher — the "Demo" launcher for a page's demo mode (docs/demo.md).
 *
 * Two buttons, two engine modes:
 *   auto   — the page runs its own workflow end to end, narrating every step
 *   guided — the page pauses at each step so the user can change anything
 *
 * `hideGuided` shows only the auto button. The Projects page sets it: its
 * guided run is the separate cross-page "Guided movie demo", so a single-page
 * guided button there would be a redundant subset of it.
 *
 * Hosts (demo-host.js) embed `${this.demoLauncher}` in their header and listen
 * for the `start-demo` event (detail {mode}); the launcher holds no demo state.
 */
export class DemoLauncher extends LitElement {
  static styles = css`
    .launcher {
      display: inline-flex;
      gap: 6px;
    }

    .launcher button {
      padding: 6px 12px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }

    .launcher button:hover:not(:disabled) {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .launcher button:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `;

  static properties = {
    busy: { type: Boolean },
    title: { type: String },
    hideGuided: { type: Boolean },
    starting: { type: Boolean },
  };

  constructor() {
    super();
    this.busy = false;
    this.title = "Demo";
    this.hideGuided = false;
    this.starting = false;
  }

  _title() {
    return this.hideGuided
      ? "Learn by watching: the demo runs this page's real workflow, narrating every step and setting."
      : "Learn by watching: the demo runs this page's real workflow, narrating every step and setting. " +
        "'auto' runs it all; 'guided' pauses at each step so you can change anything before it continues.";
  }

  _start(mode) {
    if (this.busy) return;
    this.dispatchEvent(
      new CustomEvent("start-demo", { bubbles: true, composed: true, detail: { mode } }),
    );
  }

  render() {
    // While a run is starting or alive, collapse to one labelled button so the
    // click is visibly registered (no still-clickable buttons) and a
    // double-click can't queue a second run.
    if (this.busy) {
      return html`
        <span class="launcher" title=${this._title()}>
          <button disabled>${this.starting ? "Starting…" : "Running…"}</button>
        </span>
      `;
    }
    return html`
      <span class="launcher" title=${this._title()}>
        <button @click=${() => this._start("auto")}>
          Demo: auto
        </button>
        ${this.hideGuided ? nothing : html`
          <button @click=${() => this._start("guided")}>
            Demo: guided
          </button>
        `}
      </span>
    `;
  }
}

customElements.define("demo-launcher", DemoLauncher);
