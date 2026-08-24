import { css, html, LitElement } from "lit";
import { api } from "../api.js";

export class EmailConfirmForm extends LitElement {
  static styles = css`
    .container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: calc(100vh - 70px);
      padding: 20px;
    }

    .card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 40px;
      width: 100%;
      max-width: 420px;
      box-shadow: var(--shadow);
      text-align: center;
    }

    h2 {
      margin-bottom: 12px;
      font-size: 22px;
    }

    .sub {
      color: var(--color-text-muted);
      font-size: 14px;
      margin-bottom: 24px;
    }

    .ok {
      color: var(--color-success);
    }

    .bad {
      color: var(--color-error);
    }

    a {
      color: var(--color-primary);
      font-size: 13px;
    }
  `;

  static properties = {
    token: {},
    state: {},
    message: {},
  };

  constructor() {
    super();
    this.token = "";
    this.state = "working";
    this.message = "Confirming your email address...";
  }

  connectedCallback() {
    super.connectedCallback?.();
    this._confirm();
  }

  async _confirm() {
    if (!this.token) {
      this.state = "error";
      this.message =
        "This confirmation link is incomplete. Request a new link from the login page.";
      return;
    }
    this.state = "working";
    this.message = "Confirming your email address...";
    try {
      await api.confirmEmail(this.token);
      this.state = "success";
      this.message = "Your email address is confirmed. You can sign in now.";
    } catch (err) {
      this.state = "error";
      this.message = err.message || "Could not confirm the email address";
    }
  }

  render() {
    const tone = this.state === "success" ? "ok" : this.state === "error" ? "bad" : "";
    return html`
      <div class="container">
        <div class="card">
          <h2>Confirm your email</h2>
          <p class="sub ${tone}">${this.message}</p>
          ${this.state === "success" ? html`<a href="#/login">Sign in</a>` : ""}
          ${this.state === "error" ? html`<p><a href="#/login">Back to login</a></p>` : ""}
        </div>
      </div>
    `;
  }
}

customElements.define("email-confirm-form", EmailConfirmForm);
