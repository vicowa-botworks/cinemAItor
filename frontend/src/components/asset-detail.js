import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import {
  AUDIO_TYPES,
  audioFormFromMeta,
  parseAudioMetadata,
  validateAudioAdjustments,
} from "../audio-adjustments.js";
import {
  CompareSync,
  isTimeMedia,
  resolveComparePair,
  toggleComparePair,
  versionCompareRows,
} from "../compare.js";

const STATUS_OPTIONS = ["draft", "approved", "rejected", "archived"];

function formatBytes(size) {
  if (size === null || size === undefined) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export class AssetDetail extends LitElement {
  static styles = css`
    .asset-detail {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .back-link {
      color: var(--color-primary);
      text-decoration: none;
      font-size: 13px;
    }

    .back-link:hover {
      text-decoration: underline;
    }

    .detail-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
    }

    .detail-title {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .detail-slug {
      color: var(--color-primary);
      font-size: 14px;
    }

    .chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .chip {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
    }

    .section {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 20px;
    }

    .section h3 {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 14px;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: minmax(0, 460px) 1fr;
      gap: 20px;
      align-items: start;
    }

    @media (max-width: 900px) {
      .grid-2 {
        grid-template-columns: 1fr;
      }
    }

    .preview-box {
      background: var(--color-surface-hover);
      border-radius: var(--radius);
      min-height: 220px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .preview-box img,
    .preview-box video {
      max-width: 100%;
      max-height: 420px;
      display: block;
    }

    .preview-box audio {
      width: 100%;
      padding: 24px 12px;
    }

    .preview-meta {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      margin-top: 10px;
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .preview-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
      flex-wrap: wrap;
    }

    .btn {
      padding: 8px 14px;
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

    .btn-secondary {
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-danger {
      background-color: var(--color-error);
      color: white;
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    label {
      display: block;
      font-size: 13px;
      color: var(--color-text-muted);
      margin-bottom: 5px;
      font-weight: 500;
    }

    input,
    select,
    textarea {
      width: 100%;
      padding: 8px 11px;
      background-color: var(--color-surface-hover);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 14px;
      font-family: inherit;
      box-sizing: border-box;
    }

    .field {
      margin-bottom: 12px;
    }

    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .versions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .version {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      background-color: var(--color-surface-hover);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      font-size: 13px;
      flex-wrap: wrap;
    }

    .version.active {
      border-color: var(--color-primary);
    }

    .version-id {
      font-weight: 600;
      min-width: 42px;
    }

    .version-info {
      color: var(--color-text-muted);
      flex: 1;
      min-width: 160px;
    }

    .version-notes {
      width: 100%;
      color: var(--color-text-muted);
      font-style: italic;
    }

    .tag-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 12px;
      background-color: var(--color-surface-hover);
      border: 1px solid var(--color-border);
    }

    .tag-chip .remove {
      background: none;
      border: none;
      color: var(--color-text-muted);
      cursor: pointer;
      font-size: 13px;
      padding: 0;
    }

    .tag-chip .remove:hover {
      color: var(--color-error);
    }

    .chip-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .chip-add {
      display: flex;
      gap: 8px;
    }

    .chip-add input {
      flex: 1;
    }

    .message {
      font-size: 13px;
      margin-top: 10px;
    }

    .message.error {
      color: var(--color-error);
    }

    .message.ok {
      color: #7bc47f;
    }

    .dep-group {
      margin-bottom: 14px;
    }

    .dep-group ul {
      margin: 6px 0 0;
      padding-left: 18px;
    }

    .dep-group li {
      font-size: 13px;
      margin: 4px 0;
    }

    .dep-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-muted);
    }

    .dep-dim {
      color: var(--color-text-muted);
      font-size: 12px;
    }

    .danger-zone {
      border-color: var(--color-error);
    }

    .waveform-note {
      font-size: 12px;
      color: var(--color-text-muted);
      margin-bottom: 12px;
    }

    .waveform-svg {
      display: block;
      width: 100%;
      height: 56px;
      background-color: var(--color-surface-hover);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      margin-bottom: 14px;
    }

    .waveform-bars {
      fill: none;
      stroke: var(--color-text-muted);
    }

    .waveform-dim {
      fill: #000;
      opacity: 0.35;
    }

    .waveform-edge {
      stroke: var(--color-primary);
      stroke-width: 2;
    }

    .audio-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }

    .cleanup-row {
      display: flex;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }

    .cleanup-row label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
    }

    @media (max-width: 700px) {
      .audio-row {
        grid-template-columns: 1fr;
      }
    }

    .cmp-toggle {
      margin-left: auto;
      margin-right: 8px;
      font-size: 12px;
      padding: 2px 10px;
    }

    .compare-pane {
      margin-top: 18px;
      padding: 14px;
      border: 1px solid var(--border-color, #e2e8f0);
      border-radius: 10px;
      background: var(--surface, #f8fafc);
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .compare-header {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 14px;
    }

    .compare-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .ab-col {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      border: 1px solid var(--border-color, #e2e8f0);
      border-radius: 8px;
      background: var(--card, #fff);
    }

    .ab-col-top {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .ab-label {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--accent, #4f46e5);
      color: #fff;
      font-weight: 700;
      font-size: 12px;
    }

    .media-slot {
      min-height: 96px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f172a;
      border-radius: 8px;
      overflow: hidden;
    }

    .media-slot img,
    .media-slot video {
      width: 100%;
      max-height: 240px;
      object-fit: contain;
    }

    .media-slot audio {
      width: 100%;
    }

    .cmp-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .cmp-table th,
    .cmp-table td {
      text-align: left;
      padding: 6px 10px;
      border-bottom: 1px solid var(--border-color, #e2e8f0);
      vertical-align: top;
    }

    .cmp-table thead th {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--muted, #64748b);
    }

    .cmp-table tr.differs td,
    .cmp-table tr.differs th {
      background: rgba(250, 204, 21, 0.12);
    }
  `;

  static properties = {
    assetId: {},
    backHash: { state: true },
    asset: { state: true },
    versions: { state: true },
    loading: { state: true },
    error: { state: true },
    notice: { state: true },
    preview: { state: true },
    mediaKind: { state: true },
    audioMeta: { state: true },
    audioPeaks: { state: true },
    audioForm: { state: true },
    audioSaving: { state: true },
    cleanupForm: { state: true },
    cleanupBusy: { state: true },
    subtitleBusy: { state: true },
    subtitleResult: { state: true },
    compareIds: { state: true },
    comparePreviews: { state: true },
  };

  constructor() {
    super();
    this.assetId = null;
    this.backHash = "#/assets";
    this.asset = null;
    this.versions = [];
    this.loading = false;
    this.error = "";
    this.notice = "";
    this.preview = null;
    this.mediaKind = "master";
    this.audioMeta = null;
    this.audioPeaks = null;
    this.audioForm = { start: "", end: "", gain: "" };
    this.audioSaving = false;
    this.cleanupForm = { denoise: true, normalize: true };
    this.cleanupBusy = false;
    this.subtitleBusy = false;
    this.subtitleResult = null;
    this.compareIds = [];
    this.comparePreviews = new Map();
    this._compareSync = new CompareSync();
    this.dependencies = null;
  }

  willUpdate(changed) {
    if (changed.has("assetId")) {
      this._reset();
      this._loadAll();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._revokePreview();
    this._revokeComparePreviews();
  }

  _reset() {
    this.asset = null;
    this.versions = [];
    this.error = "";
    this.notice = "";
    this.preview = null;
    this.audioMeta = null;
    this.audioPeaks = null;
    this.audioForm = { start: "", end: "", gain: "" };
    this.audioSaving = false;
    this.cleanupForm = { denoise: true, normalize: true };
    this.cleanupBusy = false;
    this.subtitleBusy = false;
    this.subtitleResult = null;
    this.compareIds = [];
    this.comparePreviews = new Map();
    this._compareSync?.clear();
    this.dependencies = null;
  }

  _revokePreview() {
    if (this.preview?.url) {
      URL.revokeObjectURL(this.preview.url);
      this.preview = null;
    }
  }

  _revokeComparePreviews() {
    for (const entry of this.comparePreviews?.values() ?? []) {
      if (entry?.url) URL.revokeObjectURL(entry.url);
    }
    this.comparePreviews = new Map();
    this._compareSync?.clear();
  }

  _comparePair() {
    return resolveComparePair(this.versions ?? [], (v) => v.id, this.compareIds);
  }

  _toggleCompare(versionId) {
    this.compareIds = toggleComparePair(this.compareIds, versionId);
    for (const [id, entry] of [...this.comparePreviews]) {
      if (!this.compareIds.includes(id)) {
        if (entry?.url) URL.revokeObjectURL(entry.url);
        this.comparePreviews.delete(id);
      }
    }
    this._loadComparePreviews();
  }

  _clearCompare() {
    this.compareIds = [];
    this._revokeComparePreviews();
  }

  async _loadComparePreviews() {
    const pair = this._comparePair();
    if (!pair) return;
    for (const v of [pair.a, pair.b]) {
      if (this.comparePreviews.has(v.id)) continue;
      this.comparePreviews = new Map(this.comparePreviews.set(v.id, undefined));
      try {
        const preview = await api.getAssetVersionPreviewUrl(this.assetId, v.id);
        if (this.compareIds.includes(v.id)) {
          this.comparePreviews = new Map(this.comparePreviews.set(v.id, preview));
        } else {
          URL.revokeObjectURL(preview.url);
        }
      } catch {
        if (this.compareIds.includes(v.id)) {
          this.comparePreviews = new Map(this.comparePreviews.set(v.id, null));
        }
      }
    }
  }

  _comparePreviewEl(v, key) {
    const entry = this.comparePreviews.get(v.id);
    const type = this.asset?.asset_type;
    if (entry === undefined) return html`<div class="media-slot">loading preview…</div>`;
    if (entry === null) return html`<div class="media-slot">preview unavailable</div>`;
    if (type === "audio") {
      return html`
        <div class="media-slot">
          <audio
            controls
            preload="auto"
            src=${entry.url}
            ref=${(el) => this._compareSync.setPlayer(key, el)}
            @seeked=${(e) => this._compareSync.handleSeeked(e)}
          ></audio>
        </div>
      `;
    }
    if (type === "video") {
      return html`
        <div class="media-slot">
          <video
            controls
            preload="metadata"
            src=${entry.url}
            ref=${(el) => this._compareSync.setPlayer(key, el)}
            @seeked=${(e) => this._compareSync.handleSeeked(e)}
          ></video>
        </div>
      `;
    }
    if (type === "image") {
      return html`<div class="media-slot"><img src=${entry.url} alt="version preview" /></div>`;
    }
    return html`<div class="media-slot">preview for ${type ?? "this type"} is not shown</div>`;
  }

  _renderCompareCol(key, v, label) {
    return html`
      <div class="ab-col">
        <div class="ab-col-top">
          <span class="ab-label">${label}</span>
          <span class="version-id">v${v.version_number}</span>
          ${this.asset?.active_version?.id === v.id ? html`<span class="chip">active</span>` : null}
          <button class="btn btn-secondary" @click=${() => this._toggleCompare(v.id)}>
            Swap out
          </button>
        </div>
        ${this._comparePreviewEl(v, key)}
        ${v.notes ? html`<div class="version-notes">${v.notes}</div>` : ""}
      </div>
    `;
  }

  _renderVersionCompare() {
    const pair = this._comparePair();
    if (!pair) return null;
    const rows = versionCompareRows(pair.a, pair.b);
    const type = this.asset?.asset_type;
    return html`
      <div class="compare-pane">
        <div class="compare-header">
          <span><strong>A/B versions</strong> — two versions side by side</span>
          ${isTimeMedia(type)
            ? html`
              <button class="btn btn-secondary" @click=${() => this._compareSync.play()}>
                Play both
              </button>
              <button class="btn btn-secondary" @click=${() => this._compareSync.pause()}>
                Pause both
              </button>
              <button class="btn btn-secondary" @click=${() => this._compareSync.stop()}>
                Stop both
              </button>
            `
            : null}
          <button
            class="btn btn-secondary"
            style="margin-left:auto"
            @click=${() => this._clearCompare()}
          >
            Close
          </button>
        </div>
        <div class="compare-grid">
          ${this._renderCompareCol("a", pair.a, "A")}
          ${this._renderCompareCol("b", pair.b, "B")}
        </div>
        <table class="cmp-table" aria-label="Version metadata comparison">
          <thead>
            <tr>
              <th>Field</th>
              <th>A — v${pair.a.version_number}</th>
              <th>B — v${pair.b.version_number}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (r) =>
                html`
                  <tr class=${r.differs ? "differs" : ""}>
                    <th>${r.label}</th>
                    <td>${r.a}</td>
                    <td>${r.b}</td>
                  </tr>
                `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  async _loadAll() {
    this.loading = true;
    this.error = "";
    try {
      const [asset, versions] = await Promise.all([
        api.getAsset(this.assetId),
        api.listAssetVersions(this.assetId),
      ]);
      this.asset = asset;
      this.versions = versions;
      await this._loadPreview();
      await this._refreshAudio();
      this._loadDependencies();
    } catch (err) {
      this.error = err.message || "Failed to load asset";
    } finally {
      this.loading = false;
    }
  }

  async _loadDependencies() {
    try {
      this.dependencies = await api.getAssetDependencies(this.assetId);
    } catch {
      this.dependencies = null;
    }
  }

  async _loadPreview() {
    const asset = this.asset;
    this._revokePreview();
    if (!asset?.active_version_id) return;
    this.mediaKind = "master";
    try {
      this.preview = await api.getAssetPreviewUrl(asset.id);
    } catch {
      this.preview = null;
    }
  }

  async _viewProxy() {
    const version = this.asset?.active_version;
    if (!version || !version.proxy_path) return;
    this._revokePreview();
    this.mediaKind = "proxy";
    try {
      this.preview = await api.getAssetProxyUrl(this.asset.id, version.id);
    } catch {
      this.preview = null;
      this.mediaKind = "master";
    }
  }

  async _regenerateProxy() {
    const version = this.asset?.active_version;
    if (!version) return;
    this.error = "";
    try {
      await api.regenerateAssetProxy(this.assetId, version.id);
      this.notice = "Proxy regeneration queued; the job runner will produce it shortly.";
    } catch (err) {
      this.error = err.message || "Failed to queue proxy";
    }
  }

  // --- audio adjustments (non-destructive trim + gain) ---

  _isAudioAsset() {
    return AUDIO_TYPES.includes(this.asset?.asset_type);
  }

  _audioDuration() {
    const d = this.audioMeta?.duration;
    return typeof d === "number" && d > 0 ? d : null;
  }

  async _refreshAudio() {
    this.audioMeta = null;
    this.audioPeaks = null;
    this.audioForm = { start: "", end: "", gain: "" };
    const version = this.asset?.active_version;
    if (!this._isAudioAsset() || !version) return;
    this.audioMeta = parseAudioMetadata(version.technical_metadata_json);
    this._syncAudioForm();
    try {
      const wave = await api.getAudioWaveform(this.assetId, version.id);
      this.audioPeaks = wave?.waveform?.peaks ?? null;
    } catch {
      this.audioPeaks = null;
    }
  }

  _syncAudioForm() {
    this.audioForm = audioFormFromMeta(this.audioMeta);
  }

  _audioFormValues() {
    return validateAudioAdjustments(this.audioForm, this._audioDuration());
  }

  async _saveAudioAdjustments() {
    const version = this.asset?.active_version;
    if (!version || this.audioSaving) return;
    const values = this._audioFormValues();
    if (values.error) {
      this.error = values.error;
      this.notice = "";
      return;
    }
    this.audioSaving = true;
    this.error = "";
    this.notice = "";
    try {
      const result = await api.updateAudioAdjustments(
        this.assetId,
        version.id,
        values,
      );
      this.versions = this.versions.map((v) => v.id === result.version.id ? result.version : v);
      this.asset = { ...this.asset, active_version: result.version };
      this.audioMeta = result.audio ?? null;
      this._syncAudioForm();
      this.notice = "Adjustments saved.";
    } catch (err) {
      this.error = err.message || "Failed to save adjustments";
    } finally {
      this.audioSaving = false;
    }
  }

  _onAudioAdjustSubmit(e) {
    e.preventDefault();
    this._saveAudioAdjustments();
  }

  _onAudioReset() {
    this.audioForm = { start: "", end: "", gain: "" };
    this._saveAudioAdjustments();
  }

  // --- audio cleanup (denoise / normalize → new version) ---

  _onCleanupSubmit(e) {
    e.preventDefault();
    this._runCleanup();
  }

  _pollJob(jobId, timeoutMs, label = "Cleanup") {
    const deadline = Date.now() + timeoutMs;
    return (async () => {
      for (;;) {
        const job = await api.getJob(jobId);
        if (["succeeded", "failed", "cancelled"].includes(job.status)) {
          return job;
        }
        if (Date.now() > deadline) throw new Error(`${label} job timed out`);
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
  }

  async _runCleanup() {
    const version = this.asset?.active_version;
    if (!version || this.cleanupBusy) return;
    const operations = {};
    if (this.cleanupForm.denoise) operations.denoise = true;
    if (this.cleanupForm.normalize) operations.normalize = true;
    if (Object.keys(operations).length === 0) {
      this.error = "Pick at least one cleanup operation.";
      this.notice = "";
      return;
    }
    this.cleanupBusy = true;
    this.error = "";
    this.notice = "";
    try {
      const result = await api.cleanupAudioVersion(
        this.assetId,
        version.id,
        operations,
      );
      const job = await this._pollJob(result.job_id, 180_000);
      if (job.status !== "succeeded") {
        this.error = job.error_text || `Cleanup ended ${job.status}.`;
        return;
      }
      const [asset, versions] = await Promise.all([
        api.getAsset(this.assetId),
        api.listAssetVersions(this.assetId),
      ]);
      this.asset = asset;
      this.versions = versions;
      await this._refreshAudio();
      this.notice = "Cleanup complete — the cleaned version is listed below.";
    } catch (err) {
      this.error = err.message || "Failed to run cleanup";
    } finally {
      this.cleanupBusy = false;
    }
  }

  // --- subtitle generation (transcribe active version → SRT candidates) ---

  async _runSubtitles() {
    const version = this.asset?.active_version;
    if (!version || this.subtitleBusy) return;
    this.subtitleBusy = true;
    this.error = "";
    this.subtitleResult = null;
    try {
      const result = await api.generateSubtitles(this.assetId, version.id);
      const job = await this._pollJob(result.job_id, 180_000, "Transcription");
      if (job.status !== "succeeded") {
        this.error = job.error_text || `Transcription ended ${job.status}.`;
        return;
      }
      this.subtitleResult = {
        job_id: result.job_id,
        asset_id: result.asset_id,
      };
      this.notice = "Subtitles ready — review the candidates on the subtitle asset.";
    } catch (err) {
      this.error = err.message || "Failed to generate subtitles";
    } finally {
      this.subtitleBusy = false;
    }
  }

  _audioWaveform() {
    const peaks = this.audioPeaks;
    if (!Array.isArray(peaks) || peaks.length < 2) {
      return html`<div class="waveform-note">Waveform unavailable.</div>`;
    }
    const step = Math.max(1, Math.ceil(peaks.length / 300));
    const pts = [];
    for (let i = 0; i < peaks.length; i += step) {
      const x = (i / (peaks.length - 1)) * 1000;
      const amp = Math.max(0.04, Math.min(1, Number(peaks[i]) || 0)) * 19;
      pts.push(`${x.toFixed(2)},${(22 - amp).toFixed(2)}`);
      pts.push(`${x.toFixed(2)},${(22 + amp).toFixed(2)}`);
    }
    const duration = this._audioDuration() ?? 0;
    const values = this._audioFormValues();
    let sf = 0;
    let ef = 1;
    if (duration > 0 && !values.error) {
      sf = Math.min(1, Math.max(0, values.trim.start / duration));
      ef = Math.min(1, Math.max(0, values.trim.end / duration));
    }
    return html`
      <svg class="waveform-svg" viewBox="0 0 1000 44" preserveAspectRatio="none"
        aria-label="Audio waveform with trim selection">
        <polyline class="waveform-bars" points=${pts.join(" ")}></polyline>
        ${sf > 0
          ? html`
            <rect class="waveform-dim" x="0" y="0" width=${(sf * 1000).toFixed(
              1,
            )}
              height="44"></rect>
            <line class="waveform-edge" x1=${(sf * 1000).toFixed(1)}
              x2=${(sf * 1000).toFixed(1)} y1="0" y2="44"></line>
          `
          : ""}
        ${ef < 1
          ? html`
            <rect class="waveform-dim" x=${(ef * 1000).toFixed(1)} y="0"
              width=${((1 - ef) * 1000).toFixed(1)} height="44"></rect>
            <line class="waveform-edge" x1=${(ef * 1000).toFixed(1)}
              x2=${(ef * 1000).toFixed(1)} y1="0" y2="44"></line>
          `
          : ""}
      </svg>
    `;
  }

  _onMetadataSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const updates = {};
    for (
      const key of [
        "display_name",
        "description",
        "license",
        "rights_status",
        "attribution",
        "status",
      ]
    ) {
      updates[key] = fd.get(key) || null;
    }
    this.error = "";
    this.notice = "";
    api
      .updateAsset(this.assetId, updates)
      .then((asset) => {
        this.asset = asset;
        this.notice = "Metadata saved.";
      })
      .catch((err) => {
        this.error = err.message || "Failed to save metadata";
      });
  }

  async _onUploadVersion(e) {
    const form = e.target;
    const file = form.file?.files?.[0];
    const notes = form.notes?.value?.trim() || undefined;
    if (!file) return;
    this.error = "";
    this.notice = "Uploading new version...";
    try {
      const result = await api.uploadAsset(this.assetId, file, notes);
      this.asset = result.asset;
      this.versions = await api.listAssetVersions(this.assetId);
      form.reset();
      await this._loadPreview();
      await this._refreshAudio();
      this.notice = `Version ${result.version.version_number} uploaded.`;
    } catch (err) {
      this.error = err.message || "Upload failed";
    }
  }

  async _restoreVersion(version) {
    this.error = "";
    this.notice = "";
    try {
      const result = await api.restoreAssetVersion(this.assetId, version.id);
      this.asset = result.asset;
      this.versions = await api.listAssetVersions(this.assetId);
      await this._loadPreview();
      await this._refreshAudio();
      this.notice = `Restored to version ${version.version_number}.`;
    } catch (err) {
      this.error = err.message || "Restore failed";
    }
  }

  async _addTag(e) {
    e.preventDefault();
    const input = e.target.tag;
    const tag = (input.value || "").trim();
    input.value = "";
    if (!tag) return;
    try {
      const result = await api.addAssetTag(this.assetId, tag);
      this.asset = { ...this.asset, tags: result.tags };
    } catch (err) {
      this.error = err.message || "Failed to add tag";
    }
  }

  async _removeTag(tag) {
    try {
      const result = await api.removeAssetTag(this.assetId, tag);
      this.asset = { ...this.asset, tags: result.tags };
    } catch (err) {
      this.error = err.message || "Failed to remove tag";
    }
  }

  async _addAlias(e) {
    e.preventDefault();
    const input = e.target.alias;
    let alias = (input.value || "").trim();
    if (alias.startsWith("@")) alias = alias.slice(1);
    input.value = "";
    if (!alias) return;
    try {
      const result = await api.addAssetAlias(this.assetId, alias);
      this.asset = { ...this.asset, aliases: result.aliases };
    } catch (err) {
      this.error = err.message || "Failed to add alias";
    }
  }

  async _removeAlias(alias) {
    try {
      const result = await api.removeAssetAlias(this.assetId, alias);
      this.asset = { ...this.asset, aliases: result.aliases };
    } catch (err) {
      this.error = err.message || "Failed to remove alias";
    }
  }

  async _deleteAsset() {
    const deps = (await api.getAssetDependencies(this.assetId).catch(() => null)) ??
      this.dependencies;
    const usedIn = [];
    if (deps) {
      if (deps.totals.timeline_items) {
        usedIn.push(`${deps.totals.timeline_items} timeline item(s)`);
      }
      if (deps.totals.panels) {
        usedIn.push(`${deps.totals.panels} storyboard panel pointer(s)`);
      }
      if (deps.totals.shots) {
        usedIn.push(`${deps.totals.shots} shot clip(s)`);
      }
      if (deps.totals.prompt_references) {
        usedIn.push(`${deps.totals.prompt_references} prompt reference(s)`);
      }
    }
    const message = usedIn.length
      ? `This asset is used in:\n  - ${
        usedIn.join("\n  - ")
      }\n\nDeleting it will leave those references dangling. Delete anyway?`
      : "Delete this asset? No timeline items, panel/shot pointers, or prompt references were found.";
    if (!window.confirm(message)) {
      return;
    }
    try {
      await api.deleteAsset(this.assetId);
      location.hash = this.backHash;
    } catch (err) {
      this.error = err.message || "Delete failed";
    }
  }

  _renderPreview() {
    const asset = this.asset;
    if (!asset) {
      return html`<div class="preview-box"><span>Loading...</span></div>`;
    }
    const version = asset.active_version;
    if (!version) {
      return html`<div class="preview-box"><span>No versions yet.</span></div>`;
    }
    if (!this.preview) {
      return html`<div class="preview-box"><span>No preview available.</span></div>`;
    }
    const type = this.preview.type || version.mime_type || "";
    if (type.startsWith("image/")) {
      return html`<img src=${this.preview.url} alt=${asset.display_name} />`;
    }
    if (type.startsWith("video/")) {
      return html`<video src=${this.preview.url} controls></video>`;
    }
    if (type.startsWith("audio/")) {
      return html`<audio src=${this.preview.url} controls></audio>`;
    }
    return html`<div class="preview-box"><span>No inline preview for ${
      type || "this type"
    }</span></div>`;
  }

  _renderDependencies() {
    const deps = this.dependencies;
    if (!deps) {
      return html`
        <div class="section">
          <h3>Used in</h3>
          <div class="message">Dependency info unavailable.</div>
        </div>
      `;
    }
    if (deps.totals.total === 0) {
      return html`
        <div class="section">
          <h3>Used in</h3>
          <div class="message">
            No timeline items, panel/shot pointers, or prompt references use this
            asset.
          </div>
        </div>
      `;
    }
    const sourceLabels = {
      prompt: "Prompt Studio",
      scene: "Scene",
      shot: "Shot",
      panel: "Storyboard panel",
    };
    return html`
      <div class="section">
        <h3>Used in &middot; ${deps.totals.total} reference(s)</h3>
        ${deps.timeline_items.length
          ? html`
            <div class="dep-group">
              <span class="dep-title">Timeline items</span>
              <ul>
                ${deps.timeline_items.map(
                  (i) =>
                    html`
                      <li>
                        <a href="#/timeline/${i.timeline_id}">${i.timeline_name}</a>
                        <span class="dep-dim">
                                                ${i.track_name} (${i.track_type})
                                              </span>
                      </li>
                    `,
                )}
              </ul>
            </div>
          `
          : ""}
        ${deps.panels.length
          ? html`
            <div class="dep-group">
              <span class="dep-title">Storyboard panels</span>
              <ul>
                ${deps.panels.map(
                  (p) =>
                    html`
                      <li>
                        <a href="#/storyboard/${p.storyboard_id}">
                                                ${p.storyboard_name}
                                              </a>
                        <span class="dep-dim">
                                                panel ${p.shot_number ?? "?"} &middot;
                                                ${p.pointer}
                                              </span>
                      </li>
                    `,
                )}
              </ul>
            </div>
          `
          : ""}
        ${deps.shots.length
          ? html`
            <div class="dep-group">
              <span class="dep-title">Shot clips</span>
              <ul>
                ${deps.shots.map(
                  (s) =>
                    html`
                      <li>
                        <a href="#/scene/${s.scene_id}">${s.scene_name}</a>
                        <span class="dep-dim">shot #${s.shot_order}</span>
                      </li>
                    `,
                )}
              </ul>
            </div>
          `
          : ""}
        ${deps.prompt_references.length
          ? html`
            <div class="dep-group">
              <span class="dep-title">Prompt references</span>
              <ul>
                ${deps.prompt_references.map(
                  (r) =>
                    html`
                      <li>
                        <code>${r.raw_text}</code>
                        <span class="dep-dim">
                                                ${sourceLabels[r.source_type] ?? r.source_type}
                                                ${r.broken ? "· broken" : `· ${r.status}`}
                                              </span>
                      </li>
                    `,
                )}
              </ul>
            </div>
          `
          : ""}
      </div>
    `;
  }

  render() {
    if (this.loading && !this.asset) {
      return html`
        <div class="asset-detail">
          <a class="back-link" href=${this.backHash}>&larr; Back</a>
          <div class="section">Loading asset...</div>
        </div>
      `;
    }

    const asset = this.asset;
    if (this.error && !asset) {
      return html`
        <div class="asset-detail">
          <a class="back-link" href=${this.backHash}>&larr; Back</a>
          <div class="section">
            <div class="message error">${this.error}</div>
          </div>
        </div>
      `;
    }

    const version = asset?.active_version;

    return html`
      <div class="asset-detail">
        <a class="back-link" href=${this.backHash}>&larr; Back to assets</a>

        <div class="detail-header">
          <div>
            <div class="detail-title">${asset.display_name}</div>
            <div class="detail-slug">@${asset.unique_slug}</div>
            <div class="chips">
              <span class="chip">${asset.asset_type}</span>
              <span class="chip">${asset.library_scope}</span>
              ${asset.project_id ? html`<span class="chip">project</span>` : ""}
              <span class="chip">${asset.status}</span>
              ${asset.source_type ? html`<span class="chip">${asset.source_type}</span>` : ""}
            </div>
          </div>
          <div class="preview-actions" style="margin-top:0;">
            <button class="btn btn-danger" @click=${this
              ._deleteAsset}>Delete</button>
          </div>
        </div>

        ${this.error ? html`<div class="message error">${this.error}</div>` : ""}
        ${this.notice ? html`<div class="message ok">${this.notice}</div>` : ""}

        <div class="grid-2">
          <div class="section">
            <h3>Preview</h3>
            <div class="preview-box">${this._renderPreview()}</div>
            ${version
              ? html`
                <div class="preview-meta">
                  <span>v${version.version_number}</span>
                  <span>${version.format ?? "?"}</span>
                  <span>${formatBytes(version.file_size)}</span>
                  <span>${this.mediaKind === "proxy" ? "proxy" : "master"}</span>
                </div>
                <div class="preview-actions">
                  ${version.proxy_path
                    ? html`
                      ${this.mediaKind === "master"
                        ? html`<button class="btn btn-secondary" @click=${this._viewProxy}>View proxy</button>`
                        : html`<button class="btn btn-secondary" @click=${this._loadPreview}>View master</button>`}
                    `
                    : ""}
                  <button class="btn btn-secondary" @click=${this
                    ._regenerateProxy}>
                    Regenerate proxy
                  </button>
                </div>
              `
              : ""}
          </div>

          <div class="section">
            <h3>Metadata</h3>
            <form @submit=${this._onMetadataSubmit}>
              <div class="row">
                <div class="field">
                  <label for="m-name">Display Name</label>
                  <input id="m-name" name="display_name" type="text"
                    .value=${asset.display_name} required />
                </div>
                <div class="field">
                  <label for="m-status">Status</label>
                  <select id="m-status" name="status">
                    ${STATUS_OPTIONS.map(
                      (s) =>
                        html`
                          <option value=${s} ?selected=${asset.status ===
                            s}>${s}</option>
                        `,
                    )}
                  </select>
                </div>
              </div>
              <div class="field">
                <label for="m-desc">Description</label>
                <textarea id="m-desc" name="description" rows="3"
                  .value=${asset.description ?? ""}></textarea>
              </div>
              <div class="row">
                <div class="field">
                  <label for="m-license">License</label>
                  <input id="m-license" name="license" type="text"
                    .value=${asset.license ?? ""} />
                </div>
                <div class="field">
                  <label for="m-rights">Rights Status</label>
                  <input id="m-rights" name="rights_status" type="text"
                    .value=${asset.rights_status ?? ""} />
                </div>
              </div>
              <div class="field">
                <label for="m-attr">Attribution</label>
                <input id="m-attr" name="attribution" type="text"
                  .value=${asset.attribution ?? ""} />
              </div>
              <button type="submit" class="btn">Save Metadata</button>
            </form>

            <h3 style="margin-top:20px;">Upload New Version</h3>
            <form @submit=${this._onUploadVersion}>
              <div class="row">
                <div class="field">
                  <label for="v-file">File</label>
                  <input id="v-file" name="file" type="file"
                    accept="image/*,video/*,audio/*" required />
                </div>
                <div class="field">
                  <label for="v-notes">Notes</label>
                  <input id="v-notes" name="notes" type="text" placeholder="optional" />
                </div>
              </div>
              <button type="submit" class="btn btn-secondary">Upload</button>
            </form>
          </div>
        </div>

        ${this._isAudioAsset() && asset?.active_version
          ? html`
            <div class="section">
              <h3>Audio adjustments</h3>
              <p class="waveform-note">
                Non-destructive: the original file is untouched. Trim and gain are
                applied at render time, so timelines using this version pick them up
                automatically.
              </p>
              ${this._audioWaveform()}
              <form @submit=${this._onAudioAdjustSubmit}>
                <div class="audio-row">
                  <div class="field">
                    <label for="a-start">Trim start (s)</label>
                    <input id="a-start" type="number" step="0.01" min="0" placeholder="0"
                      .value=${this.audioForm.start}
                      @input=${(
                        e,
                      ) => (this.audioForm = {
                        ...this.audioForm,
                        start: e.target.value,
                      })} />
                  </div>
                  <div class="field">
                    <label for="a-end">Trim end (s)</label>
                    <input id="a-end" type="number" step="0.01" min="0"
                      placeholder=${this._audioDuration()?.toFixed(2) ?? "full"}
                      .value=${this.audioForm.end}
                      @input=${(
                        e,
                      ) => (this.audioForm = {
                        ...this.audioForm,
                        end: e.target.value,
                      })} />
                    ${this._audioDuration()
                      ? html`<div class="waveform-note">
                          duration ${this._audioDuration().toFixed(2)} s — leave end
                          empty for the full length</div>`
                      : ""}
                  </div>
                  <div class="field">
                    <label for="a-gain">Gain (dB)</label>
                    <input id="a-gain" type="number" step="0.5" min="-60" max="24"
                      placeholder="0"
                      .value=${this.audioForm.gain}
                      @input=${(
                        e,
                      ) => (this.audioForm = {
                        ...this.audioForm,
                        gain: e.target.value,
                      })} />
                  </div>
                </div>
                <div class="preview-actions" style="margin-top:2px;">
                  <button type="submit" class="btn" ?disabled=${this
                    .audioSaving}>
                    ${this.audioSaving ? "Saving..." : "Save adjustments"}
                  </button>
                  <button type="button" class="btn btn-secondary"
                    ?disabled=${this.audioSaving} @click=${this._onAudioReset}>
                    Reset (full window, 0 dB)
                  </button>
                </div>
              </form>
            </div>
          `
          : ""}

        ${this._isAudioAsset() && asset?.active_version
          ? html`
            <div class="section">
              <h3>Audio cleanup</h3>
              <p class="waveform-note">
                Creates a new version of this asset (the original is kept). Denoise
                runs a spectral-denoise pass; normalize targets -16 LUFS (EBU R128,
                single pass).
              </p>
              <form @submit=${this._onCleanupSubmit}>
                <div class="cleanup-row">
                  <label>
                    <input type="checkbox" name="denoise" .checked=${this
                      .cleanupForm.denoise}
                      @change=${(
                        e,
                      ) => (this.cleanupForm = {
                        ...this.cleanupForm,
                        denoise: e.target.checked,
                      })} />
                    Denoise
                  </label>
                  <label>
                    <input type="checkbox" name="normalize" .checked=${this
                      .cleanupForm.normalize}
                      @change=${(
                        e,
                      ) => (this.cleanupForm = {
                        ...this.cleanupForm,
                        normalize: e.target.checked,
                      })} />
                    Normalize to -16 LUFS
                  </label>
                </div>
                <div class="preview-actions" style="margin-top:2px;">
                  <button type="submit" class="btn"
                    ?disabled=${this.cleanupBusy || this.audioSaving}>
                    ${this.cleanupBusy ? "Cleaning..." : "Run cleanup (new version)"}
                  </button>
                </div>
              </form>
            </div>
          `
          : ""}

        ${this._isAudioAsset() && asset?.active_version
          ? html`
            <div class="section">
              <h3>Subtitle generation</h3>
              <p class="waveform-note">
                Transcribes the active version into SRT candidates stored on a
                fresh subtitle asset — approve or reject them from the review
                board.
              </p>
              <div class="preview-actions">
                <button type="button" class="btn"
                  ?disabled=${this.subtitleBusy || this.audioSaving}
                  @click=${this._runSubtitles}>
                  ${this.subtitleBusy ? "Transcribing..." : "Generate subtitles (new asset)"}
                </button>
              </div>
              ${this.subtitleResult
                ? html`
                  <div class="message">
                    Job <code>${this.subtitleResult.job_id}</code> finished —
                    subtitle asset: <a
                      href="#/asset/${encodeURIComponent(this.subtitleResult.asset_id)}"
                    >open candidates</a>
                  </div>
                `
                : ""}
            </div>
          `
          : ""}

        <div class="grid-2">
          <div class="section">
            <h3>Versions</h3>
            ${this.versions.length === 0 ? html`<div class="message">No versions yet.</div>` : html`
              <div class="versions">
                ${this.versions.map(
                  (v) =>
                    html`
                      <div class="version ${version?.id === v.id ? "active" : ""}">
                        <span class="version-id">v${v.version_number}</span>
                        <span class="version-info">
                          ${v.format ?? "?"} &middot; ${formatBytes(
                            v.file_size,
                          )} &middot;
                          ${v.proxy_path ? "proxy ready" : "no proxy"} &middot;
                          ${v.created_at ? new Date(v.created_at).toLocaleDateString() : ""}
                        </span>
                        <button
                          class="btn btn-secondary cmp-toggle"
                          aria-pressed=${this.compareIds.includes(v.id) ? "true" : "false"}
                          @click=${() => this._toggleCompare(v.id)}
                        >
                          ${this.compareIds.includes(v.id) ? "In A/B" : "A/B"}
                        </button>
                        ${version?.id === v.id ? html`<span class="chip">active</span>` : html`
                          <button class="btn btn-secondary"
                            @click=${() => this._restoreVersion(v)}>Restore</button>
                        `}
                        ${v.notes ? html`<div class="version-notes">${v.notes}</div>` : ""}
                      </div>
                    `,
                )}
              </div>
            `}
            ${this._renderVersionCompare()}
          </div>

          <div>
            <div class="section">
              <h3>Tags</h3>
              <div class="chip-row">
                ${(asset.tags ?? []).map(
                  (t) =>
                    html`
                      <span class="tag-chip">
                        ${t}
                        <button class="remove" @click=${() => this._removeTag(t)}
                          title="Remove tag">&times;</button>
                      </span>
                    `,
                )}
              </div>
              <form class="chip-add" @submit=${this._addTag}>
                <input name="tag" type="text" placeholder="add tag (a-z, 0-9, _)"
                  pattern="[a-z0-9][a-z0-9_+\\-]*" maxlength="40" />
                <button type="submit" class="btn btn-secondary">Add</button>
              </form>
            </div>

            <div class="section" style="margin-top:20px;">
              <h3>Aliases</h3>
              <div class="chip-row">
                ${(asset.aliases ?? []).map(
                  (a) =>
                    html`
                      <span class="tag-chip">
                        @${a}
                        <button class="remove" @click=${() => this._removeAlias(a)}
                          title="Remove alias">&times;</button>
                      </span>
                    `,
                )}
              </div>
              <form class="chip-add" @submit=${this._addAlias}>
                <input name="alias" type="text" placeholder="add alias (a-z, 0-9, _)"
                  pattern="[a-z0-9][a-z0-9_]*" maxlength="64" />
                <button type="submit" class="btn btn-secondary">Add</button>
              </form>
            </div>
          </div>
        </div>

        ${this._renderDependencies()}
      </div>
    `;
  }
}

customElements.define("asset-detail", AssetDetail);
