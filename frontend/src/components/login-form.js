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
      cursor: pointer;
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
      cursor: pointer;
    }

    .btn-submit:hover {
      background-color: var(--color-primary-hover);
    }

    .btn-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-ghost {
      width: 100%;
      background: transparent;
      color: var(--color-primary);
      padding: 8px;
      font-size: 13px;
      margin-top: 6px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      cursor: pointer;
    }

    .hint {
      color: var(--color-text-muted);
      font-size: 12px;
      text-align: center;
      margin-top: 12px;
    }

    .links {
      display: flex;
      justify-content: space-between;
      margin-top: 10px;
    }

    .links a {
      color: var(--color-primary);
      font-size: 13px;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
      text-align: center;
      margin-top: 12px;
      min-height: 20px;
    }

    .notice {
      color: var(--color-text-muted);
      font-size: 13px;
      text-align: center;
      margin-top: 10px;
    }
  `;

  static properties = {
    tab: {},
    email: {},
    password: {},
    displayName: {},
    error: {},
    loading: {},
    registered: {},
    registrationEnabled: {},
    registeredNow: {},
    resendNotice: {},
    unconfirmedEmail: {},
  };

  constructor() {
    super();
    this.tab = "login";
    this.email = "";
    this.password = "";
    this.displayName = "";
    this.error = "";
    this.loading = false;
    this.registered = false;
    this.registrationEnabled = false;
    this.registeredNow = false;
    this.resendNotice = "";
    this.unconfirmedEmail = "";
  }

  connectedCallback() {
    super.connectedCallback?.();
    api.getAuthSetupStatus().then((status) => {
      this.registered = Boolean(status.registered);
      this.registrationEnabled = Boolean(status.registration_enabled);
      if (this.tab === "setup" && this.registered) this.tab = "login";
      if (
        this.tab === "register" &&
        (!this.registered || !this.registrationEnabled)
      ) {
        this.tab = "login";
      }
    }).catch(() => {});
  }

  _tabs() {
    const tabs = [{ id: "login", label: "Login" }];
    if (!this.registered) tabs.push({ id: "setup", label: "Setup" });
    if (this.registered && this.registrationEnabled) {
      tabs.push({ id: "register", label: "Register" });
    }
    return tabs;
  }

  _selectTab(tab) {
    if (tab === "setup" && this.registered) return;
    if (tab === "register" && !this.registrationEnabled) return;
    this.tab = tab;
    this.error = "";
    this.resendNotice = "";
    this.registeredNow = false;
  }

  _heading() {
    if (this.tab === "setup") return "Initial setup";
    if (this.tab === "register") return "Create an account";
    return "Welcome back";
  }

  _submitLabel() {
    if (this.loading) return "Processing...";
    if (this.tab === "setup") return "Create first account";
    if (this.tab === "register") return "Create account";
    return "Login";
  }

  _login(result) {
    api.setToken(result.token);
    localStorage.setItem("token", result.token);
    window.dispatchEvent(
      new CustomEvent("auth-change", {
        detail: { loggedIn: true, user: result.user },
      }),
    );
    window.location.hash = result.user?.must_change_password ? "#/change-password" : "#/projects";
  }

  async _submit(e) {
    e.preventDefault();
    this.error = "";
    this.resendNotice = "";
    this.unconfirmedEmail = "";

    if (this.tab !== "login" && !this.displayName.trim()) {
      this.error = "Display name is required";
      return;
    }
    this.loading = true;

    try {
      let result;
      if (this.tab === "login") {
        result = await api.login(this.email, this.password);
      } else if (this.tab === "setup") {
        result = await api.bootstrap(
          this.email,
          this.password,
          this.displayName,
        );
      } else {
        result = await api.register(
          this.email,
          this.password,
          this.displayName,
        );
        if (!result.token) {
          // Confirmation is required: no session until the link is opened.
          this.registeredNow = true;
          this.loading = false;
          return;
        }
      }
      this._login(result);
    } catch (err) {
      this.loading = false;
      if (err.code === "EMAIL_NOT_CONFIRMED") {
        this.unconfirmedEmail = this.email.trim();
        this.error = err.message ||
          "This email address has not been confirmed yet. Open the confirmation link in your inbox.";
      } else {
        this.error = err.message || "Authentication failed";
      }
    }
  }

  async _resendConfirmation() {
    this.error = "";
    this.resendNotice = "";
    try {
      await api.resendEmailConfirmation(this.unconfirmedEmail);
      this.resendNotice = "Confirmation email sent — check your inbox.";
    } catch (err) {
      this.error = err.message || "Could not resend the confirmation email";
    }
  }

  render() {
    const tabs = this._tabs();

    return html`
      <div class="login-container">
        <div class="login-card">
          ${tabs.length > 1
            ? html`
              <div class="tabs">
                ${tabs.map((t) =>
                  html`
                    <button class="tab ${this.tab === t.id ? "active" : ""}"
                      @click=${() => this._selectTab(t.id)}>${t.label}</button>
                  `
                )}
              </div>
            `
            : ""}

          ${this.registeredNow
            ? html`
              <h2>Check your inbox</h2>
              <p class="hint">
                Your account was created for <strong>${this.email}</strong>.
                Open the confirmation link from your email to activate it —
                you can sign in right after.
              </p>
              <button class="btn-submit" @click=${() => this._selectTab("login")}>
                Back to login
              </button>
            `
            : html`
              <h2>${this._heading()}</h2>

              <form @submit=${this._submit}>
                ${this.tab !== "login"
                  ? html`
                    <div class="form-group">
                      <label for="displayName">Display Name</label>
                      <input id="displayName" type="text"
                        .value=${this.displayName}
                        @input=${this._onDisplayNameInput} required />
                    </div>
                  `
                  : ""}

                <div class="form-group">
                  <label for="email">Email</label>
                  <input id="email" type="email" .value=${this.email}
                    @input=${this._onEmailInput} required />
                </div>

                <div class="form-group">
                  <label for="password">Password</label>
                  <input id="password" type="password" .value=${this.password}
                    @input=${this._onPasswordInput} required minlength="8" />
                </div>

                <button type="submit" class="btn-submit"
                  ?disabled=${this.loading}>
                  ${this._submitLabel()}
                </button>
              </form>

              ${this.tab === "login"
                ? html`
                  <div class="links">
                    <a href="#/forgot-password">Forgot password?</a>
                  </div>
                `
                : ""}

              ${this.tab === "setup"
                ? html`
                  <p class="hint">
                    Only available on a fresh instance. The first account
                    becomes the admin.
                  </p>
                `
                : ""}

              ${this.tab === "register"
                ? html`
                  <p class="hint">
                    An email confirmation may be required before your first
                    sign-in.
                  </p>
                `
                : ""}

              ${this.unconfirmedEmail
                ? html`
                  <button class="btn-ghost" @click=${this._resendConfirmation}>
                    Resend confirmation email
                  </button>
                `
                : ""}

              ${this.resendNotice ? html`<div class="notice">${this.resendNotice}</div>` : ""}

              <div class="error">${this.error}</div>
            `}
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
