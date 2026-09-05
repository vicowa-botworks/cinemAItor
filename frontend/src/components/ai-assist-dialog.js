import { css, html, LitElement, nothing } from "lit";
import { api } from "../api.js";
import { ASSIST_PURPOSES, buildAssistRequest, skillMatchesModel } from "../ai-assist-request.js";

/**
 * Shared AI-assist panel. Hosts render it inline when the user opens the
 * dialog:
 *
 *   <ai-assist-dialog purpose="enhance_prompt" .initial-context=${draft}
 *     insert-label="Use as prompt"
 *     @insert=${(e) => this.content = e.detail.content}
 *     @close=${() => (this.assistOpen = false)}>
 *   </ai-assist-dialog>
 *
 * Pass `default-model-id=${...}` to pre-select the model that will run the
 * generation, so the enhance call carries that model's context automatically
 * (the picker still lets the user override it).
 *
 * It reads GET /llm/status on open (buttons are inert with a hint when the
 * endpoint is unconfigured), assembles the request via the pure
 * ai-assist-request helpers, and emits `insert` / `close` CustomEvents.
 */
class AiAssistDialog extends LitElement {
  static properties = {
    purpose: { type: String },
    initialContext: { attribute: "initial-context", type: String },
    insertLabel: { attribute: "insert-label", type: String },
    defaultModelId: { attribute: "default-model-id", type: String },
    configured: { state: true },
    context: { state: true },
    models: { state: true },
    skills: { state: true },
    modelId: { state: true },
    skillId: { state: true },
    running: { state: true },
    error: { state: true },
    result: { state: true },
    copied: { state: true },
  };

  constructor() {
    super();
    this.initialContext = "";
    this.insertLabel = "Insert";
    this.defaultModelId = "";
    this.configured = false;
    this.context = "";
    this.models = [];
    this.skills = [];
    this.modelId = "";
    this.skillId = "";
    this.running = false;
    this.error = null;
    this.result = null;
    this.copied = false;
  }

  firstUpdated() {
    this.context = this.initialContext ?? "";
    this.modelId = this.defaultModelId || "";
    void this._load();
  }

  async _load() {
    try {
      const status = await api.getLlmStatus();
      this.configured = Boolean(status?.configured);
    } catch {
      this.configured = false;
    }
    if (this.configured && this.purpose === "enhance_prompt") {
      try {
        const [models, skills] = await Promise.all([
          api.listModels({ enabled: true }),
          api.listSkills({ assistant: "1" }),
        ]);
        this.models = models ?? [];
        // Server filters, but keep the guard: the picker must only ever
        // offer prompt-creation skills.
        this.skills = (skills ?? []).filter(
          (s) => s.definition?.assistant,
        );
      } catch {
        // Pickers are a convenience; assist still works without them.
      }
    }
  }

  _emit(detail) {
    this.dispatchEvent(
      new CustomEvent(detail.kind, { detail, bubbles: true, composed: true }),
    );
  }

  _selectedModel() {
    return this.models.find((m) => m.id === this.modelId) ?? null;
  }

  _selectedSkill() {
    return this.skills.find((s) => s.id === this.skillId) ?? null;
  }

  _mismatch() {
    const model = this._selectedModel();
    const skill = this._selectedSkill();
    return Boolean(model && skill) && !skillMatchesModel(skill, model);
  }

  async _run() {
    this.error = null;
    this.result = null;
    this.copied = false;
    let request;
    try {
      request = buildAssistRequest({
        purpose: this.purpose,
        context: this.context,
        // Send the model only when it resolves to a real enabled model — a
        // stale pre-selected id would otherwise 404 the assist call.
        modelId: this._selectedModel()?.id ?? "",
        skillId: this.skillId,
      });
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return;
    }
    this.running = true;
    try {
      const response = await api.assistLlm(request);
      const content = typeof response?.content === "string" ? response.content : "";
      if (content) {
        this.result = content;
      } else {
        this.error = "The model returned an empty response.";
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Assist request failed.";
    } finally {
      this.running = false;
    }
  }

  async _copy() {
    if (!this.result) return;
    try {
      await navigator.clipboard.writeText(this.result);
      this.copied = true;
      setTimeout(() => (this.copied = false), 1500);
    } catch {
      this.error = "Could not copy to the clipboard.";
    }
  }

  render() {
    const spec = ASSIST_PURPOSES[this.purpose] ?? ASSIST_PURPOSES.write_script;
    return html`
      <div class="assist">
        <div class="assist-head">
          <h4>${spec.label}</h4>
          <button
            class="btn-small close"
            title="Close"
            @click=${() => this._emit({ kind: "close" })}
          >✕</button>
        </div>

        ${this.configured
          ? html`
            <label class="field">
              <span>${spec.contextLabel}</span>
              <textarea
                .value=${this.context}
                placeholder=${spec.placeholder}
                rows="6"
                @input=${(e) => (this.context = e.target.value)}
              ></textarea>
            </label>
            ${this._pickers()}
            <div class="actions">
              <button
                class="btn"
                ?disabled=${this.running}
                @click=${this._run}
              >${this.running ? "Working…" : spec.label}</button>
            </div>
          `
          : html`
            <p class="unconfigured">
              No LLM endpoint is configured. Add one on the
              <a href="#/models">Models page</a> to use AI assist.
            </p>
          `}

        ${this.error ? html`<p class="error">${this.error}</p>` : nothing}

        ${this.result
          ? html`
            <div class="result">
              <textarea readonly .value=${this.result} rows="8"></textarea>
              <div class="actions">
                <button class="btn-small" @click=${this._copy}>
                  ${this.copied ? "Copied" : "Copy"}
                </button>
                <button
                  class="btn"
                  @click=${() => this._emit({ kind: "insert", content: this.result })}
                >${this.insertLabel}</button>
              </div>
            </div>
          `
          : nothing}
      </div>
    `;
  }

  _pickers() {
    if (this.purpose !== "enhance_prompt") return nothing;
    return html`
      <div class="pickers">
        <label class="field">
          <span>Model (optional)</span>
          <select
            .value=${this.modelId}
            @change=${(e) => {
              this.modelId = e.target.value;
              this.skillId = "";
              this.error = null;
            }}
          >
            <option value="">— none —</option>
            ${this.models.map(
              (m) => html`<option value=${m.id}>${m.name}</option>`,
            )}
          </select>
        </label>
        <label class="field">
          <span>Model skill (optional)</span>
          <select
            .value=${this.skillId}
            @change=${(e) => {
              this.skillId = e.target.value;
              this.error = null;
            }}
          >
            <option value="">— none —</option>
            ${this.skills.map(
              (s) => html`<option value=${s.id}>${s.definition?.name ?? s.id}</option>`,
            )}
          </select>
        </label>
        ${this._mismatch()
          ? html`
            <p class="warn">
              The selected skill does not match the selected model (different
              model scope or task types).
            </p>
          `
          : nothing}
      </div>
    `;
  }

  static styles = css`
    :host {
      display: block;
      margin-top: 10px;
    }

    .assist {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .assist-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .assist-head h4 {
      margin: 0;
      font-size: 14px;
      color: var(--color-text);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .field > span {
      font-size: 11px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    textarea,
    select {
      padding: 8px 10px;
      background-color: var(--color-surface-2, var(--color-surface));
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
      font-family: inherit;
    }

    textarea {
      resize: vertical;
    }

    .pickers {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: var(--radius);
      font-size: 13px;
      cursor: pointer;
      font-weight: 500;
      background-color: var(--color-primary);
      color: white;
    }

    .btn:hover {
      background-color: var(--color-primary-hover);
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

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .close {
      color: var(--color-text-muted);
    }

    .unconfigured {
      margin: 0;
      font-size: 13px;
      color: var(--color-text-muted);
    }

    .unconfigured a {
      color: var(--color-primary);
    }

    .error {
      margin: 0;
      font-size: 13px;
      color: var(--color-error);
    }

    .warn {
      margin: 0;
      font-size: 12px;
      color: var(--color-warning, #d9a441);
      grid-column: 1 / -1;
    }

    .result textarea {
      font-family: ui-monospace, monospace;
      font-size: 12px;
    }
  `;
}

customElements.define("ai-assist-dialog", AiAssistDialog);
