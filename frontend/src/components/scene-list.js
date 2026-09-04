import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import "./ref-input.js";
import { parseScript, scriptToSceneInputs } from "../script-parse.js";
import "./ai-assist-dialog.js";

export class SceneList extends LitElement {
  static styles = css`
    .scene-list {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .list-title {
      font-size: 24px;
      font-weight: 700;
    }

    .filters {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .filters label {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .filters select {
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
      background-color: var(--color-primary);
      color: white;
    }

    .btn:disabled {
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

    .create-panel {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 640px;
    }

    .create-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
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

    .field.wide {
      grid-column: 1 / -1;
    }

    input,
    select,
    textarea {
      padding: 8px 12px;
      background-color: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
      font-family: inherit;
    }

    .error-text {
      color: var(--color-error);
      font-size: 13px;
      align-self: center;
    }

    .panels {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .scene-card {
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

    .scene-card:hover {
      border-color: var(--color-primary);
      transform: translateY(-2px);
    }

    .scene-name {
      font-size: 16px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .scene-meta {
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

    .status-chip.approved {
      background-color: rgba(34, 197, 94, 0.15);
      color: #15803d;
      border-color: transparent;
    }

    .status-chip.in_production {
      background-color: rgba(59, 130, 246, 0.15);
      color: #1d4ed8;
      border-color: transparent;
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

    .import-panel {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 760px;
    }

    .import-panel textarea {
      min-height: 180px;
      font-family: ui-monospace, monospace;
      font-size: 12px;
      white-space: pre;
    }

    .import-hint {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .import-warnings {
      font-size: 12px;
      color: var(--color-warning, #b45309);
    }

    .import-preview {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 280px;
      overflow-y: auto;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 10px;
    }

    .preview-row {
      border-left: 2px solid var(--color-primary);
      padding-left: 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .preview-heading {
      font-size: 13px;
      font-weight: 600;
    }

    .preview-excerpt {
      font-size: 12px;
      color: var(--color-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .import-success {
      font-size: 13px;
      color: #15803d;
    }

    .continuity-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      font-size: 13px;
    }

    .severity-chip {
      flex-shrink: 0;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      border: 1px solid transparent;
    }

    .severity-chip.error {
      background-color: rgba(239, 68, 68, 0.15);
      color: #b91c1c;
    }

    .severity-chip.warning {
      background-color: rgba(249, 168, 37, 0.15);
      color: #b45309;
    }

    .severity-chip.info {
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
    }

    .continuity-label {
      font-weight: 600;
    }
  `;

  static properties = {
    scenes: { state: true },
    projects: { state: true },
    storyboards: { state: true },
    projectFilter: { state: true },
    storyboardFilter: { state: true },
    loading: { state: true },
    error: { state: true },
    showCreate: { state: true },
    creating: { state: true },
    createError: { state: true },
    form: { state: true },
    showImport: { state: true },
    importText: { state: true },
    importProject: { state: true },
    importParsed: { state: true },
    importBusy: { state: true },
    importError: { state: true },
    importedCount: { state: true },
    assistOpen: { state: true },
    showContinuity: { state: true },
    continuityProject: { state: true },
    continuityReport: { state: true },
    continuityBusy: { state: true },
    continuityError: { state: true },
  };

  constructor() {
    super();
    const query = window.location.hash.split("?")[1] ?? "";
    this.projectFilter = query.split("&").find((kv) => kv.startsWith("project="))?.split("=")[1] ??
      "";
    this.storyboardFilter =
      query.split("&").find((kv) => kv.startsWith("storyboard="))?.split("=")[1] ??
        "";
    this.scenes = [];
    this.projects = [];
    this.storyboards = [];
    this.loading = false;
    this.error = "";
    this.showCreate = false;
    this.creating = false;
    this.createError = "";
    this.form = {
      name: "",
      project_id: this.projectFilter,
      storyboard_id: "",
      description: "",
      prompt: "",
      target_duration: "",
    };
    this.showImport = false;
    this.importText = "";
    this.importProject = this.projectFilter || "";
    this.importParsed = null;
    this.importBusy = false;
    this.importError = "";
    this.importedCount = 0;
    this.assistOpen = false;
    this.showContinuity = false;
    this.continuityProject = "";
    this.continuityReport = null;
    this.continuityBusy = false;
    this.continuityError = "";
  }

  async connectedCallback() {
    super.connectedCallback?.();
    await this._load();
  }

  render() {
    return html`
      <div class="scene-list">
        <div class="list-header">
          <div class="list-title">Scenes</div>
          <div class="filters">
            <label for="filter-project">Project</label>
            <select
              id="filter-project"
              .value=${this.projectFilter}
              @change=${(e) => {
                this.projectFilter = e.target.value;
                this.storyboardFilter = "";
                this._load();
              }}>
              <option value="">all</option>
              ${this.projects.map(
                (p) => html`<option value=${p.id}>${p.name}</option>`,
              )}
            </select>
            <label for="filter-storyboard">Storyboard</label>
            <select
              id="filter-storyboard"
              .value=${this.storyboardFilter}
              @change=${(e) => {
                this.storyboardFilter = e.target.value;
                this._load();
              }}>
              <option value="">any</option>
              ${this.storyboards.map(
                (b) => html`<option value=${b.id}>${b.name}</option>`,
              )}
            </select>
          </div>
          <button
            class="btn"
            @click=${() => {
              this.showCreate = true;
              this.createError = "";
              this.form.project_id = this.projectFilter ||
                this.projects[0]?.id || "";
            }}>
            New scene
          </button>
          <button
            class="btn btn-secondary"
            @click=${() => {
              this.showImport = !this.showImport;
              this.importError = "";
              this.importedCount = 0;
              this.importParsed = null;
              if (!this.importProject) {
                this.importProject = this.projectFilter || this.projects[0]?.id || "";
              }
            }}>
            Import script
          </button>
          <button class="btn btn-secondary" @click=${this._toggleContinuity}>
            Continuity
          </button>
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : null}

        ${this.showCreate
          ? html`
            <div class="create-panel">
              <div class="create-grid">
                <div class="field">
                  <label>Name</label>
                  <input
                    type="text"
                    .value=${this.form.name}
                    @input=${(e) => (this.form = { ...this.form, name: e.target.value })}
                    placeholder="Scene 1 - Opening">
                </div>
                <div class="field">
                  <label>Project</label>
                  <select
                    .value=${this.form.project_id}
                    @change=${(e) => (this.form = {
                      ...this.form,
                      project_id: e.target.value,
                      storyboard_id: "",
                    })}>
                    ${this.projects.map(
                      (p) => html`<option value=${p.id}>${p.name}</option>`,
                    )}
                  </select>
                </div>
                <div class="field">
                  <label>Storyboard (optional)</label>
                  <select
                    .value=${this.form.storyboard_id}
                    @change=${(e) => (this.form = {
                      ...this.form,
                      storyboard_id: e.target.value,
                    })}>
                    <option value="">none</option>
                    ${this._storyboardsForProject(this.form.project_id).map(
                      (b) => html`<option value=${b.id}>${b.name}</option>`,
                    )}
                  </select>
                </div>
                <div class="field">
                  <label>Target duration (s)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    .value=${this.form.target_duration}
                    @input=${(e) => (this.form = {
                      ...this.form,
                      target_duration: e.target.value,
                    })}>
                </div>
                <div class="field wide">
                  <label>Description</label>
                  <input
                    type="text"
                    .value=${this.form.description}
                    @input=${(e) => (this.form = {
                      ...this.form,
                      description: e.target.value,
                    })}>
                </div>
                <div class="field wide">
                  <label>Prompt (supports @asset references)</label>
                  <ref-input
                    rows="3"
                    .value=${this.form.prompt}
                    @input=${(
                      e,
                    ) => (this.form = { ...this.form, prompt: e.target.value })}></ref-input>
                </div>
              </div>
              <div class="filters">
                <button
                  class="btn"
                  ?disabled=${this.creating}
                  @click=${this._create}>
                  ${this.creating ? "Creating..." : "Create"}
                </button>
                <button class="btn btn-secondary"
                  @click=${() => (this.showCreate = false)}>
                  Cancel
                </button>
                ${this.createError
                  ? html`<span class="error-text">${this.createError}</span>`
                  : null}
              </div>
            </div>
          `
          : null}

        ${this.showImport
          ? html`
            <div class="import-panel">
              <div class="create-grid">
                <div class="field">
                  <label>Project</label>
                  <select
                    .value=${this.importProject}
                    @change=${(e) => (this.importProject = e.target.value)}>
                    ${this.projects.map(
                      (p) => html`<option value=${p.id}>${p.name}</option>`,
                    )}
                  </select>
                </div>
                <div class="field">
                  <label>Or load a .fountain / .txt file</label>
                  <input
                    type="file"
                    accept=".txt,.fountain,.md,text/plain"
                    @change=${this._onImportFile}>
                </div>
              </div>
              <div class="field">
                <label>Script text</label>
                <textarea
                  rows="8"
                  .value=${this.importText}
                  @input=${(e) => (this.importText = e.target.value)}
                  placeholder="INT. OFFICE - DAY&#10;&#10;She reads the report.&#10;&#10;LEA&#10;We found it."></textarea>
              </div>
              <div class="filters">
                <button
                  class="btn btn-secondary"
                  ?disabled=${this.importBusy}
                  @click=${() => (this.assistOpen = true)}>
                  Write with AI
                </button>
              </div>
              ${this.assistOpen
                ? html`
                  <ai-assist-dialog
                    purpose="write_script"
                    .initial-context=${this.importText}
                    insert-label="Use as script"
                    @insert=${this._onAssistInsert}
                    @close=${() => (this.assistOpen = false)}></ai-assist-dialog>
                `
                : null}
              <div class="import-hint">
                Fountain-lite: INT./EXT. lines start scenes; short all-caps lines (after a
                blank line) start dialogue; "(...)" are parentheticals.
              </div>
              <div class="filters">
                <button
                  class="btn"
                  ?disabled=${this.importBusy || this.importText.trim() === ""}
                  @click=${this._previewScript}>
                  Preview
                </button>
                <button
                  class="btn btn-secondary"
                  ?disabled=${this.importBusy}
                  @click=${this._closeImport}>
                  Close
                </button>
              </div>
              ${this.importError ? html`<div class="error-text">${this.importError}</div>` : null}
              ${this.importParsed && this.importParsed.scenes.length === 0
                ? html`<div class="error-text">No scenes found in that text.</div>`
                : null}
              ${this.importParsed && this.importParsed.warnings.length > 0
                ? html`<div class="import-warnings">
                  ${this.importParsed.warnings.join(" · ")}
                </div>`
                : null}
              ${this.importParsed && this.importParsed.scenes.length > 0
                ? html`
                  <div class="import-preview">
                    ${this.importParsed.scenes.map(
                      (s) =>
                        html`
                          <div class="preview-row">
                            <span class="preview-heading">${s.heading}</span>
                            <span class="preview-excerpt">
                              ${s.action.trim().slice(0, 120) ||
                                (s.dialogue.length > 0
                                  ? `${s.dialogue.length} dialogue block${
                                    s.dialogue.length === 1 ? "" : "s"
                                  }`
                                  : "")}
                            </span>
                          </div>
                        `,
                    )}
                  </div>
                  <div class="filters">
                    <button
                      class="btn"
                      ?disabled=${this.importBusy || !this.importProject}
                      @click=${this._importScenes}>
                      ${this.importBusy
                        ? "Importing..."
                        : `Create ${this.importParsed.scenes.length} scene${
                          this.importParsed.scenes.length === 1 ? "" : "s"
                        }`}
                    </button>
                  </div>
                `
                : null}
              ${this.importedCount > 0
                ? html`<div class="import-success">
                  Created ${this.importedCount} scenes.
                </div>`
                : null}
            </div>
          `
          : null}

        ${this.showContinuity
          ? html`
            <div class="import-panel">
              <div class="create-grid">
                <div class="field">
                  <label>Project</label>
                  <select
                    .value=${this.continuityProject}
                    @change=${(e) => (this.continuityProject = e.target.value)}>
                    ${this.projects.map(
                      (p) => html`<option value=${p.id}>${p.name}</option>`,
                    )}
                  </select>
                </div>
              </div>
              <div class="filters">
                <button
                  class="btn"
                  ?disabled=${this.continuityBusy || this.continuityProject === ""}
                  @click=${this._runContinuity}>
                  ${this.continuityBusy ? "Checking..." : "Run check"}
                </button>
                <button
                  class="btn btn-secondary"
                  ?disabled=${this.continuityBusy}
                  @click=${this._closeContinuity}>
                  Close
                </button>
              </div>
              ${this.continuityError
                ? html`<div class="error-text">${this.continuityError}</div>`
                : null}
              ${this.continuityReport
                ? this.continuityReport.issues.length === 0
                  ? html`<div class="import-success">
                      No continuity issues found.
                    </div>`
                  : html`
                    <div class="import-preview">
                      ${this.continuityReport.issues.map(
                        (i) =>
                          html`
                            <div class="continuity-row">
                              <span class="severity-chip ${i.severity}">
                                ${i.severity}
                              </span>
                              <span>
                                <span class="continuity-label"
                                  >${i.object_label} · ${i.rule}</span
                                >
                                ${i.message}
                              </span>
                            </div>
                          `,
                      )}
                    </div>
                  `
                : null}
            </div>
          `
          : null}

        ${this.scenes.length === 0
          ? html`
            <div class="empty">
              ${this.loading
                ? "Loading scenes..."
                : this.projectFilter
                ? "No scenes in this project."
                : "No scenes yet. Create the first one."}
            </div>
          `
          : html`
            <div class="panels">
              ${this.scenes.map((s) =>
                html`
                  <div
                    class="scene-card"
                    @click=${() => (window.location.hash = `#/scene/${encodeURIComponent(s.id)}`)}>
                    <div class="scene-name">${s.name}</div>
                    <div class="scene-meta">
                      ${s.description ?? ""}${this._boardName(s.storyboard_id)}
                    </div>
                    <span class="status-chip ${s.status}">${s.status}</span>
                  </div>
                `
              )}
            </div>
          `}
      </div>
    `;
  }

  _boardName(storyboardId) {
    if (!storyboardId) return "";
    const board = this.storyboards.find((b) => b.id === storyboardId);
    return board ? ` · ${board.name}` : ` · board ${storyboardId.slice(0, 8)}`;
  }

  _storyboardsForProject(projectId) {
    return this.storyboards.filter((b) => !projectId || b.project_id === projectId);
  }

  async _load() {
    this.loading = true;
    this.error = "";
    try {
      const [projects, storyboards] = await Promise.all([
        api.listProjects(),
        api.listStoryboards(
          this.projectFilter ? { project_id: this.projectFilter } : {},
        ),
      ]);
      this.projects = projects;
      this.storyboards = storyboards;
      this.scenes = await api.listScenes({
        project_id: this.projectFilter,
        storyboard_id: this.storyboardFilter,
      });
    } catch (err) {
      this.error = err.message || "Failed to load scenes.";
    } finally {
      this.loading = false;
    }
  }

  async _create() {
    const f = this.form;
    if (!f.name.trim() || !f.project_id) {
      this.createError = "Name and project are required.";
      return;
    }
    this.creating = true;
    this.createError = "";
    try {
      const payload = {
        name: f.name.trim(),
        project_id: f.project_id,
      };
      if (f.storyboard_id) payload.storyboard_id = f.storyboard_id;
      if (f.description.trim()) payload.description = f.description.trim();
      if (f.prompt.trim()) payload.prompt = f.prompt.trim();
      if (f.target_duration !== "") payload.target_duration = Number(f.target_duration);
      await api.createScene(payload);
      this.showCreate = false;
      this.form = {
        name: "",
        project_id: f.project_id,
        storyboard_id: "",
        description: "",
        prompt: "",
        target_duration: "",
      };
      await this._load();
    } catch (err) {
      this.createError = err.message || "Failed to create scene.";
    } finally {
      this.creating = false;
    }
  }

  _closeImport() {
    this.showImport = false;
    this.importText = "";
    this.importParsed = null;
    this.importError = "";
    this.importedCount = 0;
    this.assistOpen = false;
  }

  async _onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      this.importText = await file.text();
      this._previewScript();
    } catch (err) {
      this.importError = err.message || "Could not read that file.";
    } finally {
      e.target.value = "";
    }
  }

  _onAssistInsert(e) {
    this.importText = e.detail.content;
    this.assistOpen = false;
    this._previewScript();
  }

  _previewScript() {
    this.importError = "";
    this.importedCount = 0;
    this.importParsed = parseScript(this.importText);
  }

  async _importScenes() {
    if (!this.importProject || !this.importParsed) return;
    this.importBusy = true;
    this.importError = "";
    try {
      const inputs = scriptToSceneInputs(this.importParsed.scenes);
      const res = await api.importScriptScenes(this.importProject, inputs);
      this.importedCount = res.created?.length ?? inputs.length;
      this.importText = "";
      this.importParsed = null;
      this.projectFilter = this.importProject;
      await this._load();
    } catch (err) {
      this.importError = err.message || "Failed to import script.";
    } finally {
      this.importBusy = false;
    }
  }

  _toggleContinuity() {
    this.showContinuity = !this.showContinuity;
    this.continuityError = "";
    if (this.showContinuity) {
      if (!this.continuityProject) {
        this.continuityProject = this.projectFilter || this.projects[0]?.id || "";
      }
      this._runContinuity();
    }
  }

  _closeContinuity() {
    this.showContinuity = false;
    this.continuityReport = null;
    this.continuityError = "";
  }

  async _runContinuity() {
    if (!this.continuityProject) return;
    this.continuityBusy = true;
    this.continuityError = "";
    try {
      this.continuityReport = await api.checkContinuity(this.continuityProject);
    } catch (err) {
      this.continuityReport = null;
      this.continuityError = err.message || "Continuity check failed.";
    } finally {
      this.continuityBusy = false;
    }
  }
}

customElements.define("scene-list", SceneList);
