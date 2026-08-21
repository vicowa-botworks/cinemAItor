import { css, html, LitElement } from "lit";
import { api } from "../api.js";

export class TimelineList extends LitElement {
  static styles = css`
    .timeline-list {
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

    .error {
      color: var(--color-error);
      font-size: 14px;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .timeline-card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 20px;
      cursor: pointer;
      transition:
        border-color 0.15s ease,
        transform 0.15s ease;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .timeline-card:hover {
      border-color: var(--color-primary);
      transform: translateY(-2px);
    }

    .timeline-name {
      font-size: 16px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .timeline-meta {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .duration-chip {
      align-self: flex-start;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
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

    .create-panel {
      display: flex;
      gap: 12px;
      align-items: flex-end;
      flex-wrap: wrap;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .field label {
      font-size: 11px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .field input,
    .field select {
      padding: 8px 12px;
      background-color: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
    }

    .field input {
      min-width: 220px;
    }

    .create-error {
      color: var(--color-error);
      font-size: 13px;
      align-self: center;
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
    timelines: { state: true },
    projects: { state: true },
    projectFilter: { state: true },
    loading: { state: true },
    error: { state: true },
    creating: { state: true },
    newName: { state: true },
    newProject: { state: true },
    showCreate: { state: true },
    createError: { state: true },
  };

  constructor() {
    super();
    this.timelines = [];
    this.projects = [];
    this.projectFilter = (window.location.hash.split("?")[1] ?? "")
      .split("&")
      .find((kv) => kv.startsWith("project="))
      ?.split("=")[1] ?? "";
    this.loading = false;
    this.error = "";
    this.creating = false;
    this.newName = "";
    this.newProject = this.projectFilter;
    this.showCreate = false;
    this.createError = "";
  }

  async connectedCallback() {
    super.connectedCallback?.();
    await this._load();
  }

  async _load() {
    this.loading = true;
    this.error = "";
    try {
      const [projects, timelines] = await Promise.all([
        api.listProjects(),
        api.listTimelines(this.projectFilter ? { project_id: this.projectFilter } : {}),
      ]);
      this.projects = projects;
      this.timelines = timelines;
      if (!this.newProject) {
        this.newProject = this.projectFilter;
      }
    } catch (e) {
      this.error = e.message ?? "Failed to load timelines.";
    } finally {
      this.loading = false;
    }
  }

  async _create() {
    const name = this.newName.trim();
    const project_id = this.newProject;
    if (!name || !project_id) {
      this.createError = "Name and project are required.";
      return;
    }
    this.creating = true;
    this.createError = "";
    try {
      const timeline = await api.createTimeline({ name, project_id });
      window.location.hash = `#/timeline/${encodeURIComponent(timeline.id)}`;
    } catch (e) {
      this.createError = e.message ?? "Failed to create timeline.";
      this.creating = false;
    }
  }

  _formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds ?? 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  render() {
    return html`
      <div class="timeline-list">
        <div class="list-header">
          <div class="list-title">Timelines</div>
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
            New timeline
          </button>
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : null}

        ${this.showCreate
          ? html`
            <div
              class="create-panel"
              style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);padding:16px;">
              <div class="field">
                <label>Name</label>
                <input
                  type="text"
                  .value=${this.newName}
                  @input=${(e) => (this.newName = e.target.value)}
                  placeholder="Cut v1">
              </div>
              <div class="field">
                <label>Project</label>
                <select
                  .value=${this.newProject}
                  @change=${(e) => (this.newProject = e.target.value)}>
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
              <button
                class="btn btn-secondary"
                @click=${() => (this.showCreate = false)}>
                Cancel
              </button>
              ${this.createError
                ? html`<span class="create-error">${this.createError}</span>`
                : null}
            </div>
          `
          : null}

        ${this.timelines.length === 0
          ? html`
            <div class="empty">
              ${this.loading
                ? "Loading timelines..."
                : this.projectFilter
                ? "No timelines in this project."
                : "No timelines yet. Create the first one."}
            </div>
          `
          : html`
            <div class="cards">
              ${this.timelines.map((t) => this._renderCard(t))}
            </div>
          `}
      </div>
    `;
  }

  _renderCard(t) {
    return html`
      <div
        class="timeline-card"
        @click=${() => (window.location.hash = `#/timeline/${encodeURIComponent(t.id)}`)}>
        <span class="duration-chip">${this._formatDuration(t.duration)}</span>
        <span class="timeline-name">${t.name}</span>
        <span class="timeline-meta">
          Updated ${new Date(t.updated_at).toLocaleString()}
        </span>
      </div>
    `;
  }
}

customElements.define("timeline-list", TimelineList);
