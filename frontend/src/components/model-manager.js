import { css, html, LitElement } from "lit";
import { api } from "../api.js";

const TASK_TYPES = [
  "text_to_image",
  "image_to_image",
  "image_to_video",
  "text_to_video",
  "audio",
  "music",
  "voice",
  "transcribe",
];

const BACKENDS = ["mock", "local_cli", "comfyui", "local_http"];

const HF_FILTERS = [
  ["", "All"],
  ["text-to-image", "Text to image"],
  ["image-to-video", "Image to video"],
  ["text-to-video", "Text to video"],
  ["text-to-speech", "Text to speech"],
  ["text-to-audio", "Text to audio"],
  ["any-to-any", "Any to any"],
];

const EMPTY_HF_FORM = {
  name: "",
  version: "",
  backend: "local_cli",
  file: "",
  tasks: [],
  vram_requirement_mb: "",
};

const SOURCES = ["local", "url", "mock"];

const EMPTY_REG_FORM = {
  name: "",
  version: "",
  backend: "mock",
  tasks: [],
  source: "",
  repository_url: "",
  source_path: "",
  license: "",
  vram_requirement_mb: "",
  ram_requirement_mb: "",
  dependencies: "",
  default_settings: "",
  enabled: true,
};

export class ModelManager extends LitElement {
  static styles = css`
    .model-manager {
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

    .list-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
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

    .hw-summary {
      font-size: 14px;
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
    }

    .hw-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .hw-item span:first-child {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
    }

    .hw-warning {
      margin-top: 10px;
      font-size: 12px;
      color: #b45309;
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

    .filters input {
      min-width: 200px;
    }

    .model-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .model-row {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .model-top {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .model-name {
      font-size: 16px;
      font-weight: 600;
    }

    .model-version {
      color: var(--color-text-muted);
      font-size: 13px;
    }

    .chip {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
    }

    .chip.enabled {
      background-color: rgba(34, 197, 94, 0.15);
      color: #15803d;
      border-color: transparent;
    }

    .chip.disabled {
      opacity: 0.7;
    }

    .chip.health-ok {
      background-color: rgba(34, 197, 94, 0.15);
      color: #15803d;
      border-color: transparent;
    }

    .chip.health-error {
      background-color: rgba(239, 68, 68, 0.15);
      color: #b91c1c;
      border-color: transparent;
    }

    .chip.health-unknown {
      opacity: 0.7;
    }

    .model-meta {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .model-meta .tasks {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }

    .model-settings {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
    }

    .model-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
    }

    .notice {
      font-size: 13px;
      padding: 8px 12px;
      border-radius: var(--radius);
    }

    .notice.ok {
      background-color: rgba(34, 197, 94, 0.12);
      color: #15803d;
    }

    .notice.err {
      background-color: rgba(239, 68, 68, 0.12);
      color: #b91c1c;
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

    .admin-note {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .bench-wrap {
      margin-top: 8px;
      font-size: 12px;
    }

    .bench-head {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--color-text-muted);
    }

    .bench-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }

    .bench-table th,
    .bench-table td {
      text-align: left;
      padding: 3px 10px 3px 0;
      border-bottom: 1px solid var(--color-border);
      white-space: nowrap;
    }

    .bench-table th {
      color: var(--color-text-muted);
      font-weight: 500;
    }

    .llm-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 4px;
    }

    .llm-head h3 {
      margin: 0;
    }

    .llm-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 12px;
      max-width: 640px;
    }

    .llm-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .llm-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .reg-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px 16px;
      margin-top: 12px;
    }

    .reg-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .llm-field.wide {
      grid-column: 1 / -1;
    }

    .llm-field label {
      font-size: 11px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .llm-field input[type="text"],
    .llm-field input[type="password"],
    .llm-field input[type="number"] {
      padding: 8px 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
    }

    .llm-check {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }

    .llm-check input {
      accent-color: var(--color-primary);
    }

    .reg-field label {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .reg-field label .req {
      color: var(--color-error);
    }

    .reg-field input,
    .reg-field select,
    .reg-field textarea {
      padding: 7px 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background: var(--color-surface);
      color: var(--color-text);
      font-size: 13px;
      font-family: inherit;
      width: 100%;
      box-sizing: border-box;
    }

    .reg-field textarea {
      font-family: var(--font-mono, monospace);
      resize: vertical;
      min-height: 64px;
    }

    .reg-tasks {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-top: 12px;
      align-items: center;
    }

    .reg-tasks .reg-tasks-label {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .reg-tasks label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 13px;
      cursor: pointer;
    }

    .reg-advanced {
      margin-top: 14px;
      font-size: 13px;
    }

    .reg-advanced summary {
      cursor: pointer;
      color: var(--color-text-muted);
      font-weight: 500;
    }

    .reg-actions {
      display: flex;
      gap: 10px;
      margin-top: 16px;
    }

    .reg-actions .btn {
      padding: 8px 16px;
    }

    .btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .hf-search {
      display: flex;
      gap: 10px;
      margin: 12px 0;
      flex-wrap: wrap;
    }

    .hf-search input[type="search"] {
      flex: 1;
      min-width: 200px;
      padding: 8px 10px;
      background: var(--color-input-bg, #1e1e28);
      color: var(--color-text, #e5e5ef);
      border: 1px solid var(--color-border, #34344a);
      border-radius: 6px;
    }

    .hf-search select {
      padding: 8px 10px;
      background: var(--color-input-bg, #1e1e28);
      color: var(--color-text, #e5e5ef);
      border: 1px solid var(--color-border, #34344a);
      border-radius: 6px;
    }

    .hf-results {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 300px;
      overflow-y: auto;
      margin: 10px 0;
    }

    .hf-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid var(--color-border, #34344a);
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }

    .hf-row:hover {
      border-color: var(--color-accent, #7c6cf0);
    }

    .hf-row.active {
      border-color: var(--color-accent, #7c6cf0);
      background: rgba(124, 108, 240, 0.08);
    }

    .hf-row-id {
      font-weight: 500;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hf-row-meta {
      color: var(--color-text-muted, #9a9ab0);
      font-size: 12px;
      white-space: nowrap;
    }

    .hf-repo {
      margin-top: 16px;
      border-top: 1px solid var(--color-border, #34344a);
      padding-top: 12px;
    }

    .hf-repo h4 {
      margin: 0 0 10px;
      font-size: 15px;
    }

    .hf-files {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 220px;
      overflow-y: auto;
      margin-bottom: 12px;
      border: 1px solid var(--color-border, #34344a);
      border-radius: 6px;
      padding: 6px;
    }

    .hf-file {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }

    .hf-file.active {
      background: rgba(124, 108, 240, 0.12);
    }

    .hf-file-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
    }

    .hf-file-size {
      color: var(--color-text-muted, #9a9ab0);
      font-size: 12px;
    }

    .hf-tasks {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }

    .hf-task {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      cursor: pointer;
    }
  `;

  static properties = {
    models: { state: true },
    hardware: { state: true },
    hwWarnings: { state: true },
    isAdmin: { state: true },
    loading: { state: true },
    busyId: { state: true },
    error: { state: true },
    notice: { state: true },
    enabledFilter: { state: true },
    taskFilter: { state: true },
    query: { state: true },
    benchmarks: { state: true },
    benchBusyId: { state: true },
    llm: { state: true },
    llmConfigured: { state: true },
    llmDraft: { state: true },
    llmBusy: { state: true },
    llmNotice: { state: true },
    llmError: { state: true },
    showRegister: { state: true },
    regBusy: { state: true },
    regForm: { state: true },
    hfQuery: { state: true },
    hfFilter: { state: true },
    hfResults: { state: true },
    hfSearching: { state: true },
    hfError: { state: true },
    hfRepo: { state: true },
    hfLoadingRepo: { state: true },
    hfForm: { state: true },
    hfBusy: { state: true },
    hfNotice: { state: true },
  };

  constructor() {
    super();
    this.models = [];
    this.hardware = null;
    this.hwWarnings = [];
    this.isAdmin = false;
    this.loading = false;
    this.busyId = null;
    this.error = "";
    this.notice = null;
    this.enabledFilter = "";
    this.taskFilter = "";
    this.query = "";
    this.benchmarks = {};
    this.benchBusyId = null;
    this.llm = null;
    this.llmConfigured = false;
    this.llmDraft = null;
    this.llmBusy = null;
    this.llmNotice = null;
    this.llmError = "";
    this.showRegister = false;
    this.regBusy = false;
    this.regForm = { ...EMPTY_REG_FORM };
    this.hfQuery = "";
    this.hfFilter = "";
    this.hfResults = null;
    this.hfSearching = false;
    this.hfError = "";
    this.hfRepo = null;
    this.hfLoadingRepo = false;
    this.hfForm = { ...EMPTY_HF_FORM };
    this.hfBusy = false;
    this.hfNotice = null;
    this._queryTimer = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    if (this._queryTimer) clearTimeout(this._queryTimer);
  }

  async connectedCallback() {
    super.connectedCallback?.();
    try {
      const me = await api.getMe();
      this.isAdmin = me?.role === "admin";
    } catch {
      this.isAdmin = false;
    }
    this._loadAll();
  }

  render() {
    return html`
      <div class="model-manager">
        <div class="list-header">
          <div class="list-title">Models</div>
          <div class="list-header-actions">
            ${this.isAdmin
              ? html`
                <button
                  class="btn"
                  @click=${() => (this.showRegister = !this.showRegister)}>
                  ${this.showRegister ? "Hide registration" : "Register model"}
                </button>
              `
              : null}
            <button class="btn btn-secondary" @click=${this._loadAll}>
              ${this.loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        ${this.isAdmin && this.showRegister ? this._renderRegisterForm() : null}

        ${this.error ? html`<div class="error">${this.error}</div>` : null}
        ${this.notice
          ? html`<div class="notice ${this.notice.kind}">${this.notice.text}</div>`
          : null}

        <div class="panel">
          <h3>Hardware</h3>
          ${this.hardware
            ? html`
              <div class="hw-summary">
                <div class="hw-item">
                  <span>Platform</span>
                  <span>${this.hardware.platform}/${this.hardware.arch}</span>
                </div>
                <div class="hw-item">
                  <span>CPU</span>
                  <span>${this.hardware.cpu_count} cores</span>
                </div>
                <div class="hw-item">
                  <span>RAM</span>
                  <span>${this._fmtMb(this.hardware.mem_total_mb)}</span>
                </div>
                <div class="hw-item">
                  <span>GPU</span>
                  <span>${this.hardware.gpu
                    ? `${this.hardware.gpu.model} (${this._fmtMb(this.hardware.gpu.vram_mb)})`
                    : "none detected"}</span>
                </div>
              </div>
              ${this.hwWarnings.map(
                (w) => html`<div class="hw-warning">⚠ ${w}</div>`,
              )}
            `
            : html`<div class="empty">No hardware report available.</div>`}
        </div>

        <div class="panel">
          <div class="llm-head">
            <h3>LLM Assistant</h3>
            <span class="chip ${this.llmConfigured ? "enabled" : "disabled"}">
              ${this.llmConfigured ? "configured" : "not configured"}
            </span>
          </div>
          <p class="admin-note">
            Point this at an OpenAI-compatible endpoint (llama.cpp server, Ollama
            <code>/v1</code>, LM Studio, ...). The endpoint powers the writing
            assistant and the Model Copilot.
          </p>
          ${this.isAdmin && this.llm
            ? html`
              <div class="llm-form">
                <label class="llm-check">
                  <input
                    type="checkbox"
                    .checked=${this.llmDraft.enabled}
                    @change=${(e) => this._llmSetField("enabled", e.target.checked)} />
                  Enable the LLM assistant
                </label>
                <div class="llm-grid">
                  <div class="llm-field wide">
                    <label for="llm-base-url">Base URL</label>
                    <input
                      id="llm-base-url"
                      type="text"
                      placeholder="http://localhost:8080/v1"
                      .value=${this.llmDraft.base_url}
                      @input=${(e) => this._llmSetField("base_url", e.target.value)} />
                  </div>
                  <div class="llm-field">
                    <label for="llm-model">Model</label>
                    <input
                      id="llm-model"
                      type="text"
                      placeholder="qwen3:8b"
                      .value=${this.llmDraft.model}
                      @input=${(e) => this._llmSetField("model", e.target.value)} />
                  </div>
                  <div class="llm-field">
                    <label for="llm-api-key">API key</label>
                    <input
                      id="llm-api-key"
                      type="password"
                      placeholder=${this.llm.apiKeySet
                        ? "set — leave empty to keep"
                        : "none (most local runners need no key)"}
                      .value=${this.llmDraft.api_key}
                      @input=${(e) => this._llmSetField("api_key", e.target.value)} />
                  </div>
                  <div class="llm-field">
                    <label for="llm-temperature">Temperature</label>
                    <input
                      id="llm-temperature"
                      type="text"
                      placeholder="0.7 (default)"
                      .value=${this.llmDraft.temperature}
                      @input=${(e) => this._llmSetField("temperature", e.target.value)} />
                  </div>
                  <div class="llm-field">
                    <label for="llm-max-tokens">Max tokens</label>
                    <input
                      id="llm-max-tokens"
                      type="text"
                      placeholder="server default"
                      .value=${this.llmDraft.max_tokens}
                      @input=${(e) => this._llmSetField("max_tokens", e.target.value)} />
                  </div>
                  <div class="llm-field">
                    <label for="llm-timeout">Timeout (s)</label>
                    <input
                      id="llm-timeout"
                      type="number"
                      min="1"
                      max="600"
                      .value=${this.llmDraft.timeout_seconds}
                      @input=${(e) => this._llmSetField("timeout_seconds", e.target.value)} />
                  </div>
                </div>
                <div class="model-actions">
                  <button
                    class="btn-small"
                    ?disabled=${this.llmBusy !== null}
                    @click=${() => this._testLlm()}>
                    ${this.llmBusy === "test" ? "Testing..." : "Test connection"}
                  </button>
                  <button
                    class="btn-small"
                    ?disabled=${this.llmBusy !== null}
                    @click=${() => this._saveLlm()}>
                    ${this.llmBusy === "save" ? "Saving..." : "Save settings"}
                  </button>
                </div>
                ${this.llmNotice
                  ? html`<div class="notice ${this.llmNotice.kind}">${this.llmNotice.text}</div>`
                  : null}
                ${this.llmError ? html`<div class="error">${this.llmError}</div>` : null}
              </div>
            `
            : !this.isAdmin
            ? html`<p class="admin-note">Only admins can change the LLM settings.</p>`
            : null}
        </div>

        ${this._renderHfPanel()}

        <div class="panel">
          <div class="filters">
            <div class="filter-field">
              <label for="filter-enabled">Enabled</label>
              <select
                id="filter-enabled"
                .value=${this.enabledFilter}
                @change=${(e) => {
                  this.enabledFilter = e.target.value;
                  this._loadModels();
                }}>
                <option value="">all</option>
                <option value="true">enabled</option>
                <option value="false">disabled</option>
              </select>
            </div>
            <div class="filter-field">
              <label for="filter-task">Task type</label>
              <select
                id="filter-task"
                .value=${this.taskFilter}
                @change=${(e) => {
                  this.taskFilter = e.target.value;
                  this._loadModels();
                }}>
                <option value="">all</option>
                ${TASK_TYPES.map(
                  (t) => html`<option value=${t}>${t}</option>`,
                )}
              </select>
            </div>
            <div class="filter-field" style="flex:1;">
              <label for="filter-query">Search</label>
              <input
                id="filter-query"
                type="text"
                placeholder="name or version..."
                .value=${this.query}
                @input=${this._onQueryInput} />
            </div>
          </div>
        </div>

        ${this.models.length === 0
          ? html`<div class="empty">
              ${this.loading ? "Loading models..." : "No models registered."}
            </div>`
          : html`
            <div class="model-list">
              ${this.models.map((m) => this._renderModel(m))}
            </div>
          `}

        ${!this.isAdmin
          ? html`
            <p class="admin-note">
              Install, enable/disable, and remove require the admin role.
              Health checks and verification are available to all users.
            </p>
          `
          : null}
      </div>
    `;
  }

  _renderRegisterForm() {
    const f = this.regForm;
    const set = (key) => (e) => {
      const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      this.regForm = { ...this.regForm, [key]: value };
    };
    const toggleTask = (task) => () => {
      const tasks = f.tasks.includes(task) ? f.tasks.filter((t) => t !== task) : [...f.tasks, task];
      this.regForm = { ...this.regForm, tasks };
    };
    return html`
      <div class="panel">
        <h3>Register model</h3>
        <form @submit=${this._registerSubmit} @reset=${this._registerReset}>
          <div class="reg-grid">
            <div class="reg-field">
              <label for="reg-name">Name <span class="req">*</span></label>
              <input
                id="reg-name"
                type="text"
                required
                placeholder="e.g. SDXL Turbo"
                .value=${f.name}
                @input=${set("name")} />
            </div>
            <div class="reg-field">
              <label for="reg-version">Version <span class="req">*</span></label>
              <input
                id="reg-version"
                type="text"
                required
                placeholder="e.g. 1.0"
                .value=${f.version}
                @input=${set("version")} />
            </div>
            <div class="reg-field">
              <label for="reg-backend">Backend <span class="req">*</span></label>
              <select
                id="reg-backend"
                .value=${f.backend}
                @change=${set("backend")}>
                ${BACKENDS.map(
                  (b) => html`<option value=${b}>${b}</option>`,
                )}
              </select>
            </div>
            <div class="reg-field">
              <label for="reg-source">Source</label>
              <select
                id="reg-source"
                .value=${f.source}
                @change=${set("source")}>
                <option value="">—</option>
                ${SOURCES.map(
                  (s) => html`<option value=${s}>${s}</option>`,
                )}
              </select>
            </div>
            ${f.source === "url"
              ? html`
                <div class="reg-field">
                  <label for="reg-repo-url">Repository URL</label>
                  <input
                    id="reg-repo-url"
                    type="text"
                    placeholder="https://..."
                    .value=${f.repository_url}
                    @input=${set("repository_url")} />
                </div>
              `
              : null}
            ${f.source === "local"
              ? html`
                <div class="reg-field">
                  <label for="reg-source-path">Source path</label>
                  <input
                    id="reg-source-path"
                    type="text"
                    placeholder="/path/on/server"
                    .value=${f.source_path}
                    @input=${set("source_path")} />
                </div>
              `
              : null}
            <div class="reg-field">
              <label for="reg-license">License</label>
              <input
                id="reg-license"
                type="text"
                placeholder="e.g. Apache-2.0"
                .value=${f.license}
                @input=${set("license")} />
            </div>
            <div class="reg-field">
              <label for="reg-vram">VRAM requirement (MB)</label>
              <input
                id="reg-vram"
                type="number"
                min="0"
                placeholder="e.g. 8192"
                .value=${f.vram_requirement_mb}
                @input=${set("vram_requirement_mb")} />
            </div>
            <div class="reg-field">
              <label for="reg-ram">RAM requirement (MB)</label>
              <input
                id="reg-ram"
                type="number"
                min="0"
                placeholder="e.g. 16384"
                .value=${f.ram_requirement_mb}
                @input=${set("ram_requirement_mb")} />
            </div>
          </div>

          <div class="reg-tasks">
            <span class="reg-tasks-label">Task types:</span>
            ${TASK_TYPES.map(
              (t) =>
                html`
                  <label>
                    <input
                      type="checkbox"
                      .checked=${f.tasks.includes(t)}
                      @change=${toggleTask(t)} />
                    ${t}
                  </label>
                `,
            )}
          </div>

          <details class="reg-advanced">
            <summary>Advanced options</summary>
            <div class="reg-grid">
              <div class="reg-field">
                <label for="reg-deps">
                  Dependencies (comma-separated)
                </label>
                <input
                  id="reg-deps"
                  type="text"
                  placeholder="e.g. ffmpeg, python3"
                  .value=${f.dependencies}
                  @input=${set("dependencies")} />
              </div>
              <div class="reg-field">
                <label for="reg-settings">
                  Default settings (JSON)
                </label>
                <textarea
                  id="reg-settings"
                  placeholder='{"command": "/usr/local/bin/sdxl", "args": ["--prompt", "{prompt}", "--seed", "{seed}", "--out", "{output}"]}'
                  .value=${f.default_settings}
                  @input=${set("default_settings")}></textarea>
              </div>
              <div class="reg-field">
                <label>
                  <input
                    type="checkbox"
                    .checked=${f.enabled}
                    @change=${set("enabled")} />
                  Enabled on registration
                </label>
              </div>
            </div>
          </details>

          <div class="reg-actions">
            <button
              type="submit"
              class="btn"
              ?disabled=${this.regBusy}>
              ${this.regBusy ? "Registering..." : "Register"}
            </button>
            <button type="reset" class="btn btn-secondary">Clear</button>
          </div>
        </form>
      </div>
    `;
  }

  _renderHfPanel() {
    const form = this.hfForm;
    const setForm = (key) => (e) => {
      const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      this.hfForm = { ...this.hfForm, [key]: value };
    };
    const toggleHfTask = (task) => () => {
      const tasks = form.tasks.includes(task)
        ? form.tasks.filter((t) => t !== task)
        : [...form.tasks, task];
      this.hfForm = { ...this.hfForm, tasks };
    };
    return html`
      <div class="panel">
        <div class="llm-head">
          <h3>Browse HuggingFace</h3>
          <span class="chip">catalog</span>
        </div>
        <p class="admin-note">
          Search the public HuggingFace model catalog, inspect a repo's files and
          register it straight into the registry. Registration only creates the
          model row — weights are downloaded later by the (consent-gated) install
          action.
        </p>
        <form
          class="hf-search"
          @submit=${(e) => {
            e.preventDefault();
            this._hfSearch();
          }}>
          <input
            type="search"
            placeholder="Search models, e.g. sdxl, wan, flux..."
            .value=${this.hfQuery}
            @input=${(e) => (this.hfQuery = e.target.value)} />
          <select
            .value=${this.hfFilter}
            @change=${(e) => (this.hfFilter = e.target.value)}>
            ${HF_FILTERS.map(
              ([value, label]) => html`<option value=${value}>${label}</option>`,
            )}
          </select>
          <button
            type="submit"
            class="btn"
            ?disabled=${this.hfSearching}>
            ${this.hfSearching ? "Searching..." : "Search"}
          </button>
        </form>
        ${this.hfError ? html`<div class="error">${this.hfError}</div>` : null}
        ${this.hfNotice
          ? html`<div class="notice ${this.hfNotice.kind}">${this.hfNotice.text}</div>`
          : null}

        ${this.hfResults
          ? html`
            <div class="hf-results">
              ${this.hfResults.map(
                (r) =>
                  html`
                    <div
                      class="hf-row ${this.hfRepo?.repo.id === r.id ? "active" : ""}"
                      @click=${() => this._hfSelectRepo(r.id)}>
                      <span class="hf-row-id">${r.id}</span>
                      ${r.pipeline_tag ? html`<span class="chip">${r.pipeline_tag}</span>` : null}
                      <span class="hf-row-meta">
                        ♥ ${r.likes} · ↓ ${r.downloads.toLocaleString()}
                        ${r.license ? html`· ${r.license}` : ""}
                      </span>
                    </div>
                  `,
              )}
            </div>
          `
          : null}

        ${this.hfLoadingRepo ? html`<div class="empty">Loading repo...</div>` : null}
        ${this.hfRepo
          ? html`
            <div class="hf-repo">
              <h4>${this.hfRepo.repo.id}</h4>
              <div class="hf-files">
                ${this.hfRepo.files.map(
                  (f) =>
                    html`
                      <label class="hf-file ${form.file === f.path ? "active" : ""}">
                        <input
                          type="radio"
                          name="hf-file"
                          value=${f.path}
                          .checked=${form.file === f.path}
                          @change=${() => {
                            this.hfForm = { ...this.hfForm, file: f.path };
                          }} />
                        <span class="hf-file-path">${f.path}</span>
                        <span class="hf-file-size">${this._fmtBytes(f.size)}</span>
                      </label>
                    `,
                )}
              </div>
              <div class="reg-grid">
                <div class="reg-field">
                  <label for="hf-name">Name</label>
                  <input
                    id="hf-name"
                    type="text"
                    placeholder=${this.hfRepo.repo.id}
                    .value=${form.name}
                    @input=${setForm("name")} />
                </div>
                <div class="reg-field">
                  <label for="hf-version">Version</label>
                  <input
                    id="hf-version"
                    type="text"
                    placeholder="1.0"
                    .value=${form.version}
                    @input=${setForm("version")} />
                </div>
                <div class="reg-field">
                  <label for="hf-backend">Backend</label>
                  <select
                    id="hf-backend"
                    .value=${form.backend}
                    @change=${setForm("backend")}>
                    ${BACKENDS.map(
                      (b) => html`<option value=${b}>${b}</option>`,
                    )}
                  </select>
                </div>
                <div class="reg-field">
                  <label for="hf-vram">Min VRAM (MB)</label>
                  <input
                    id="hf-vram"
                    type="number"
                    min="0"
                    placeholder="optional"
                    .value=${form.vram_requirement_mb}
                    @input=${setForm("vram_requirement_mb")} />
                </div>
              </div>
              <div class="hf-tasks">
                ${TASK_TYPES.map(
                  (t) =>
                    html`
                      <label class="hf-task">
                        <input
                          type="checkbox"
                          .checked=${form.tasks.includes(t)}
                          @change=${toggleHfTask(t)} />
                        ${t}
                      </label>
                    `,
                )}
              </div>
              <div class="reg-actions">
                ${this.isAdmin
                  ? html`
                    <button
                      class="btn"
                      ?disabled=${this.hfBusy || !form.file}
                      @click=${this._hfRegister}>
                      ${this.hfBusy ? "Registering..." : "Register model"}
                    </button>
                  `
                  : html`
                    <span class="admin-note" title="Only admins can register models">
                      Register is admin-only
                    </span>
                  `}
              </div>
            </div>
          `
          : null}
      </div>
    `;
  }

  async _hfSearch() {
    this.hfSearching = true;
    this.hfError = "";
    this.hfNotice = null;
    try {
      const res = await api.searchHuggingFace({
        q: this.hfQuery.trim(),
        filter: this.hfFilter,
        limit: 12,
      });
      this.hfResults = res.results ?? [];
      this.hfRepo = null;
      if (this.hfResults.length === 0) {
        this.hfNotice = { kind: "ok", text: "No repos matched." };
      }
    } catch (err) {
      this.hfError = err?.message ?? "HuggingFace search failed";
    } finally {
      this.hfSearching = false;
    }
  }

  async _hfSelectRepo(repoId) {
    if (this.hfRepo?.repo.id === repoId) return;
    this.hfLoadingRepo = true;
    this.hfError = "";
    this.hfNotice = null;
    try {
      const res = await api.getHuggingFaceRepo(repoId);
      this.hfRepo = res;
      const weight = res.files.find((f) => /\.(safetensors|gguf|ckpt|bin)$/i.test(f.path));
      this.hfForm = {
        ...EMPTY_HF_FORM,
        file: weight ? weight.path : "",
        name: res.repo.id,
      };
    } catch (err) {
      this.hfError = err?.message ?? "Could not load the repo";
    } finally {
      this.hfLoadingRepo = false;
    }
  }

  async _hfRegister() {
    const form = this.hfForm;
    if (!this.hfRepo || !form.file) return;
    this.hfBusy = true;
    this.hfError = "";
    this.hfNotice = null;
    const payload = {
      repo_id: this.hfRepo.repo.id,
      file: form.file,
      backend: form.backend,
    };
    if (form.name.trim()) payload.name = form.name.trim();
    if (form.version.trim()) payload.version = form.version.trim();
    if (form.tasks.length > 0) payload.task_types = form.tasks;
    if (form.vram_requirement_mb !== "") {
      payload.min_vram_mb = Number(form.vram_requirement_mb);
    }
    try {
      const res = await api.registerModelFromHuggingFace(payload);
      this.hfNotice = {
        kind: "ok",
        text: `Registered "${res.model.name}" (id: ${res.model.id}, file: ${res.file}). ` +
          "Use its Install action to download the weights.",
      };
      await this._loadAll();
    } catch (err) {
      this.hfError = err?.message ?? "Registration failed";
    } finally {
      this.hfBusy = false;
    }
  }

  _renderModel(m) {
    const busy = this.busyId === m.id;
    const needsConsent = m.repository_url &&
      (m.source === "url" || m.source === null || m.source === undefined);
    return html`
      <div class="model-row">
        <div class="model-top">
          <span class="model-name">${m.name}</span>
          ${m.version ? html`<span class="model-version">${m.version}</span>` : null}
          <span class="chip">${m.backend}</span>
          <span class="chip ${m.enabled ? "enabled" : "disabled"}">
            ${m.enabled ? "enabled" : "disabled"}
          </span>
          <span
            class="chip ${this._healthClass(m)}"
            title=${m.health_error ?? ""}>${this._healthLabel(m)}</span>
          ${m.installed_at
            ? html`<span class="chip">installed</span>`
            : html`<span class="chip health-unknown">not installed</span>`}
        </div>

        <div class="model-meta">
          <div class="tasks">
            <span>Tasks:</span>
            ${m.task_types.length > 0
              ? m.task_types.map((t) => html`<span class="chip">${t}</span>`)
              : html`<span>—</span>`}
          </div>
          ${m.vram_requirement_mb !== null
            ? html`<span>VRAM ≥ ${this._fmtMb(m.vram_requirement_mb)}</span>`
            : null}
          ${m.ram_requirement_mb !== null
            ? html`<span>RAM ≥ ${this._fmtMb(m.ram_requirement_mb)}</span>`
            : null}
          ${m.source ? html`<span>source: ${m.source}</span>` : null}
          ${this._renderSettings(m)}
        </div>

        ${m.health_error ? html`<div class="error">${m.health_error}</div>` : null}
        ${m.health_checked_at
          ? html`
            <div class="model-meta">
              <span>
                last health check:
                ${new Date(m.health_checked_at).toLocaleString()}
              </span>
            </div>
          `
          : null}

        ${this._renderBenchmarks(m)}

        <div class="model-actions">
          <button
            class="btn-small"
            ?disabled=${busy}
            @click=${() =>
              this._run(
                m.id,
                (id) => api.healthCheckModel(id),
                (res) =>
                  res.status === "ok"
                    ? `"${m.name}": health OK — ${res.message}`
                    : `"${m.name}": ${res.message}`,
              )}>
            Health check
          </button>
          <button
            class="btn-small"
            ?disabled=${busy}
            @click=${() =>
              this._run(
                m.id,
                (id) => api.verifyModel(id),
                (res) =>
                  res.valid
                    ? `"${m.name}": ${res.message}`
                    : `"${m.name}": verification failed — ${res.message}`,
              )}>
            Verify checksum
          </button>
          <button
            class="btn-small"
            ?disabled=${this.busyId === m.id ||
              this.benchBusyId === m.id ||
              !m.installed_at ||
              !m.enabled}
            title=${!m.installed_at
              ? "Install the model first"
              : !m.enabled
              ? "Enable the model first"
              : "Run a deterministic benchmark job for each input-less task type"}
            @click=${() => this._runBenchmark(m)}>
            ${this.benchBusyId === m.id ? "Benchmarking..." : "Benchmark"}
          </button>
          ${this.isAdmin
            ? html`
              <button
                class="btn-small"
                ?disabled=${busy}
                @click=${() => this._setEnabled(m, !m.enabled)}>
                ${m.enabled ? "Disable" : "Enable"}
              </button>
              <button
                class="btn-small"
                ?disabled=${busy}
                @click=${() => this._install(m, needsConsent)}>
                Install
              </button>
              <button
                class="btn-small btn-danger"
                ?disabled=${busy}
                @click=${() => this._remove(m)}>
                Remove
              </button>
            `
            : null}
        </div>
      </div>
    `;
  }

  _renderSettings(m) {
    const s = m.default_settings;
    if (!s || typeof s !== "object" || Object.keys(s).length === 0) return html``;
    const label = typeof s.command === "string" && s.command
      ? `cmd: ${s.command}`
      : typeof s.endpoint === "string" && s.endpoint
      ? `endpoint: ${s.endpoint}`
      : null;
    return label
      ? html`<span class="model-settings" title=${JSON.stringify(s)}>${label}</span>`
      : html``;
  }

  _onQueryInput(e) {
    this.query = e.target.value;
    if (this._queryTimer) clearTimeout(this._queryTimer);
    this._queryTimer = setTimeout(() => this._loadModels(), 300);
  }

  async _loadAll() {
    this.loading = true;
    this.error = "";
    this.notice = null;
    try {
      await this._loadModels();
      await this._loadHardware();
      await this._loadBenchmarks();
      await this._loadLlm();
    } finally {
      this.loading = false;
    }
  }

  async _loadBenchmarks() {
    if (this.models.length === 0) {
      this.benchmarks = {};
      return;
    }
    const settled = await Promise.all(
      this.models.map(async (m) => {
        try {
          const { benchmarks } = await api.getModelBenchmarks(m.id);
          return [m.id, benchmarks];
        } catch {
          return [m.id, []];
        }
      }),
    );
    this.benchmarks = Object.fromEntries(settled);
  }

  async _loadModels() {
    try {
      this.models = await api.listModels({
        enabled: this.enabledFilter,
        task_type: this.taskFilter,
        query: this.query,
      });
      this.error = "";
    } catch (err) {
      this.error = err.message || "Failed to load models.";
    }
  }

  async _loadHardware() {
    try {
      const result = await api.getModelsHardware();
      this.hardware = result.hardware;
      this.hwWarnings = result.warnings ?? [];
    } catch {
      this.hardware = null;
      this.hwWarnings = [];
    }
  }

  async _loadLlm() {
    try {
      if (this.isAdmin) {
        this.llm = await api.getLlmSettings();
        this.llmConfigured = this.llm.configured;
        this.llmDraft = {
          enabled: this.llm.enabled,
          base_url: this.llm.baseUrl,
          api_key: "",
          model: this.llm.model,
          temperature: this.llm.temperature,
          max_tokens: this.llm.maxTokens,
          timeout_seconds: this.llm.timeoutSeconds,
        };
      } else {
        const status = await api.getLlmStatus();
        this.llmConfigured = status.configured;
      }
    } catch {
      this.llm = null;
      this.llmConfigured = false;
    }
  }

  _llmSetField(key, value) {
    this.llmDraft = { ...this.llmDraft, [key]: value };
  }

  async _saveLlm() {
    this.llmBusy = "save";
    this.llmNotice = null;
    this.llmError = "";
    try {
      await this._persistLlmDraft();
      this.llmNotice = {
        kind: "ok",
        text: this.llmConfigured
          ? "LLM settings saved and the assistant is configured."
          : "LLM settings saved. Enable the assistant and set a URL + model to activate it.",
      };
    } catch (err) {
      this.llmError = err.message || "Failed to save LLM settings.";
    } finally {
      this.llmBusy = null;
    }
  }

  async _testLlm() {
    this.llmBusy = "test";
    this.llmNotice = null;
    this.llmError = "";
    try {
      // The test endpoint probes the saved settings, so persist the draft
      // first — testing the form is the point of the button.
      await this._persistLlmDraft();
      const result = await api.testLlm();
      this.llmNotice = {
        kind: "ok",
        text: `Connection OK — "${result.model}" answered in ${result.latency_ms} ms.`,
      };
    } catch (err) {
      this.llmError = err.message || "Connection test failed.";
    } finally {
      this.llmBusy = null;
    }
  }

  async _persistLlmDraft() {
    const d = this.llmDraft;
    const update = {
      enabled: d.enabled,
      base_url: d.base_url.trim(),
      model: d.model.trim(),
      temperature: d.temperature.trim(),
      max_tokens: d.max_tokens.trim(),
      timeout_seconds: Number(d.timeout_seconds) || 60,
    };
    if (d.api_key.trim() !== "") update.api_key = d.api_key.trim();
    this.llm = await api.updateLlmSettings(update);
    this.llmConfigured = this.llm.configured;
    this.llmDraft = { ...this.llmDraft, api_key: "" };
  }

  _registerReset() {
    this.regForm = { ...EMPTY_REG_FORM };
  }

  async _registerSubmit(e) {
    e.preventDefault();
    const f = this.regForm;
    if (!f.name.trim() || !f.version.trim()) {
      this.error = "Name and version are required.";
      return;
    }
    let settings = {};
    if (f.default_settings.trim()) {
      try {
        const parsed = JSON.parse(f.default_settings);
        if (
          typeof parsed !== "object" || parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("must be a JSON object");
        }
        settings = parsed;
      } catch (err) {
        this.error = `Default settings is not valid JSON: ${err.message}`;
        return;
      }
    }
    const payload = {
      name: f.name.trim(),
      version: f.version.trim(),
      backend: f.backend,
      task_types: f.tasks,
      enabled: f.enabled,
    };
    if (f.source) payload.source = f.source;
    if (f.source === "url" && f.repository_url.trim()) {
      payload.repository_url = f.repository_url.trim();
    }
    if (f.source === "local" && f.source_path.trim()) {
      payload.source_path = f.source_path.trim();
    }
    if (f.license.trim()) payload.license = f.license.trim();
    const vram = Number(f.vram_requirement_mb);
    if (f.vram_requirement_mb !== "" && Number.isFinite(vram)) {
      payload.vram_requirement_mb = vram;
    }
    const ram = Number(f.ram_requirement_mb);
    if (f.ram_requirement_mb !== "" && Number.isFinite(ram)) {
      payload.ram_requirement_mb = ram;
    }
    const deps = f.dependencies
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (deps.length > 0) payload.dependencies = deps;
    if (f.default_settings.trim()) payload.default_settings = settings;

    this.regBusy = true;
    this.error = "";
    this.notice = null;
    try {
      await api.registerModel(payload);
      this.notice = {
        kind: "ok",
        text: `"${payload.name}" registered.`,
      };
      this.showRegister = false;
      this._registerReset();
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Failed to register model.";
    } finally {
      this.regBusy = false;
    }
  }

  async _run(id, fn, noticeFn) {
    this.busyId = id;
    this.notice = null;
    this.error = "";
    try {
      const result = await fn(id);
      this.notice = { kind: "ok", text: noticeFn(result) };
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Operation failed.";
    } finally {
      this.busyId = null;
    }
  }

  async _setEnabled(m, enabled) {
    this.busyId = m.id;
    this.notice = null;
    this.error = "";
    try {
      await api.updateModel(m.id, { enabled });
      this.notice = {
        kind: "ok",
        text: `"${m.name}" ${enabled ? "enabled" : "disabled"}.`,
      };
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Failed to update model.";
    } finally {
      this.busyId = null;
    }
  }

  async _install(m, needsConsent) {
    if (
      needsConsent &&
      !window.confirm(
        `Download "${m.name}" from network source ${m.repository_url}?\n\nThis requires explicit consent because it downloads a file from the network.`,
      )
    ) {
      return;
    }
    this.busyId = m.id;
    this.notice = null;
    this.error = "";
    try {
      const result = await api.installModel(m.id, {
        consent: needsConsent ? true : undefined,
      });
      this.notice = {
        kind: "ok",
        text: `"${m.name}" installed (file ${this._fmtBytes(result.install?.fileBytes)}).`,
      };
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Failed to install model.";
    } finally {
      this.busyId = null;
    }
  }

  async _remove(m) {
    if (!window.confirm(`Remove "${m.name}" and its installed files?`)) {
      return;
    }
    this.busyId = m.id;
    this.notice = null;
    this.error = "";
    try {
      await api.deleteModel(m.id);
      this.notice = { kind: "ok", text: `"${m.name}" removed.` };
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Failed to remove model.";
    } finally {
      this.busyId = null;
    }
  }

  _renderBenchmarks(m) {
    const rows = this.benchmarks[m.id];
    if (!rows || rows.length === 0) return null;
    return html`
      <div class="bench-wrap">
        <div class="bench-head">
          <span>Benchmarks (latest runs first)</span>
        </div>
        <table class="bench-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Duration</th>
              <th>Candidates</th>
              <th>Output</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) =>
              html`
                <tr>
                  <td>${r.task_type}</td>
                  <td>${this._fmtMs(r.duration_ms)}</td>
                  <td>${r.candidate_count}</td>
                  <td>${this._fmtBytes(r.output_bytes)}</td>
                  <td>${new Date(r.benchmarked_at).toLocaleString()}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  async _runBenchmark(m) {
    this.benchBusyId = m.id;
    this.notice = null;
    this.error = "";
    try {
      const { job_id, tasks } = await api.requestModelBenchmark(m.id);
      const job = await this._waitJob(job_id);
      await Promise.all([this._loadModels(), this._loadBenchmarks()]);
      if (job.status === "succeeded") {
        this.notice = {
          kind: "ok",
          text: `"${m.name}" benchmark finished: ${tasks.length} task(s), ` +
            `${job.candidate_count} candidate(s).`,
        };
      } else {
        this.error = `"${m.name}" benchmark ${job.status}: ` +
          `${job.error_text || "unknown error"}`;
      }
    } catch (err) {
      this.error = err.message || "Failed to run benchmark.";
    } finally {
      this.benchBusyId = null;
    }
  }

  async _waitJob(jobId) {
    const start = Date.now();
    for (;;) {
      const job = await api.getJob(jobId);
      if (["succeeded", "failed", "cancelled"].includes(job.status)) {
        return job;
      }
      if (Date.now() - start > 10 * 60 * 1000) {
        throw new Error("benchmark timed out");
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  _healthLabel(m) {
    if (!m.health_checked_at) return "never checked";
    return m.health_status === "ok" ? "healthy" : "unhealthy";
  }

  _healthClass(m) {
    if (!m.health_checked_at) return "health-unknown";
    return m.health_status === "ok" ? "health-ok" : "health-error";
  }

  _fmtMb(mb) {
    if (mb === null || mb === undefined) return "unknown";
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
  }

  _fmtBytes(bytes) {
    if (bytes === null || bytes === undefined) return "unknown size";
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.ceil(bytes / 1024)} KB`;
  }

  _fmtMs(ms) {
    if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min`;
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
    return `${ms} ms`;
  }
}

customElements.define("model-manager", ModelManager);
