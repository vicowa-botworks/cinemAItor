import { css, html, LitElement } from "lit";
import { api } from "../api.js";

export class PasswordResetRequestForm extends LitElement {
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

    .form-group {
      margin-bottom: 16px;
      text-align: left;
    }

    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      color: var(--color-text-muted);
      font-weight: 500;
    }

    input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background-color: var(--color-bg, transparent);
      color: var(--color-text);
      font-size: 14px;
    }

    .btn-submit {
      width: 100%;
      background-color: var(--color-primary);
      color: white;
      padding: 12px;
      font-size: 15px;
      margin-top: 8px;
      border: none;
      border-radius: var(--radius);
      cursor: pointer;
    }

    .btn-submit:hover {
      background-color: var(--color-primary-hover);
    }

    .btn-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
      margin-top: 12px;
      min-height: 20px;
    }

    .success {
      color: #16a34a;
      font-size: 14px;
      margin-top: 16px;
    }

    a {
      color: var(--color-primary);
      font-size: 13px;
    }
  `;

  static properties = {
    email: {},
    error: {},
    loading: {},
    sent: {},
  };

  constructor() {
    super();
    this.email = "";
    this.error = "";
    this.loading = false;
    this.sent = false;
  }

  async _submit(e) {
    e.preventDefault();
    this.error = "";
    this.loading = true;
    try {
      await api.requestPasswordReset(this.email.trim());
      this.sent = true;
    } catch (err) {
      this.error = err.message || "Could not request a password reset";
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (this.sent) {
      return html`
        <div class="container">
          <div class="card">
            <h2>Check your inbox</h2>
            <p class="sub">
              If an account exists for <strong>${this.email}</strong>, a
              password reset link is on its way. The link is valid for 1
              hour.
            </p>
            <a href="#/login">&larr; Back to login</a>
          </div>
        </div>
      `;
    }

    return html`
      <div class="container">
        <div class="card">
          <h2>Forgot your password?</h2>
          <p class="sub">
            Enter your account email and we will send you a link to set a new
            password.
          </p>
          <form @submit=${this._submit}>
            <div class="form-group">
              <label for="email">Email</label>
              <input id="email" type="email" .value=${this.email}
                @input=${(e) => (this.email = e.target.value)} required />
            </div>
            <button type="submit" class="btn-submit" ?disabled=${this.loading}>
              ${this.loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
          <div class="error">${this.error}</div>
          <p><a href="#/login">&larr; Back to login</a></p>
        </div>
      </div>
    `;
  }
}

customElements.define("password-reset-request-form", PasswordResetRequestForm);
