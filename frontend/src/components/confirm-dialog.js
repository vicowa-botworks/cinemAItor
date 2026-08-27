import { css, html, LitElement, nothing } from "lit";

/**
 * confirm-dialog — reusable app-styled confirmation modal.
 *
 * Controlled component: the host owns `open` and decides when to close it.
 * The dialog only reports intent via events:
 *   @confirm — the user accepted
 *   @cancel  — the user dismissed (cancel button, Escape, or overlay click)
 *
 * While `busy` is true (a long-running operation is in flight), dismissal is
 * suppressed (buttons, Escape, overlay) and the confirm button shows
 * `busyLabel` with a spinner, so the user always sees the operation running.
 */
export class ConfirmDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    title: { type: String },
    message: { type: String },
    confirmLabel: { type: String },
    cancelLabel: { type: String },
    tone: { type: String },
    busy: { type: Boolean, reflect: true },
    busyLabel: { type: String },
  };

  constructor() {
    super();
    this.open = false;
    this.title = "";
    this.message = "";
    this.confirmLabel = "Confirm";
    this.cancelLabel = "Cancel";
    this.tone = "default";
    this.busy = false;
    this.busyLabel = "Working…";
  }

  connectedCallback() {
    super.connectedCallback();
    this._docKeyDown = (e) => {
      if (this.open && e.key === "Escape") {
        e.preventDefault();
        this._dismiss();
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
      this.shadowRoot.querySelector(".btn-confirm")?.focus();
    }
  }

  _dismiss() {
    if (this.busy) return;
    this.dispatchEvent(
      new CustomEvent("cancel", { bubbles: true, composed: true }),
    );
  }

  _accept() {
    if (this.busy) return;
    this.dispatchEvent(
      new CustomEvent("confirm", { bubbles: true, composed: true }),
    );
  }

  _onOverlayClick(e) {
    if (e.target === e.currentTarget) this._dismiss();
  }

  render() {
    if (!this.open) return nothing;
    const danger = this.tone === "danger";
    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div
          class="card ${danger ? "danger" : ""}"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div class="card-title" id="confirm-dialog-title">
            ${this.title}
          </div>
          <div class="message">${this.message}</div>
          <div class="actions">
            <button
              class="btn btn-cancel"
              ?disabled=${this.busy}
              @click=${this._dismiss}
            >
              ${this.cancelLabel}
            </button>
            <button
              class="btn btn-confirm ${danger ? "btn-danger" : ""}"
              ?disabled=${this.busy}
              @click=${this._accept}
            >
              ${this.busy ? this.busyLabel : this.confirmLabel}
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
      animation: cd-fade 120ms ease-out;
    }

    .card {
      width: 100%;
      max-width: 460px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: calc(var(--radius) + 4px);
      box-shadow: var(--shadow);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      animation: cd-pop 140ms ease-out;
    }

    .card.danger {
      border-top: 3px solid var(--color-error);
    }

    .card-title {
      font-size: 16px;
      font-weight: 600;
    }

    .message {
      font-size: 14px;
      color: var(--color-text-muted);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 4px;
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

    .btn-confirm {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: #fff;
    }

    .btn-confirm:hover:not(:disabled) {
      background: var(--color-primary-hover);
      border-color: var(--color-primary-hover);
      color: #fff;
    }

    .btn-danger {
      background: transparent;
      border-color: var(--color-error);
      color: var(--color-error);
    }

    .btn-danger:hover:not(:disabled) {
      background: var(--color-error);
      color: #fff;
    }

    .btn-confirm:disabled {
      position: relative;
      color: transparent;
    }

    .btn-confirm:disabled::before {
      content: "";
      position: absolute;
      inset: 0;
      margin: auto;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.35);
      border-top-color: #fff;
      animation: cd-spin 0.8s linear infinite;
    }

    .btn-danger.btn-confirm:disabled::before {
      border-color: rgba(233, 69, 96, 0.35);
      border-top-color: var(--color-error);
    }

    @keyframes cd-fade {
      from {
        opacity: 0;
      }

      to {
        opacity: 1;
      }
    }

    @keyframes cd-pop {
      from {
        opacity: 0;
        transform: scale(0.96);
      }

      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes cd-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;
}

customElements.define("confirm-dialog", ConfirmDialog);
