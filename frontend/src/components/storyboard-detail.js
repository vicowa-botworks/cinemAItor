import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import { creativeAssetIds, forgetCreativeAssetIds } from "../creative-assets.js";
import { VramGuard } from "./vram-guard.js";
import { reconcilePreviews } from "./preview-reconcile.js";

const POLL_MS = 5000;
const PANEL_FIELDS = [
  ["shot_number", "Shot #", "text"],
  ["description", "Description", "textarea"],
  ["duration", "Duration (s)", "number"],
  ["mood", "Mood", "text"],
  ["lighting", "Lighting", "text"],
  ["time_of_day", "Time of day", "text"],
  ["dialogue", "Dialogue", "textarea"],
  ["voiceover", "Voiceover", "textarea"],
  ["music_cue", "Music cue", "text"],
  ["sfx", "SFX", "text"],
  ["transition", "Transition", "text"],
  ["notes", "Notes", "textarea"],
];

export class StoryboardDetail extends VramGuard(LitElement) {
  static styles = css`
    .board-detail {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .back-link {
      align-self: flex-start;
      color: var(--color-text-muted);
      text-decoration: none;
      font-size: 13px;
    }

    .back-link:hover {
      color: var(--color-primary);
    }

    .board-header {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .board-name {
      font-size: 24px;
      font-weight: 700;
    }

    .board-name-input {
      font-size: 22px;
      font-weight: 700;
      padding: 6px 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
    }

    .board-status {
      padding: 5px 10px;
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

    .btn-danger {
      background-color: transparent;
      color: var(--color-error);
      border: 1px solid var(--color-error);
    }

    .btn-small {
      padding: 5px 12px;
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

    .btn-small:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
    }

    .notice {
      font-size: 13px;
      padding: 8px 12px;
      border-radius: var(--radius);
      background-color: rgba(34, 197, 94, 0.12);
      color: #15803d;
    }

    .panels {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .panel-card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .panel-top {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .order-badge {
      font-size: 12px;
      font-weight: 700;
      padding: 2px 10px;
      border-radius: 999px;
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
    }

    .shot-number {
      font-weight: 600;
      font-size: 14px;
    }

    .panel-description {
      flex: 1;
      min-width: 120px;
      font-size: 13px;
      color: var(--color-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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

    .chip.draft {
      background-color: rgba(107, 114, 128, 0.15);
      color: #374151;
      border-color: transparent;
    }

    .chip.generating {
      background-color: rgba(59, 130, 246, 0.15);
      color: #1d4ed8;
      border-color: transparent;
    }

    .chip.preview_ready {
      background-color: rgba(34, 197, 94, 0.15);
      color: #15803d;
      border-color: transparent;
    }

    .panel-body {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .preview {
      max-width: 220px;
      max-height: 150px;
      border-radius: var(--radius);
      border: 1px solid var(--color-border);
      object-fit: cover;
      background-color: var(--color-bg);
    }

    .preview-slot {
      width: 220px;
      height: 120px;
      border-radius: var(--radius);
      border: 1px dashed var(--color-border);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-muted);
      font-size: 12px;
      background-color: var(--color-bg);
    }

    .prompt-area {
      flex: 1;
      min-width: 260px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .prompt-area label,
    .details-grid label,
    .gen-options label {
      font-size: 11px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    textarea,
    input[type="text"],
    input[type="number"],
    select {
      padding: 8px 10px;
      background-color: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
      font-family: inherit;
    }

    .prompt-area textarea {
      min-height: 88px;
      resize: vertical;
    }

    .warnings {
      font-size: 12px;
      color: #b45309;
      background-color: rgba(245, 158, 11, 0.12);
      border-radius: var(--radius);
      padding: 6px 10px;
    }

    .prompt-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .details {
      border-top: 1px solid var(--color-border);
      padding-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .details-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 10px;
    }

    .details-grid .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .details-grid textarea {
      min-height: 56px;
      resize: vertical;
    }

    .details-grid .wide {
      grid-column: 1 / -1;
    }

    .gen-options {
      display: flex;
      gap: 10px;
      align-items: flex-end;
      flex-wrap: wrap;
    }

    .gen-options .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .gen-options select {
      min-width: 180px;
    }

    .panel-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
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

    .add-bar {
      display: flex;
      justify-content: center;
    }

    a {
      color: var(--color-primary);
      text-decoration: none;
    }
  `;

  static properties = {
    boardId: {},
    board: { state: true },
    panels: { state: true },
    models: { state: true },
    loading: { state: true },
    error: { state: true },
    notice: { state: true },
    editingName: { state: true },
    nameDraft: { state: true },
    expandedId: { state: true },
    draft: { state: true },
    previewUrls: { state: true },
    busyPanelId: { state: true },
    saving: { state: true },
  };

  constructor() {
    super();
    this.board = null;
    this.panels = [];
    this.models = [];
    this.loading = false;
    this.error = "";
    this.notice = null;
    this.editingName = false;
    this.nameDraft = "";
    this.expandedId = null;
    this.draft = null;
    this.previewUrls = new Map();
    this.busyPanelId = null;
    this.saving = false;
    this._timer = null;
    this._boardId = null;
  }

  async connectedCallback() {
    super.connectedCallback?.();
    this._boardId = this.boardId ??
      decodeURIComponent(
        (window.location.hash.match(/#\/storyboard\/([^/?]+)/) ?? [])[1] ?? "",
      );
    await this._load();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._stopPolling();
    for (const entry of this.previewUrls.values()) {
      if (entry.url) URL.revokeObjectURL(entry.url);
    }
    this.previewUrls = new Map();
  }

  render() {
    if (this.loading && !this.board) {
      return html`<div class="empty">Loading storyboard...</div>`;
    }
    if (!this.board) {
      return html`<div class="empty">${this.error || "Storyboard not found."}</div>`;
    }
    const generating = this.panels.some((p) => p.status === "generating");
    return html`
      <div class="board-detail">
        <a class="back-link" href="#/storyboards">&larr; Storyboards</a>

        <div class="board-header">
          ${this.editingName
            ? html`
              <input
                class="board-name-input"
                .value=${this.nameDraft}
                @input=${(e) => (this.nameDraft = e.target.value)}
                @keydown=${(e) => {
                  if (e.key === "Enter") this._saveName();
                }}>
            `
            : html`<span class="board-name">${this.board.name}</span>`}
          <select
            class="board-status"
            .value=${this.board.status}
            @change=${(e) => this._saveBoardStatus(e.target.value)}>
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="archived">archived</option>
          </select>
          ${this.editingName
            ? html`
              <button class="btn btn-small" ?disabled=${this.saving}
                @click=${this._saveName}>
                Save
              </button>
              <button class="btn btn-small btn-secondary"
                @click=${() => {
                  this.editingName = false;
                  this.nameDraft = "";
                }}>
                Cancel
              </button>
            `
            : html`
              <button class="btn btn-small btn-secondary"
                @click=${() => {
                  this.editingName = true;
                  this.nameDraft = this.board.name;
                }}>
                              Rename
                            </button>
            `}
          <button
            class="btn btn-small btn-danger"
            style="margin-left:auto;"
            @click=${this._deleteBoard}>
            Delete
          </button>
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : null}
        ${this.notice ? html`<div class="notice">${this.notice}</div>` : null}
        ${generating
          ? html`
            <div class="notice"
              style="background:rgba(59,130,246,0.12); color:#1d4ed8;">
                          A preview is generating... (refreshing automatically)
                        </div>
          `
          : null}

        <div class="panels">
          ${this.panels.map((p) => this._renderPanel(p))}
        </div>

        <div class="add-bar">
          <button class="btn btn-secondary" ?disabled=${this.saving}
            @click=${this._addPanel}>
            Add panel
          </button>
        </div>
      </div>
    `;
  }

  _renderPanel(panel) {
    const expanded = this.expandedId === panel.id;
    const draft = expanded ? this.draft : null;
    const preview = this.previewUrls.get(panel.id);
    const busy = this.busyPanelId === panel.id;
    return html`
      <div class="panel-card">
              <div class="panel-top">
                <span class="order-badge">#${panel.panel_order}</span>
                ${panel.shot_number
                  ? html`<span class="shot-number">${panel.shot_number}</span>`
                  : null}
                <span class="panel-description">${panel.description ?? ""}</span>
                <span class="chip ${panel.status}">${panel.status}</span>
                <button
                  class="btn-small"
                  @click=${() => this._toggleExpand(panel)}>
                  ${expanded ? "Hide details" : "Details"}
                </button>
              </div>

              <div class="panel-body">
                ${preview
                  ? html`
                    <a
                      href="#/asset/${encodeURIComponent(preview.assetId)}"
                      target="_blank"
                      rel="noreferrer">
                      <img class="preview" src=${preview.url}
                        alt="Panel ${panel.panel_order} preview" />
                    </a>
                  `
                  : html`
                    <div class="preview-slot">
                      ${panel.status === "generating" ? "generating..." : "no preview yet"}
                    </div>
                  `}

                <div class="prompt-area">
                  <label for="prompt-${panel.id}">Prompt</label>
                  <textarea
                    id="prompt-${panel.id}"
                    .value=${panel.prompt?.content ?? ""}
                    @change=${(e) => this._savePrompt(panel, e.target.value)}>
      ${panel.prompt?.content ?? ""}</textarea>
                  ${panel.prompt?.warnings?.length
                    ? html`<div class="warnings">
                  ${panel.prompt.warnings.join(" · ")}
                </div>`
                    : null}
                  <div class="prompt-actions">
                    <button
                      class="btn-small"
                      ?disabled=${busy || !panel.prompt}
                      @click=${() => this._generatePreview(panel)}>
                      ${busy
                        ? "Working..."
                        : panel.prompt
                        ? "Generate preview"
                        : "Set a prompt first"}
                    </button>
                    <a class="btn-small"
                      href="#/jobs"
                      style="text-decoration:none; display:inline-block;">
                      Jobs
                    </a>
                  </div>
                </div>
              </div>

              ${expanded && draft
                ? html`
                  <div class="details">
                    <div class="details-grid">
                      ${PANEL_FIELDS.map(([key, label, kind]) =>
                        kind === "textarea"
                          ? html`
                            <div class="field ${label === "Description" ? "wide" : ""}">
                              <label>${label}</label>
                              <textarea
                                .value=${String(draft[key] ?? "")}
                                @input=${(e) => this._setDraftField(key, e.target.value)}>
                            ${String(draft[key] ?? "")}</textarea>
                            </div>
                          `
                          : html`
                            <div class="field">
                              <label>${label}</label>
                              <input
                                type=${kind}
                                ?step=${kind === "number" ? "any" : false}
                                .value=${String(draft[key] ?? "")}
                                @input=${(e) => this._setDraftField(key, e.target.value)}>
                            </div>
                          `
                      )}
                      <div class="field">
                        <label>Camera settings (JSON)</label>
                        <input
                          type="text"
                          .value=${draft.camera_settings_json ?? ""}
                          @input=${(e) =>
                            this._setDraftField("camera_settings_json", e.target.value)}>
                      </div>
                    </div>

                    <div class="gen-options">
                      <div class="field">
                        <label for="model-${panel.id}">Model (optional)</label>
                        <select
                          id="model-${panel.id}"
                          .value=${String(draft.model_id ?? "")}
                          @change=${(e) => this._setDraftField("model_id", e.target.value)}>
                          <option value="">default (first enabled)</option>
                          ${this.models.map(
                            (m) => html`<option value=${m.id}>${m.name}</option>`,
                          )}
                        </select>
                      </div>
                      <div class="field">
                        <label for="seed-${panel.id}">Seed (optional)</label>
                        <input
                          id="seed-${panel.id}"
                          type="text"
                          .value=${String(draft.seed ?? "")}
                          @change=${(e) => this._setDraftField("seed", e.target.value)}
                          style="min-width:110px;">
                      </div>
                    </div>

                    <div class="panel-actions">
                      <button class="btn-small btn-danger" ?disabled=${this.saving}
                        @click=${() => this._deletePanel(panel)}>
                        Delete panel
                      </button>
                      <button class="btn-small" ?disabled=${this.saving}
                        @click=${() => this._savePanel(panel)}>
                        ${this.saving ? "Saving..." : "Save details"}
                      </button>
                    </div>
                  </div>
                `
                : null}
            </div>
      ${this.vramDialog}
    `;
  }

  _toggleExpand(panel) {
    if (this.expandedId === panel.id) {
      this.expandedId = null;
      this.draft = null;
      return;
    }
    this.draft = {
      ...panel,
      camera_settings_json: panel.camera_settings
        ? JSON.stringify(panel.camera_settings, null, 0)
        : "",
      model_id: "",
      seed: "",
    };
    this.expandedId = panel.id;
    this._loadModels();
  }

  _setDraftField(key, value) {
    this.draft = { ...this.draft, [key]: value };
  }

  async _loadModels() {
    if (this.models.length > 0) return;
    try {
      this.models = (await api.listModels({ task_type: "text_to_image" })).filter(
        (m) => m.enabled,
      );
    } catch {
      this.models = [];
    }
  }

  async _load() {
    if (!this._boardId) return;
    this.loading = true;
    this.error = "";
    try {
      const { storyboard, panels } = await api.getStoryboard(this._boardId);
      // Assign the fresh panels BEFORE _replacePreviews: it reads this.panels to
      // decide which panels want a preview. Doing it afterwards made the decision
      // one fetch stale, so the poll that first carries preview_asset_version_id
      // (and flips the panel to preview_ready, stopping the poll loop) never
      // fetched the image — the panel stayed "no preview yet".
      this.board = storyboard;
      this.panels = panels;
      this._replacePreviews();
    } catch (err) {
      this.error = err.message || "Failed to load storyboard.";
    } finally {
      this.loading = false;
      this._syncPolling();
    }
  }

  _replacePreviews() {
    // Plan the reconciliation from the (fresh) panels; keep/fetch/revoke is
    // pure + unit-tested in preview-reconcile.js.
    const { keep, fetch, revoke } = reconcilePreviews(this.panels, this.previewUrls);
    for (const url of revoke) URL.revokeObjectURL(url);
    this.previewUrls = keep;
    for (const panelId of fetch) this._fetchPreview(panelId);
  }

  async _fetchPreview(panelId) {
    const panel = this.panels.find((p) => p.id === panelId);
    if (!panel?.preview_asset_version_id) return;
    const slug = `panel_${panelId.slice(0, 8)}`;
    const map = await creativeAssetIds("panel");
    const assetId = map.get(slug);
    if (!assetId) {
      // Asset does not exist yet (or is not visible) — retry once next poll.
      forgetCreativeAssetIds("panel");
      return;
    }
    let media;
    try {
      media = await api.fetchMediaUrl(api.getAssetPreviewUrl(assetId));
    } catch {
      media = await api.fetchMediaUrl(
        api.getAssetProxyUrl(assetId, panel.preview_asset_version_id),
      );
    }
    if (!this.panels.some((p) => p.id === panelId)) {
      URL.revokeObjectURL(media.url);
      return;
    }
    const prev = this.previewUrls.get(panelId);
    if (prev?.url) URL.revokeObjectURL(prev.url);
    this.previewUrls = new Map(this.previewUrls.set(panelId, {
      url: media.url,
      type: media.type,
      assetId,
      versionId: panel.preview_asset_version_id,
    }));
  }

  _syncPolling() {
    if (this.panels.some((p) => p.status === "generating")) {
      this._startPolling();
    } else {
      this._stopPolling();
    }
  }

  _startPolling() {
    this._stopPolling();
    this._timer = setInterval(() => this._load(), POLL_MS);
  }

  _stopPolling() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _saveName() {
    const name = this.nameDraft.trim();
    if (!name) return;
    this.saving = true;
    this.error = "";
    try {
      this.board = await api.updateStoryboard(this._boardId, { name });
      this.editingName = false;
      this.nameDraft = "";
      this.notice = "Storyboard renamed.";
    } catch (err) {
      this.error = err.message || "Failed to rename storyboard.";
    } finally {
      this.saving = false;
    }
  }

  async _saveBoardStatus(status) {
    this.error = "";
    try {
      this.board = { ...this.board, status };
      await api.updateStoryboard(this._boardId, { status });
    } catch (err) {
      this.error = err.message || "Failed to update status.";
      this.board = { ...this.board, status: this.board.status };
    }
  }

  async _savePrompt(panel, prompt) {
    this.error = "";
    this.notice = null;
    try {
      const updated = await api.updatePanel(this._boardId, panel.id, { prompt });
      this.panels = this.panels.map((p) => (p.id === panel.id ? updated : p));
      this.notice = "Prompt saved.";
    } catch (err) {
      this.error = err.message || "Failed to save prompt.";
    }
  }

  async _savePanel(panel) {
    const d = this.draft;
    if (!d) return;
    this.saving = true;
    this.error = "";
    try {
      const payload = {};
      for (const [key] of PANEL_FIELDS) {
        const raw = d[key];
        if (key === "duration") {
          payload.duration = raw === "" ? null : Number(raw);
        } else if (typeof raw === "string") {
          payload[key] = raw.trim() === "" ? null : raw;
        }
      }
      if (d.camera_settings_json.trim()) {
        let settings;
        try {
          settings = JSON.parse(d.camera_settings_json);
        } catch {
          this.error = "Camera settings must be valid JSON.";
          this.saving = false;
          return;
        }
        payload.camera_settings = settings;
      }
      const updated = await api.updatePanel(this._boardId, panel.id, payload);
      this.panels = this.panels.map((p) => (p.id === panel.id ? updated : p));
      this.draft = null;
      this.expandedId = null;
      this.notice = "Panel saved.";
    } catch (err) {
      this.error = err.message || "Failed to save panel.";
    } finally {
      this.saving = false;
    }
  }

  async _addPanel() {
    this.saving = true;
    this.error = "";
    try {
      const next = this.panels.length > 0
        ? Math.max(...this.panels.map((p) => p.panel_order)) + 1
        : 1;
      await api.createPanel(this._boardId, { panel_order: next });
      await this._load();
    } catch (err) {
      this.error = err.message || "Failed to add panel.";
    } finally {
      this.saving = false;
    }
  }

  async _deletePanel(panel) {
    if (!window.confirm(`Delete panel #${panel.panel_order}?`)) return;
    this.saving = true;
    this.error = "";
    try {
      await api.deletePanel(this._boardId, panel.id);
      this.expandedId = null;
      this.draft = null;
      this.notice = "Panel deleted.";
      await this._load();
    } catch (err) {
      this.error = err.message || "Failed to delete panel.";
    } finally {
      this.saving = false;
    }
  }

  async _generatePreview(panel) {
    const d = this.draft ?? {};
    const modelId = d.model_id;
    const model = modelId
      ? this.models.find((m) => m.id === modelId) ?? null
      : this.models[0] ?? null;
    const device = await this.resolveVramDevice(model);
    if (device === "cancel") return;
    this.busyPanelId = panel.id;
    this.error = "";
    this.notice = null;
    try {
      const options = {};
      if (device) options.device = device;
      if (modelId) options.model_id = modelId;
      if (String(d.seed ?? "").trim()) options.seed = String(d.seed).trim();
      const result = await api.generatePanelPreview(
        this._boardId,
        panel.id,
        options,
      );
      this.notice = `Preview job queued (job ${result.job_id.slice(0, 8)}...) — ` +
        "watch it in the job monitor.";
      forgetCreativeAssetIds("panel");
      this.panels = this.panels.map((p) => p.id === panel.id ? { ...p, status: "generating" } : p);
      this._syncPolling();
    } catch (err) {
      this.error = err.message || "Failed to start preview job.";
    } finally {
      this.busyPanelId = null;
    }
  }

  async _deleteBoard() {
    if (!window.confirm("Delete this storyboard and all its panels?")) return;
    this.saving = true;
    try {
      await api.deleteStoryboard(this._boardId);
      window.location.hash = "#/storyboards";
    } catch (err) {
      this.error = err.message || "Failed to delete storyboard.";
      this.saving = false;
    }
  }
}

customElements.define("storyboard-detail", StoryboardDetail);
