import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import "./project-card.js";
import "./project-form.js";

export class ProjectList extends LitElement {
  static styles = css`
    .project-list-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 30px 20px;
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
  };

  constructor() {
    super();
    this.projects = [];
    this.loading = true;
    this.error = "";
    this.showCreate = false;
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
          <button class="btn-create" @click=${this._toggleCreate}>
            ${this.showCreate ? "Close" : "+ New Project"}
          </button>
        </div>

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
      </div>
    `;
  }
}

customElements.define("project-list", ProjectList);
