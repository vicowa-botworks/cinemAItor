import { css, html, LitElement } from "lit";
import { api } from "../api.js";

export class LoginForm extends LitElement {
  static styles = css`
    .login-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: calc(100vh - 70px);
      padding: 20px;
    }

    .login-card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 40px;
      width: 100%;
      max-width: 420px;
      box-shadow: var(--shadow);
    }

    .tabs {
      display: flex;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--color-border);
    }

    .tab {
      flex: 1;
      padding: 12px;
      text-align: center;
      background: transparent;
      color: var(--color-text-muted);
      border: none;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      font-size: 15px;
    }

    .tab.active {
      color: var(--color-primary);
      border-bottom-color: var(--color-primary);
    }

    .tab:hover:not(.active) {
      color: var(--color-text);
    }

    h2 {
      text-align: center;
      margin-bottom: 24px;
      font-size: 22px;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      color: var(--color-text-muted);
      font-weight: 500;
    }

    .form-group input {
      margin-bottom: 0;
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
    }

    .btn-submit:hover {
      background-color: var(--color-primary-hover);
    }

    .btn-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .hint {
      color: var(--color-text-muted);
      font-size: 12px;
      text-align: center;
      margin-top: 12px;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
      text-align: center;
      margin-top: 12px;
      min-height: 20px;
    }
  `;

  static properties = {
    isLogin: {},
    email: {},
    password: {},
    displayName: {},
    error: {},
    loading: {},
  };

  constructor() {
    super();
    this.isLogin = true;
    this.email = "";
    this.password = "";
    this.displayName = "";
    this.error = "";
    this.loading = false;
  }

  _toggleMode() {
    this.isLogin = !this.isLogin;
    this.error = "";
  }

  _submitLabel() {
    if (this.loading) return "Processing...";
    return this.isLogin ? "Login" : "Create first account";
  }

  async _submit(e) {
    e.preventDefault();
    this.error = "";
    this.loading = true;

    try {
      let result;
      if (this.isLogin) {
        result = await api.login(this.email, this.password);
      } else {
        if (!this.displayName.trim()) {
          this.error = "Display name is required";
          return;
        }
        result = await api.bootstrap(
          this.email,
          this.password,
          this.displayName,
        );
      }
      api.setToken(result.token);
      localStorage.setItem("token", result.token);
      window.dispatchEvent(
        new CustomEvent("auth-change", {
          detail: { loggedIn: true, user: result.user },
        }),
      );
      window.location.hash = "#/projects";
    } catch (err) {
      this.error = err.message || "Authentication failed";
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html`
      <div class="login-container">
        <div class="login-card">
          <div class="tabs">
            <button class="tab ${this.isLogin ? "active" : ""}" @click=${this
              ._toggleMode}>Login</button>
            <button class="tab ${!this.isLogin ? "active" : ""}" @click=${this
              ._toggleMode}>Setup</button>
          </div>

          <h2>${this.isLogin ? "Welcome back" : "Initial setup"}</h2>

          <form @submit=${this._submit}>
            ${!this.isLogin
              ? html`
                <div class="form-group">
                  <label for="displayName">Display Name</label>
                  <input id="displayName" type="text" .value=${this.displayName}
                    @input=${this._onDisplayNameInput} required />
                </div>
              `
              : ""}

            <div class="form-group">
              <label for="email">Email</label>
              <input id="email" type="email" .value=${this.email} @input=${this
                ._onEmailInput} required />
            </div>

            <div class="form-group">
              <label for="password">Password</label>
              <input id="password" type="password" .value=${this.password}
                @input=${this._onPasswordInput} required minlength="8" />
            </div>

            <button type="submit" class="btn-submit" ?disabled=${this.loading}>
              ${this._submitLabel()}
            </button>
          </form>

          ${!this.isLogin
            ? html`
              <p class="hint">
                Only available on a fresh instance. The first account becomes the admin.
              </p>
            `
            : ""}

          <div class="error">${this.error}</div>
        </div>
      </div>
    `;
  }

  _onDisplayNameInput(e) {
    this.displayName = e.target.value;
  }

  _onEmailInput(e) {
    this.email = e.target.value;
  }

  _onPasswordInput(e) {
    this.password = e.target.value;
  }
}

customElements.define("login-form", LoginForm);
