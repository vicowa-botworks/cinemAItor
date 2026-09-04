import { css, html, LitElement, nothing } from "lit";
import { api } from "../api.js";
import "./ref-input.js";
import { VramGuard } from "./vram-guard.js";

const KINDS = [
  { value: "music", label: "Music" },
  { value: "voiceover", label: "Voiceover" },
  { value: "sfx", label: "Sound effect" },
];

export class AudioDialog extends VramGuard(LitElement) {
  static styles = css`
    .card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: calc(var(--radius) + 4px);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .card-title {
      font-size: 16px;
      font-weight: 600;
    }

    .row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: flex-end;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .field.grow {
      flex: 1;
      min-width: 220px;
    }

    label {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    select,
    textarea {
      padding: 8px 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background-color: var(--color-surface);
      color: var(--color-text);
      font-size: 14px;
      font-family: inherit;
    }

    textarea {
      resize: vertical;
      min-height: 64px;
    }

    .actions {
      display: flex;
      gap: 10px;
      align-items: center;
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
      font-size: 13px;
    }

    .notice {
      color: var(--color-text-muted);
      font-size: 13px;
    }

    .result {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      font-size: 13px;
    }

    .result a {
      color: var(--color-primary);
      text-decoration: none;
    }
  `;

  static properties = {
    projectId: {},
    sceneId: {},
    defaultKind: {},
    kind: { state: true },
    prompt: { state: true },
    submitting: { state: true },
    error: { state: true },
    result: { state: true },
  };

  constructor() {
    super();
    this.projectId = null;
    this.sceneId = null;
    this.defaultKind = null;
    this.kind = "music";
    this.prompt = "";
    this.submitting = false;
    this.error = "";
    this.result = null;
  }

  willUpdate(changed) {
    if (changed.has("defaultKind") && this.defaultKind) {
      this.kind = this.defaultKind;
    }
  }

  async connectedCallback() {
    super.connectedCallback?.();
    if (!this.kind || !KINDS.some((k) => k.value === this.kind)) {
      this.kind = "music";
    }
  }

  render() {
    const context = this.sceneId
      ? "for the selected scene"
      : this.projectId
      ? "for the project"
      : "";
    return html`
      <div class="card">
        <div class="card-title">
          Generate audio ${context
            ? html`<span style="font-weight:400; font-size:13px; color:var(--color-text-muted);">(${context})</span>`
            : nothing}
        </div>
        <div class="row">
          <div class="field">
            <label for="audio-kind">Kind</label>
            <select
              id="audio-kind"
              .value=${this.kind}
              ?disabled=${this.submitting}
              @change=${(e) => (this.kind = e.target.value)}>
              ${KINDS.map(
                (k) => html`<option value=${k.value}>${k.label}</option>`,
              )}
            </select>
          </div>
          <div class="field grow">
            <label for="audio-prompt">Prompt</label>
            <ref-input
              id="audio-prompt"
              placeholder="Describe the sound, e.g. 'tense orchestral drone with distant thunder'"
              .value=${this.prompt}
              ?disabled=${this.submitting}
              @input=${(e) => (this.prompt = e.target.value)}></ref-input>
          </div>
        </div>
        ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
        ${this.result
          ? html`
            <div class="result">
              <strong>Job queued</strong>
              <span>
                Job ${this.result.job_id.slice(0, 8)} ·
                ${this.result.job_type} · model ${this.result.model_id}
              </span>
              <span>
                <a href="#/jobs" target="_blank"
                >Track it in Jobs</a>
                <a
                  href="#/asset/${encodeURIComponent(this.result.asset_id)}"
                  target="_blank"
                >
                  View the asset (candidates land here for review)
                </a>
              </span>
            </div>
          `
          : nothing}
        <div class="actions">
          <button
            class="btn"
            ?disabled=${this.submitting || !this.prompt.trim()}
            @click=${this._submit}>
            ${this.submitting ? "Queuing…" : "Generate"}
          </button>
          ${this.result
            ? html`
              <button
                class="btn btn-secondary"
                ?disabled=${this.submitting}
                @click=${this._reset}>
                              Generate another
                            </button>
            `
            : nothing}
        </div>
      </div>
      ${this.vramDialog}
    `;
  }

  async _submit() {
    const prompt = this.prompt.trim();
    if (!prompt) return;
    if (!this.projectId && !this.sceneId) {
      this.error = "No project or scene context available.";
      return;
    }
    // No model picker here — the backend auto-picks the first enabled model
    // for the kind's task type, so the gate checks that same model.
    const taskType = { music: "music", voiceover: "voice", sfx: "audio" }[this.kind] ??
      "music";
    let model = null;
    try {
      const models = await api.listModels({ task_type: taskType, enabled: true });
      model = models[0] ?? null;
    } catch {
      model = null;
    }
    const device = await this.resolveVramDevice(model);
    if (device === "cancel") return;
    this.submitting = true;
    this.error = "";
    try {
      const result = await api.generateAudio({
        kind: this.kind,
        prompt,
        ...(device ? { device } : {}),
        ...(this.sceneId ? { scene_id: this.sceneId } : { project_id: this.projectId }),
      });
      this.result = result;
      this.dispatchEvent(
        new CustomEvent("audio-generated", {
          detail: result,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (e) {
      this.error = e.message ?? "Audio generation failed.";
    } finally {
      this.submitting = false;
    }
  }

  _reset() {
    this.prompt = "";
    this.result = null;
    this.error = "";
  }
}

customElements.define("audio-dialog", AudioDialog);
