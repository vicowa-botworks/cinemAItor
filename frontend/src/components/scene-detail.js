import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import "./ref-input.js";
import { creativeAssetIds, forgetCreativeAssetIds } from "../creative-assets.js";
import "./audio-dialog.js";
import "./ai-assist-dialog.js";
import { VramGuard } from "./vram-guard.js";

const SCENE_STATUSES = [
  "draft",
  "in_production",
  "in_review",
  "approved",
  "archived",
];

export class SceneDetail extends VramGuard(LitElement) {
  static styles = css`
    .scene-detail {
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

    .scene-header {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .scene-name {
      font-size: 24px;
      font-weight: 700;
    }

    .scene-name-input {
      font-size: 22px;
      font-weight: 700;
      padding: 6px 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
    }

    .scene-status {
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
      white-space: pre-line;
    }

    .card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .card-title {
      font-size: 15px;
      font-weight: 600;
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

    .field-row {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 10px;
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

    .warnings {
      font-size: 12px;
      color: #b45309;
      background-color: rgba(245, 158, 11, 0.12);
      border-radius: var(--radius);
      padding: 6px 10px;
    }

    .shots {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .shot-card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .shot-top {
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

    .chip {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
    }

    .chip.queued {
      background-color: rgba(59, 130, 246, 0.15);
      color: #1d4ed8;
      border-color: transparent;
    }

    .chip.generated {
      background-color: rgba(34, 197, 94, 0.15);
      color: #15803d;
      border-color: transparent;
    }

    .shot-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .shot-grid .wide {
      grid-column: 1 / -1;
    }

    .shot-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    video {
      width: 100%;
      max-height: 240px;
      border-radius: var(--radius);
      background-color: black;
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

    a {
      color: var(--color-primary);
    }
  `;

  static properties = {
    sceneId: {},
    scene: { state: true },
    shots: { state: true },
    models: { state: true },
    loading: { state: true },
    error: { state: true },
    notice: { state: true },
    editingName: { state: true },
    nameDraft: { state: true },
    expandedShotId: { state: true },
    shotDraft: { state: true },
    clipUrls: { state: true },
    sceneClip: { state: true },
    showAudioGen: { state: true },
    busy: { state: true },
    assistOpen: { state: true },
    assistPurpose: { state: true },
    assistInitial: { state: true },
    assistTarget: { state: true },
  };

  constructor() {
    super();
    this.scene = null;
    this.shots = [];
    this.models = [];
    this.loading = false;
    this.error = "";
    this.notice = null;
    this.editingName = false;
    this.nameDraft = "";
    this.expandedShotId = null;
    this.shotDraft = null;
    this.clipUrls = new Map();
    this.sceneClip = null;
    this.showAudioGen = false;
    this.busy = false;
    this.assistOpen = false;
    this.assistPurpose = "design_scene";
    this.assistInitial = "";
    this.assistTarget = "scene";
    this._sceneId = null;
    this._modelChoice = "";
    this._seed = "";
    this._pollTimer = null;
  }

  async connectedCallback() {
    super.connectedCallback?.();
    this._sceneId = this.sceneId ??
      decodeURIComponent(
        (window.location.hash.match(/#\/scene\/([^/?]+)/) ?? [])[1] ?? "",
      );
    await this._load();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._stopJobPolling();
    for (const entry of this.clipUrls.values()) {
      if (entry.url) URL.revokeObjectURL(entry.url);
    }
    this.clipUrls = new Map();
    if (this.sceneClip?.url) URL.revokeObjectURL(this.sceneClip.url);
    this.sceneClip = null;
  }

  render() {
    if (this.loading && !this.scene) {
      return html`<div class="empty">Loading scene...</div>`;
    }
    if (!this.scene) {
      return html`<div class="empty">${this.error || "Scene not found."}</div>`;
    }
    const s = this.scene;
    return html`
      <div class="scene-detail">
              <a class="back-link" href="#/scenes">&larr; Scenes</a>

              <div class="scene-header">
                ${this.editingName
                  ? html`
                    <input
                      class="scene-name-input"
                      .value=${this.nameDraft}
                      @input=${(e) => (this.nameDraft = e.target.value)}>
                  `
                  : html`<span class="scene-name">${s.name}</span>`}
                <select
                  class="scene-status"
                  .value=${s.status}
                  @change=${(e) => this._saveStatus(e.target.value)}>
                  ${SCENE_STATUSES.map(
                    (st) => html`<option value=${st}>${st}</option>`,
                  )}
                </select>
                ${this.editingName
                  ? html`
                    <button class="btn-small" ?disabled=${this.busy}
                      @click=${this._saveName}>
                      Save
                    </button>
                    <button class="btn-small btn-secondary"
                      @click=${() => {
                        this.editingName = false;
                        this.nameDraft = "";
                      }}>
                      Cancel
                    </button>
                  `
                  : html`
                    <button class="btn-small btn-secondary"
                      @click=${() => {
                        this.editingName = true;
                        this.nameDraft = s.name;
                      }}>
                                    Rename
                                  </button>
                  `}
                <button
                  class="btn-small btn-danger"
                  style="margin-left:auto;"
                  @click=${this._deleteScene}>
                  Delete
                </button>
              </div>

              ${this.error ? html`<div class="error">${this.error}</div>` : null}
              ${this.notice ? html`<div class="notice">${this.notice}</div>` : null}

              <div class="card">
                <div class="card-title">Scene</div>
                <div class="field-row">
                  <div class="field">
                    <label>Description</label>
                    <input
                      type="text"
                      .value=${s.description ?? ""}
                      @change=${(e) => this._saveSceneFields({ description: e.target.value })}>
                  </div>
                  <div class="field">
                    <label>Target duration (s)</label>
                    <input
                      type="number"
                      step="any"
                      .value=${s.target_duration ?? ""}
                      @change=${(e) =>
                        this._saveSceneFields({
                          target_duration: e.target.value === "" ? null : Number(e.target.value),
                        })}>
                  </div>
                  <div class="field">
                    <label>Aspect ratio override</label>
                    <input
                      type="text"
                      .value=${s.aspect_ratio_override ?? ""}
                      @change=${(e) =>
                        this._saveSceneFields({
                          aspect_ratio_override: e.target.value,
                        })}>
                    <span style="font-size:11px;color:var(--color-text-muted);">
                      e.g. 16:9
                    </span>
                  </div>
                  <div class="field">
                    <label>Frame rate override</label>
                    <input
                      type="number"
                      step="any"
                      .value=${s.frame_rate_override ?? ""}
                      @change=${(e) =>
                        this._saveSceneFields({
                          frame_rate_override: e.target.value === ""
                            ? null
                            : Number(e.target.value),
                        })}>
                  </div>
                </div>
                <div class="field">
                  <label>Notes</label>
                  <textarea
                    rows="2"
                    .value=${s.notes ?? ""}
                    @change=${(e) => this._saveSceneFields({ notes: e.target.value })}>
      ${s.notes ?? ""}</textarea>
                </div>
              </div>

              <div class="card">
                <div class="card-title">Prompt &amp; generation</div>
                <div class="field">
                  <label>Scene prompt (supports @asset references)</label>
                  <ref-input
                    rows="3"
                    .value=${s.prompt?.content ?? ""}
                    @change=${(e) => this._savePrompt(e.target.value)}></ref-input>
                  <button
                    class="btn-small"
                    ?disabled=${this.busy}
                    @click=${() => {
                      this.assistPurpose = "design_scene";
                      this.assistTarget = "scene";
                      this.assistInitial = s.prompt?.content ??
                        `Scene: ${s.name ?? ""} (${s.status ?? ""})`;
                      this.assistOpen = true;
                    }}>
                    Design scene with AI
                  </button>
                </div>
                ${this.assistOpen && this.assistTarget === "scene"
                  ? html`
                    <ai-assist-dialog
                      purpose=${this.assistPurpose}
                      .initial-context=${this.assistInitial}
                      insert-label="Use as scene prompt"
                      @insert=${this._onAssistInsert}
                      @close=${() => (this.assistOpen = false)}></ai-assist-dialog>
                  `
                  : null}
                ${s.prompt?.warnings?.length
                  ? html`<div class="warnings">
                ${s.prompt.warnings.map((w) => html`<div>${w}</div>`)}
              </div>`
                  : null}
                ${this.sceneClip
                  ? html`
                    <video controls preload="metadata" src=${this.sceneClip.url}
                      style="max-width:420px;"></video>
                  `
                  : null}
                <div class="field-row">
                  <div class="field">
                    <label for="scene-model">Model (optional)</label>
                    <select
                      id="scene-model"
                      .value=${String(this._modelChoice ?? "")}
                      @change=${(e) => (this._modelChoice = e.target.value)}>
                      <option value="">default (auto i2v / t2v)</option>
                      ${this.models.map(
                        (m) =>
                          html`<option value=${m.id}>${m.name} (${
                            m.task_types
                              ?.join("/")
                          })</option>`,
                      )}
                    </select>
                  </div>
                  <div class="field">
                    <label for="scene-seed">Seed (optional)</label>
                    <input
                      id="scene-seed"
                      type="text"
                      .value=${String(this._seed ?? "")}
                      @input=${(e) => (this._seed = e.target.value)}>
                  </div>
                </div>
                <div class="shot-actions" style="justify-content:flex-start;">
                  <button
                    class="btn"
                    ?disabled=${this.busy || !s.prompt}
                    @click=${() => this._generate(false)}>
                    ${this.busy ? "Working..." : "Generate scene clip"}
                  </button>
                  <button
                    class="btn btn-secondary"
                    ?disabled=${this.busy || this.shots.length === 0}
                    @click=${() => this._generate(true)}>
                    Batch generate (one job per shot)
                  </button>
                    <a class="btn-small" href="#/jobs" style="text-decoration:none; display:inline-block;">
                    Jobs
                  </a>
                </div>
              </div>

              <div class="card">
                <div class="card-title">Audio</div>
                ${this.showAudioGen
                  ? html`
                    <audio-dialog .sceneId=${this._sceneId}></audio-dialog>
                  `
                  : html`
                    <button
                      class="btn-secondary"
                      style="padding:8px 14px;border-radius:var(--radius);background:transparent;border:1px solid var(--color-border);color:var(--color-text);cursor:pointer;font-size:13px;"
                      @click=${() => (this.showAudioGen = true)}>
                      Generate audio (music / voiceover / SFX)
                    </button>
                  `}
              </div>

              <div class="shots">
                <div class="card-title">Shots (${this.shots.length})</div>
                ${this.shots.map((shot) => this._renderShot(shot))}
                <div class="shot-actions" style="justify-content:center;">
                  <button
                    class="btn-small btn-secondary"
                    ?disabled=${this.busy}
                    @click=${this._addShot}>
                    Add shot
                  </button>
                </div>
              </div>
            </div>
    `;
  }

  _renderShot(shot) {
    const expanded = this.expandedShotId === shot.id;
    const d = expanded ? this.shotDraft : null;
    const clip = this.clipUrls.get(shot.id);
    return html`
      <div class="shot-card">
        <div class="shot-top">
          <span class="order-badge">#${shot.shot_order}</span>
          <input
            type="text"
            .value=${shot.name ?? ""}
            placeholder="Shot name"
            style="min-width:160px; flex:1;"
            @change=${(e) => this._saveShot(shot.id, { name: e.target.value })}>
          <span class="chip ${shot.status}">${shot.status}</span>
          <button
            class="btn-small"
            @click=${() => this._toggleShot(shot)}>
            ${expanded ? "Hide" : "Edit"}
          </button>
        </div>

        ${shot.generated_asset_version_id && clip
          ? html`
            <video controls preload="metadata" src=${clip.url}
              style="max-width:360px;"></video>
          `
          : null}

        ${expanded && d
          ? html`
            <div class="shot-grid">
              <div class="field wide">
                <label>Shot prompt (optional — falls back to scene prompt)</label>
                <ref-input
                  rows="2"
                  .value=${String(d.prompt ?? "")}
                  @input=${(e) => this._setShotField("prompt", e.target.value)}></ref-input>
                <button
                  class="btn-small"
                  ?disabled=${this.busy || !String(d.prompt ?? "").trim()}
                  @click=${() => {
                    this.assistPurpose = "enhance_prompt";
                    this.assistTarget = "shot";
                    this.assistInitial = String(d.prompt ?? "");
                    this.assistOpen = true;
                  }}>
                  Enhance with AI
                </button>
              </div>
              ${this.assistOpen && this.assistTarget === "shot"
                ? html`
                  <ai-assist-dialog
                    purpose=${this.assistPurpose}
                    .initial-context=${this.assistInitial}
                    insert-label="Use as shot prompt"
                    @insert=${this._onAssistInsert}
                    @close=${() => (this.assistOpen = false)}></ai-assist-dialog>
                `
                : null}
              <div class="field">
                <label>Duration (s)</label>
                <input
                  type="number"
                  step="any"
                  .value=${String(d.duration ?? "")}
                  @input=${(e) => this._setShotField("duration", e.target.value)}>
              </div>
              <div class="field">
                <label>Camera settings (JSON)</label>
                <input
                  type="text"
                  .value=${String(d.camera_settings_json ?? "")}
                  @input=${(e) => this._setShotField("camera_settings_json", e.target.value)}>
              </div>
              <div class="field wide">
                <label>Notes</label>
                <input
                  type="text"
                  .value=${String(d.notes ?? "")}
                  @input=${(e) => this._setShotField("notes", e.target.value)}>
              </div>
            </div>
            <div class="shot-actions">
              <button class="btn-small btn-danger" ?disabled=${this.busy}
                @click=${() => this._deleteShot(shot)}>
                            Delete shot
                          </button>
              <button class="btn-small" ?disabled=${this.busy}
                @click=${() => this._saveShotDraft(shot)}>
                            ${this.busy ? "Saving..." : "Save"}
                          </button>
            </div>
          `
          : null}
      </div>
      ${this.vramDialog}
    `;
  }

  _toggleShot(shot) {
    if (this.expandedShotId === shot.id) {
      this.expandedShotId = null;
      this.shotDraft = null;
      return;
    }
    this.shotDraft = {
      name: shot.name ?? "",
      prompt: shot.prompt?.content ?? "",
      duration: shot.duration ?? "",
      camera_settings_json: shot.camera_settings ? JSON.stringify(shot.camera_settings) : "",
      notes: shot.notes ?? "",
    };
    this.expandedShotId = shot.id;
  }

  _setShotField(key, value) {
    this.shotDraft = { ...this.shotDraft, [key]: value };
  }

  async _loadModels() {
    if (this.models.length > 0) return;
    try {
      const [i2v, t2v] = await Promise.all([
        api.listModels({ task_type: "image_to_video" }),
        api.listModels({ task_type: "text_to_video" }),
      ]);
      const byId = new Map();
      for (const m of [...i2v, ...t2v]) if (m.enabled) byId.set(m.id, m);
      this.models = [...byId.values()];
    } catch {
      this.models = [];
    }
  }

  async _load() {
    if (!this._sceneId) return;
    this.loading = this.scene === null;
    this.error = "";
    try {
      const { scene, shots } = await api.getScene(this._sceneId);
      this.scene = scene;
      this.shots = shots;
      this._replaceClips();
      this._fetchSceneClip();
    } catch (err) {
      this.error = err.message || "Failed to load scene.";
    } finally {
      this.loading = false;
    }
  }

  _replaceClips() {
    const wanted = new Set();
    for (const shot of this.shots) {
      if (shot.generated_asset_version_id) wanted.add(shot.id);
    }
    const old = this.clipUrls;
    this.clipUrls = new Map();
    for (const [shotId, entry] of old.entries()) {
      if (!wanted.has(shotId) && entry.url) URL.revokeObjectURL(entry.url);
    }
    for (const shotId of wanted) {
      this._fetchClip(shotId);
    }
  }

  async _fetchClip(shotId) {
    const shot = this.shots.find((x) => x.id === shotId);
    if (!shot?.generated_asset_version_id) return;
    const slug = `shot_${shotId.slice(0, 8)}`;
    const map = await creativeAssetIds("shot");
    const assetId = map.get(slug);
    if (!assetId) {
      forgetCreativeAssetIds("shot");
      return;
    }
    let media;
    try {
      media = await api.getAssetProxyUrl(
        assetId,
        shot.generated_asset_version_id,
      );
    } catch {
      return;
    }
    if (!this.shots.some((x) => x.id === shotId)) {
      URL.revokeObjectURL(media.url);
      return;
    }
    const prev = this.clipUrls.get(shotId);
    if (prev?.url) URL.revokeObjectURL(prev.url);
    this.clipUrls = new Map(this.clipUrls.set(shotId, {
      url: media.url,
      type: media.type,
      assetId,
    }));
  }

  async _fetchSceneClip() {
    const slug = `scene_${this._sceneId.slice(0, 8)}`;
    const map = await creativeAssetIds("scene");
    const assetId = map.get(slug);
    if (!assetId) {
      forgetCreativeAssetIds("scene");
      return;
    }
    const detailed = await api.getAsset(assetId).catch(() => null);
    const versionId = detailed?.active_version_id;
    if (!versionId) return;
    const media = await api.getAssetProxyUrl(assetId, versionId).catch(
      () => null,
    );
    if (!media) return;
    if (this.sceneClip?.url) URL.revokeObjectURL(this.sceneClip.url);
    this.sceneClip = { url: media.url, type: media.type, assetId };
  }

  async _saveName() {
    const name = this.nameDraft.trim();
    if (!name) return;
    this.busy = true;
    this.error = "";
    try {
      this.scene = { ...this.scene, name };
      await api.updateScene(this._sceneId, { name });
      this.editingName = false;
      this.nameDraft = "";
      this.notice = "Scene renamed.";
    } catch (err) {
      this.error = err.message || "Failed to rename scene.";
    } finally {
      this.busy = false;
    }
  }

  async _saveStatus(status) {
    this.scene = { ...this.scene, status };
    this.error = "";
    try {
      await api.updateScene(this._sceneId, { status });
    } catch (err) {
      this.error = err.message || "Failed to update status.";
    }
  }

  async _saveSceneFields(patch) {
    this.error = "";
    try {
      this.scene = { ...this.scene, ...patch };
      await api.updateScene(this._sceneId, patch);
    } catch (err) {
      this.error = err.message || "Failed to save scene.";
    }
  }

  _onAssistInsert(e) {
    const content = e.detail.content;
    this.assistOpen = false;
    if (this.assistTarget === "shot") {
      this._setShotField("prompt", content);
      this.notice = "Shot prompt updated — save the shot to keep it.";
    } else {
      void this._savePrompt(content);
    }
  }

  async _savePrompt(prompt) {
    this.error = "";
    try {
      this.scene = await api.updateScene(this._sceneId, { prompt });
      this.notice = "Scene prompt saved.";
    } catch (err) {
      this.error = err.message || "Failed to save prompt.";
    }
  }

  async _saveShot(shotId, patch) {
    this.error = "";
    try {
      const payload = {};
      for (const [key, value] of Object.entries(patch)) {
        payload[key] = typeof value === "string" ? (value.trim() === "" ? null : value) : value;
      }
      const updated = await api.updateShot(this._sceneId, shotId, payload);
      this.shots = this.shots.map((s) => (s.id === shotId ? updated : s));
    } catch (err) {
      this.error = err.message || "Failed to save shot.";
    }
  }

  async _saveShotDraft(shot) {
    const d = this.shotDraft;
    if (!d) return;
    this.busy = true;
    this.error = "";
    try {
      const payload = {
        name: d.name.trim() === "" ? null : d.name,
        notes: d.notes.trim() === "" ? null : d.notes,
        duration: d.duration === "" || d.duration === null ? null : Number(d.duration),
      };
      if (d.prompt.trim()) payload.prompt = d.prompt.trim();
      if (d.camera_settings_json.trim()) {
        let settings;
        try {
          settings = JSON.parse(d.camera_settings_json);
        } catch {
          this.error = "Camera settings must be valid JSON.";
          this.busy = false;
          return;
        }
        payload.camera_settings = settings;
      }
      if (this.expandedShotId === shot.id) {
        const updated = await api.updateShot(this._sceneId, shot.id, payload);
        this.shots = this.shots.map((s) => (s.id === shot.id ? updated : s));
      }
      this.expandedShotId = null;
      this.shotDraft = null;
      this.notice = "Shot saved.";
    } catch (err) {
      this.error = err.message || "Failed to save shot.";
    } finally {
      this.busy = false;
    }
  }

  async _addShot() {
    this.busy = true;
    this.error = "";
    try {
      const next = this.shots.length > 0 ? Math.max(...this.shots.map((s) => s.shot_order)) + 1 : 1;
      await api.createShot(this._sceneId, { shot_order: next });
      await this._load();
      this.notice = "Shot added.";
    } catch (err) {
      this.error = err.message || "Failed to add shot.";
    } finally {
      this.busy = false;
    }
  }

  async _deleteShot(shot) {
    if (!window.confirm(`Delete shot #${shot.shot_order}?`)) return;
    this.busy = true;
    this.error = "";
    try {
      await api.deleteShot(this._sceneId, shot.id);
      this.expandedShotId = null;
      this.shotDraft = null;
      this.notice = "Shot deleted.";
      await this._load();
    } catch (err) {
      this.error = err.message || "Failed to delete shot.";
    } finally {
      this.busy = false;
    }
  }

  async _generate(batch) {
    // The backend picks i2v (linked panel preview) or t2v when no model is
    // chosen, so gate on the whole candidate set — never silently fall to CPU.
    const model = this._modelChoice
      ? this.models.find((m) => m.id === this._modelChoice) ?? null
      : this.models;
    const device = await this.resolveVramDevice(model);
    if (device === "cancel") return;
    const options = {};
    if (device) options.device = device;
    if (this._modelChoice) options.model_id = this._modelChoice;
    if (String(this._seed ?? "").trim()) options.seed = String(this._seed).trim();
    this.busy = true;
    this.error = "";
    this.notice = null;
    forgetCreativeAssetIds("shot");
    forgetCreativeAssetIds("scene");
    try {
      const result = batch
        ? await api.batchGenerateScene(this._sceneId, options)
        : await api.generateScene(this._sceneId, options);
      if (batch) {
        const started = result.jobs.length;
        const skipped = result.skipped
          .map((s) => `shot ${s.shot_id.slice(0, 8)}: ${s.reason}`)
          .join("\n");
        this.notice = `Batch queued: ${started} job(s), ${result.skipped.length} skipped.` +
          (skipped ? `\n${skipped}` : "");
      } else {
        this.notice = `Scene ${result.job_type} job queued (job ` +
          `${result.job_id.slice(0, 8)}...).`;
      }
      await this._watchJobs(
        batch ? result.jobs.map((j) => j.job_id) : [
          result.job_id,
        ],
      );
      this._modelChoice = "";
      this._seed = "";
    } catch (err) {
      this.error = err.message || "Failed to start generation.";
    } finally {
      this.busy = false;
    }
  }

  _watchJobs(jobIds) {
    this._stopJobPolling();
    const check = async () => {
      let allDone = true;
      try {
        for (const id of jobIds) {
          const job = await api.getJob(id);
          if (!["succeeded", "failed", "cancelled"].includes(job.status)) {
            allDone = false;
            break;
          }
        }
      } catch {
        return;
      }
      if (allDone) {
        this._stopJobPolling();
        await this._load();
      } else {
        this._pollTimer = setTimeout(check, 1500);
      }
    };
    this._pollTimer = setTimeout(check, 1500);
  }

  _stopJobPolling() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _deleteScene() {
    if (!window.confirm("Delete this scene and all its shots?")) return;
    this.busy = true;
    try {
      await api.deleteScene(this._sceneId);
      window.location.hash = "#/scenes";
    } catch (err) {
      this.error = err.message || "Failed to delete scene.";
      this.busy = false;
    }
  }
}

customElements.define("scene-detail", SceneDetail);
