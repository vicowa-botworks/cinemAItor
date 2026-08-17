import { css, html } from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-html/lit-html.ts";
import { LitElement } from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-element/lit-element.ts";
import { customElement, state } from "lit/decorators.ts";
import { api } from "./api.ts";
import "./components/app-header.ts";
import "./components/login-form.ts";
import "./components/movie-list.ts";
import "./components/movie-detail.ts";

@customElement("app-root")
export class AppRoot extends LitElement {
  static override styles = css`
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

  @state()
  private loggedIn = false;
  @state()
  private userName = "";
  @state()
  private currentView = "login";
  @state()
  private viewParams: Record<string, unknown> = {};

  override connectedCallback(): Promise<void> {
    super.connectedCallback?.();
    this._checkAuth();
    window.addEventListener("hashchange", () => this._route());
    window.addEventListener("auth-change", (e: Event) => this._onAuthChange(e));
    return Promise.resolve();
  }

  private _checkAuth(): void {
    const token = localStorage.getItem("token");
    if (token) {
      api.setToken(token);
      api.getMe().then((user: { display_name: string }) => {
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

  private _onAuthChange(e: Event): void {
    const detail = (e as CustomEvent).detail;
    this.loggedIn = detail.loggedIn;
    if (detail.loggedIn && detail.user) {
      this.userName = detail.user.display_name;
    } else {
      this.userName = "";
    }
    this._updateHeader();
    this._route();
  }

  private _logout(): void {
    localStorage.removeItem("token");
    api.clearToken();
    this.loggedIn = false;
    this.userName = "";
    this._updateHeader();
  }

  private _updateHeader(): void {
    const header = this.shadowRoot?.querySelector("app-header") as HTMLElement;
    if (header) {
      (header as any).setUserData(this.userName, this.loggedIn);
    }
  }

  private _route(): void {
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

  override render() {
    return html`
      <div class="app">
        <app-header></app-header>
        <div class="view">
          ${this._renderView()}
        </div>
      </div>
    `;
  }

  private _renderView() {
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
