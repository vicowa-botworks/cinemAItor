import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import {
  generationKindForAsset,
  generationTaskType,
  IMAGE_ASSET_TYPES,
  normalizeCandidates,
  normalizeSeed,
  slugify,
  validateGenerationForm,
  VIDEO_ASSET_TYPES,
} from "./asset-generation.js";

/**
 * Prompt-based generation form for image/video assets.
 *
 * New-asset mode (no `editAsset`): creates a fresh asset and queues a
 * generation job on it.
 * Edit mode (`editAsset` set): queues a generation job whose candidates are
 * stored as new versions of the given asset.
 *
 * Events: "queued" → detail { job_id, job_type, asset_id, kind, task_type }
 */
export class AssetGenerate extends LitElement {
  static styles = css`
    .gen {
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

    textarea {
      resize: vertical;
      min-height: 74px;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .row-3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 14px;
    }

    .kind-toggle {
      display: flex;
      gap: 8px;
    }

    .kind-toggle button {
      flex: 1;
      padding: 9px 12px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      font-size: 14px;
      cursor: pointer;
    }

    .kind-toggle button.active {
      border-color: var(--color-primary);
      background-color: var(--color-primary);
      color: white;
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

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .status {
      font-size: 13px;
      color: var(--color-text-muted);
    }

    .ok {
      color: #7bc47f;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
    }

    .errors {
      margin: 0;
      padding-left: 18px;
      color: var(--color-error);
      font-size: 13px;
    }

    .note {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .refs-block {
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 12px;
    }

    .check {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--color-text);
    }

    .check input {
      width: auto;
    }
  `;

  static properties = {
    editAsset: {},
    projectId: {},
    prompt: { state: true },
    kind: { state: true },
    slug: { state: true },
    slugTouched: { state: true },
    displayName: { state: true },
    assetType: { state: true },
    scope: { state: true },
    selectedProject: { state: true },
    projects: { state: true },
    modelId: { state: true },
    seed: { state: true },
    candidates: { state: true },
    references: { state: true },
    includeCurrent: { state: true },
    models: { state: true },
    busy: { state: true },
    error: { state: true },
    status: { state: true },
    queuedResult: { state: true },
  };

  constructor() {
    super();
    this.editAsset = null;
    this.projectId = null;
    this.prompt = "";
    this.kind = "image";
    this.slug = "";
    this.slugTouched = false;
    this.displayName = "";
    this.assetType = "image";
    this.scope = "global";
    this.selectedProject = "";
    this.projects = [];
    this.modelId = "";
    this.seed = "";
    this.candidates = 2;
    this.references = [];
    this.includeCurrent = false;
    this.models = [];
    this.busy = false;
    this.error = "";
    this.status = "";
    this.queuedResult = null;
    this._modelCache = new Map();
  }

  firstUpdated() {
    if (this.editAsset) {
      const kind = generationKindForAsset(this.editAsset);
      if (kind) this.kind = kind;
    }
    this._loadModels();
  }

  updated(changed) {
    if (changed.has("kind") || changed.has("references") || changed.has("includeCurrent")) {
      this._loadModels();
    }
  }

  _isEdit() {
    return !!this.editAsset;
  }

  _editKind() {
    return this.editAsset ? generationKindForAsset(this.editAsset) : null;
  }

  _hasInputs() {
    if (this.references.length > 0) return true;
    if (this._isEdit() && this.includeCurrent) {
      return !!this.editAsset.active_version_id;
    }
    return false;
  }

  _taskType() {
    return generationTaskType(this.kind, this._hasInputs());
  }

  async _loadModels() {
    const taskType = this._taskType();
    if (this._modelCache.has(taskType)) {
      this.models = this._modelCache.get(taskType);
      return;
    }
    try {
      const models = await api.listModels({
        task_type: taskType,
        enabled: "true",
      });
      this._modelCache.set(taskType, models);
      this.models = models;
    } catch {
      this._modelCache.set(taskType, []);
      this.models = [];
    }
  }

  _onKindChange(kind) {
    if (this._isEdit()) return;
    this.kind = kind;
    const types = kind === "video" ? VIDEO_ASSET_TYPES : IMAGE_ASSET_TYPES;
    if (!types.includes(this.assetType)) {
      this.assetType = kind; // "image" or "video"
    }
    if (!this.slugTouched) {
      this.slug = slugify(this.prompt);
    }
  }

  _onPromptInput(e) {
    this.prompt = e.target.value;
    if (!this._isEdit() && !this.slugTouched) {
      this.slug = slugify(this.prompt);
    }
  }

  async _ensureProjects() {
    if (this.projects.length > 0 || this.projectId) return;
    try {
      this.projects = await api.listProjects();
    } catch {
      // Project picker stays empty; validation catches a missing choice.
    }
  }

  _onScopeChange(e) {
    this.scope = e.target.value;
    if (this.scope === "project") this._ensureProjects();
  }

  _onRefsChange(e) {
    this.references = e.detail?.references ?? [];
  }

  _buildPayload() {
    const payload = {
      kind: this.kind,
      prompt: this.prompt.trim(),
    };
    const seed = normalizeSeed(this.seed);
    if (seed !== undefined) payload.seed = seed;
    payload.candidates = normalizeCandidates(this.candidates);
    if (this.modelId) payload.model_id = this.modelId;
    if (this.references.length > 0) payload.references = this.references;
    if (this._isEdit()) {
      if (this.includeCurrent && this.editAsset.active_version_id) {
        payload.include_current = true;
      }
    } else {
      payload.unique_slug = this.slug.trim();
      payload.display_name = this.displayName.trim() || payload.unique_slug;
      payload.asset_type = this.assetType;
      const projectId = this.projectId ?? this.selectedProject;
      payload.library_scope = projectId ? "project" : "global";
      if (projectId) payload.project_id = projectId;
    }
    return payload;
  }

  async _submit(e) {
    e?.preventDefault();
    if (this.busy) return;
    this.error = "";
    this.status = "";
    this.queuedResult = null;

    const errors = validateGenerationForm(
      {
        kind: this.kind,
        prompt: this.prompt,
        unique_slug: this.slug,
        library_scope: this.scope,
        project_id: this.projectId ?? this.selectedProject,
        references: this.references,
      },
      { isNew: !this._isEdit() },
    );
    if (errors.length > 0) {
      this.error = errors[0];
      return;
    }
    if (this._isEdit() && !this._editKind()) {
      this.error = "This asset type cannot be generated or edited with a prompt.";
      return;
    }

    const payload = this._buildPayload();
    this.busy = true;
    this.status = "Queueing generation job...";
    try {
      const result = this._isEdit()
        ? await api.editAssetGeneration(this.editAsset.id, payload)
        : await api.generateAsset(payload);
      this.queuedResult = {
        job_id: result.job_id,
        job_type: result.job_type,
        asset_id: result.asset_id,
        kind: this.kind,
        task_type: result.job_type,
        slug: this._isEdit() ? this.editAsset.unique_slug : payload.unique_slug,
      };
      if (!this._isEdit()) {
        this.prompt = "";
        this.slug = "";
        this.slugTouched = false;
        this.displayName = "";
        this.seed = "";
        this.references = [];
      }
    } catch (err) {
      this.error = err.message || "Generation request failed";
    } finally {
      this.busy = false;
      this.status = "";
    }
  }

  _typeOptions() {
    return this.kind === "video" ? VIDEO_ASSET_TYPES : IMAGE_ASSET_TYPES;
  }

  render() {
    const kind = this._isEdit() ? this._editKind() : this.kind;
    if (this._isEdit() && !kind) {
      return html`
        <div class="gen">
          <div class="note">
            Prompt-based generation is available for image and video assets.
          </div>
        </div>
      `;
    }

    const inputLabel = this._hasInputs()
      ? this.kind === "video" ? "image/video reference → video" : "image reference → image"
      : this.kind === "video"
      ? "text → video"
      : "text → image";

    return html`
      <form class="gen" @submit=${this._submit}>
        ${this._isEdit() ? "" : html`
          <div>
            <label>Generate</label>
            <div class="kind-toggle" role="group" aria-label="Kind">
              <button
                type="button"
                class=${this.kind === "image" ? "active" : ""}
                @click=${() => this._onKindChange("image")}>
                Image
              </button>
              <button
                type="button"
                class=${this.kind === "video" ? "active" : ""}
                @click=${() => this._onKindChange("video")}>
                Video
              </button>
            </div>
          </div>
        `}

        <div>
          <label for="gen-prompt">Prompt</label>
          <textarea
            id="gen-prompt"
            .value=${this.prompt}
            @input=${this._onPromptInput}
            ?disabled=${this.busy}
            placeholder="Describe the ${kind === "video" ? "video" : "image"} to generate..."
            required></textarea>
          <div class="note">
            Task: ${inputLabel}
            ${this._hasInputs()
              ? " — references included"
              : this._isEdit() && this.editAsset?.active_version_id
              ? " — tick “use current version” below to include it as a reference"
              : ""}
          </div>
        </div>

        ${this._isEdit() ? "" : html`
          <div class="row">
            <div>
              <label for="gen-slug">Unique Slug (@name)</label>
              <input
                id="gen-slug"
                type="text"
                .value=${this.slug}
                @input=${(e) => {
                  this.slug = e.target.value;
                  this.slugTouched = true;
                }}
                ?disabled=${this.busy}
                placeholder="my_generated_hero"
                required />
            </div>
            <div>
              <label for="gen-name">Display Name (optional)</label>
              <input
                id="gen-name"
                type="text"
                .value=${this.displayName}
                @input=${(e) => {
                  this.displayName = e.target.value;
                }}
                ?disabled=${this.busy}
                placeholder="My Generated Hero" />
            </div>
          </div>

          <div class="row">
            <div>
              <label for="gen-type">Type</label>
              <select
                id="gen-type"
                .value=${this.assetType}
                @change=${(e) => {
                  this.assetType = e.target.value;
                }}
                ?disabled=${this.busy}>
                ${this._typeOptions().map(
                  (t) => html`<option value=${t}>${t}</option>`,
                )}
              </select>
            </div>
            <div>
              <label for="gen-scope">Scope</label>
              <select
                id="gen-scope"
                .value=${this.scope}
                @change=${this._onScopeChange}
                ?disabled=${this.busy}>
                <option value="global">global (shared library)</option>
                <option value="project">project</option>
              </select>
            </div>
          </div>

          ${!this.projectId && this.scope === "project"
            ? html`
              <div>
                <label for="gen-project">Project</label>
                <select
                  id="gen-project"
                  .value=${this.selectedProject}
                  @change=${(e) => {
                    this.selectedProject = e.target.value;
                  }}
                  ?disabled=${this.busy}>
                  <option value="">Choose a project...</option>
                  ${this.projects.map(
                    (p) => html`<option value=${p.id}>${p.name}</option>`,
                  )}
                </select>
              </div>
            `
            : ""}
        `}

        <div class="row-3">
          <div>
            <label for="gen-model">Model</label>
            <select
              id="gen-model"
              .value=${this.modelId}
              @change=${(e) => {
                this.modelId = e.target.value;
              }}
              ?disabled=${this.busy}>
              <option value="">Auto (first enabled ${this._taskType()})</option>
              ${this.models.map(
                (m) => html`<option value=${m.id}>${m.display_name ?? m.name}</option>`,
              )}
            </select>
          </div>
          <div>
            <label for="gen-seed">Seed (optional)</label>
            <input
              id="gen-seed"
              type="number"
              min="0"
              step="1"
              .value=${this.seed}
              @input=${(e) => {
                this.seed = e.target.value;
              }}
              ?disabled=${this.busy}
              placeholder="random" />
          </div>
          <div>
            <label for="gen-candidates">Candidates (1-8)</label>
            <input
              id="gen-candidates"
              type="number"
              min="1"
              max="8"
              step="1"
              .value=${String(this.candidates)}
              @input=${(e) => {
                this.candidates = e.target.value;
              }}
              ?disabled=${this.busy} />
          </div>
        </div>

        ${this._isEdit() && this.editAsset?.active_version_id
          ? html`
            <label class="check">
              <input
                type="checkbox"
                .checked=${this.includeCurrent}
                @change=${(e) => {
                  this.includeCurrent = e.target.checked;
                }}
                ?disabled=${this.busy} />
              Use the current version (v${this.editAsset.active_version
                ?.version_number ??
                "?"}) as a reference
            </label>
          `
          : ""}

        <div class="refs-block">
          <label>Reference assets (optional)</label>
          <asset-reference-picker
            .kind=${kind}
            .excludeAssetId=${this._isEdit() ? this.editAsset.id : null}
            .selected=${this.references}
            @change=${this._onRefsChange}></asset-reference-picker>
        </div>

        ${this.status ? html`<div class="status">${this.status}</div>` : ""}
        ${this.error ? html`<div class="error">${this.error}</div>` : ""}
        ${this.queuedResult
          ? html`
            <div class="status ok">
              ${this._isEdit()
                ? "Generation queued — candidates will appear as new versions when the job finishes."
                : "Generation queued — the asset is created now and gets its first version when the job finishes."}
              &nbsp;
              <a href="#/jobs">Open job monitor (job ${this.queuedResult.job_id})</a>
            </div>
          `
          : ""}

        <div>
          <button type="submit" class="btn" ?disabled=${this.busy}>
            ${this.busy
              ? "Queueing..."
              : this._isEdit()
              ? "Generate new version(s)"
              : "Create asset & queue generation"}
          </button>
        </div>
      </form>
    `;
  }
}

customElements.define("asset-generate", AssetGenerate);
