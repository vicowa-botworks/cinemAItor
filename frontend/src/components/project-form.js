import { css, html, LitElement, nothing } from "lit";
import { api } from "../api.js";
import {
  loadModelDefaults,
  parseProjectPreferences,
  projectPreferencesPayload,
} from "../model-defaults.js";

const ASPECT_RATIOS = [
  { value: "16:9", label: "16:9 (TV / YouTube, landscape)" },
  { value: "9:16", label: "9:16 (TikTok / Reels, vertical)" },
  { value: "1:1", label: "1:1 (square social posts)" },
  { value: "2.39:1", label: "2.39:1 (cinematic film, widescreen)" },
];
const FRAME_RATES = [
  { value: 24, label: "24 fps (film look, cinematic)" },
  { value: 25, label: "25 fps (European broadcast standard)" },
  { value: 30, label: "30 fps (web video standard)" },
  { value: 48, label: "48 fps (high speed, slow motion)" },
  { value: 60, label: "60 fps (very smooth, sports / gaming)" },
];
const AUDIO_SAMPLE_RATES = [
  { value: 48000, label: "48 kHz (video production standard)" },
  { value: 44100, label: "44.1 kHz (music / CD standard)" },
];
const RESOLUTIONS = [
  { label: "1920 x 1080 (HD)", width: 1920, height: 1080 },
  { label: "1280 x 720 (SD)", width: 1280, height: 720 },
  { label: "3840 x 2160 (4K)", width: 3840, height: 2160 },
  { label: "1080 x 1920 (HD vertical)", width: 1080, height: 1920 },
  { label: "720 x 1280 (SD vertical)", width: 720, height: 1280 },
  { label: "1080 x 1080 (square)", width: 1080, height: 1080 },
];

/** Task types the project-level model override offers a pick for. */
const MODEL_PREF_TASK_TYPES = [
  "text_to_image",
  "image_to_image",
  "text_to_video",
  "image_to_video",
  "music",
  "voice",
  "audio",
];

export class ProjectForm extends LitElement {
  static styles = css`
    .form-card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 24px;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .form-group {
      margin-bottom: 0;
    }

    .form-group.full {
      grid-column: 1 / -1;
    }

    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      color: var(--color-text-muted);
      font-weight: 500;
    }

    .form-group .hint {
      font-weight: 400;
      font-size: 12px;
      opacity: 0.8;
    }

    .form-group input,
    .form-group select,
    .form-group textarea {
      width: 100%;
      margin-bottom: 0;
      background-color: var(--color-bg);
      color: var(--color-text);
      caret-color: var(--color-text);
    }

    .form-group input::placeholder,
    .form-group textarea::placeholder {
      color: var(--color-text-muted);
    }

    .form-group select option {
      color: var(--color-text);
      background-color: var(--color-surface);
    }

    .form-group textarea {
      resize: vertical;
      min-height: 70px;
    }

    .form-actions {
      display: flex;
      gap: 12px;
      margin-top: 20px;
    }

    .btn-cancel {
      background: transparent;
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
    }

    .btn-cancel:hover {
      color: var(--color-text);
      border-color: var(--color-text);
    }

    .btn-save {
      background-color: var(--color-primary);
      color: white;
    }

    .btn-save:hover {
      background-color: var(--color-primary-hover);
    }

    .btn-save:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
      margin-top: 12px;
      min-height: 18px;
    }

    .model-prefs {
      grid-column: 1 / -1;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 12px 14px;
    }

    .model-prefs > summary {
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-muted);
    }

    .model-prefs .prefs-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px 16px;
      margin-top: 14px;
    }

    .model-prefs .hint {
      display: block;
      margin-top: 6px;
      font-size: 12px;
      color: var(--color-text-muted);
    }
  `;

  static properties = {
    project: {},
    saving: {},
    error: {},
    name: {},
    description: {},
    aspectRatio: {},
    frameRate: {},
    resolution: {},
    sampleRate: {},
    template: {},
    templates: {},
    modelPrefs: { state: true },
    modelOptions: { state: true },
    globalDefaults: { state: true },
    globalModelInfo: { state: true },
    taskTypes: { state: true },
  };

  constructor() {
    super();
    this.project = null;
    this.saving = false;
    this.error = "";
    this.name = "";
    this.description = "";
    this.aspectRatio = "16:9";
    this.frameRate = 24;
    this.resolution = "1920x1080";
    this.sampleRate = 48000;
    this.template = "";
    this.templates = [];
    this.modelPrefs = {};
    this.modelOptions = [];
    this.globalDefaults = {};
    this.globalModelInfo = {};
    this.taskTypes = MODEL_PREF_TASK_TYPES;
    this._modelsLoaded = false;
  }

  async firstUpdated() {
    // All three feed the model-defaults section; the defaults view also
    // carries the canonical task-type list, so the form never hardcodes it.
    const [defaults, models, templates] = await Promise.all([
      loadModelDefaults(api),
      api.listModels({ enabled: "true" }).then(
        (m) => {
          // A successful (even empty) list means the defaults section reflects
          // reality and may write the project's preference map. A failed one
          // must not let a save wipe the stored preferences.
          this._modelsLoaded = true;
          return m;
        },
        () => [],
      ),
      this.project ? Promise.resolve(this.templates) : api.listTemplates().catch(() => []),
    ]);
    this.globalDefaults = defaults.defaults;
    this.globalModelInfo = defaults.models;
    if (Array.isArray(defaults.taskTypes) && defaults.taskTypes.length > 0) {
      this.taskTypes = defaults.taskTypes;
    }
    this.modelOptions = Array.isArray(models) ? models : [];
    this.templates = Array.isArray(templates) ? templates : [];
  }

  willUpdate(changed) {
    if (changed.has("project") && this.project) {
      this.name = this.project.name ?? "";
      this.description = this.project.description ?? "";
      this.aspectRatio = this.project.aspect_ratio ?? "16:9";
      this.frameRate = this.project.frame_rate ?? 24;
      this.sampleRate = this.project.audio_sample_rate ?? 48000;
      const key = `${this.project.resolution_width}x${this.project.resolution_height}`;
      this.resolution = RESOLUTIONS.some((r) => `${r.width}x${r.height}` === key)
        ? key
        : "1920x1080";
      this.modelPrefs = parseProjectPreferences(
        this.project.default_model_preferences_json,
      );
    }
  }

  _payload() {
    const res = RESOLUTIONS.find((r) => `${r.width}x${r.height}` === this.resolution) ??
      RESOLUTIONS[0];
    const prefs = projectPreferencesPayload(this.modelPrefs);
    return {
      name: this.name.trim(),
      description: this.description.trim() || null,
      aspect_ratio: this.aspectRatio,
      frame_rate: Number(this.frameRate),
      resolution_width: res.width,
      resolution_height: res.height,
      audio_sample_rate: Number(this.sampleRate),
      // Omitted (not emptied) when the model list never loaded, so a save
      // never silently wipes the project's stored overrides.
      ...(this._modelsLoaded ? { default_model_preferences: prefs } : {}),
      ...(this.template ? { template_id: this.template } : {}),
    };
  }

  async _submit(e) {
    e.preventDefault();
    if (!this.name.trim()) {
      this.error = "Project name is required";
      return;
    }
    this.error = "";
    this.saving = true;
    try {
      const payload = this._payload();
      const project = this.project
        ? await api.updateProject(this.project.id, payload)
        : await api.createProject(payload);
      this.dispatchEvent(
        new CustomEvent("saved", { detail: project, bubbles: true }),
      );
    } catch (err) {
      this.error = err.message || "Failed to save project";
    } finally {
      this.saving = false;
    }
  }

  _modelsForTaskType(taskType) {
    return this.modelOptions.filter((m) => m.task_types?.includes(taskType));
  }

  /** Label naming what happens when no project override is chosen. */
  _globalDefaultLabel(taskType) {
    const id = this.globalDefaults[taskType];
    if (!id) return "no default (first enabled)";
    const name = this.globalModelInfo[id]?.name ??
      this.modelOptions.find((m) => m.id === id)?.display_name ??
      this.modelOptions.find((m) => m.id === id)?.name;
    return name ? `global default (${name})` : `global default (${id})`;
  }

  _renderModelDefaults() {
    if (this._modelsLoaded && this.modelOptions.length === 0) return nothing;
    const taskTypes = this.taskTypes.filter((t) =>
      this._modelsForTaskType(t).length > 0 || this.modelPrefs[t] || this.globalDefaults[t]
    );
    if (taskTypes.length === 0) return nothing;
    const anySet = Object.values(this.modelPrefs).some((v) => v);
    return html`
      <details class="model-prefs" ?open=${anySet}>
        <summary>
          Default models for this project
          <span class="hint">
            Overrides the registry default for generation runs in this project
            that don't name a model.
          </span>
        </summary>
        <div class="prefs-grid">
          ${taskTypes.map((taskType) => {
            const options = this._modelsForTaskType(taskType);
            const current = this.modelPrefs[taskType] ?? "";
            return html`
              <div class="form-group">
                <label for="pf-model-${taskType}">${taskType}</label>
                <select
                  id="pf-model-${taskType}"
                  .value=${current}
                  @change=${(e) => this._setModelPref(taskType, e.target.value)}>
                  <option value="">${this._globalDefaultLabel(taskType)}</option>
                  ${options.map(
                    (m) =>
                      html`
                        <option value=${m.id} ?selected=${m.id === current}>
                          ${m.display_name ?? m.name}
                        </option>
                      `,
                  )}
                </select>
              </div>
            `;
          })}
        </div>
        <span class="hint">
          A model must support the task type; a run that names its own model
          always wins over these.
        </span>
      </details>
    `;
  }

  _setModelPref(taskType, modelId) {
    const next = { ...this.modelPrefs };
    if (modelId) next[taskType] = modelId;
    else delete next[taskType];
    this.modelPrefs = next;
  }

  render() {
    return html`
      <form class="form-card" @submit=${this._submit}>
        <div class="form-grid">
          <div class="form-group full">
            <label for="pf-name">Name</label>
            <input id="pf-name" type="text" .value=${this.name}
              @input=${(
                e,
              ) => (this.name = e.target.value)} maxlength="200" required />
          </div>

          <div class="form-group full">
            <label for="pf-description">Description</label>
            <textarea id="pf-description" .value=${this.description}
              @input=${(e) => (this.description = e.target.value)}
              placeholder="What is this project about?"></textarea>
          </div>

          <div class="form-group">
            <label for="pf-aspect">Aspect ratio</label>
            <select id="pf-aspect" .value=${this.aspectRatio}
              @change=${(e) => (this.aspectRatio = e.target.value)}>
              ${ASPECT_RATIOS.map(
                (r) =>
                  html`
                    <option value=${r.value} ?selected=${r.value ===
                      this.aspectRatio}>${r.label}</option>
                  `,
              )}
            </select>
          </div>

          <div class="form-group">
            <label for="pf-fps">Frame rate</label>
            <select id="pf-fps" .value=${String(this.frameRate)}
              @change=${(e) => (this.frameRate = Number(e.target.value))}>
              ${FRAME_RATES.map(
                (f) =>
                  html`
                    <option value=${f.value} ?selected=${f.value ===
                      Number(this.frameRate)}>${f.label}</option>
                  `,
              )}
            </select>
          </div>

          <div class="form-group">
            <label for="pf-resolution">Resolution</label>
            <select id="pf-resolution" .value=${this.resolution}
              @change=${(e) => (this.resolution = e.target.value)}>
              ${RESOLUTIONS.map(
                (r) =>
                  html`
                    <option value=${`${r.width}x${r.height}`}
                      ?selected=${`${r.width}x${r.height}` ===
                        this.resolution}>${r.label}</option>
                  `,
              )}
            </select>
          </div>

          <div class="form-group">
            <label for="pf-samplerate">Audio sample rate</label>
            <select id="pf-samplerate" .value=${String(this.sampleRate)}
              @change=${(e) => (this.sampleRate = Number(e.target.value))}>
              ${AUDIO_SAMPLE_RATES.map(
                (s) =>
                  html`
                    <option value=${s.value} ?selected=${s.value ===
                      Number(this.sampleRate)}>${s.label}</option>
                  `,
              )}
            </select>
          </div>

          ${this._renderModelDefaults()}

          ${this.project ? html`` : html`
            <div class="form-group full">
              <label for="pf-template">Project template
                <span class="hint">Optional — pre-creates a timeline with
                  matching audio tracks</span></label>
              <select id="pf-template" .value=${this.template}
                @change=${(e) => (this.template = e.target.value)}>
                <option value="">None (empty project)</option>
                ${this.templates.map(
                  (t) =>
                    html`
                      <option value=${t.id} ?selected=${t.id ===
                        this.template}>
                        ${t.name} — ${t.description}
                      </option>
                    `,
                )}
              </select>
            </div>
          `}
        </div>

        <div class="form-actions">
          <button type="submit" class="btn-save" ?disabled=${this.saving}>
            ${this.saving ? "Saving..." : this.project ? "Save changes" : "Create project"}
          </button>
          <button type="button" class="btn-cancel" @click=${this
            ._cancel}>Cancel</button>
        </div>

        <div class="error">${this.error}</div>
      </form>
    `;
  }

  _cancel() {
    this.dispatchEvent(
      new CustomEvent("cancel", { detail: null, bubbles: true }),
    );
  }
}

customElements.define("project-form", ProjectForm);
