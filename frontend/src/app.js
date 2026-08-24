import { css, html, LitElement } from "lit";
import { api } from "./api.js";
import "./components/app-sidebar.js";
import "./components/login-form.js";
import "./components/project-list.js";
import "./components/project-detail.js";
import "./components/asset-list.js";
import "./components/asset-detail.js";
import "./components/asset-card.js";
import "./components/asset-form.js";
import "./components/asset-upload.js";
import "./components/prompt-editor.js";
import "./components/model-manager.js";
import "./components/job-monitor.js";
import "./components/skills-list.js";
import "./components/storyboard-list.js";
import "./components/storyboard-detail.js";
import "./components/scene-list.js";
import "./components/scene-detail.js";
import "./components/review-board.js";
import "./components/timeline-list.js";
import "./components/timeline-detail.js";
import "./components/timeline-preview.js";
import "./components/audio-dialog.js";
import "./components/diagnostics-panel.js";
import "./components/password-change-form.js";
import "./components/user-manager.js";
import "./components/password-reset-request-form.js";
import "./components/password-reset-form.js";
import "./components/email-confirm-form.js";
import "./components/invitation-form.js";

// Extract a query parameter from a hash route like "#/reset-password?token=…"
function hashParam(hash, name) {
  const query = hash.split("?")[1] || "";
  return new URLSearchParams(query).get(name) || "";
}

export class AppRoot extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }

    .app {
      display: flex;
      align-items: flex-start;
      min-height: 100vh;
    }

    .view {
      flex: 1;
      min-width: 0;
      min-height: 100vh;
      padding: 30px 20px;
    }

    .menu-toggle {
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 300;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      gap: 4px;
      width: 40px;
      height: 40px;
      padding: 0;
      background-color: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .menu-toggle:hover {
      background-color: var(--color-surface-hover);
    }

    .menu-toggle span {
      display: block;
      width: 18px;
      height: 2px;
      background-color: currentColor;
      border-radius: 1px;
    }
  `;

  static properties = {
    loggedIn: {},
    userName: {},
    userRole: {},
    currentView: {},
    viewParams: {},
    assetProjectId: {},
    navCollapsed: {},
  };

  constructor() {
    super();
    this.loggedIn = false;
    this.userName = "";
    this.userRole = "";
    this.currentView = "login";
    this.viewParams = {};
    this.assetProjectId = null;
    this.navCollapsed = window.innerWidth < 1024;
  }

  connectedCallback() {
    super.connectedCallback?.();
    this._checkAuth();
    window.addEventListener("hashchange", () => this._route());
    window.addEventListener("auth-change", (e) => this._onAuthChange(e));
    return Promise.resolve();
  }

  _checkAuth() {
    const token = localStorage.getItem("token");
    if (token) {
      api.setToken(token);
      api.getMe().then((user) => {
        this.userName = user.display_name;
        this.userRole = user.role || "";
        this.loggedIn = true;
        this._updateSidebar();
        if (user.must_change_password) {
          window.location.hash = "#/change-password";
          return;
        }
        this._route();
      }).catch(() => {
        this._logout();
      });
    } else {
      this._route();
    }
  }

  _onAuthChange(e) {
    const detail = e.detail;
    if (!detail.loggedIn) {
      this._logout();
      return;
    }
    this.loggedIn = detail.loggedIn;
    if (detail.user) {
      this.userName = detail.user.display_name;
      this.userRole = detail.user.role || "";
    } else {
      this.userName = "";
      this.userRole = "";
    }
    this._updateSidebar();
    if (detail.user?.must_change_password) {
      window.location.hash = "#/change-password";
      return;
    }
    this._route();
  }

  async _logout() {
    if (api.getToken()) {
      try {
        await api.logout();
      } catch {
        // Session may already be expired; local cleanup still proceeds.
      }
    }
    localStorage.removeItem("token");
    api.clearToken();
    this.loggedIn = false;
    this.userName = "";
    this.userRole = "";
    this._updateSidebar();
    this._route();
  }

  _updateSidebar() {
    const sidebar = this.shadowRoot?.querySelector("app-sidebar");
    if (sidebar) {
      sidebar.setUserData(this.userName, this.loggedIn, this.userRole);
    }
  }

  _onSidebarCollapseChange(e) {
    this.navCollapsed = e.detail.collapsed;
  }

  _expandNav() {
    this.shadowRoot?.querySelector("app-sidebar")?.expand();
  }

  _route() {
    const hash = window.location.hash || "#/login";

    if (hash === "#/login" || hash === "") {
      if (this.loggedIn) {
        window.location.hash = "#/projects";
        return;
      }
      this.currentView = "login";
    } else if (hash === "#/projects" || hash === "#/") {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "projects";
    } else if (hash === "#/assets") {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "assets";
      this.assetProjectId = null;
    } else if (hash.startsWith("#/project/")) {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      const assetMatch = hash.match(/^#\/project\/([^/]+)\/assets$/);
      if (assetMatch) {
        this.currentView = "assets";
        this.assetProjectId = decodeURIComponent(assetMatch[1]);
      } else {
        this.currentView = "project-detail";
        this.assetProjectId = null;
        const match = hash.match(/\/project\/([^/]+)/);
        if (match) {
          this.viewParams.id = decodeURIComponent(match[1]);
        }
      }
    } else if (hash.startsWith("#/asset/")) {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "asset-detail";
      const match = hash.match(/^#\/asset\/([^/]+)/);
      if (match) {
        this.viewParams.id = decodeURIComponent(match[1]);
      }
    } else if (hash === "#/prompts") {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "prompts";
    } else if (hash === "#/models") {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "models";
    } else if (hash === "#/jobs") {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "jobs";
    } else if (hash === "#/skills") {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "skills";
    } else if (hash.startsWith("#/storyboard/")) {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "storyboard-detail";
      const match = hash.match(/^#\/storyboard\/([^/?]+)/);
      if (match) {
        this.viewParams.id = decodeURIComponent(match[1]);
      }
    } else if (hash.startsWith("#/storyboards")) {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "storyboards";
    } else if (hash.startsWith("#/scene/")) {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "scene-detail";
      const match = hash.match(/^#\/scene\/([^/?]+)/);
      if (match) {
        this.viewParams.id = decodeURIComponent(match[1]);
      }
    } else if (hash.startsWith("#/scenes")) {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "scenes";
    } else if (hash.startsWith("#/review/")) {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "review";
      const match = hash.match(/^#\/review\/([^/?]+)/);
      if (match) {
        this.viewParams.jobId = decodeURIComponent(match[1]);
      }
    } else if (hash.startsWith("#/timelines")) {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "timelines";
    } else if (hash.startsWith("#/timeline/")) {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "timeline-detail";
      const match = hash.match(/^#\/timeline\/([^/?]+)/);
      if (match) {
        this.viewParams.id = decodeURIComponent(match[1]);
      }
    } else if (hash === "#/diagnostics") {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "diagnostics";
    } else if (hash === "#/users") {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "users";
    } else if (hash === "#/change-password") {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "change-password";
    } else if (hash.startsWith("#/forgot-password")) {
      if (this.loggedIn) {
        window.location.hash = "#/projects";
        return;
      }
      this.currentView = "forgot-password";
    } else if (hash.startsWith("#/reset-password")) {
      if (this.loggedIn) {
        window.location.hash = "#/projects";
        return;
      }
      this.currentView = "reset-password";
      this.viewParams.token = hashParam(hash, "token");
    } else if (hash.startsWith("#/confirm-email")) {
      if (this.loggedIn) {
        window.location.hash = "#/projects";
        return;
      }
      this.currentView = "confirm-email";
      this.viewParams.token = hashParam(hash, "token");
    } else if (hash.startsWith("#/invitation")) {
      if (this.loggedIn) {
        window.location.hash = "#/projects";
        return;
      }
      this.currentView = "invitation";
      this.viewParams.token = hashParam(hash, "token");
    } else {
      this.currentView = "login";
    }

    this.requestUpdate();
  }

  render() {
    return html`
      <div class="app">
        <app-sidebar
          @sidebar-collapse-change=${this._onSidebarCollapseChange}
        ></app-sidebar>
        ${this.navCollapsed
          ? html`
            <button
              class="menu-toggle"
              title="Show navigation"
              aria-label="Show navigation"
              @click=${this._expandNav}
            ><span></span><span></span><span></span></button>
          `
          : ""}
        <div class="view">
          ${this._renderView()}
        </div>
      </div>
    `;
  }

  _renderView() {
    switch (this.currentView) {
      case "login":
        return html`<login-form></login-form>`;
      case "projects":
        return html`<project-list></project-list>`;
      case "project-detail":
        return html`
          <project-detail .projectId=${this.viewParams.id}></project-detail>
        `;
      case "assets":
        return html`<asset-list .projectId=${this.assetProjectId}></asset-list>`;
      case "asset-detail":
        return html`
          <asset-detail
            .assetId=${this.viewParams.id}
            .backHash=${this.assetProjectId
              ? `#/project/${encodeURIComponent(this.assetProjectId)}/assets`
              : "#/assets"}
          ></asset-detail>
        `;
      case "prompts":
        return html`<prompt-editor></prompt-editor>`;
      case "models":
        return html`<model-manager></model-manager>`;
      case "jobs":
        return html`<job-monitor></job-monitor>`;
      case "skills":
        return html`<skills-list></skills-list>`;
      case "storyboards":
        return html`<storyboard-list></storyboard-list>`;
      case "storyboard-detail":
        return html`
          <storyboard-detail .boardId=${this.viewParams.id}></storyboard-detail>
        `;
      case "scenes":
        return html`<scene-list></scene-list>`;
      case "scene-detail":
        return html`
          <scene-detail .sceneId=${this.viewParams.id}></scene-detail>
        `;
      case "review":
        return html`<review-board .jobId=${this.viewParams.jobId}></review-board>`;
      case "timelines":
        return html`<timeline-list></timeline-list>`;
      case "timeline-detail":
        return html`
          <timeline-detail .timelineId=${this.viewParams.id}></timeline-detail>
        `;
      case "diagnostics":
        return html`<diagnostics-panel></diagnostics-panel>`;
      case "users":
        return html`<user-manager .userRole=${this.userRole}></user-manager>`;
      case "change-password":
        return html`<password-change-form></password-change-form>`;
      case "forgot-password":
        return html`<password-reset-request-form></password-reset-request-form>`;
      case "reset-password":
        return html`
          <password-reset-form .token=${this.viewParams.token}></password-reset-form>
        `;
      case "confirm-email":
        return html`
          <email-confirm-form .token=${this.viewParams.token}></email-confirm-form>
        `;
      case "invitation":
        return html`
          <invitation-form .token=${this.viewParams.token}></invitation-form>
        `;
      default:
        return html`<login-form></login-form>`;
    }
  }
}

customElements.define("app-root", AppRoot);
