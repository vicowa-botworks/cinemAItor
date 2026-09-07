import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import "./ref-input.js";
import { buildAssistRequest, skillMatchesModel } from "../ai-assist-request.js";
import {
  ASPECT_RATIO_PRESETS,
  generationKindForAsset,
  generationTaskType,
  IMAGE_ASSET_TYPES,
  normalizeCandidates,
  normalizeSeed,
  RESOLUTION_PRESETS,
  sizeFieldsFromForm,
  sizePreview,
  slugify,
  validateGenerationForm,
  VIDEO_ASSET_TYPES,
} from "./asset-generation.js";
import { VramGuard } from "./vram-guard.js";
import { MAX_REFERENCES } from "./asset-reference-picker.js";

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
export class AssetGenerate extends VramGuard(LitElement) {
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

    .row-4 {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
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

    .btn-secondary {
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
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

    .assist-block {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .assist-top {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .assist-select {
      width: auto;
      min-width: 190px;
      padding: 8px 10px;
    }

    .assist-hint {
      font-size: 13px;
      color: var(--color-text-muted);
    }

    .assist-hint a {
      color: var(--color-primary);
    }

    .assist-result {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .assist-result textarea {
      font-family: ui-monospace, monospace;
      font-size: 12px;
    }

    .assist-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .warn {
      font-size: 12px;
      color: var(--color-warning, #d9a441);
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
    profile: { state: true },
    references: { state: true },
    includeCurrent: { state: true },
    models: { state: true },
    busy: { state: true },
    error: { state: true },
    status: { state: true },
    queuedResult: { state: true },
    assistMetaLoaded: { state: true },
    assistConfigured: { state: true },
    assistModels: { state: true },
    assistSkills: { state: true },
    assistModelId: { state: true },
    assistSkillId: { state: true },
    assistRunning: { state: true },
    assistResult: { state: true },
    assistError: { state: true },
    assistCopied: { state: true },
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
    this.profile = "";
    this.aspectRatio = "";
    this.resolution = "";
    this.references = [];
    this.includeCurrent = false;
    this.models = [];
    this.busy = false;
    this.error = "";
    this.status = "";
    this.queuedResult = null;
    this.assistMetaLoaded = false;
    this.assistConfigured = false;
    this.assistModels = [];
    this.assistSkills = [];
    this.assistModelId = "";
    this.assistSkillId = "";
    this.assistRunning = false;
    this.assistResult = "";
    this.assistError = "";
    this.assistCopied = false;
    this._modelCache = new Map();
    this._mentionedRefs = [];
    this._suppressedRefs = new Set();
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
    const next = e.detail?.references ?? [];
    const nextIds = new Set(next.map((r) => r.asset_id));
    // A ref the user removed while it is still @mentioned is suppressed so the
    // next parse does not snap it back into the list.
    for (const r of this.references) {
      if (!nextIds.has(r.asset_id) && this._mentionedRefs.includes(r.asset_id)) {
        this._suppressedRefs.add(r.asset_id);
      }
    }
    this.references = next;
  }

  // Keep the reference list in sync with the prompt's @mentions: as soon as a
  // mentioned asset resolves to an image/video reference of the current kind
  // (with an active version), it is added to the picker so the model actually
  // receives it — no need to re-select it from the list by hand. A ref the
  // user removed is respected (suppressed) until the mention itself is gone.
  _onPromptRefs(e) {
    const tokens = e.detail?.tokens ?? [];
    const types = this.kind === "video" ? VIDEO_ASSET_TYPES : IMAGE_ASSET_TYPES;
    const mentioned = [];
    for (const t of tokens) {
      const a = t?.asset;
      if (a && a.id && a.active_version_id && types.includes(a.asset_type)) {
        mentioned.push(a.id);
      }
    }
    const mentionedIds = [...new Set(mentioned)];
    this._mentionedRefs = mentionedIds;
    for (const id of [...this._suppressedRefs]) {
      if (!mentionedIds.includes(id)) this._suppressedRefs.delete(id);
    }
    const next = [...this.references];
    let changed = false;
    for (const id of mentionedIds) {
      if (next.length >= MAX_REFERENCES) break;
      if (this._suppressedRefs.has(id)) continue;
      if (next.some((r) => r.asset_id === id)) continue;
      next.push({ asset_id: id });
      changed = true;
    }
    if (changed) this.references = next;
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
    if (this.profile) payload.profile = this.profile;
    const kind = this._isEdit() ? this._editKind() : this.kind;
    if (kind === "image") {
      const sizeFields = sizeFieldsFromForm({
        aspect_ratio: this.aspectRatio,
        resolution: this.resolution,
      });
      if (sizeFields.aspect_ratio) payload.aspect_ratio = sizeFields.aspect_ratio;
      if (sizeFields.resolution) payload.resolution = sizeFields.resolution;
    }
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

    // Pre-submit VRAM choice for local_cli models: opens the dialog when the
    // GPU's free VRAM can't cover the model's requirement, and resolves to an
    // explicit device. "cancel" aborts the submit.
    const device = await this.resolveVramDevice(this._selectedModel());
    if (device === "cancel") return;
    if (device === "cpu" || device === "cuda") payload.device = device;

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
        this.assistResult = "";
        this.assistError = "";
        this.assistCopied = false;
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

  /** The model the job will run on: the explicit pick, or the "auto" first. */
  _selectedModel() {
    if (this.modelId) {
      return this.models.find((m) => m.id === this.modelId) ?? null;
    }
    // Matches the backend's pickModel auto-pick (first enabled model for the
    // task, ordered by name, version).
    return this.models[0] ?? null;
  }

  /** Live "W×H" for the current aspect/resolution picks, or "model default". */
  _sizePreviewText() {
    return sizePreview(this.aspectRatio, this.resolution) ?? "model default";
  }

  // --- Inline "Enhance with AI" (issue #175): the prompt box is the input, the
  // result renders below it. Mirrors the shared ai-assist-dialog flow (same
  // request shape, pickers, and status handling) without the second input. ---

  /** Lazy one-shot load of LLM status + picker lists (same calls as the dialog). */
  async _loadAssistMeta() {
    if (this.assistMetaLoaded) return;
    this.assistMetaLoaded = true;
    try {
      const status = await api.getLlmStatus();
      this.assistConfigured = Boolean(status?.configured);
    } catch {
      this.assistConfigured = false;
    }
    if (!this.assistConfigured) return;
    try {
      const [models, skills] = await Promise.all([
        api.listModels({ enabled: true }),
        api.listSkills({ assistant: "1" }),
      ]);
      this.assistModels = models ?? [];
      // Server filters, but keep the guard: only prompt-creation skills qualify.
      this.assistSkills = (skills ?? []).filter((s) => s.definition?.assistant);
      // Pre-select the model the job will run on (the dialog's default-model-id).
      if (!this.assistModelId) {
        this.assistModelId = this._selectedModel()?.id ?? "";
      }
    } catch {
      // Pickers are a convenience; assist still works without them.
    }
  }

  async _runAssist() {
    if (this.assistRunning) return;
    this.assistError = "";
    await this._loadAssistMeta();
    if (!this.assistConfigured) return; // the hint renders from assistMetaLoaded
    let request;
    try {
      request = buildAssistRequest({
        purpose: "enhance_prompt",
        context: this.prompt,
        // Send the model only when it resolves to a real enabled model — a
        // stale pick would otherwise 404 the assist call.
        modelId: this.assistModels.find((m) => m.id === this.assistModelId)?.id ?? "",
        skillId: this.assistSkillId,
      });
    } catch (err) {
      this.assistError = err instanceof Error ? err.message : String(err);
      return;
    }
    this.assistRunning = true;
    this.assistResult = "";
    this.assistCopied = false;
    try {
      const response = await api.assistLlm(request);
      const content = typeof response?.content === "string" ? response.content : "";
      if (content) {
        this.assistResult = content;
      } else {
        this.assistError = "The model returned an empty response.";
      }
    } catch (err) {
      this.assistError = err instanceof Error ? err.message : "Assist request failed.";
    } finally {
      this.assistRunning = false;
    }
  }

  _assistMismatch() {
    const model = this.assistModels.find((m) => m.id === this.assistModelId) ?? null;
    const skill = this.assistSkills.find((s) => s.id === this.assistSkillId) ?? null;
    return Boolean(model && skill) && !skillMatchesModel(skill, model);
  }

  /** Replace the prompt with the enhanced text (re-slug an untouched slug). */
  _applyAssist() {
    if (!this.assistResult) return;
    this.prompt = this.assistResult;
    if (!this._isEdit() && !this.slugTouched) {
      this.slug = slugify(this.prompt);
    }
    this.assistResult = "";
    this.assistCopied = false;
  }

  _dismissAssist() {
    this.assistResult = "";
    this.assistError = "";
  }

  async _copyAssist() {
    if (!this.assistResult) return;
    try {
      await navigator.clipboard.writeText(this.assistResult);
      this.assistCopied = true;
      setTimeout(() => (this.assistCopied = false), 1500);
    } catch {
      this.assistError = "Could not copy to the clipboard.";
    }
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
          <ref-input
            id="gen-prompt"
            .value=${this.prompt}
            @input=${this._onPromptInput}
            @references=${this._onPromptRefs}
            ?disabled=${this.busy}
            placeholder="Describe the ${kind === "video"
              ? "video"
              : "image"} to generate..."></ref-input>
          <div class="note">
            Task: ${inputLabel}
            ${this._hasInputs()
              ? " — references included"
              : this._isEdit() && this.editAsset?.active_version_id
              ? " — tick “use current version” below to include it as a reference"
              : ""}
          </div>
        </div>

        <div class="assist-block">
          <div class="assist-top">
            <button
              type="button"
              class="btn btn-secondary"
              ?disabled=${!this.prompt.trim() || this.assistRunning}
              title=${this.prompt.trim()
                ? "Rewrite the prompt with the configured LLM, using the selected generation model"
                : "Type a prompt first"}
              @click=${this._runAssist}>
              ${this.assistRunning ? "Enhancing…" : "Enhance with AI"}
            </button>
            ${this.assistMetaLoaded && this.assistConfigured
              ? html`
                <select
                  class="assist-select"
                  .value=${this.assistModelId}
                  ?disabled=${this.assistRunning}
                  title="Model whose metadata (task types, version, settings keys) is included in the enhance call"
                  @change=${(e) => {
                    this.assistModelId = e.target.value;
                    this.assistSkillId = "";
                    this.assistError = "";
                  }}><option value="">— no model context —</option>
                  ${this.assistModels.map(
                    (m) => html`<option value=${m.id}>${m.display_name ?? m.name}</option>`,
                  )}
                </select>
                <select
                  class="assist-select"
                  .value=${this.assistSkillId}
                  ?disabled=${this.assistRunning}
                  title="Optional model skill (prompt-writing guidance) for the enhance call"
                  @change=${(e) => {
                    this.assistSkillId = e.target.value;
                    this.assistError = "";
                  }}><option value="">— no model skill —</option>
                  ${this.assistSkills.map(
                    (s) => html`<option value=${s.id}>${s.definition?.name ?? s.id}</option>`,
                  )}
                </select>
              `
              : ""}
          </div>
          ${this.assistMetaLoaded && !this.assistConfigured
            ? html`
              <div class="assist-hint">
                No LLM endpoint is configured. Add one on the
                <a href="#/models">Models page</a> to use AI assist.
              </div>
            `
            : ""}
          ${this._assistMismatch()
            ? html`
              <div class="warn">
                The selected skill does not match the selected model (different model scope or
                task types).
              </div>
            `
            : ""}
          ${this.assistError ? html`<div class="error">${this.assistError}</div>` : ""}
          ${this.assistRunning ? html`<div class="status">Enhancing prompt…</div>` : ""}
          ${this.assistResult
            ? html`
              <div class="assist-result">
                <textarea readonly .value=${this.assistResult} rows="6"></textarea>
                <div class="assist-actions">
                  <button type="button" class="btn" @click=${this._applyAssist}>
                    Use as prompt
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    @click=${this._copyAssist}>
                    ${this.assistCopied ? "Copied" : "Copy"}
                  </button>
                  <button
                    type="button"
                    class="btn btn-secondary"
                    @click=${this._dismissAssist}>
                    Dismiss
                  </button>
                </div>
              </div>
            `
            : ""}
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

        <div class="row-4">
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
          <div>
            <label
              for="gen-profile"
              title="Use the model's matching settings profile (draft = speed-first, production = quality-first). Models without profiles keep their default settings.">Quality profile</label>
            <select
              id="gen-profile"
              .value=${this.profile}
              @change=${(e) => {
                this.profile = e.target.value;
              }}
              ?disabled=${this.busy}>
              <option value="">model default</option>
              <option value="draft">draft (fast)</option>
              <option value="production">production (quality)</option>
            </select>
          </div>
        </div>

        ${kind === "image"
          ? html`
            <div class="row-3">
              <div>
                <label for="gen-aspect">Aspect ratio</label>
                <select
                  id="gen-aspect"
                  .value=${this.aspectRatio}
                  @change=${(e) => {
                    this.aspectRatio = e.target.value;
                  }}
                  ?disabled=${this.busy}>
                  ${ASPECT_RATIO_PRESETS.map(
                    (p) => html`<option value=${p.value}>${p.label}</option>`,
                  )}
                </select>
              </div>
              <div>
                <label for="gen-resolution">Resolution (base edge)</label>
                <select
                  id="gen-resolution"
                  .value=${this.resolution}
                  @change=${(e) => {
                    this.resolution = e.target.value;
                  }}
                  ?disabled=${this.busy}>
                  ${RESOLUTION_PRESETS.map(
                    (p) => html`<option value=${p.value}>${p.label}</option>`,
                  )}
                </select>
              </div>
              <div>
                <label>Output size</label>
                <div class="note">${this._sizePreviewText()}</div>
              </div>
            </div>
          `
          : ""}

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
            <button
              type="button"
              class="btn btn-secondary"
              ?disabled=${this.busy}
              title="Draft→production: re-run this prompt with the model's production profile, using the current version as a reference."
              @click=${() => {
                this.profile = "production";
                this.includeCurrent = true;
                this._submit();
              }}>
              Produce final from current version (production profile)
            </button>
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

        <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">
          <button type="submit" class="btn" ?disabled=${this.busy}>
            ${this.busy
              ? "Queueing..."
              : this._isEdit()
              ? "Generate new version(s)"
              : "Create asset & queue generation"}
          </button>
        </div>
      </form>
      ${this.vramDialog}
    `;
  }
}

customElements.define("asset-generate", AssetGenerate);
