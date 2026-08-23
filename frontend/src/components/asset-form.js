import { css, html, LitElement } from "lit";
import { api } from "../api.js";

export const ASSET_TYPE_PRESETS = [
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

export function slugifyName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export class AssetForm extends LitElement {
  static styles = css`
    .asset-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    label {
      display: block;
      font-size: 13px;
      color: var(--color-text-muted);
      margin-bottom: 5px;
      font-weight: 500;
    }

    input,
    select,
    textarea {
      width: 100%;
      padding: 9px 12px;
      background-color: var(--color-surface-hover);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 14px;
      font-family: inherit;
      box-sizing: border-box;
    }

    input:focus,
    select:focus,
    textarea:focus {
      outline: none;
      border-color: var(--color-primary);
    }

    textarea {
      resize: vertical;
      min-height: 64px;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .hint {
      font-size: 11px;
      color: var(--color-text-muted);
      margin-top: 4px;
    }

    .actions {
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
    }

    .btn-primary {
      background-color: var(--color-primary);
      color: white;
    }

    .btn-primary:hover {
      background-color: var(--color-primary-hover);
    }

    .btn-secondary {
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
    }
  `;

  static properties = {
    projectId: {},
    displayName: { state: true },
    slug: { state: true },
    slugTouched: { state: true },
    assetType: { state: true },
    customType: { state: true },
    scope: { state: true },
    selectedProject: { state: true },
    description: { state: true },
    projects: { state: true },
    loading: { state: true },
    error: { state: true },
  };

  constructor() {
    super();
    this.projectId = null;
    this.displayName = "";
    this.slug = "";
    this.slugTouched = false;
    this.assetType = "image";
    this.customType = "";
    this.scope = "global";
    this.selectedProject = "";
    this.description = "";
    this.projects = [];
    this.loading = false;
    this.error = "";
  }

  connectedCallback() {
    super.connectedCallback?.();
    if (this.projectId) {
      this.scope = "project";
    }
  }

  _effectiveProjectId() {
    return this.projectId ?? this.selectedProject;
  }

  _effectiveType() {
    return this.assetType === "__custom" ? this.customType.trim() : this.assetType;
  }

  _onNameInput(e) {
    this.displayName = e.target.value;
    if (!this.slugTouched) {
      this.slug = slugifyName(e.target.value);
    }
  }

  _onScopeChange(e) {
    this.scope = e.target.value;
    this._ensureProjects();
  }

  async _ensureProjects() {
    if (this.projects.length > 0 || this.projectId) return;
    try {
      this.projects = await api.listProjects();
    } catch {
      // Project picker stays empty; the error surfaces on submit.
    }
  }

  async _submit(e) {
    e.preventDefault();
    this.error = "";

    const slug = this.slug.trim();
    if (!/^[a-z0-9][a-z0-9_]{0,63}$/.test(slug)) {
      this.error = "Slug must be lowercase letters/digits/underscore, 1-64 chars";
      return;
    }
    const type = this._effectiveType();
    if (!/^[a-z0-9][a-z0-9_+-]{0,49}$/.test(type)) {
      this.error = "Asset type is required";
      return;
    }
    if (this.scope === "project" && !this._effectiveProjectId()) {
      this.error = "Choose a project for a project-scoped asset";
      return;
    }

    this.loading = true;
    try {
      const asset = await api.createAsset({
        unique_slug: slug,
        display_name: this.displayName.trim(),
        asset_type: type,
        library_scope: this.scope,
        project_id: this.scope === "project" ? this._effectiveProjectId() : undefined,
        description: this.description.trim() || null,
      });
      this.dispatchEvent(new CustomEvent("saved", { detail: asset, bubbles: true }));
    } catch (err) {
      this.error = err.message || "Failed to create asset";
    } finally {
      this.loading = false;
    }
  }

  _cancel() {
    this.dispatchEvent(new CustomEvent("cancel", { bubbles: true }));
  }

  render() {
    return html`
      <form class="asset-form" @submit=${this._submit}>
        <div>
          <label for="asset-name">Display Name</label>
          <input id="asset-name" type="text" .value=${this.displayName}
            @input=${this._onNameInput} placeholder="Hero's sword" required />
        </div>

        <div>
          <label for="asset-slug">Unique Slug (@name)</label>
          <input id="asset-slug" type="text" .value=${this.slug}
            @input=${(e) => {
              this.slug = e.target.value;
              this.slugTouched = true;
            }} placeholder="heros_sword" required
            pattern="[a-z0-9][a-z0-9_]*" />
          <div class="hint">
            Global @name used in prompts; lowercase, digits, underscore; never changes.
          </div>
        </div>

        <div class="row">
          <div>
            <label for="asset-type">Type</label>
            <select id="asset-type" .value=${this.assetType}
              @change=${(e) => {
                this.assetType = e.target.value;
              }}>
              <option value="image">image</option>
              <option value="character">character</option>
              <option value="location">location</option>
              <option value="prop">prop</option>
              <option value="video">video</option>
              <option value="audio">audio</option>
              <option value="music">music</option>
              <option value="sfx">sfx</option>
              <option value="voiceover">voiceover</option>
              <option value="ambience">ambience</option>
              <option value="model">model (3D)</option>
              <option value="__custom">custom...</option>
            </select>
          </div>
          ${this.assetType === "__custom"
            ? html`
              <div>
                <label for="asset-type-custom">Custom Type</label>
                <input id="asset-type-custom" type="text"
                  .value=${this.customType} @input=${(e) => {
                    this.customType = e.target.value;
                  }} placeholder="storyboard" />
              </div>
            `
            : ""}
        </div>

        ${this.projectId
          ? html`
            <p class="hint">
              Scope: project (${this.projectId.length > 12
                ? `${this.projectId.slice(0, 12)}...`
                : this.projectId})
            </p>
          `
          : html`
            <div class="row">
              <div>
                <label for="asset-scope">Scope</label>
                <select id="asset-scope" .value=${this.scope}
                  @change=${this._onScopeChange}>
                  <option value="global">global (shared library)</option>
                  <option value="project">project</option>
                </select>
              </div>
              ${this.scope === "project"
                ? html`
                  <div>
                    <label for="asset-project">Project</label>
                    <select id="asset-project" .value=${this.selectedProject}
                      @change=${(e) => {
                        this.selectedProject = e.target.value;
                      }}>
                      <option value="">Choose a project...</option>
                      ${this.projects.map(
                        (p) => html`<option value=${p.id}>${p.name}</option>`,
                      )}
                    </select>
                  </div>
                `
                : ""}
            </div>
          `}

        <div>
          <label for="asset-description">Description</label>
          <textarea id="asset-description" .value=${this.description}
            @input=${(e) => {
              this.description = e.target.value;
            }}
            placeholder="Optional notes about what this asset is"></textarea>
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : ""}

        <div class="actions">
          <button type="submit" class="btn btn-primary"
            ?disabled=${this.loading}>
            ${this.loading ? "Creating..." : "Create Asset"}
          </button>
          <button type="button" class="btn btn-secondary"
            @click=${this._cancel}>Cancel</button>
        </div>
      </form>
    `;
  }
}

customElements.define("asset-form", AssetForm);
