import { css, html, LitElement, nothing } from "lit";
import { api } from "../api.js";
import { jobEvents } from "../job-events.js";

const SAMPLE_DEFINITION = JSON.stringify(
  {
    name: "My Score",
    version: "1.0.0",
    author: "me",
    license: "MIT",
    description: "A short tense score.",
    inputs: {
      mood: { type: "string", default: "tense" },
      duration: { type: "number", default: 30 },
    },
    steps: [
      { type: "music", prompt: "Cinematic {{ mood }} score, {{ duration }} s" },
      { type: "sfx", prompt: "Low impact under the {{ mood }} score" },
    ],
  },
  null,
  2,
);

export class SkillsList extends LitElement {
  static styles = css`
    .skills {
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

    .btn-danger {
      background-color: transparent;
      color: var(--color-error);
      border: 1px solid var(--color-error);
    }

    .btn-small {
      padding: 4px 10px;
      font-size: 12px;
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      cursor: pointer;
    }

    .btn-small:hover {
      color: var(--color-primary);
      border-color: var(--color-primary);
    }

    .btn:disabled,
    .btn-small:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(320px, 2fr) minmax(320px, 3fr);
      gap: 20px;
      align-items: start;
    }

    @media (max-width: 900px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }

    .panel {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 20px;
    }

    .panel h3 {
      margin: 0 0 12px;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
    }

    .cards {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 16px;
      cursor: pointer;
    }

    .card.selected {
      border-color: var(--color-primary);
    }

    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .card-name {
      font-size: 16px;
      font-weight: 600;
    }

    .card-id {
      font-size: 12px;
      color: var(--color-text-muted);
      font-family: monospace;
    }

    .card-desc {
      margin: 6px 0 8px;
      font-size: 13px;
      color: var(--color-text-muted);
    }

    .card-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .chip {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
      white-space: nowrap;
    }

    .chip.running,
    .chip.pending,
    .chip.queued {
      background-color: rgba(59, 130, 246, 0.15);
      color: #2563eb;
      border-color: rgba(59, 130, 246, 0.4);
    }

    .chip.succeeded,
    .chip.completed {
      background-color: rgba(34, 197, 94, 0.15);
      color: #16a34a;
      border-color: rgba(34, 197, 94, 0.4);
    }

    .chip.failed {
      background-color: rgba(239, 68, 68, 0.15);
      color: #dc2626;
      border-color: rgba(239, 68, 68, 0.4);
    }

    .chip.system {
      background-color: rgba(168, 85, 247, 0.15);
      color: #9333ea;
      border-color: rgba(168, 85, 247, 0.4);
    }

    .card-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 12px;
    }

    .field label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
    }

    .field input,
    .field select,
    .field textarea {
      padding: 8px 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      font-size: 13px;
      background-color: var(--color-surface);
      color: var(--color-text);
      font-family: inherit;
    }

    .field textarea {
      font-family: monospace;
      min-height: 220px;
      resize: vertical;
    }

    .field input[readonly] {
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
    }

    .form-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }

    .error {
      margin-top: 10px;
      font-size: 13px;
      color: var(--color-error);
      background-color: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: var(--radius);
      padding: 8px 12px;
      white-space: pre-wrap;
    }

    .notice {
      margin-top: 10px;
      font-size: 13px;
      color: #16a34a;
      background-color: rgba(34, 197, 94, 0.08);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: var(--radius);
      padding: 8px 12px;
    }

    .empty {
      font-size: 14px;
      color: var(--color-text-muted);
    }

    .runs {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .run {
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 10px 12px;
    }

    .run-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }

    .run-meta {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .run-error {
      margin-top: 6px;
      font-size: 12px;
      color: var(--color-error);
      white-space: pre-wrap;
    }

    .run-steps {
      margin-top: 6px;
      font-size: 12px;
      color: var(--color-text-muted);
      font-family: monospace;
    }

    .versions {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      font-family: monospace;
      color: var(--color-text-muted);
    }

    .muted {
      color: var(--color-text-muted);
      font-size: 13px;
    }

    .ve-section {
      margin-top: 14px;
    }

    .ve-section h4 {
      margin: 0 0 8px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
    }

    .ve-meta {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 13px;
    }

    .ve-meta code {
      font-family: monospace;
      font-size: 12px;
    }

    .ve-key {
      display: inline-block;
      min-width: 88px;
      color: var(--color-text-muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .ve-desc {
      margin: 10px 0 0;
      font-size: 13px;
      color: var(--color-text);
      white-space: pre-wrap;
    }

    .ve-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .ve-table th,
    .ve-table td {
      text-align: left;
      padding: 6px 8px;
      border: 1px solid var(--color-border);
    }

    .ve-table th {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
      font-weight: 600;
    }

    .ve-table td {
      font-family: monospace;
      font-size: 12px;
      word-break: break-word;
    }

    .ve-steps {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ve-step {
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 8px 10px;
      font-size: 13px;
    }

    .ve-step-prompt {
      font-family: monospace;
      font-size: 12px;
      margin-top: 4px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .ve-step-pins {
      margin-top: 4px;
      font-size: 11px;
      color: var(--color-text-muted);
      font-family: monospace;
    }

    .ve-guidance {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 13px;
      background-color: var(--color-surface-hover);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 10px 12px;
    }

    .ve-example {
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 8px 10px;
      font-size: 13px;
    }

    .ve-example-notes {
      margin-top: 4px;
      font-size: 12px;
      color: var(--color-text-muted);
    }
  `;

  static properties = {
    skills: { state: true },
    projects: { state: true },
    selectedId: { state: true },
    runs: { state: true },
    versions: { state: true },
    loading: { state: true },
    busy: { state: true },
    error: { state: true },
    notice: { state: true },
    editing: { state: true },
    draftId: { state: true },
    draftJson: { state: true },
    assistantGuidance: { state: true },
    assistantModelIds: { state: true },
    runInputs: { state: true },
    runProjectId: { state: true },
    viewMode: { state: true },
  };

  constructor() {
    super();
    this.skills = [];
    this.projects = [];
    this.selectedId = null;
    this.runs = [];
    this.versions = [];
    this.loading = false;
    this.busy = false;
    this.error = "";
    this.notice = null;
    this.editing = null;
    this.draftId = "";
    this.draftJson = SAMPLE_DEFINITION;
    this.assistantGuidance = "";
    this.assistantModelIds = "";
    this.runInputs = {};
    this.runProjectId = "";
    this.viewMode = "view";
    this._unsubscribeEvents = null;
    this._runTimer = null;
  }

  async connectedCallback() {
    super.connectedCallback?.();
    await Promise.all([this._refreshSkills(), this._refreshProjects()]);
    this._unsubscribeEvents = jobEvents.subscribe((ev) => this._onLiveEvent(ev));
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._unsubscribeEvents?.();
    this._unsubscribeEvents = null;
    this._stopRunTimer();
  }

  get selected() {
    return this.skills.find((s) => s.id === this.selectedId) ?? null;
  }

  async _refreshSkills() {
    this.loading = true;
    try {
      this.skills = await api.listSkills();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.loading = false;
    }
  }

  async _refreshProjects() {
    try {
      this.projects = await api.listProjects();
    } catch {
      this.projects = [];
    }
  }

  async _select(skillId) {
    this.selectedId = skillId;
    this.viewMode = "view";
    this.notice = null;
    this.error = "";
    const skill = this.skills.find((s) => s.id === skillId);
    const inputs = {};
    if (skill) {
      for (
        const [name, spec] of Object.entries(skill.definition.inputs ?? {})
      ) {
        inputs[name] = spec.default !== undefined ? String(spec.default) : "";
      }
    }
    this.runInputs = inputs;
    await Promise.all([this._refreshRuns(), this._refreshVersions()]);
  }

  async _refreshRuns() {
    if (!this.selectedId) {
      this.runs = [];
      this._stopRunTimer();
      return;
    }
    try {
      this.runs = await api.listSkillRuns(this.selectedId);
    } catch (err) {
      this.error = err.message;
    }
    if (this.runs.some((r) => r.status === "running")) {
      this._startRunTimer();
    } else {
      this._stopRunTimer();
    }
  }

  async _refreshVersions() {
    if (!this.selectedId) {
      this.versions = [];
      return;
    }
    try {
      this.versions = await api.listSkillVersions(this.selectedId);
    } catch {
      this.versions = [];
    }
  }

  _startRunTimer() {
    if (this._runTimer) return;
    this._runTimer = setInterval(() => {
      this._refreshRuns();
    }, 2500);
  }

  _stopRunTimer() {
    if (this._runTimer) {
      clearInterval(this._runTimer);
      this._runTimer = null;
    }
  }

  _onLiveEvent(ev) {
    if (!ev || ev.kind !== "status" || typeof ev.jobId !== "string") return;
    const known = this.runs.some((run) => run.steps.some((step) => step.job_id === ev.jobId));
    if (known) this._refreshRuns();
  }

  async _openCreate() {
    this.editing = { mode: "create" };
    this.draftId = "";
    this.draftJson = SAMPLE_DEFINITION;
    this.assistantGuidance = "";
    this.assistantModelIds = "";
    this.error = "";
  }

  /** Prefill the draft fields from the selected skill and switch the
   *  view/edit panel to edit mode. */
  _enterEditMode() {
    const skill = this.selected;
    if (!skill) return;
    this.draftId = skill.id;
    this.draftJson = JSON.stringify(skill.definition, null, 2);
    const assistant = skill.definition?.assistant;
    this.assistantGuidance = assistant?.guidance ?? "";
    this.assistantModelIds = (assistant?.model_ids ?? []).join(", ");
    this.error = "";
    this.viewMode = "edit";
  }

  _exitEditMode() {
    this.viewMode = "view";
    this.error = "";
  }

  async _saveVeEdit() {
    const skill = this.selected;
    if (!skill) return;
    let definition;
    try {
      definition = this._parseDraft();
    } catch (err) {
      this.error = err.message;
      return;
    }
    this._applyAssistantFields(definition);
    this.busy = true;
    this.error = "";
    try {
      await api.updateSkill(skill.id, definition);
      this.viewMode = "view";
      this.notice = `Skill '${skill.id}' updated`;
      await this._refreshSkills();
      await this._refreshVersions();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.busy = false;
    }
  }

  _closeEdit() {
    this.editing = null;
    this.error = "";
  }

  /**
   * Parse the draft into { id, definition }. Throws an Error with a message
   * the user can act on (JSON syntax first, structure second — the server
   * re-validates with precise messages).
   */
  _parseDraft() {
    let raw;
    try {
      raw = JSON.parse(this.draftJson);
    } catch (err) {
      throw new Error(`Definition is not valid JSON: ${err.message}`);
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("Definition must be a JSON object");
    }
    return raw;
  }

  /**
   * Merge the markdown guidance + model-ids fields into the assistant block.
   * The fields win over the JSON for these two sub-fields; task types and
   * examples stay in the JSON. No-op when both fields are empty.
   */
  _applyAssistantFields(definition) {
    const modelIds = this.assistantModelIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const guidance = this.assistantGuidance;
    if (modelIds.length === 0 && guidance === "") return;
    definition.assistant = {
      ...(definition.assistant ?? {}),
      ...(modelIds.length > 0 ? { model_ids: modelIds } : {}),
      ...(guidance !== "" ? { guidance: guidance.trim() } : {}),
    };
  }

  async _submitDraft(e) {
    e?.preventDefault?.();
    let definition;
    try {
      definition = this._parseDraft();
    } catch (err) {
      this.error = err.message;
      return;
    }
    this._applyAssistantFields(definition);
    this.busy = true;
    this.error = "";
    try {
      const id = this.draftId.trim();
      if (!id) {
        throw new Error("Skill id is required");
      }
      await api.createSkill(id, definition);
      this.notice = `Skill '${id}' created`;
      this._closeEdit();
      await this._refreshSkills();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.busy = false;
    }
  }

  async _toggle(skill, e) {
    e?.stopPropagation?.();
    this.busy = true;
    this.error = "";
    try {
      const updated = await api.toggleSkill(skill.id, !skill.enabled);
      this.skills = this.skills.map((s) => (s.id === updated.id ? updated : s));
    } catch (err) {
      this.error = err.message;
    } finally {
      this.busy = false;
    }
  }

  async _delete(skill, e) {
    e?.stopPropagation?.();
    if (!confirm(`Delete skill '${skill.id}' and all of its runs?`)) return;
    this.busy = true;
    this.error = "";
    try {
      await api.deleteSkill(skill.id);
      if (this.selectedId === skill.id) this.selectedId = null;
      this.notice = `Skill '${skill.id}' deleted`;
      await this._refreshSkills();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.busy = false;
    }
  }

  _inputValue(name, e) {
    this.runInputs = { ...this.runInputs, [name]: e.target.value };
  }

  _buildRunPayload() {
    const skill = this.selected;
    const inputs = {};
    for (const [name, spec] of Object.entries(skill.definition.inputs ?? {})) {
      const raw = this.runInputs[name] ?? "";
      if (spec.type === "number") {
        const num = Number(raw);
        inputs[name] = Number.isFinite(num) ? num : raw;
      } else if (spec.type === "boolean") {
        inputs[name] = raw === "true";
      } else {
        inputs[name] = raw;
      }
    }
    return inputs;
  }

  async _run(e) {
    e?.preventDefault?.();
    const skill = this.selected;
    if (!skill) return;
    if (!this.runProjectId) {
      this.error = "Pick a project to run the skill into";
      return;
    }
    this.busy = true;
    this.error = "";
    try {
      const result = await api.runSkill(skill.id, {
        projectId: this.runProjectId,
        inputs: this._buildRunPayload(),
      });
      this.notice = `Run ${result.run.id} queued (${result.jobs.length} job(s))`;
      await this._refreshRuns();
    } catch (err) {
      this.error = err.message;
    } finally {
      this.busy = false;
    }
  }

  _skillCard(skill) {
    const steps = skill.definition.steps ?? [];
    return html`
      <div
        class="card ${this.selectedId === skill.id ? "selected" : ""}"
        @click=${() => this._select(skill.id)}
      >
        <div class="card-top">
          <div>
            <div class="card-name">${skill.name}</div>
            <div class="card-id">
              ${skill.id} · v${skill.version} · ${skill.author ?? "unknown"}
            </div>
          </div>
          <span class="chip ${skill.enabled ? "succeeded" : "failed"}"
            >${skill.enabled ? "enabled" : "disabled"}</span
          >
        </div>
        ${skill.description ? html`<div class="card-desc">${skill.description}</div>` : nothing}
        <div class="card-meta">
          ${skill.is_system ? html`<span class="chip system">system</span>` : nothing}
          ${steps.map(
            (step, i) =>
              html`
                <span class="chip" title="step ${i + 1}: ${step.prompt}"
                >${step.type}</span>
              `,
          )}
        </div>
        <div class="card-actions">
          <button
            class="btn-small"
            @click=${(ev) => this._toggle(skill, ev)}
            ?disabled=${this.busy}
          >
            ${skill.enabled ? "Disable" : "Enable"}
          </button>
          ${skill.is_system ? nothing : html`
            <button
              class="btn-small"
              @click=${(ev) => {
                ev.stopPropagation();
                this._select(skill.id);
                this._enterEditMode();
              }}
            >
              Edit
            </button>
            <button
              class="btn-small"
              style="color: var(--color-error)"
              @click=${(ev) => this._delete(skill, ev)}
              ?disabled=${this.busy}
            >
              Delete
            </button>
          `}
          <a
            href="#/jobs"
            class="btn-secondary btn"
            style="margin-left:auto"
            @click=${(ev) => ev.stopPropagation()}
            >View jobs</a
          >
        </div>
      </div>
    `;
  }

  _runPanel() {
    const skill = this.selected;
    if (!skill) return nothing;
    const specs = Object.entries(skill.definition.inputs ?? {});
    return html`
      <section class="panel">
        <h3>Run · ${skill.name}</h3>
        <form @submit=${(e) => this._run(e)}>
          <div class="field">
            <label for="run-project">Project</label>
            <select
              id="run-project"
              .value=${this.runProjectId}
              @change=${(e) => {
                this.runProjectId = e.target.value;
              }}
            >
              <option value="">Select a project…</option>
              ${this.projects.map(
                (p) => html`<option value=${p.id}>${p.name}</option>`,
              )}
            </select>
          </div>
          ${specs.map(([name, spec]) =>
            html`
              <div class="field">
                <label for="run-in-${name}">
                  ${name} (${spec.type})${spec.required ? " *" : ""}
                </label>
                <input
                  id="run-in-${name}"
                  .value=${this.runInputs[name] ?? ""}
                  @input=${(e) => this._inputValue(name, e)}
                  placeholder=${spec.default !== undefined ? `default: ${spec.default}` : ""}
                />
              </div>
            `
          )}
          ${specs.length ? nothing : html`<div class="muted">This skill takes no inputs.</div>`}
          <div class="form-actions">
            <button class="btn" type="submit" ?disabled=${this.busy}
              >Run skill</button
            >
          </div>
          ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
          ${this.notice ? html`<div class="notice">${this.notice}</div>` : nothing}
        </form>
      </section>
    `;
  }

  _runsPanel() {
    if (!this.selected) return nothing;
    return html`
      <section class="panel">
        <h3>Run history</h3>
        ${this.runs.length
          ? html`
            <div class="runs">
              ${this.runs
                .map(
                  (run) =>
                    html`
                      <div class="run">
                        <div class="run-top">
                          <span class="chip ${run.status}">${run.status}</span>
                          <span class="run-meta">${run.created_at}</span>
                        </div>
                        <div class="run-steps">
                          ${run.steps
                            .map(
                              (s) => `${s.step_index + 1}.${s.kind} → job ${s.job_id}`,
                            )
                            .join("   ")}
                        </div>
                        ${run.error_text
                          ? html`<div class="run-error">${run.error_text}</div>`
                          : nothing}
                      </div>
                    `,
                )}
            </div>
          `
          : html`<div class="empty">No runs yet.</div>`}
        ${this.versions.length
          ? html`
            <h3 style="margin-top:16px">Versions</h3>
            <div class="versions">
              ${this.versions.map(
                (v) => html`<div>${v.version} — ${v.created_at}</div>`,
              )}
            </div>
          `
          : nothing}
      </section>
    `;
  }

  _veValue(value) {
    if (value === undefined || value === null || value === "") return "—";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  _viewEditPanel() {
    const skill = this.selected;
    if (!skill) return nothing;
    if (this.viewMode === "edit") {
      return html`
        <section class="panel">
          <h3>View/Edit · ${skill.name}</h3>
          <div class="field">
            <label for="ve-def">Definition (JSON)</label>
            <textarea
              id="ve-def"
              spellcheck="false"
              .value=${this.draftJson}
              @input=${(e) => {
                this.draftJson = e.target.value;
              }}
            ></textarea>
          </div>
          <div class="field">
            <label for="ve-guidance">
              Prompt guidance (markdown) — sets the assistant block, overrides the JSON
            </label>
            <textarea
              id="ve-guidance"
              spellcheck="false"
              .value=${this.assistantGuidance}
              @input=${(e) => {
                this.assistantGuidance = e.target.value;
              }}
            ></textarea>
          </div>
          <div class="field">
            <label for="ve-model-ids">
              Model ids (comma-separated) — scope the skill to models; empty = any model
            </label>
            <input
              id="ve-model-ids"
              style="font-family: monospace"
              .value=${this.assistantModelIds}
              @input=${(e) => {
                this.assistantModelIds = e.target.value;
              }}
              placeholder="minimax_h3"
            />
          </div>
          ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
          <div class="form-actions">
            <button class="btn" type="button" @click=${() => this._saveVeEdit()}
              ?disabled=${this.busy}
              >${this.busy ? "Saving…" : "Save"}</button
            >
            <button
              class="btn btn-secondary"
              type="button"
              @click=${() => this._exitEditMode()}
              ?disabled=${this.busy}
            >
              View only
            </button>
          </div>
        </section>
      `;
    }
    const d = skill.definition;
    const inputs = Object.entries(d.inputs ?? {});
    const steps = d.steps ?? [];
    const assistant = d.assistant;
    return html`
      <section class="panel">
        <h3>View/Edit · ${skill.name}</h3>
        <div class="ve-meta">
          <div><span class="ve-key">id</span> <code>${skill.id}</code></div>
          <div><span class="ve-key">version</span> v${d.version}</div>
          <div><span class="ve-key">author</span> ${d.author ?? "—"}</div>
          <div><span class="ve-key">license</span> ${d.license ?? "—"}</div>
          <div>
            <span class="ve-key">status</span>
            ${skill.enabled ? "enabled" : "disabled"}
            ${skill.is_system ? " · system" : ""}
          </div>
          <div>
            <span class="ve-key">updated</span> ${skill.updated_at}
          </div>
        </div>
        ${d.description ? html`<p class="ve-desc">${d.description}</p>` : nothing}
        <div class="ve-section">
          <h4>Inputs</h4>
          ${inputs.length
            ? html`
              <table class="ve-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Default</th>
                    <th>Required</th>
                  </tr>
                </thead>
                <tbody>
                  ${inputs.map(
                    ([name, spec]) =>
                      html`
                        <tr>
                          <td>${name}</td>
                          <td>${spec.type}</td>
                          <td>${this._veValue(spec.default)}</td>
                          <td>${spec.required ? "yes" : "no"}</td>
                        </tr>
                      `,
                  )}
                </tbody>
              </table>
            `
            : html`<div class="muted">This skill takes no inputs.</div>`}
        </div>
        <div class="ve-section">
          <h4>Steps</h4>
          ${steps.length
            ? html`
              <div class="ve-steps">
                ${steps.map(
                  (step) =>
                    html`
                      <div class="ve-step">
                        <span class="chip">${step.type}</span>
                        <div class="ve-step-prompt">${step.prompt}</div>
                        ${step.model_id || step.seed
                          ? html`
                            <div class="ve-step-pins">
                              ${step.model_id
                                ? html`
                                  model: ${step.model_id}
                                `
                                : nothing}
                              ${step.seed ? html`seed: ${step.seed}` : nothing}
                            </div>
                          `
                          : nothing}
                      </div>
                    `,
                )}
              </div>
            `
            : html`<div class="muted">No steps (assistant-only skill).</div>`}
        </div>
        ${assistant
          ? html`
            <div class="ve-section">
              <h4>Assistant</h4>
              <div class="ve-meta">
                <div>
                  <span class="ve-key">task types</span>
                  ${(assistant.model_task_types ?? []).join(", ") || "—"}
                </div>
                <div>
                  <span class="ve-key">model ids</span>
                  ${(assistant.model_ids ?? []).join(", ") || "— (any model)"}
                </div>
              </div>
              ${assistant.guidance
                ? html`<div class="ve-guidance" style="margin-top:8px">${assistant.guidance}</div>`
                : nothing}
              ${(assistant.examples ?? []).length
                ? html`
                  <div class="ve-steps" style="margin-top:8px">
                    ${assistant.examples.map(
                      (ex) =>
                        html`
                          <div class="ve-example">
                            <div class="ve-step-prompt">${ex.prompt}</div>
                            ${ex.notes
                              ? html`<div class="ve-example-notes">${ex.notes}</div>`
                              : nothing}
                          </div>
                        `,
                    )}
                  </div>
                `
                : nothing}
            </div>
          `
          : nothing}
        <div class="form-actions" style="margin-top:14px">
          ${skill.is_system
            ? html`<div class="muted">System skills are read-only (admin-managed via API).</div>`
            : html`
              <button class="btn" type="button" @click=${() => this._enterEditMode()}>
                Edit
              </button>
            `}
        </div>
      </section>
    `;
  }

  _editPanel() {
    if (!this.editing || this.editing.mode !== "create") return nothing;
    return html`
      <section class="panel">
        <h3>New skill</h3>
        <form @submit=${(e) => this._submitDraft(e)}>
          ${this.editing.mode === "create"
            ? html`
              <div class="field">
                <label for="skill-id">Skill id (a-z 0-9 - _)</label>
                <input
                  id="skill-id"
                  style="font-family: monospace"
                  .value=${this.draftId}
                  @input=${(e) => {
                    this.draftId = e.target.value;
                  }}
                  placeholder="my-score"
                />
              </div>
            `
            : nothing}
          <div class="field">
            <label for="skill-def">Definition (JSON)</label>
            <textarea
              id="skill-def"
              spellcheck="false"
              .value=${this.draftJson}
              @input=${(e) => {
                this.draftJson = e.target.value;
              }}
            ></textarea>
          </div>
          <div class="field">
            <label for="skill-guidance">
              Prompt guidance (markdown) — sets the assistant block, overrides the JSON
            </label>
            <textarea
              id="skill-guidance"
              spellcheck="false"
              .value=${this.assistantGuidance}
              @input=${(e) => {
                this.assistantGuidance = e.target.value;
              }}
            ></textarea>
          </div>
          <div class="field">
            <label for="skill-model-ids">
              Model ids (comma-separated) — scope the skill to models; empty = any model
            </label>
            <input
              id="skill-model-ids"
              style="font-family: monospace"
              .value=${this.assistantModelIds}
              @input=${(e) => {
                this.assistantModelIds = e.target.value;
              }}
              placeholder="minimax_h3"
            />
          </div>
          ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
          <div class="form-actions">
            <button class="btn" type="submit" ?disabled=${this.busy}>Create</button>
            <button
              class="btn btn-secondary"
              type="button"
              @click=${() => this._closeEdit()}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    `;
  }

  render() {
    return html`
      <div class="skills">
        <div class="list-header">
          <div class="list-title">Skills</div>
          <button class="btn" @click=${() => this._openCreate()}>
            New skill
          </button>
        </div>
        <div class="layout">
          <div class="cards">
            ${this.loading && !this.skills.length
              ? html`<div class="empty">Loading…</div>`
              : nothing}
            ${this.skills.length
              ? this.skills.map((skill) => this._skillCard(skill))
              : html`<div class="empty">
                  No skills yet. Create one, or use the seeded system skills.
                </div>`}
          </div>
          <div style="display:flex;flex-direction:column;gap:20px">
            ${this._editPanel()}
            ${this._runPanel()}
            ${this._runsPanel()}
            ${this._viewEditPanel()}
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("skills-list", SkillsList);
