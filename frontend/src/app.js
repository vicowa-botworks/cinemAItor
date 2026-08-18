import { css, html, LitElement } from "lit";
import { api } from "./api.js";
import "./components/app-header.js";
import "./components/login-form.js";
import "./components/movie-list.js";
import "./components/movie-detail.js";

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
  };

  constructor() {
    super();
    this.loggedIn = false;
    this.userName = "";
    this.currentView = "login";
    this.viewParams = {};
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
    this.loggedIn = detail.loggedIn;
    if (detail.loggedIn && detail.user) {
      this.userName = detail.user.display_name;
    } else {
      this.userName = "";
    }
    this._updateHeader();
    this._route();
  }

  _logout() {
    localStorage.removeItem("token");
    api.clearToken();
    this.loggedIn = false;
    this.userName = "";
    this._updateHeader();
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
        window.location.hash = "#/movies";
        return;
      }
      this.currentView = "login";
    } else if (hash === "#/movies" || hash === "#/") {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "movies";
    } else if (hash.startsWith("#/movie/")) {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "movie-detail";
      const match = hash.match(/\/movie\/(\d+)/);
      if (match) {
        this.viewParams.id = Number(match[1]);
      }
    } else if (hash === "#/create") {
      if (!this.loggedIn) {
        window.location.hash = "#/login";
        return;
      }
      this.currentView = "create";
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
      case "movies":
        return html`<movie-list></movie-list>`;
      case "movie-detail":
        return html`<movie-detail></movie-detail>`;
      case "create":
        return html`
          <div style="text-align:center; padding:60px; color:var(--color-text-muted);">
            <p>Create Movie - Coming Soon</p>
          </div>
        `;
      default:
        return html`<login-form></login-form>`;
    }
  }
}

customElements.define("app-root", AppRoot);
