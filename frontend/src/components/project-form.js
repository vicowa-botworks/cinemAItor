import { css, html, LitElement } from "lit";
import { api } from "../api.js";

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "2.39:1"];
const FRAME_RATES = [24, 25, 30, 48, 60];
const AUDIO_SAMPLE_RATES = [48000, 44100];
const RESOLUTIONS = [
  { label: "1920 x 1080 (HD)", width: 1920, height: 1080 },
  { label: "1280 x 720 (SD)", width: 1280, height: 720 },
  { label: "3840 x 2160 (4K)", width: 3840, height: 2160 },
  { label: "1080 x 1920 (HD vertical)", width: 1080, height: 1920 },
  { label: "720 x 1280 (SD vertical)", width: 720, height: 1280 },
  { label: "1080 x 1080 (square)", width: 1080, height: 1080 },
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
    }
  }

  _payload() {
    const res = RESOLUTIONS.find((r) => `${r.width}x${r.height}` === this.resolution) ??
      RESOLUTIONS[0];
    return {
      name: this.name.trim(),
      description: this.description.trim() || null,
      aspect_ratio: this.aspectRatio,
      frame_rate: Number(this.frameRate),
      resolution_width: res.width,
      resolution_height: res.height,
      audio_sample_rate: Number(this.sampleRate),
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
                    <option value=${r} ?selected=${r ===
                      this.aspectRatio}>${r}</option>
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
                    <option value=${f} ?selected=${f ===
                      Number(this.frameRate)}>${f}
                    fps</option>
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
                    <option value=${s} ?selected=${s ===
                      Number(this.sampleRate)}>${(s / 1000)
                      .toFixed(1)} kHz</option>
                  `,
              )}
            </select>
          </div>
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
