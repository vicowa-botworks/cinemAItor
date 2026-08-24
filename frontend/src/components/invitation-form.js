import { css, html, LitElement } from "lit";
import { api } from "../api.js";

export class InvitationForm extends LitElement {
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
      background-color: var(--color-bg);
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
  `;

  static properties = {
    token: {},
    displayName: {},
    password: {},
    confirm: {},
    error: {},
    loading: {},
  };

  constructor() {
    super();
    this.token = "";
    this.displayName = "";
    this.password = "";
    this.confirm = "";
    this.error = "";
    this.loading = false;
  }

  async _submit(e) {
    e.preventDefault();
    this.error = "";
    if (this.password.length < 8) {
      this.error = "Password must be at least 8 characters";
      return;
    }
    if (this.password !== this.confirm) {
      this.error = "Passwords do not match";
      return;
    }
    this.loading = true;
    try {
      const result = await api.acceptInvitation(
        this.token,
        this.password,
        this.displayName.trim(),
      );
      api.setToken(result.token);
      localStorage.setItem("token", result.token);
      window.dispatchEvent(
        new CustomEvent("auth-change", {
          detail: { loggedIn: true, user: result.user },
        }),
      );
      window.location.hash = "#/projects";
    } catch (err) {
      this.error = err.message || "Could not accept the invitation";
      this.loading = false;
    }
  }

  render() {
    if (!this.token) {
      return html`
        <div class="container">
          <div class="card">
            <h2>Link missing</h2>
            <p class="sub">
              This invitation link is incomplete. Ask the person who invited
              you to send it again.
            </p>
          </div>
        </div>
      `;
    }

    return html`
      <div class="container">
        <div class="card">
          <h2>Accept invitation</h2>
          <p class="sub">
            Set up your account. Choose a display name and a password.
          </p>
          <form @submit=${this._submit}>
            <div class="form-group">
              <label for="displayName">Display name</label>
              <input id="displayName" type="text" .value=${this.displayName}
                @input=${(e) => (this.displayName = e.target.value)}
                maxlength="100" placeholder="Leave empty to use your email
                prefix" />
            </div>
            <div class="form-group">
              <label for="password">Password</label>
              <input id="password" type="password" .value=${this.password}
                @input=${(e) => (this.password = e.target.value)} required
                minlength="8" />
            </div>
            <div class="form-group">
              <label for="confirm">Repeat password</label>
              <input id="confirm" type="password" .value=${this.confirm}
                @input=${(e) => (this.confirm = e.target.value)} required
                minlength="8" />
            </div>
            <button type="submit" class="btn-submit" ?disabled=${this.loading}>
              ${this.loading ? "Creating account..." : "Create account"}
            </button>
          </form>
          <div class="error">${this.error}</div>
        </div>
      </div>
    `;
  }
}

customElements.define("invitation-form", InvitationForm);
