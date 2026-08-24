import { css, html, LitElement } from "lit";
import { api } from "../api.js";

export class PasswordChangeForm extends LitElement {
  static styles = css`
    .pw-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: calc(100vh - 70px);
      padding: 20px;
    }

    .pw-card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 40px;
      width: 100%;
      max-width: 420px;
      box-shadow: var(--shadow);
    }

    h2 {
      text-align: center;
      margin-bottom: 8px;
      font-size: 22px;
    }

    .subtitle {
      text-align: center;
      color: var(--color-text-muted);
      font-size: 13px;
      margin-bottom: 24px;
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

  static properties = {
    current: {},
    next: {},
    confirm: {},
    error: {},
    loading: {},
  };

  constructor() {
    super();
    this.current = "";
    this.next = "";
    this.confirm = "";
    this.error = "";
    this.loading = false;
  }

  async _submit(e) {
    e.preventDefault();
    this.error = "";
    if (!this.current || !this.next || !this.confirm) {
      this.error = "All fields are required";
      return;
    }
    if (this.next.length < 8) {
      this.error = "New password must be at least 8 characters";
      return;
    }
    if (this.next !== this.confirm) {
      this.error = "New passwords do not match";
      return;
    }
    this.loading = true;
    try {
      const result = await api.changePassword(this.current, this.next);
      window.dispatchEvent(
        new CustomEvent("auth-change", {
          detail: { loggedIn: true, user: result.user },
        }),
      );
      window.location.hash = "#/projects";
    } catch (err) {
      this.error = err.message || "Password change failed";
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html`
      <div class="pw-container">
        <div class="pw-card">
          <h2>Change password</h2>
          <p class="subtitle">
            Your account has a temporary password. Choose a new one to continue.
          </p>

          <form @submit=${this._submit}>
            <div class="form-group">
              <label for="current">Current password</label>
              <input id="current" type="password" .value=${this.current}
                @input=${this._onCurrentInput} required />
            </div>

            <div class="form-group">
              <label for="next">New password</label>
              <input id="next" type="password" .value=${this.next}
                @input=${this._onNextInput} required minlength="8" />
            </div>

            <div class="form-group">
              <label for="confirm">Confirm new password</label>
              <input id="confirm" type="password" .value=${this.confirm}
                @input=${this._onConfirmInput} required minlength="8" />
            </div>

            <button type="submit" class="btn-submit" ?disabled=${this.loading}>
              ${this.loading ? "Saving..." : "Save new password"}
            </button>
          </form>

          <div class="error">${this.error}</div>
        </div>
      </div>
    `;
  }

  _onCurrentInput(e) {
    this.current = e.target.value;
  }

  _onNextInput(e) {
    this.next = e.target.value;
  }

  _onConfirmInput(e) {
    this.confirm = e.target.value;
  }
}

customElements.define("password-change-form", PasswordChangeForm);
