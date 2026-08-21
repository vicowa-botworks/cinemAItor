import { css, html, LitElement } from "lit";
import { api } from "./api.js";
import "./components/app-header.js";
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

export class AppRoot extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }

    .app {
      min-height: 100vh;
    }

    .view {
      min-height: calc(100vh - 70px);
    }
  `;

  static properties = {
    loggedIn: {},
    userName: {},
    currentView: {},
    viewParams: {},
    assetProjectId: {},
  };

  constructor() {
    super();
    this.loggedIn = false;
    this.userName = "";
    this.currentView = "login";
    this.viewParams = {};
    this.assetProjectId = null;
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
        this.loggedIn = true;
        this._updateHeader();
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
    } else {
      this.userName = "";
    }
    this._updateHeader();
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
    this._updateHeader();
    this._route();
  }

  _updateHeader() {
    const header = this.shadowRoot?.querySelector("app-header");
    if (header) {
      header.setUserData(this.userName, this.loggedIn);
    }
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
    } else {
      this.currentView = "login";
    }

    this.requestUpdate();
  }

  render() {
    return html`
      <div class="app">
        <app-header></app-header>
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
      default:
        return html`<login-form></login-form>`;
    }
  }
}

customElements.define("app-root", AppRoot);
