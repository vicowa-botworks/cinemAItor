import { css, html, LitElement, nothing } from "lit";
import { api } from "../api.js";
import "./ai-assist-dialog.js";

/**
 * Movie script detail: a Fountain-lite screenplay editor with versioned
 * history. Every manual save and every LLM generation is a new version, so the
 * history panel reads as the edit + generation log. Generation reuses the
 * shared <ai-assist-dialog> (write_script / extend_script purposes).
 */
export class ScriptDetail extends LitElement {
  static styles = css`
    :host {
      display: block;
    }

    .script-detail {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .back {
      font-size: 13px;
      color: var(--color-text-muted);
      text-decoration: none;
    }

    .back:hover {
      color: var(--color-primary);
    }

    .head {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .title {
      font-size: 24px;
      font-weight: 700;
      margin: 0;
    }

    .title input {
      font-size: 24px;
      font-weight: 700;
      padding: 4px 8px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      min-width: 240px;
    }

    .status-chip {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
    }

    .status-chip.active {
      background-color: #0d9488;
      color: white;
      border-color: #0d9488;
    }

    .spacer {
      flex: 1;
    }

    .section {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .section-head h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
    }

    .hint {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    textarea.editor {
      width: 100%;
      min-height: 340px;
      resize: vertical;
      padding: 14px;
      background: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 13px;
      line-height: 1.6;
      white-space: pre;
    }

    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
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

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-secondary {
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-danger {
      background-color: var(--color-surface-hover);
      color: var(--color-error);
      border: 1px solid var(--color-border);
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

    .version {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background: var(--color-bg);
    }

    .version.is-active {
      border-color: var(--color-primary);
    }

    .version .num {
      font-weight: 600;
      font-size: 13px;
    }

    .version .when {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .version .preview {
      width: 100%;
      margin-top: 6px;
      min-height: 180px;
      resize: vertical;
      padding: 12px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
    }

    .dirty {
      font-size: 12px;
      color: var(--color-warning, #d9a441);
    }
  `;

  static properties = {
    script: { state: true },
    content: { state: true },
    savedContent: { state: true },
    versions: { state: true },
    loading: { state: true },
    error: { state: true },
    saving: { state: true },
    generateMode: { state: true },
    nameDraft: { state: true },
    editingName: { state: true },
    saveNameBusy: { state: true },
    viewing: { state: true },
    deleting: { state: true },
  };

  constructor() {
    super();
    this.script = null;
    this.content = "";
    this.savedContent = "";
    this.versions = [];
    this.loading = false;
    this.error = "";
    this.saving = false;
    this.generateMode = "";
    this.nameDraft = "";
    this.editingName = false;
    this.saveNameBusy = false;
    this.viewing = null;
    this.deleting = false;
  }

  get scriptId() {
    return decodeURIComponent((window.location.hash.split("/")[2] ?? "").replace(/^#/, ""));
  }

  async connectedCallback() {
    super.connectedCallback?.();
    await this._load();
  }

  render() {
    if (this.loading && !this.script) {
      return html`<div class="script-detail">Loading script…</div>`;
    }
    if (!this.script) {
      return html`
        <div class="script-detail">
          <a class="back" href="#/scripts">← Scripts</a>
          <div class="error">${this.error || "Script not found."}</div>
        </div>
      `;
    }
    const activeVersionId = this.versions[0]?.id;
    return html`
      <div class="script-detail">
        <a class="back" href="#/scripts">← Scripts</a>

        <div class="head">
          ${this.editingName
            ? html`
              <div class="row" style="flex:1;">
                <input
                  type="text"
                  class="title"
                  .value=${this.nameDraft}
                  @input=${(e) => (this.nameDraft = e.target.value)}
                  @keydown=${(e) => {
                    if (e.key === "Enter") this._saveName();
                    if (e.key === "Escape") this.editingName = false;
                  }}>
                <button
                  class="btn"
                  ?disabled=${this.saveNameBusy}
                  @click=${this._saveName}>
                  Save
                </button>
                <button class="btn-secondary btn" @click=${() => (this.editingName = false)}>
                  Cancel
                </button>
              </div>
            `
            : html`
              <h1 class="title">${this.script.name}</h1>
              <button
                class="btn-small"
                title="Rename"
                @click=${() => {
                  this.nameDraft = this.script.name;
                  this.editingName = true;
                }}>
                ✎
              </button>
              <span class="status-chip ${this.script.status === "active" ? "active" : ""}">
                ${this.script.status}
              </span>
            `}
          <div class="spacer"></div>
          <button
            class="btn btn-danger"
            ?disabled=${this.deleting}
            @click=${this._delete}>
            ${this.deleting ? "Deleting…" : "Delete"}
          </button>
        </div>

        <div class="section">
          <div class="section-head">
            <h3>Screenplay</h3>
            <span class="hint">Fountain-lite — edits and generations are versioned</span>
          </div>
          <textarea
            class="editor"
            .value=${this.content}
            placeholder="Paste your screenplay here, or generate one below…"
            @input=${(e) => (this.content = e.target.value)}></textarea>
          <div class="row">
            <button class="btn" ?disabled=${this.saving} @click=${this._save}>
              ${this.saving ? "Saving…" : "Save version"}
            </button>
            ${this._dirty() ? html`<span class="dirty">Unsaved changes</span>` : null}
            <div class="spacer"></div>
            ${this.generateMode ? null : html`
              <button
                class="btn-secondary btn"
                @click=${() => (this.generateMode = "write")}>
                ✦ Write from idea
              </button>
              <button
                class="btn-secondary btn"
                ?disabled=${!this.content.trim()}
                @click=${() => (this.generateMode = "extend")}>
                ✦ Continue existing
              </button>
            `}
          </div>
          ${this.generateMode
            ? html`
              <ai-assist-dialog
                purpose=${this.generateMode === "extend" ? "extend_script" : "write_script"}
                .initial-context=${this.generateMode === "extend" ? this.content : ""}
                insert-label="Use in editor"
                @insert=${(e) => {
                  this.content = e.detail.content;
                  this.generateMode = "";
                }}
                @close=${() => (this.generateMode = "")}></ai-assist-dialog>
            `
            : nothing}
        </div>

        <div class="section">
          <div class="section-head">
            <h3>History</h3>
            <span class="hint">${this.versions.length} version(s) — newest first</span>
          </div>
          ${this.versions.length === 0
            ? html`<p class="hint" style="margin:0;">No versions yet — save the screenplay to
                create the first one.</p>`
            : html`
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${this.versions.map(
                  (v) =>
                    html`
                      <div
                        class="version ${v.id === activeVersionId ? "is-active" : ""}">
                        <span class="num">v${v.version_number}</span>
                        <span class="when">${this._fmtWhen(v.created_at)}</span>
                        ${v.id === activeVersionId
                          ? html`<span class="status-chip active">current</span>`
                          : null}
                        <div class="spacer"></div>
                        <button
                          class="btn-small"
                          @click=${() => (this.viewing = this.viewing?.id === v.id ? null : v)}>
                          ${this.viewing?.id === v.id ? "Hide" : "View"}
                        </button>
                        ${v.id === activeVersionId ? nothing : html`
                          <button class="btn-small" @click=${() => this._restore(v.id)}>
                            Restore
                          </button>
                        `}
                        ${this.viewing?.id === v.id
                          ? html`<textarea class="preview" readonly>${v.content}</textarea>`
                          : nothing}
                      </div>
                    `,
                )}
              </div>
            `}
        </div>
      </div>
    `;
  }

  _fmtWhen(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString();
  }

  _dirty() {
    return this.content !== this.savedContent;
  }

  _applyDetail(detail, keepContent = false) {
    this.script = detail.script;
    this.versions = detail.versions ?? [];
    if (!keepContent && detail.prompt) {
      this.content = detail.prompt.content;
      this.savedContent = detail.prompt.content;
    }
    this.error = "";
  }

  async _load() {
    this.loading = true;
    this.error = "";
    try {
      const detail = await api.getScript(this.scriptId);
      this._applyDetail(detail);
    } catch (err) {
      this.error = err.message || "Failed to load script.";
    } finally {
      this.loading = false;
    }
  }

  async _save() {
    if (!this.content.trim()) {
      this.error = "Nothing to save — the screenplay is empty.";
      return;
    }
    this.saving = true;
    this.error = "";
    try {
      const detail = await api.saveScriptVersion(this.scriptId, this.content);
      this._applyDetail(detail, true);
      this.savedContent = this.content;
    } catch (err) {
      this.error = err.message || "Failed to save version.";
    } finally {
      this.saving = false;
    }
  }

  async _restore(versionId) {
    this.error = "";
    try {
      const detail = await api.restoreScriptVersion(this.scriptId, versionId);
      this._applyDetail(detail);
      this.viewing = null;
    } catch (err) {
      this.error = err.message || "Failed to restore version.";
    }
  }

  async _saveName() {
    const name = this.nameDraft.trim();
    if (!name) return;
    this.saveNameBusy = true;
    this.error = "";
    try {
      await api.updateScript(this.scriptId, { name });
      this.editingName = false;
      await this._load();
    } catch (err) {
      this.error = err.message || "Failed to rename.";
    } finally {
      this.saveNameBusy = false;
    }
  }

  async _delete() {
    if (!confirm("Delete this script and its version history?")) return;
    this.deleting = true;
    this.error = "";
    try {
      await api.deleteScript(this.scriptId);
      window.location.hash = "#/scripts";
    } catch (err) {
      this.error = err.message || "Failed to delete script.";
      this.deleting = false;
    }
  }
}

customElements.define("script-detail", ScriptDetail);
