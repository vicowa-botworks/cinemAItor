import { html, css } from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-html/lit-html.ts";
import { LitElement } from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-element/lit-element.ts";
import { customElement, state, property } from "lit/decorators.ts";

@customElement("app-header")
export class AppHeader extends LitElement {
  static override styles = css`
    header {
      background-color: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      padding: 16px 0;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 20px;
    }

    .logo {
      font-size: 24px;
      font-weight: 700;
      color: var(--color-primary);
      cursor: pointer;
    }

    .nav {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .nav a {
      color: var(--color-text-muted);
      padding: 8px 12px;
      border-radius: var(--radius);
      transition: color 0.2s, background-color 0.2s;
    }

    .nav a:hover,
    .nav a.active {
      color: var(--color-text);
      background-color: var(--color-surface-hover);
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .user-name {
      color: var(--color-text-muted);
      font-size: 14px;
    }

    .btn-logout {
      background: transparent;
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
      padding: 6px 14px;
      font-size: 13px;
    }

    .btn-logout:hover {
      color: var(--color-error);
      border-color: var(--color-error);
    }
  `;

  @state() private userName = "";
  @state() private isLoggedIn = false;

  setUserData(name: string, loggedIn: boolean): void {
    this.userName = name;
    this.isLoggedIn = loggedIn;
    this.requestUpdate();
  }

  override render() {
    return html`
      <header>
        <div class="header-content">
          <div class="logo" @click=${this._goHome}>CinemaItor</div>
          <nav class="nav">
            ${this.isLoggedIn ? html`
              <a href="#/movies" class="${this._isActive('/movies')}">My Movies</a>
              <a href="#/create" class="${this._isActive('/create')}">Create</a>
              <div class="user-info">
                <span class="user-name">${this.userName}</span>
                <button class="btn-logout" @click=${this._logout}>Logout</button>
              </div>
            ` : html`
              <a href="#/login" class="${this._isActive('/login')}">Login</a>
            `}
          </nav>
        </div>
      </header>
    `;
  }

  private _isActive(path: string): string {
    const current = window.location.hash || "#/login";
    return current.includes(path) ? "active" : "";
  }

  private _goHome(): void {
    window.location.hash = this.isLoggedIn ? "#/movies" : "#/login";
  }

  private _logout(): void {
    localStorage.removeItem("token");
    window.dispatchEvent(new CustomEvent("auth-change", { detail: { loggedIn: false } }));
    window.location.hash = "#/login";
  }
}
