import { css, html, LitElement } from "lit";
import { api } from "../api.js";

const FILTER_TYPES = [
  "character",
  "location",
  "prop",
  "image",
  "video",
  "audio",
  "music",
  "sfx",
  "voiceover",
  "ambience",
];

export class AssetList extends LitElement {
  static styles = css`
    .asset-list {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .list-title {
      font-size: 22px;
      font-weight: 600;
    }

    .header-actions {
      display: flex;
      gap: 10px;
    }

    .btn {
      padding: 9px 18px;
      border: none;
      border-radius: var(--radius);
      font-size: 14px;
      cursor: pointer;
      font-weight: 500;
      background-color: var(--color-primary);
      color: white;
    }

    .btn:hover {
      background-color: var(--color-primary-hover);
    }

    .btn-secondary {
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .filters {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: flex-end;
    }

    .filter-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .filter-field label {
      font-size: 11px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .filters input,
    .filters select {
      padding: 7px 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 18px;
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

    .error {
      color: var(--color-error);
      font-size: 13px;
    }

    .panel {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 20px;
    }

    .panel-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 14px;
    }

    .result-count {
      font-size: 13px;
      color: var(--color-text-muted);
    }
  `;

  static properties = {
    projectId: {},
    panel: { state: true },
    assets: { state: true },
    loading: { state: true },
    error: { state: true },
    scope: { state: true },
    type: { state: true },
    status: { state: true },
    tag: { state: true },
    q: { state: true },
  };

  constructor() {
    super();
    this.projectId = null;
    this.panel = null;
    this.assets = [];
    this.loading = false;
    this.error = "";
    this.scope = "";
    this.type = "";
    this.status = "";
    this.tag = "";
    this.q = "";
    this._qTimer = null;
    this._loadedFor = Symbol("unloaded");
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    if (this._qTimer) {
      clearTimeout(this._qTimer);
      this._qTimer = null;
    }
  }

  willUpdate(changed) {
    if (changed.has("projectId") && this.projectId !== this._loadedFor) {
      this._loadedFor = this.projectId;
      this._load();
    }
  }

  _filter() {
    const filter = {};
    if (this.projectId) {
      filter.project_id = this.projectId;
    }
    if (this.scope) filter.library_scope = this.scope;
    if (this.type) filter.asset_type = this.type;
    if (this.status) filter.status = this.status;
    if (this.tag) filter.tag = this.tag.trim();
    if (this.q) filter.q = this.q.trim();
    return filter;
  }

  async _load() {
    this.loading = true;
    this.error = "";
    try {
      this.assets = await api.listAssets(this._filter());
    } catch (err) {
      this.error = err.message || "Failed to load assets";
      this.assets = [];
    } finally {
      this.loading = false;
    }
  }

  _onSearch(e) {
    this.q = e.target.value;
    if (this._qTimer) clearTimeout(this._qTimer);
    this._qTimer = setTimeout(() => {
      this._qTimer = null;
      this._load();
    }, 300);
  }

  _onFilterChange(e) {
    const { name, value } = e.target;
    this[name] = value;
    this._load();
  }

  _openPanel(panel) {
    this.panel = this.panel === panel ? null : panel;
  }

  _onSaved(e) {
    const id = e.detail?.asset?.id;
    if (!id) return;
    window.location.hash = `#/asset/${encodeURIComponent(id)}`;
  }

  render() {
    return html`
      <div class="asset-list">
        <div class="list-header">
          <div>
            <span class="list-title">
              ${this.projectId ? "Project Assets" : "Asset Library"}
            </span>
            <span class="result-count">
              ${this.loading
                ? "Loading..."
                : `${this.assets.length} asset${this.assets.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <div class="header-actions">
            <button class="btn" @click=${() => this._openPanel("generate")}>
              Generate
            </button>
            <button class="btn" @click=${() => this._openPanel("upload")}>Upload</button>
            <button class="btn btn-secondary"
              @click=${() => this._openPanel("create")}>New Asset</button>
          </div>
        </div>

        ${this.panel === "generate"
          ? html`
            <div class="panel">
              <div class="panel-title">
                Generate Asset (prompt → image / video)
              </div>
              <asset-generate .projectId=${this.projectId}></asset-generate>
            </div>
          `
          : ""}

        ${this.panel === "upload"
          ? html`
            <div class="panel">
              <div class="panel-title">Upload Asset</div>
              <asset-upload .projectId=${this.projectId} @saved=${this._onSaved}
                @cancel=${() => {
                  this.panel = null;
                }}></asset-upload>
            </div>
          `
          : ""}

        ${this.panel === "create"
          ? html`
            <div class="panel">
              <div class="panel-title">New Asset</div>
              <asset-form .projectId=${this.projectId} @saved=${this._onSaved}
                @cancel=${() => {
                  this.panel = null;
                }}></asset-form>
            </div>
          `
          : ""}

        <div class="filters">
          <div class="filter-field" style="flex:1; min-width:180px;">
            <label for="f-search">Search</label>
            <input id="f-search" type="search" .value=${this.q}
              @input=${this._onSearch} placeholder="slug, name, description..." />
          </div>
          ${this.projectId ? "" : html`
            <div class="filter-field">
              <label for="f-scope">Scope</label>
              <select id="f-scope" name="scope" .value=${this.scope}
                @change=${this._onFilterChange}>
                <option value="">all</option>
                <option value="global">global</option>
                <option value="project">project</option>
              </select>
            </div>
          `}
          <div class="filter-field">
            <label for="f-type">Type</label>
            <select id="f-type" name="type" .value=${this.type}
              @change=${this._onFilterChange}>
              <option value="">all</option>
              ${FILTER_TYPES.map(
                (t) => html`<option value=${t}>${t}</option>`,
              )}
            </select>
          </div>
          <div class="filter-field">
            <label for="f-status">Status</label>
            <select id="f-status" name="status" .value=${this.status}
              @change=${this._onFilterChange}>
              <option value="">all</option>
              <option value="draft">draft</option>
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
              <option value="archived">archived</option>
            </select>
          </div>
          <div class="filter-field">
            <label for="f-tag">Tag</label>
            <input id="f-tag" type="text" name="tag" .value=${this.tag}
              @change=${this._onFilterChange} placeholder="e.g. vfx" />
          </div>
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : ""}

        ${this.loading
          ? html`<div class="empty">Loading assets...</div>`
          : this.assets.length === 0
          ? html`
            <div class="empty">
              No assets ${this.projectId ? "in this project" : "yet"}. Upload a file, generate
              one from a prompt, or create an asset to get started.
            </div>
          `
          : html`
            <div class="grid">
              ${this.assets.map(
                (a) =>
                  html`
                    <asset-card .asset=${a} @navigate=${(e) => {
                      window.location.hash = `#/asset/${encodeURIComponent(e.detail)}`;
                    }}></asset-card>
                  `,
              )}
            </div>
          `}
      </div>
    `;
  }
}

customElements.define("asset-list", AssetList);
