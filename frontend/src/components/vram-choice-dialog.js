import { css, html, LitElement, nothing } from "lit";

/**
 * vram-choice-dialog — pre-submit VRAM decision modal for prompt-based
 * generation.
 *
 * Shown by asset-generate when the selected local_cli model declares a VRAM
 * requirement that the GPU's current free VRAM cannot cover. The host owns
 * `open` and the displayed numbers; the dialog only reports intent:
 *   @choose  — detail { device: "cpu" } — generate on the CPU anyway
 *   @recheck — the user freed (or is about to free) VRAM and wants a live
 *              re-probe; the host re-checks and either auto-continues on the
 *              GPU or leaves the dialog open with updated numbers
 *   @cancel  — the user dismissed (cancel button, Escape, or overlay click)
 *
 * While `rechecking` is true (the host's live probe is in flight) every
 * action is disabled and the recheck button shows a spinner.
 */
export class VramChoiceDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    requirementGb: { type: String },
    freeGb: { type: String },
    gpuModel: { type: String },
    rechecking: { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.open = false;
    this.requirementGb = "";
    this.freeGb = "";
    this.gpuModel = "";
    this.rechecking = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._docKeyDown = (e) => {
      if (this.open && e.key === "Escape") {
        e.preventDefault();
        this._cancel();
      }
    };
    document.addEventListener("keydown", this._docKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("keydown", this._docKeyDown);
  }

  updated(changed) {
    if (changed.has("open") && this.open) {
      this.shadowRoot.querySelector(".btn-recheck")?.focus();
    }
  }

  _emit(type, detail) {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  }

  _chooseCpu() {
    if (this.rechecking) return;
    this._emit("choose", { device: "cpu" });
  }

  _recheck() {
    if (this.rechecking) return;
    this._emit("recheck", {});
  }

  _cancel() {
    if (this.rechecking) return;
    this._emit("cancel", {});
  }

  _onOverlayClick(e) {
    if (e.target === e.currentTarget) this._cancel();
  }

  render() {
    if (!this.open) return nothing;
    const gpu = this.gpuModel ? ` on ${this.gpuModel}` : "";
    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div
          class="card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vram-dialog-title"
        >
          <div class="card-title" id="vram-dialog-title">
            Not enough VRAM for this model
          </div>
          <div class="message">
            This model needs about ${this.requirementGb} of VRAM, but only
            ${this.freeGb} is free${gpu}.
            <br /><br />
            Close other GPU apps to free VRAM and recheck — or generate on
            the CPU, which works but is much slower (often hours for large
            models).
          </div>
          <div class="actions">
            <button class="btn btn-cancel" ?disabled=${this.rechecking}
              @click=${this._cancel}>
              Cancel
            </button>
            <button class="btn btn-cpu" ?disabled=${this.rechecking}
              @click=${this._chooseCpu}>
              Generate on CPU
            </button>
            <button class="btn btn-recheck" ?disabled=${this.rechecking}
              @click=${this._recheck}>
              ${this.rechecking ? "Checking…" : "Free VRAM & recheck"}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
    }

    .overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(4, 4, 10, 0.72);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      animation: vc-fade 120ms ease-out;
    }

    .card {
      width: 100%;
      max-width: 480px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-top: 3px solid var(--color-warning, #d9a441);
      border-radius: calc(var(--radius) + 4px);
      box-shadow: var(--shadow);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      animation: vc-pop 140ms ease-out;
    }

    .card-title {
      font-size: 16px;
      font-weight: 600;
    }

    .message {
      font-size: 14px;
      color: var(--color-text-muted);
      line-height: 1.5;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 18px;
      flex-wrap: wrap;
    }

    .btn {
      padding: 9px 18px;
      font-size: 14px;
      font-weight: 500;
      border-radius: var(--radius);
      border: 1px solid var(--color-border);
      background: var(--color-surface-hover);
      color: var(--color-text);
      transition: background-color 0.2s, border-color 0.2s, color 0.2s;
    }

    .btn:hover:not(:disabled) {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }

    .btn:disabled {
      opacity: 0.55;
      cursor: default;
    }

    .btn-recheck {
      position: relative;
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: #fff;
    }

    .btn-recheck:hover:not(:disabled) {
      background: var(--color-primary-hover);
      border-color: var(--color-primary-hover);
      color: #fff;
    }

    .btn-recheck:disabled {
      color: transparent;
    }

    .btn-recheck:disabled::before {
      content: "";
      position: absolute;
      inset: 0;
      margin: auto;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: #fff;
      animation: vc-spin 0.8s linear infinite;
    }

    @keyframes vc-fade {
      from {
        opacity: 0;
      }

      to {
        opacity: 1;
      }
    }

    @keyframes vc-pop {
      from {
        opacity: 0;
        transform: scale(0.96);
      }

      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes vc-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;
}

customElements.define("vram-choice-dialog", VramChoiceDialog);
