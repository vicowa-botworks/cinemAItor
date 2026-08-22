import { css, html, LitElement } from "lit";
import { api } from "../api.js";

export class StoryboardList extends LitElement {
  static styles = css`
    .board-list {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    .list-title {
      font-size: 24px;
      font-weight: 700;
    }

    .project-filter {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .project-filter label {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .project-filter select {
      padding: 8px 12px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: var(--radius);
      font-size: 14px;
      cursor: pointer;
      font-weight: 500;
    }

    .btn-primary {
      background-color: var(--color-primary);
      color: white;
    }

    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-secondary {
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .error {
      color: var(--color-error);
      font-size: 14px;
    }

    .panels {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .board-card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 20px;
      cursor: pointer;
      transition: border-color 0.15s ease, transform 0.15s ease;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .board-card:hover {
      border-color: var(--color-primary);
      transform: translateY(-2px);
    }

    .board-name {
      font-size: 16px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .board-meta {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .status-chip {
      align-self: flex-start;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
    }

    .status-chip.active {
      background-color: #0d9488;
      color: white;
      border-color: #0d9488;
    }

    .empty {
      background-color: var(--color-surface);
      border: 1px dashed var(--color-border);
      border-radius: var(--radius);
      padding: 48px 24px;
      text-align: center;
      color: var(--color-text-muted);
      font-size: 14px;
    }
  `;

  static properties = {
    boards: { state: true },
    projects: { state: true },
    projectFilter: { state: true },
    loading: { state: true },
    error: { state: true },
    creating: { state: true },
    newBoardName: { state: true },
    newBoardProject: { state: true },
    showCreate: { state: true },
    createError: { state: true },
  };

  constructor() {
    super();
    this.boards = [];
    this.projects = [];
    this.projectFilter = (window.location.hash.split("?")[1] ?? "")
      .split("&")
      .find((kv) => kv.startsWith("project="))
      ?.split("=")[1] ?? "";
    this.loading = false;
    this.error = "";
    this.creating = false;
    this.newBoardName = "";
    this.newBoardProject = "";
    this.showCreate = false;
    this.createError = "";
  }

  async connectedCallback() {
    super.connectedCallback?.();
    await this._load();
  }

  render() {
    return html`
      <div class="board-list">
        <div class="list-header">
          <div class="list-title">Storyboards</div>
          <div class="project-filter">
            <label for="filter-project">Project</label>
            <select
              id="filter-project"
              .value=${this.projectFilter}
              @change=${(e) => {
                this.projectFilter = e.target.value;
                this._load();
              }}>
              <option value="">all</option>
              ${this.projects.map(
                (p) => html`<option value=${p.id}>${p.name}</option>`,
              )}
            </select>
          </div>
          <button
            class="btn btn-primary"
            @click=${() => {
              this.showCreate = true;
              this.createError = "";
            }}>
            New storyboard
          </button>
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : null}

        ${this.showCreate
          ? html`
            <div class="create-panel"
              style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);padding:16px;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
              <div style="display:flex;flex-direction:column;gap:4px;">
                <label
                  style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;">
                  Name
                </label>
                <input
                  type="text"
                  .value=${this.newBoardName}
                  @input=${(e) => (this.newBoardName = e.target.value)}
                  placeholder="Act one"
                  style="padding:8px 12px;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text);min-width:220px;">
              </div>
              <div style="display:flex;flex-direction:column;gap:4px;">
                <label
                  style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;">
                  Project
                </label>
                <select
                  .value=${this.newBoardProject}
                  @change=${(e) => (this.newBoardProject = e.target.value)}
                  style="padding:8px 12px;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text);">
                  ${this.projects.map(
                    (p) => html`<option value=${p.id}>${p.name}</option>`,
                  )}
                </select>
              </div>
              <button
                class="btn btn-primary"
                ?disabled=${this.creating}
                @click=${this._create}>
                ${this.creating ? "Creating..." : "Create"}
              </button>
              <button class="btn btn-secondary" @click=${() => (this.showCreate = false)}>
                Cancel
              </button>
              ${this.createError
                ? html`
                  <span
                    style="color:var(--color-error);font-size:13px;align-self:center;">
                                      ${this.createError}
                                    </span>
                `
                : null}
            </div>
          `
          : null}

        ${this.boards.length === 0
          ? html`
            <div class="empty">
              ${this.loading
                ? "Loading storyboards..."
                : this.projectFilter
                ? "No storyboards in this project."
                : "No storyboards yet. Create the first one."}
            </div>
          `
          : html`
            <div class="panels">
              ${this.boards.map((b) =>
                html`
                  <div
                    class="board-card"
                    @click=${() => (window.location.hash = `#/storyboard/${
                      encodeURIComponent(b.id)
                    }`)}>
                    <div class="board-name">${b.name}</div>
                    <div class="board-meta">${this._fmtWhen(b.created_at)}</div>
                    <span class="status-chip ${b.status === "active" ? "active" : ""}">
                      ${b.status}
                    </span>
                  </div>
                `
              )}
            </div>
          `}
      </div>
    `;
  }

  _fmtWhen(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString();
  }

  async _load() {
    this.loading = true;
    this.error = "";
    try {
      const [projects, boards] = await Promise.all([
        api.listProjects(),
        api.listStoryboards(
          this.projectFilter ? { project_id: this.projectFilter } : {},
        ),
      ]);
      this.projects = projects;
      this.boards = boards;
      if (!this.newBoardProject && projects.length > 0) {
        this.newBoardProject = this.projectFilter || projects[0].id;
      }
    } catch (err) {
      this.error = err.message || "Failed to load storyboards.";
    } finally {
      this.loading = false;
    }
  }

  async _create() {
    const name = this.newBoardName.trim();
    const project_id = this.newBoardProject;
    if (!name || !project_id) {
      this.createError = "Name and project are required.";
      return;
    }
    this.creating = true;
    this.createError = "";
    try {
      await api.createStoryboard({ name, project_id });
      this.showCreate = false;
      this.newBoardName = "";
      await this._load();
    } catch (err) {
      this.createError = err.message || "Failed to create storyboard.";
    } finally {
      this.creating = false;
    }
  }
}

customElements.define("storyboard-list", StoryboardList);
