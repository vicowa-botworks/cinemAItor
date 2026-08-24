import { css, html, LitElement } from "lit";

const NAV_ROUTES = {
  "/projects": ["/projects", "/project/"],
  "/assets": ["/assets", "/asset/"],
  "/storyboards": ["/storyboards", "/storyboard/"],
  "/scenes": ["/scenes", "/scene/", "/review/"],
  "/prompts": ["/prompts"],
  "/models": ["/models"],
  "/jobs": ["/jobs"],
  "/skills": ["/skills"],
  "/timelines": ["/timelines", "/timeline/"],
  "/diagnostics": ["/diagnostics"],
  "/users": ["/users"],
  "/login": ["/login"],
};

// Below this viewport width the panel starts out collapsed and re-collapses
// whenever the viewport shrinks past it (expanding still works via the
// hamburger button the shell renders).
const AUTO_COLLAPSE_MAX_WIDTH = 1024;

export class AppSidebar extends LitElement {
  static styles = css`
    :host {
      display: block;
      flex: 0 0 auto;
    }

    .sidebar {
      width: 240px;
      height: 100vh;
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      flex-direction: column;
      background-color: var(--color-surface);
      border-right: 1px solid var(--color-border);
      overflow: hidden;
      transition: width 0.2s ease;
    }

    .sidebar.collapsed {
      width: 0;
      border-right: none;
    }

    .sidebar-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 14px 12px 12px 16px;
      border-bottom: 1px solid var(--color-border);
    }

    .logo {
      font-size: 20px;
      font-weight: 700;
      color: var(--color-primary);
      cursor: pointer;
      white-space: nowrap;
    }

    .btn-collapse {
      background: transparent;
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
      width: 32px;
      height: 32px;
      padding: 0;
      font-size: 18px;
      line-height: 1;
      flex: 0 0 auto;
    }

    .btn-collapse:hover {
      color: var(--color-text);
      background-color: var(--color-surface-hover);
    }

    .nav {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 12px;
    }

    .nav a {
      color: var(--color-text-muted);
      padding: 9px 12px;
      border-radius: var(--radius);
      white-space: nowrap;
      transition: color 0.2s, background-color 0.2s;
    }

    .nav a:hover,
    .nav a.active {
      color: var(--color-text);
      background-color: var(--color-surface-hover);
    }

    .user-info {
      border-top: 1px solid var(--color-border);
      padding: 12px 16px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .user-name {
      color: var(--color-text-muted);
      font-size: 14px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .btn-logout {
      background: transparent;
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
      padding: 8px 14px;
      font-size: 13px;
      width: 100%;
    }

    .btn-logout:hover {
      color: var(--color-error);
      border-color: var(--color-error);
    }
  `;

  static properties = {
    userName: {},
    isLoggedIn: {},
    userRole: {},
    collapsed: {},
  };

  constructor() {
    super();
    this.userName = "";
    this.isLoggedIn = false;
    this.userRole = "";
    this.collapsed = window.innerWidth < AUTO_COLLAPSE_MAX_WIDTH;
    this._lastNarrow = this.collapsed;
    this._onHashChange = () => this.requestUpdate();
    this._onResize = () => this._handleResize();
  }

  connectedCallback() {
    super.connectedCallback?.();
    window.addEventListener("hashchange", this._onHashChange);
    window.addEventListener("resize", this._onResize);
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    window.removeEventListener("hashchange", this._onHashChange);
    window.removeEventListener("resize", this._onResize);
  }

  updated(changed) {
    if (changed.has("collapsed")) {
      this.dispatchEvent(
        new CustomEvent("sidebar-collapse-change", {
          detail: { collapsed: this.collapsed },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  setUserData(name, loggedIn, role = "") {
    this.userName = name;
    this.isLoggedIn = loggedIn;
    this.userRole = role;
  }

  toggle() {
    this.collapsed = !this.collapsed;
  }

  expand() {
    this.collapsed = false;
  }

  collapse() {
    this.collapsed = true;
  }

  _handleResize() {
    const narrow = window.innerWidth < AUTO_COLLAPSE_MAX_WIDTH;
    if (narrow === this._lastNarrow) return;
    this._lastNarrow = narrow;
    this.collapsed = narrow;
  }

  render() {
    return html`
      <aside class="sidebar ${this.collapsed ? "collapsed" : ""}">
        <div class="sidebar-top">
          <div class="logo" @click=${this._goHome}>CinemAItor</div>
          <button
            class="btn-collapse"
            title="Collapse navigation"
            aria-label="Collapse navigation"
            @click=${this.toggle}
          >«</button>
        </div>
        <nav class="nav" aria-label="Main navigation">
          ${this.isLoggedIn
            ? html`
              <a href="#/projects" class="${this._isActive("/projects")}">Projects</a>
              <a href="#/assets" class="${this._isActive("/assets")}">Assets</a>
              <a href="#/storyboards" class="${this._isActive("/storyboards")}">Storyboards</a>
              <a href="#/scenes" class="${this._isActive("/scenes")}">Scenes</a>
              <a href="#/prompts" class="${this._isActive("/prompts")}">Prompts</a>
              <a href="#/models" class="${this._isActive("/models")}">Models</a>
              <a href="#/jobs" class="${this._isActive("/jobs")}">Jobs</a>
              <a href="#/skills" class="${this._isActive("/skills")}">Skills</a>
              <a href="#/timelines" class="${this._isActive("/timelines")}">Timelines</a>
              <a href="#/diagnostics" class="${this._isActive("/diagnostics")}">Diagnostics</a>
              ${this.userRole === "admin"
                ? html`
                  <a href="#/users" class="${this._isActive("/users")}">Users</a>
                `
                : ""}
            `
            : html`
              <a href="#/login" class="${this._isActive("/login")}">Login</a>
            `}
        </nav>
        ${this.isLoggedIn
          ? html`
            <div class="user-info">
              <span class="user-name">${this.userName}</span>
              <button class="btn-logout" @click=${this._logout}>Logout</button>
            </div>
          `
          : ""}
      </aside>
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

customElements.define("app-sidebar", AppSidebar);
