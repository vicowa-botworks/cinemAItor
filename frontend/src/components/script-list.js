import { css, html, LitElement } from "lit";
import { api } from "../api.js";

export class ScriptList extends LitElement {
  static styles = css`
    .script-list {
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

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .script-card {
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

    .script-card:hover {
      border-color: var(--color-primary);
      transform: translateY(-2px);
    }

    .script-name {
      font-size: 16px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .script-meta {
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
    scripts: { state: true },
    projects: { state: true },
    projectFilter: { state: true },
    loading: { state: true },
    error: { state: true },
    creating: { state: true },
    newScriptName: { state: true },
    newScriptProject: { state: true },
    showCreate: { state: true },
    createError: { state: true },
  };

  constructor() {
    super();
    this.scripts = [];
    this.projects = [];
    this.projectFilter = (window.location.hash.split("?")[1] ?? "")
      .split("&")
      .find((kv) => kv.startsWith("project="))
      ?.split("=")[1] ?? "";
    this.loading = false;
    this.error = "";
    this.creating = false;
    this.newScriptName = "";
    this.newScriptProject = "";
    this.showCreate = false;
    this.createError = "";
  }

  async connectedCallback() {
    super.connectedCallback?.();
    await this._load();
  }

  render() {
    return html`
      <div class="script-list">
        <div class="list-header">
          <div class="list-title">Scripts</div>
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
              ${this.projects.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
            </select>
          </div>
          <button
            class="btn btn-primary"
            @click=${() => {
              this.showCreate = true;
              this.createError = "";
            }}>
            New script
          </button>
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : null}

        ${this.showCreate
          ? html`
            <div
              class="create-panel"
              style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);padding:16px;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
              <div style="display:flex;flex-direction:column;gap:4px;">
                <label
                  style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;">
                  Name
                </label>
                <input
                  type="text"
                  .value=${this.newScriptName}
                  @input=${(e) => (this.newScriptName = e.target.value)}
                  placeholder="Draft one"
                  style="padding:8px 12px;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text);min-width:220px;">
              </div>
              <div style="display:flex;flex-direction:column;gap:4px;">
                <label
                  style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;">
                  Project
                </label>
                <select
                  .value=${this.newScriptProject}
                  @change=${(e) => (this.newScriptProject = e.target.value)}
                  style="padding:8px 12px;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text);">
                  ${this.projects.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
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

        ${this.scripts.length === 0
          ? html`
            <div class="empty">
              ${this.loading
                ? "Loading scripts..."
                : this.projectFilter
                ? "No scripts in this project."
                : "No scripts yet. Create the first one — paste a screenplay or generate one."}
            </div>
          `
          : html`
            <div class="cards">
              ${this.scripts.map(
                (s) =>
                  html`
                    <div
                      class="script-card"
                      @click=${() => (window.location.hash = `#/script/${
                        encodeURIComponent(s.id)
                      }`)}>
                      <div class="script-name">${s.name}</div>
                      <div class="script-meta">${this._fmtWhen(s.updated_at)}</div>
                      <span class="status-chip ${s.status === "active" ? "active" : ""}">
                        ${s.status}
                      </span>
                    </div>
                  `,
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
      const [projects, scripts] = await Promise.all([
        api.listProjects(),
        api.listScripts(this.projectFilter ? { project_id: this.projectFilter } : {}),
      ]);
      this.projects = projects;
      this.scripts = scripts;
      if (!this.newScriptProject && projects.length > 0) {
        this.newScriptProject = this.projectFilter || projects[0].id;
      }
    } catch (err) {
      this.error = err.message || "Failed to load scripts.";
    } finally {
      this.loading = false;
    }
  }

  async _create() {
    const name = this.newScriptName.trim();
    const project_id = this.newScriptProject;
    if (!name || !project_id) {
      this.createError = "Name and project are required.";
      return;
    }
    this.creating = true;
    this.createError = "";
    try {
      const script = await api.createScript({ name, project_id });
      window.location.hash = `#/script/${encodeURIComponent(script.id)}`;
    } catch (err) {
      this.createError = err.message || "Failed to create script.";
    } finally {
      this.creating = false;
    }
  }
}

customElements.define("script-list", ScriptList);
