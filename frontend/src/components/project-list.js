import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import { DemoHost } from "./demo-host.js";
import { buildMovieDemoSteps } from "./demo-movie.js";
import { MovieDemoHost } from "./movie-demo-host.js";
import { clearMovieState } from "./demo-movie-state.js";
import { resetDemoData } from "./demo-reset.js";
import "./confirm-dialog.js";
import "./project-card.js";
import "./project-form.js";

export class ProjectList extends MovieDemoHost(DemoHost(LitElement)) {
  static styles = css`
    .project-list-container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .list-header h2 {
      font-size: 24px;
    }

    .btn-create {
      background-color: var(--color-primary);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: var(--radius);
      font-size: 14px;
      font-weight: 500;
    }

    .btn-create:hover {
      background-color: var(--color-primary-hover);
    }

    .btn-reset {
      background: transparent;
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
      padding: 10px 16px;
      border-radius: var(--radius);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }

    .btn-reset:hover {
      color: var(--color-error);
      border-color: var(--color-error);
    }

    .list-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .create-panel {
      margin-bottom: 24px;
    }

    .create-panel h3 {
      font-size: 18px;
      margin-bottom: 12px;
    }

    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--color-text-muted);
    }

    .empty-state p {
      margin-top: 12px;
      font-size: 15px;
    }

    .loading,
    .error {
      text-align: center;
      padding: 40px;
      color: var(--color-text-muted);
    }

    .error {
      color: var(--color-error);
    }
  `;

  static properties = {
    projects: {},
    loading: {},
    error: {},
    showCreate: {},
    resetOpen: { type: Boolean },
    resetBusy: { type: Boolean },
    resetTone: { type: String },
    resetMessage: { type: String },
    resetConfirmLabel: { type: String },
    resetPhase: { type: String },
  };

  constructor() {
    super();
    this.projects = [];
    this.loading = true;
    this.error = "";
    this.showCreate = false;
    this.resetOpen = false;
    this.resetBusy = false;
    this.resetTone = "danger";
    this.resetMessage = "";
    this.resetConfirmLabel = "Delete all";
    this.resetPhase = "confirm";
  }

  get demoTitle() {
    return "Full movie demo";
  }

  get demoSubtitle() {
    return "The Lighthouse — the whole pipeline, end to end";
  }

  buildDemoSteps(_mode, preflight) {
    return buildMovieDemoSteps(this, preflight);
  }

  /** The movie demo calls the API directly with the fixed film content — there
   * is no form on this page to edit between guided pauses. Its guided run is
   * the separate cross-page "Guided movie demo" below, so the single-page
   * guided button would be a redundant subset of it. Show auto only. */
  get demoHideGuided() {
    return true;
  }

  get movieDemoPage() {
    return "projects";
  }

  get movieDemoTitle() {
    return "Guided movie demo";
  }

  get movieDemoSubtitle() {
    return "The Lighthouse, page by page — with resume";
  }

  get movieDemoStartButton() {
    return html`
      <button
        class="btn-create"
        style="background-color: var(--color-accent, #8b5cf6);"
        ?disabled=${this._movieRun || this._movieStarting}
        @click=${this._onStartMovieDemo}>
        ${this._movieStarting ? "Starting…" : "Guided movie demo"}
      </button>
    `;
  }

  async connectedCallback() {
    super.connectedCallback?.();
    await this._loadProjects();
  }

  async _loadProjects() {
    this.loading = true;
    this.error = "";
    try {
      this.projects = await api.listProjects();
    } catch (err) {
      this.error = err.message || "Failed to load projects";
    } finally {
      this.loading = false;
    }
  }

  _toggleCreate() {
    this.showCreate = !this.showCreate;
  }

  _onSaved(e) {
    e.stopPropagation();
    const project = e.detail;
    window.location.hash = `#/project/${encodeURIComponent(project.id)}`;
  }

  _onCancel() {
    this.showCreate = false;
  }

  _navigateToProject(id) {
    window.location.hash = `#/project/${encodeURIComponent(id)}`;
  }

  _onResetClick() {
    this.resetPhase = "confirm";
    this.resetTone = "danger";
    this.resetConfirmLabel = "Delete all";
    this.resetBusy = false;
    this.resetMessage = "This deletes the demo project “The Lighthouse (demo)” and every asset, " +
      "panel, scene, and timeline it created — including the global scene clips " +
      "and score that survive a project delete. You can then run the demo again " +
      "from scratch.";
    this.resetOpen = true;
  }

  _onResetCancel() {
    this.resetOpen = false;
  }

  async _onResetConfirm() {
    if (this.resetPhase === "result") {
      this.resetOpen = false;
      return;
    }
    this.resetBusy = true;
    try {
      const result = await resetDemoData(api);
      const d = result.deleted;
      if (result.found) {
        clearMovieState();
        await this._loadProjects();
        this.resetMessage = `Deleted ${d.assets} asset(s), ${d.timelines} timeline(s), ` +
          `${d.scenes} scene(s), ${d.panels} panel(s), ${d.storyboards} ` +
          `storyboard(s) and the demo project.` +
          (result.errors.length ? ` Errors: ${result.errors.join("; ")}` : "");
        this.resetConfirmLabel = "Done";
      } else {
        this.resetMessage = "No demo data found to reset.";
        this.resetConfirmLabel = "Close";
      }
      this.resetTone = "default";
      this.resetPhase = "result";
    } catch (err) {
      this.resetMessage = `Reset failed: ${err?.message || err}. You can try again.`;
      this.resetConfirmLabel = "Try again";
      this.resetTone = "danger";
      this.resetPhase = "result";
    }
    this.resetBusy = false;
  }

  render() {
    if (this.loading) {
      return html`
        <div class="project-list-container">
          <div class="loading">Loading projects...</div>
        </div>
      `;
    }

    return html`
      <div class="project-list-container">
        <div class="list-header">
          <h2>My Projects</h2>
          <div class="list-header-actions">
            ${this.demoLauncher}
            ${this.movieDemoStartButton}
            <button
              class="btn-reset"
              title="Delete every item the movie demo created so it can run again from scratch"
              @click=${this._onResetClick}>
              Reset demo data
            </button>
            <button class="btn-create" @click=${this._toggleCreate}>
              ${this.showCreate ? "Close" : "+ New Project"}
            </button>
          </div>
        </div>
        ${this.demoRunnerPanel}
        ${this.movieDemoRunnerPanel}

        ${this.showCreate
          ? html`
            <div class="create-panel">
              <h3>New Project</h3>
              <project-form @saved=${this._onSaved} @cancel=${this
                ._onCancel}></project-form>
            </div>
          `
          : ""}

        ${this.error ? html`<div class="error">${this.error}</div>` : ""}

        ${this.projects.length === 0 && !this.showCreate
          ? html`
            <div class="empty-state">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.5">
                <path
                  d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm4-1v3m8-3v3M4 9h16M9 21v-3m6 3v-3" />
              </svg>
              <p>No projects yet. Create your first project!</p>
            </div>
          `
          : ""}

        ${this.projects.length > 0
          ? html`
            <div class="projects-grid">
              ${this.projects.map((project) =>
                html`
                  <project-card .project=${project} @navigate=${(e) =>
                    this._navigateToProject(e.detail)}></project-card>
                `
              )}
            </div>
          `
          : ""}

        <confirm-dialog
          .open=${this.resetOpen}
          .busy=${this.resetBusy}
          .tone=${this.resetTone}
          title="Reset demo data"
          .message=${this.resetMessage}
          .confirmLabel=${this.resetConfirmLabel}
          busyLabel="Resetting…"
          @confirm=${this._onResetConfirm}
          @cancel=${this._onResetCancel}></confirm-dialog>
      </div>
    `;
  }
}

customElements.define("project-list", ProjectList);
