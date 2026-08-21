import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import { slugifyName } from "./asset-form.js";

const TYPE_OPTIONS = [
  "image",
  "video",
  "audio",
  "character",
  "location",
  "prop",
];

export class AssetUpload extends LitElement {
  static styles = css`
    .asset-upload {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .file-row {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    .file-name {
      font-size: 13px;
      color: var(--color-text-muted);
      word-break: break-all;
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

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
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

    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .status {
      font-size: 13px;
      color: var(--color-text-muted);
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
    }
  `;

  static properties = {
    projectId: {},
    file: {},
    displayName: {},
    slug: {},
    slugTouched: {},
    assetType: {},
    scope: {},
    selectedProject: {},
    notes: {},
    projects: { state: true },
    status: { state: true },
    error: { state: true },
    busy: { state: true },
  };

  constructor() {
    super();
    this.projectId = null;
    this.file = null;
    this.displayName = "";
    this.slug = "";
    this.slugTouched = false;
    this.assetType = "image";
    this.scope = "global";
    this.selectedProject = "";
    this.notes = "";
    this.projects = [];
    this.status = "";
    this.error = "";
    this.busy = false;
  }

  _fileInput() {
    return this.shadowRoot?.querySelector("input[type=file]");
  }

  _pickFile() {
    this._fileInput()?.click();
  }

  _onFileChange(e) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    this.file = file;
    const base = file.name.replace(/\.[^.]+$/, "");
    if (!this.displayName) {
      this.displayName = base;
      this.slug = slugifyName(base);
    }
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
    e?.preventDefault();
    if (this.busy) return;
    this.error = "";

    const slug = this.slug.trim();
    if (!/^[a-z0-9][a-z0-9_]{0,63}$/.test(slug)) {
      this.error = "Slug must be lowercase letters/digits/underscore, 1-64 chars";
      return;
    }
    if (!this.file) {
      this.error = "Pick a file to upload";
      return;
    }
    const projectId = this.projectId ?? this.selectedProject;
    if (this.scope === "project" && !projectId) {
      this.error = "Choose a project for a project-scoped asset";
      return;
    }

    this.busy = true;
    this.status = "Creating asset...";
    try {
      const asset = await api.createAsset({
        unique_slug: slug,
        display_name: this.displayName.trim() || slug,
        asset_type: this.assetType,
        library_scope: projectId ? "project" : "global",
        project_id: projectId || undefined,
        description: null,
      });
      this.status = "Uploading file (hash + dedupe + proxy job)...";
      const result = await api.uploadAsset(
        asset.id,
        this.file,
        this.notes.trim() || undefined,
      );
      this.dispatchEvent(
        new CustomEvent("saved", {
          detail: { asset: result.asset, version: result.version },
          bubbles: true,
        }),
      );
    } catch (err) {
      this.error = err.message || "Upload failed";
    } finally {
      this.busy = false;
      this.status = "";
    }
  }

  _cancel() {
    this.dispatchEvent(new CustomEvent("cancel", { bubbles: true }));
  }

  render() {
    return html`
      <form class="asset-upload" @submit=${this._submit}>
        <div class="file-row">
          <button class="btn" type="button" @click=${this._pickFile}
            ?disabled=${this.busy}>
            ${this.file ? "Change File" : "Choose File"}
          </button>
          <input type="file" style="display:none"
            accept="image/*,video/*,audio/*" @change=${this._onFileChange} />
          <span class="file-name">${this.file?.name ?? ""}</span>
          ${this.file
            ? html`
              <span class="file-name">
                (${(this.file.size / 1024 / 1024).toFixed(1)} MB)
              </span>
            `
            : ""}
        </div>

        <div class="row">
          <div>
            <label for="upload-name">Display Name</label>
            <input id="upload-name" type="text" .value=${this.displayName}
              @input=${this._onNameInput} ?disabled=${this.busy} required />
          </div>
          <div>
            <label for="upload-slug">Unique Slug (@name)</label>
            <input id="upload-slug" type="text" .value=${this.slug} @input=${(e) => {
              this.slug = e.target.value;
              this.slugTouched = true;
            }} ?disabled=${this.busy} required />
          </div>
        </div>

        <div class="row">
          <div>
            <label for="upload-type">Type</label>
            <select id="upload-type" .value=${this.assetType} @change=${(e) => {
              this.assetType = e.target.value;
            }} ?disabled=${this.busy}>
              ${TYPE_OPTIONS.map(
                (t) => html`<option value=${t}>${t}</option>`,
              )}
            </select>
          </div>
          <div>
            <label for="upload-notes">Version Notes</label>
            <input id="upload-notes" type="text" .value=${this.notes}
              @input=${(e) => {
                this.notes = e.target.value;
              }} ?disabled=${this.busy} />
          </div>
        </div>

        ${this.projectId ? "" : html`
          <div class="row">
            <div>
              <label for="upload-scope">Scope</label>
              <select id="upload-scope" .value=${this.scope}
                @change=${this._onScopeChange} ?disabled=${this.busy}>
                <option value="global">global (shared library)</option>
                <option value="project">project</option>
              </select>
            </div>
            ${this.scope === "project"
              ? html`
                <div>
                  <label for="upload-project">Project</label>
                  <select id="upload-project" .value=${this.selectedProject}
                    @change=${(e) => {
                      this.selectedProject = e.target.value;
                    }} ?disabled=${this.busy}>
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

        ${this.status ? html`<div class="status">${this.status}</div>` : ""}
        ${this.error ? html`<div class="error">${this.error}</div>` : ""}

        <div class="file-row">
          <button type="submit" class="btn" ?disabled=${this.busy || !this.file}>
            ${this.busy ? "Working..." : "Create & Upload"}
          </button>
          <button type="button" class="btn btn-secondary" ?disabled=${this.busy}
            @click=${this._cancel}>Cancel</button>
        </div>
      </form>
    `;
  }
}

customElements.define("asset-upload", AssetUpload);
