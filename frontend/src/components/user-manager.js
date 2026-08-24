import { css, html, LitElement } from "lit";
import { api } from "../api.js";

export class UserManager extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    h1 {
      font-size: 22px;
      margin-bottom: 20px;
    }

    .card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 20px;
    }

    .card h2 {
      font-size: 16px;
      margin-bottom: 14px;
    }

    .grid {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: flex-end;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    label {
      font-size: 11px;
      color: var(--color-text-muted);
    }

    select,
    input {
      padding: 6px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background-color: var(--color-surface);
      color: var(--color-text);
      font-size: 13px;
    }

    .check {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--color-text);
      padding-bottom: 6px;
    }

    .btn {
      padding: 6px 14px;
      border: none;
      border-radius: var(--radius);
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
      background-color: var(--color-primary);
      color: white;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-secondary {
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-danger {
      background-color: transparent;
      color: var(--color-error);
      border: 1px solid var(--color-error);
    }

    .btn-small {
      padding: 3px 10px;
      font-size: 12px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    th,
    td {
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid var(--color-border);
    }

    th {
      color: var(--color-text-muted);
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .chip {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      border: 1px solid var(--color-border);
      color: var(--color-text-muted);
    }

    .chip.ok {
      color: #16a34a;
      border-color: #16a34a;
    }

    .chip.warn {
      color: #d97706;
      border-color: #d97706;
    }

    .chip.bad {
      color: var(--color-error);
      border-color: var(--color-error);
    }

    .actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
      margin-top: 8px;
      min-height: 18px;
    }

    .notice {
      color: var(--color-text-muted);
      font-size: 13px;
      margin-top: 8px;
    }

    .self {
      color: var(--color-primary);
      font-size: 11px;
    }
  `;

  static properties = {
    userRole: {},
    meId: {},
    users: {},
    settings: {},
    error: {},
    status: {},
    loading: {},
    newEmail: {},
    newName: {},
    newPassword: {},
    newForceChange: {},
    newRole: {},
  };

  constructor() {
    super();
    this.userRole = "";
    this.meId = null;
    this.users = [];
    this.settings = { registration_enabled: true };
    this.error = "";
    this.status = "";
    this.loading = false;
    this.newEmail = "";
    this.newName = "";
    this.newPassword = "";
    this.newForceChange = true;
    this.newRole = "user";
  }

  connectedCallback() {
    super.connectedCallback?.();
    api.getMe().then((me) => {
      this.meId = me.id;
      if (me.role !== "admin") return;
      this._load();
    }).catch(() => {});
  }

  async _load() {
    try {
      const [users, settings] = await Promise.all([
        api.listUsers(),
        api.getUserSettings(),
      ]);
      this.users = users.users;
      this.settings = settings;
    } catch (err) {
      this.error = err.message || "Failed to load users";
    }
  }

  _flash(message) {
    this.status = message;
    this.error = "";
  }

  _fail(err, fallback) {
    this.error = err.message || fallback;
    this.status = "";
  }

  _isSelf(user) {
    return this.meId !== null && user.id === this.meId;
  }

  async _createUser(e) {
    e.preventDefault();
    this.error = "";
    this.status = "";
    if (!this.newEmail.trim() || !this.newName.trim() || !this.newPassword) {
      this.error = "Email, display name, and password are required";
      return;
    }
    try {
      const res = await api.createUser({
        email: this.newEmail.trim(),
        display_name: this.newName.trim(),
        password: this.newPassword,
        must_change_password: this.newForceChange,
        role: this.newRole,
      });
      this._flash(`Created user ${res.user.email}`);
      this.newEmail = "";
      this.newName = "";
      this.newPassword = "";
      this.newForceChange = true;
      this.newRole = "user";
      await this._load();
    } catch (err) {
      this._fail(err, "Failed to create user");
    }
  }

  async _patchUser(user, patch, success) {
    try {
      await api.updateUser(user.id, patch);
      this._flash(success);
      await this._load();
    } catch (err) {
      this._fail(err, "Failed to update user");
    }
  }

  _toggleRole(user) {
    const toAdmin = user.role !== "admin";
    if (
      this._isSelf(user) && !toAdmin &&
      !window.confirm(
        "You are demoting yourself. You will lose admin access. Continue?",
      )
    ) {
      return;
    }
    this._patchUser(
      user,
      { role: toAdmin ? "admin" : "user" },
      `${user.display_name} is now ${toAdmin ? "an admin" : "a user"}`,
    );
  }

  _toggleActive(user) {
    if (user.is_active) {
      this._patchUser(user, { is_active: false }, `${user.display_name} deactivated`);
    } else {
      this._patchUser(user, { is_active: true }, `${user.display_name} activated`);
    }
  }

  _resetPassword(user) {
    const password = window.prompt(
      `New password for ${user.email} (min 8 characters):`,
    );
    if (password === null) return;
    if (password.length < 8) {
      this.error = "Password must be at least 8 characters";
      return;
    }
    this._patchUser(
      user,
      { password },
      `Password reset for ${user.email}; they must change it at next login`,
    );
  }

  _deleteUser(user) {
    if (!window.confirm(`Delete ${user.email}? Their login stops working immediately.`)) {
      return;
    }
    (async () => {
      try {
        await api.deleteUser(user.id);
        this._flash(`Deleted ${user.email}`);
        await this._load();
      } catch (err) {
        this._fail(err, "Failed to delete user");
      }
    })();
  }

  async _toggleRegistration() {
    const next = !this.settings.registration_enabled;
    try {
      await api.updateUserSettings({ registration_enabled: next });
      this.settings = { ...this.settings, registration_enabled: next };
      this._flash(
        `Self-registration is now ${next ? "enabled" : "disabled"}`,
      );
    } catch (err) {
      this._fail(err, "Failed to update settings");
    }
  }

  _renderUserRow(user) {
    const self = this._isSelf(user);
    return html`
      <tr>
        <td>
          ${user.display_name} ${self ? html`<span class="self">(you)</span>` : ""}
        </td>
        <td>${user.email}</td>
        <td>
          <span class="chip ${user.role === "admin" ? "warn" : ""}">
            ${user.role}
          </span>
        </td>
        <td>
          <span class="chip ${user.is_active ? "ok" : "bad"}">
            ${user.is_active ? "active" : "inactive"}
          </span>
          ${user.must_change_password
            ? html`
              <span class="chip">change pw</span>
            `
            : ""}
        </td>
        <td>${user.created_at?.slice(0, 10)}</td>
        <td>
          <div class="actions">
            <button class="btn btn-secondary btn-small" ?disabled=${self && user.role !== "admin"}
              @click=${this._toggleRole}>
              ${user.role === "admin" ? "Make user" : "Make admin"}
            </button>
            <button class="btn btn-secondary btn-small" ?disabled=${self}
              @click=${this._toggleActive}>
              ${user.is_active ? "Deactivate" : "Activate"}
            </button>
            <button class="btn btn-secondary btn-small" @click=${this._resetPassword}>Reset
              password</button>
            <button class="btn btn-danger btn-small" ?disabled=${self}
              @click=${this._deleteUser}>Delete</button>
          </div>
        </td>
      </tr>
    `;
  }

  render() {
    if (this.userRole !== "admin") {
      return html`
        <h1>Users</h1>
        <div class="card">
          <p class="notice">User management requires the admin role.</p>
        </div>
      `;
    }

    return html`
      <h1>User management</h1>

      <div class="card">
        <h2>Add user</h2>
        <form @submit=${this._createUser}>
          <div class="grid">
            <div class="field">
              <label for="new-email">Email</label>
              <input id="new-email" type="email" .value=${this.newEmail}
                @input=${(e) => (this.newEmail = e.target.value)} required />
            </div>
            <div class="field">
              <label for="new-name">Display name</label>
              <input id="new-name" type="text" .value=${this.newName}
                @input=${(e) => (this.newName = e.target.value)} required />
            </div>
            <div class="field">
              <label for="new-password">Default password</label>
              <input id="new-password" type="password" .value=${this.newPassword}
                @input=${(e) => (this.newPassword = e.target.value)} required
                minlength="8" />
            </div>
            <div class="field">
              <label for="new-role">Role</label>
              <select id="new-role" .value=${this.newRole}
                @change=${(e) => (this.newRole = e.target.value)}>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <label class="check">
              <input type="checkbox" .checked=${this.newForceChange}
                @change=${(e) => (this.newForceChange = e.target.checked)} />
              Force password change at first login
            </label>
            <button type="submit" class="btn">Add user</button>
          </div>
        </form>
        <div class="error">${this.error}</div>
        <div class="notice">${this.status}</div>
      </div>

      <div class="card">
        <h2>Settings</h2>
        <label class="check">
          <input type="checkbox" .checked=${this.settings.registration_enabled}
            @change=${this._toggleRegistration} />
          Allow self-registration
        </label>
      </div>

      <div class="card">
        <h2>Users (${this.users.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this.users.map((u) => this._renderUserRow(u))}
          </tbody>
        </table>
      </div>
    `;
  }
}

customElements.define("user-manager", UserManager);
