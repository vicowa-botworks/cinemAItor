import { css, html } from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-html/lit-html.ts";
import { LitElement } from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-element/lit-element.ts";
import { customElement, state } from "lit/decorators.ts";
import { api } from "../api.ts";

@customElement("login-form")
export class LoginForm extends LitElement {
  static override styles = css`
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

    .error {
      color: var(--color-error);
      font-size: 13px;
      text-align: center;
      margin-top: 12px;
      min-height: 20px;
    }
  `;

  @state()
  private isLogin = true;
  @state()
  private email = "";
  @state()
  private password = "";
  @state()
  private displayName = "";
  @state()
  private error = "";
  @state()
  private loading = false;

  private _toggleMode(): void {
    this.isLogin = !this.isLogin;
    this.error = "";
  }

  private async _submit(e: Event): Promise<void> {
    e.preventDefault();
    this.error = "";
    this.loading = true;

    try {
      if (this.isLogin) {
        const result = await api.login(this.email, this.password);
        api.setToken(result.token);
        localStorage.setItem("token", result.token);
        window.dispatchEvent(
          new CustomEvent("auth-change", { detail: { loggedIn: true, user: result.user } }),
        );
        window.location.hash = "#/movies";
      } else {
        if (!this.displayName.trim()) {
          this.error = "Display name is required";
          return;
        }
        const result = await api.register(this.email, this.password, this.displayName);
        api.setToken(result.token);
        localStorage.setItem("token", result.token);
        window.dispatchEvent(
          new CustomEvent("auth-change", { detail: { loggedIn: true, user: result.user } }),
        );
        window.location.hash = "#/movies";
      }
    } catch (err: unknown) {
      this.error = (err as Error).message || "Authentication failed";
    } finally {
      this.loading = false;
    }
  }

  override render() {
    return html`
      <div class="login-container">
        <div class="login-card">
          <div class="tabs">
            <button class="tab ${this.isLogin ? "active" : ""}" @click=${this
              ._toggleMode}>Login</button>
            <button class="tab ${!this.isLogin ? "active" : ""}" @click=${this
              ._toggleMode}>Register</button>
          </div>

          <form @submit=${this._submit}>
            ${!this.isLogin
              ? html`
                <div class="form-group">
                  <label for="displayName">Display Name</label>
                  <input id="displayName" type="text" .value=${this.displayName} @input=${this
                    ._onDisplayNameInput} required />
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
              <input id="password" type="password" .value=${this.password} @input=${this
                ._onPasswordInput} required minlength="8" />
            </div>

            <button type="submit" class="btn-submit" ?disabled=${this.loading}>
              ${this.loading ? "Processing..." : this.isLogin ? "Login" : "Register"}
            </button>
          </form>

          <div class="error">${this.error}</div>
        </div>
      </div>
    `;
  }

  private _onDisplayNameInput(e: Event): void {
    this.displayName = (e.target as HTMLInputElement).value;
  }

  private _onEmailInput(e: Event): void {
    this.email = (e.target as HTMLInputElement).value;
  }

  private _onPasswordInput(e: Event): void {
    this.password = (e.target as HTMLInputElement).value;
  }
}
