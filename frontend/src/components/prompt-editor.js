import { css, html, LitElement } from "lit";
import { api } from "../api.js";

const SCOPE_TYPES = ["generic", "prompt", "scene", "shot", "storyboard_panel"];

export class PromptEditor extends LitElement {
  static styles = css`
    .prompt-editor {
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

    .scope-bar {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: flex-end;
    }

    .scope-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .scope-field label {
      font-size: 11px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .scope-bar input,
    .scope-bar select,
    .picker input {
      padding: 7px 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
    }

    .scope-bar input {
      min-width: 260px;
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

    .layout {
      display: grid;
      grid-template-columns: 1fr 340px;
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

    .editor-actions {
      display: flex;
      gap: 10px;
      margin-top: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    textarea.content {
      width: 100%;
      min-height: 220px;
      resize: vertical;
      padding: 12px;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 13px;
      line-height: 1.6;
      background-color: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
    }

    .hint {
      margin-top: 8px;
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .notice {
      margin-top: 10px;
      font-size: 13px;
      padding: 8px 12px;
      border-radius: var(--radius);
    }

    .notice.ok {
      background-color: rgba(34, 197, 94, 0.12);
      color: #15803d;
    }

    .notice.warn {
      background-color: rgba(245, 158, 11, 0.12);
      color: #b45309;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
    }

    .viewing-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      padding: 8px 12px;
      border-radius: var(--radius);
      background-color: rgba(59, 130, 246, 0.1);
      font-size: 13px;
    }

    .ref-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .ref-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: 13px;
      flex-wrap: wrap;
    }

    .ref-token {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 12px;
    }

    .badge {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 2px 8px;
      border-radius: 999px;
    }

    .badge.resolved {
      background-color: rgba(34, 197, 94, 0.15);
      color: #15803d;
    }

    .badge.missing {
      background-color: rgba(239, 68, 68, 0.15);
      color: #b91c1c;
    }

    .badge.ambiguous {
      background-color: rgba(245, 158, 11, 0.15);
      color: #b45309;
    }

    .ref-asset {
      color: var(--color-text-muted);
      font-size: 12px;
    }

    .ref-notes {
      width: 100%;
      color: var(--color-text-muted);
      font-size: 12px;
    }

    .no-refs {
      color: var(--color-text-muted);
      font-size: 13px;
    }

    .warning-line {
      font-size: 12px;
      color: #b45309;
      margin-top: 10px;
    }

    .history-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .history-row {
      display: flex;
      align-items: center;
      gap: 10px;
      justify-content: space-between;
      font-size: 13px;
      padding: 8px 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
    }

    .history-meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .history-date {
      font-size: 11px;
      color: var(--color-text-muted);
    }

    .history-actions {
      display: flex;
      gap: 6px;
    }

    .picker {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      border-top: 1px solid var(--color-border);
      padding-top: 12px;
    }

    .picker-results {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 220px;
      overflow-y: auto;
    }

    .picker-item {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 13px;
    }

    .picker-item:hover {
      background-color: var(--color-surface-hover);
    }

    .picker-item .slug {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      color: var(--color-text-muted);
      font-size: 12px;
    }

    .empty {
      color: var(--color-text-muted);
      font-size: 13px;
    }
  `;

  static properties = {
    scopeType: { state: true },
    scopeId: { state: true },
    loadedScope: { state: true },
    content: { state: true },
    tokens: { state: true },
    parseWarnings: { state: true },
    parsing: { state: true },
    history: { state: true },
    loading: { state: true },
    viewingVersion: { state: true },
    saving: { state: true },
    saveMsg: { state: true },
    error: { state: true },
    pickerOpen: { state: true },
    pickerQuery: { state: true },
    pickerAssets: { state: true },
    pickerLoading: { state: true },
  };

  constructor() {
    super();
    this.scopeType = "prompt";
    this.scopeId = "";
    this.loadedScope = null;
    this.content = "";
    this.tokens = [];
    this.parseWarnings = [];
    this.parsing = false;
    this.history = [];
    this.loading = false;
    this.viewingVersion = null;
    this.saving = false;
    this.saveMsg = null;
    this.error = "";
    this.pickerOpen = false;
    this.pickerQuery = "";
    this.pickerAssets = [];
    this.pickerLoading = false;
    this._parseTimer = null;
    this._pickerTimer = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    if (this._parseTimer) clearTimeout(this._parseTimer);
    if (this._pickerTimer) clearTimeout(this._pickerTimer);
  }

  render() {
    return html`
      <div class="prompt-editor">
        <div class="list-header">
          <div class="list-title">Prompt Studio</div>
        </div>

        <div class="panel">
          <div class="scope-bar">
            <div class="scope-field">
              <label for="scope-type">Scope type</label>
              <select
                id="scope-type"
                .value=${this.scopeType}
                @change=${this._onScopeTypeChange}>
                ${SCOPE_TYPES.map((t) => html`<option value=${t}>${t}</option>`)}
              </select>
            </div>
            <div class="scope-field">
              <label for="scope-id">Scope id (e.g. a scene id)</label>
              <input
                id="scope-id"
                type="text"
                placeholder="scene-42"
                .value=${this.scopeId}
                @input=${this._onScopeIdInput} />
            </div>
            <button class="btn btn-secondary" @click=${this._loadScope}>
              ${this.loading ? "Loading..." : "Load"}
            </button>
          </div>
          <p class="hint">
            Reference studio assets inline with <code>@slug</code> or
            <code>@slug:v3</code>. Emails and words like <code>foo@bar</code> are
            ignored.
          </p>
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : null}

        <div class="layout">
          <div class="panel">
            ${this.viewingVersion
              ? html`
                <div class="viewing-banner">
                  <span>
                    Viewing <strong>v${this.viewingVersion.version_number}</strong>
                    (saved ${this._fmtDate(
                      this.viewingVersion.created_at,
                    )})
                  </span>
                  <button
                    class="btn-small btn"
                    @click=${() => this._restore(this.viewingVersion.id)}>
                    Restore this version
                  </button>
                </div>
              `
              : null}
            <h3>Prompt text</h3>
            <textarea
              class="content"
              placeholder="@hero walks into @room and spots @ghost:v2..."
              .value=${this.content}
              @input=${this._onContentInput}></textarea>
            <div class="editor-actions">
              <button
                class="btn"
                ?disabled=${this.saving ||
                  !this.loadedScope}
                @click=${this._save}>
                ${this.saving
                  ? "Saving..."
                  : this.loadedScope
                  ? "Save version"
                  : "Load a scope to save"}
              </button>
              <button
                class="btn btn-secondary"
                @click=${this._togglePicker}>
                Insert @asset
              </button>
            </div>
            ${this.saveMsg
              ? html`<div class="notice ${this.saveMsg.kind}">${this.saveMsg.text}</div>`
              : null}
            ${this.pickerOpen
              ? html`
                <div class="picker">
                  <input
                    type="text"
                    placeholder="Search assets by name, slug, or tag..."
                    .value=${this.pickerQuery}
                    @input=${this._onPickerInput} />
                  <div class="picker-results">
                    ${this.pickerLoading
                      ? html`<div class="empty">Searching...</div>`
                      : this.pickerAssets.length === 0
                      ? html`<div class="empty">No matching assets.</div>`
                      : this.pickerAssets.map(
                        (a) =>
                          html`
                            <div
                              class="picker-item"
                              @click=${() =>
                                this._insertToken(
                                  a.unique_slug,
                                )}>
                              <span>${a.display_name}</span>
                              <span class="slug">@${a.unique_slug}</span>
                            </div>
                          `,
                      )}
                  </div>
                </div>
              `
              : null}
          </div>

          <div style="display:flex; flex-direction:column; gap:20px;">
            <div class="panel">
              <h3>References ${this.parsing ? "(parsing...)" : ""}</h3>
              ${this.tokens.length === 0
                ? html`<div class="no-refs">
                    No @-references in the current text.
                  </div>`
                : html`
                  <div class="ref-list">
                    ${this.tokens.map((t) =>
                      html`
                        <div class="ref-row">
                          <span class="ref-token">${t.raw}</span>
                          <span class="badge ${t.status}">${t.status}</span>
                          ${t.asset
                            ? html`
                              <span class="ref-asset"
                              >→ ${t.asset.display_name}</span>
                            `
                            : null}
                          ${t.notes ? html`<span class="ref-notes">${t.notes}</span>` : null}
                        </div>
                      `
                    )}
                  </div>
                `}
              ${this.parseWarnings.length > 0
                ? html`
                  ${this.parseWarnings.map(
                    (w) => html`<div class="warning-line">${w}</div>`,
                  )}
                `
                : null}
            </div>

            <div class="panel">
              <h3>Version history</h3>
              ${this.history.length === 0
                ? html`<div class="empty">
                    No saved versions for this scope yet.
                  </div>`
                : html`
                  <div class="history-list">
                    ${this.history.map(
                      (v) =>
                        html`
                          <div class="history-row">
                            <div class="history-meta">
                              <span>v${v.version_number}</span>
                              <span class="history-date">${this._fmtDate(
                                v.created_at,
                              )}</span>
                            </div>
                            <div class="history-actions">
                              <button
                                class="btn-small"
                                @click=${() => this._viewVersion(v)}>View</button>
                              ${v.id === this.history[0]?.id ? null : html`
                                <button
                                  class="btn-small"
                                  @click=${() => this._restore(v.id)}>Restore</button>
                              `}
                            </div>
                          </div>
                        `,
                    )}
                  </div>
                `}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _onScopeTypeChange(e) {
    this.scopeType = e.target.value;
  }

  _onScopeIdInput(e) {
    this.scopeId = e.target.value.trim();
  }

  async _loadScope() {
    this.error = "";
    if (!this.scopeId) {
      this.error = "Enter a scope id to load.";
      return;
    }
    this.loading = true;
    this.viewingVersion = null;
    this.saveMsg = null;
    try {
      const versions = await api.listPromptVersions(
        this.scopeType,
        this.scopeId,
      );
      this.loadedScope = {
        type: this.scopeType,
        id: this.scopeId,
      };
      this.history = versions;
      this.content = versions[0]?.content ?? "";
      await this._parse();
    } catch (err) {
      this.error = err.message || "Failed to load prompt scope.";
    } finally {
      this.loading = false;
    }
  }

  _onContentInput(e) {
    this.content = e.target.value;
    this.viewingVersion = null;
    this.saveMsg = null;
    this._scheduleParse();
  }

  _scheduleParse() {
    if (this._parseTimer) clearTimeout(this._parseTimer);
    if (!this.content.trim()) {
      this.tokens = [];
      this.parseWarnings = [];
      this.parsing = false;
      return;
    }
    this.parsing = true;
    this._parseTimer = setTimeout(() => this._parse(), 400);
  }

  async _parse() {
    if (this._parseTimer) {
      clearTimeout(this._parseTimer);
      this._parseTimer = null;
    }
    if (!this.content.trim()) {
      this.tokens = [];
      this.parseWarnings = [];
      this.parsing = false;
      return;
    }
    try {
      const result = await api.parseReferences({ text: this.content });
      this.tokens = result.tokens ?? [];
      this.parseWarnings = result.warnings ?? [];
    } catch {
      this.tokens = [];
      this.parseWarnings = [];
    } finally {
      this.parsing = false;
    }
  }

  async _save() {
    if (!this.loadedScope) return;
    this.saving = true;
    this.error = "";
    this.saveMsg = null;
    try {
      const result = await api.savePrompt({
        scope_type: this.loadedScope.type,
        scope_id: this.loadedScope.id,
        content: this.content,
      });
      this.saveMsg = {
        kind: result.duplicate ? "warn" : "ok",
        text: result.duplicate
          ? "No changes — content is identical to the latest version."
          : `Saved as v${result.version.version_number}.`,
      };
      this.parseWarnings = result.warnings ?? [];
      this.viewingVersion = null;
      this.history = await api.listPromptVersions(
        this.loadedScope.type,
        this.loadedScope.id,
      );
    } catch (err) {
      this.error = err.message || "Failed to save prompt.";
    } finally {
      this.saving = false;
    }
  }

  _viewVersion(version) {
    this.content = version.content;
    this.viewingVersion = version;
    this.saveMsg = null;
    this._scheduleParse();
  }

  async _restore(versionId) {
    this.saving = true;
    this.error = "";
    this.saveMsg = null;
    try {
      const result = await api.restorePrompt(versionId);
      this.saveMsg = {
        kind: "ok",
        text: result.duplicate
          ? `v${result.version.version_number} is already the latest version.`
          : `Restored content as v${result.version.version_number}.`,
      };
      this.content = result.version.content;
      this.viewingVersion = null;
      if (this.loadedScope) {
        this.history = await api.listPromptVersions(
          this.loadedScope.type,
          this.loadedScope.id,
        );
      }
    } catch (err) {
      this.error = err.message || "Failed to restore version.";
    } finally {
      this.saving = false;
    }
  }

  _togglePicker() {
    this.pickerOpen = !this.pickerOpen;
    if (this.pickerOpen) {
      this.pickerQuery = "";
      this._searchPicker();
    }
  }

  _onPickerInput(e) {
    this.pickerQuery = e.target.value;
    if (this._pickerTimer) clearTimeout(this._pickerTimer);
    this._pickerTimer = setTimeout(() => this._searchPicker(), 300);
  }

  async _searchPicker() {
    this.pickerLoading = true;
    try {
      this.pickerAssets = await api.listAssets({
        q: this.pickerQuery,
        limit: 25,
      });
    } catch {
      this.pickerAssets = [];
    } finally {
      this.pickerLoading = false;
    }
  }

  _insertToken(slug) {
    const token = `@${slug}`;
    const ta = this.shadowRoot?.querySelector("textarea.content");
    if (!ta) {
      this.content = `${this.content}${token} `.trimStart();
      this.pickerOpen = false;
      this._scheduleParse();
      return;
    }
    const start = ta.selectionStart ?? this.content.length;
    const end = ta.selectionEnd ?? start;
    const prefix = this.content.slice(0, start);
    const needsSpace = prefix.length > 0 && !/\s$/.test(prefix);
    const inserted = `@${slug}`;
    this.content = prefix + (needsSpace ? " " : "") + inserted + this.content.slice(end);
    this.pickerOpen = false;
    this.pickerQuery = "";
    this._scheduleParse();
    const insertLen = inserted.length + (needsSpace ? 1 : 0);
    requestAnimationFrame(() => {
      const el = this.shadowRoot?.querySelector("textarea.content");
      if (!el) return;
      const pos = start + insertLen;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  _fmtDate(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}

customElements.define("prompt-editor", PromptEditor);
