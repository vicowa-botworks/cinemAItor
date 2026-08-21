import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import "./project-form.js";

export class ProjectDetail extends LitElement {
  static styles = css`
    .detail-container {
      max-width: 900px;
      margin: 0 auto;
      padding: 30px 20px;
    }

    .back-btn {
      background: transparent;
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
      padding: 8px 16px;
      margin-bottom: 20px;
      border-radius: var(--radius);
      font-size: 13px;
    }

    .back-btn:hover {
      color: var(--color-text);
      border-color: var(--color-text);
    }

    .detail-header {
      margin-bottom: 24px;
    }

    .detail-header h2 {
      font-size: 28px;
      margin-bottom: 12px;
    }

    .meta-tags {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    .meta-tag {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .description {
      color: var(--color-text-muted);
      line-height: 1.6;
      margin-bottom: 20px;
    }

    .actions {
      display: flex;
      gap: 12px;
    }

    .btn-edit {
      background-color: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-edit:hover {
      border-color: var(--color-text);
    }

    .btn-delete {
      background-color: transparent;
      color: var(--color-error);
      border: 1px solid var(--color-error);
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

    .delete-note {
      font-size: 12px;
      color: var(--color-text-muted);
      margin-top: 8px;
    }
  `;

  static properties = {
    projectId: {},
    project: {},
    loading: {},
    error: {},
    editing: {},
    deleting: {},
  };

  constructor() {
    super();
    this.projectId = null;
    this.project = null;
    this.loading = true;
    this.error = "";
    this.editing = false;
    this.deleting = false;
  }

  async connectedCallback() {
    super.connectedCallback?.();
    if (this.projectId) {
      await this._loadProject();
    } else {
      this.error = "No project ID found";
      this.loading = false;
    }
  }

  updated(changed) {
    if (
      changed.has("projectId") && this.projectId &&
      this.projectId !== this._loadedId
    ) {
      this._loadProject();
    }
  }

  async _loadProject() {
    if (!this.projectId) return;
    this.loading = true;
    this.error = "";
    try {
      this.project = await api.getProject(this.projectId);
      this._loadedId = this.project.id;
      this.editing = false;
    } catch (err) {
      this.error = err.message || "Failed to load project";
      this._loadedId = this.projectId;
    } finally {
      this.loading = false;
    }
  }

  _goBack() {
    window.location.hash = "#/projects";
  }

  _gotoAssets() {
    window.location.hash = `#/project/${encodeURIComponent(this.projectId)}/assets`;
  }

  _gotoCreative(path) {
    window.location.hash = `#${path}?project=${encodeURIComponent(this.projectId)}`;
  }

  _toggleEdit() {
    this.editing = !this.editing;
    this.error = "";
  }

  _onSaved() {
    this.editing = false;
    this._loadProject();
  }

  _onEditCancel() {
    this.editing = false;
  }

  async _deleteProject() {
    if (!confirm("Delete this project? Its data will be marked deleted.")) {
      return;
    }
    this.deleting = true;
    this.error = "";
    try {
      await api.deleteProject(this.projectId);
      window.location.hash = "#/projects";
    } catch (err) {
      this.error = err.message || "Failed to delete project";
      this.deleting = false;
    }
  }

  _formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }

  render() {
    if (this.loading) {
      return html`
        <div class="detail-container">
          <div class="loading">Loading...</div>
        </div>
      `;
    }

    if (this.error && !this.project) {
      return html`
        <div class="detail-container">
          <button class="back-btn" @click=${this
            ._goBack}>← Back to Projects</button>
          <div class="error">${this.error}</div>
        </div>
      `;
    }

    if (!this.project) return null;

    const p = this.project;

    return html`
      <div class="detail-container">
        <button class="back-btn" @click=${this
          ._goBack}>← Back to Projects</button>

        <div class="detail-header">
          <h2>${p.name}</h2>
          <div class="meta-tags">
            <span class="meta-tag">${p.aspect_ratio}</span>
            <span class="meta-tag">${p.resolution_width}x${p
              .resolution_height}</span>
            <span class="meta-tag">${p.frame_rate} fps</span>
            <span class="meta-tag">${p.color_space}</span>
            <span class="meta-tag">${(p.audio_sample_rate / 1000).toFixed(
              1,
            )} kHz audio</span>
          </div>
          ${p.description ? html`<p class="description">${p.description}</p>` : ""}
          <div class="actions">
            <button class="btn-edit" @click=${this._toggleEdit}>
              ${this.editing ? "Close" : "Edit settings"}
            </button>
            <button class="btn-edit" @click=${this._gotoAssets}>
              View assets
            </button>
            <button class="btn-edit"
              @click=${() => this._gotoCreative("/storyboards")}>
              View storyboards
            </button>
            <button class="btn-edit"
              @click=${() => this._gotoCreative("/scenes")}>
              View scenes
            </button>
            <button class="btn-edit"
              @click=${() => this._gotoCreative("/timelines")}>
              View timelines
            </button>
            <button class="btn-delete" ?disabled=${this.deleting}
              @click=${this._deleteProject}>
              ${this.deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
          ${this.error
            ? html`<p class="delete-note" style="color: var(--color-error);">${this.error}</p>`
            : ""}
        </div>

        ${this.editing
          ? html`
            <project-form .project=${p} @saved=${this._onSaved}
              @cancel=${this._onEditCancel}></project-form>
          `
          : html`
            <div class="details">
              <div class="meta-tags">
                <span class="meta-tag">Created ${this._formatDate(
                  p.created_at,
                ) || "—"}</span>
                <span class="meta-tag">Updated ${this._formatDate(
                  p.updated_at,
                ) || "—"}</span>
              </div>
            </div>
          `}
      </div>
    `;
  }
}

customElements.define("project-detail", ProjectDetail);
