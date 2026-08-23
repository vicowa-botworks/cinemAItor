import { css, html, LitElement } from "lit";

const NAV_ROUTES = {
  "/projects": ["/projects", "/project/"],
  "/assets": ["/assets", "/asset/"],
  "/storyboards": ["/storyboards", "/storyboard/"],
  "/scenes": ["/scenes", "/scene/", "/review/"],
  "/prompts": ["/prompts"],
  "/models": ["/models"],
  "/jobs": ["/jobs"],
  "/timelines": ["/timelines", "/timeline/"],
  "/diagnostics": ["/diagnostics"],
  "/login": ["/login"],
};

export class AppHeader extends LitElement {
  static styles = css`
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

  static properties = {
    userName: {},
    isLoggedIn: {},
  };

  constructor() {
    super();
    this.userName = "";
    this.isLoggedIn = false;
    this._onHashChange = () => this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback?.();
    window.addEventListener("hashchange", this._onHashChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    window.removeEventListener("hashchange", this._onHashChange);
  }

  setUserData(name, loggedIn) {
    this.userName = name;
    this.isLoggedIn = loggedIn;
  }

  render() {
    return html`
      <header>
        <div class="header-content">
          <div class="logo" @click=${this._goHome}>CinemaItor</div>
          <nav class="nav">
            ${this.isLoggedIn
              ? html`
                <a href="#/projects" class="${this._isActive(
                  "/projects",
                )}">Projects</a>
                <a href="#/assets" class="${this._isActive(
                  "/assets",
                )}">Assets</a>
                <a href="#/storyboards" class="${this._isActive(
                  "/storyboards",
                )}">Storyboards</a>
                <a href="#/scenes" class="${this._isActive(
                  "/scenes",
                )}">Scenes</a>
                <a href="#/prompts" class="${this._isActive(
                  "/prompts",
                )}">Prompts</a>
                <a href="#/models" class="${this._isActive(
                  "/models",
                )}">Models</a>
                <a href="#/jobs" class="${this._isActive("/jobs")}">Jobs</a>
                <a href="#/skills" class="${this._isActive(
                  "/skills",
                )}">Skills</a>
                <a href="#/timelines" class="${this._isActive(
                  "/timelines",
                )}">Timelines</a>
                <a href="#/diagnostics" class="${this._isActive(
                  "/diagnostics",
                )}">Diagnostics</a>
                <div class="user-info">
                  <span class="user-name">${this.userName}</span>
                  <button class="btn-logout" @click=${this
                    ._logout}>Logout</button>
                </div>
              `
              : html`
                <a href="#/login" class="${this._isActive("/login")}">Login</a>
              `}
          </nav>
        </div>
      </header>
    `;
  }

  _activeRoute() {
    const hash = window.location.hash || "#/login";
    const path = hash.split("?")[0].replace(/^#/, "");
    // #/project/:id/assets renders the asset list, so it is the Assets tab.
    if (
      path === "/assets" || path.startsWith("/asset/") ||
      /\/project\/[^/]+\/assets$/.test(path)
    ) {
      return "/assets";
    }
    for (const [route, prefixes] of Object.entries(NAV_ROUTES)) {
      if (prefixes.some((p) => path === p || path.startsWith(p))) return route;
    }
    return null;
  }

  _isActive(route) {
    return this._activeRoute() === route ? "active" : "";
  }

  _goHome() {
    window.location.hash = this.isLoggedIn ? "#/projects" : "#/login";
  }

  _logout() {
    localStorage.removeItem("token");
    window.dispatchEvent(
      new CustomEvent("auth-change", { detail: { loggedIn: false } }),
    );
    window.location.hash = "#/login";
  }
}

customElements.define("app-header", AppHeader);
