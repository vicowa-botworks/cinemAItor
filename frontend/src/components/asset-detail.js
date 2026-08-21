import { css, html, LitElement } from "lit";
import { api } from "../api.js";

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

    .danger-zone {
      border-color: var(--color-error);
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
  }

  _reset() {
    this.asset = null;
    this.versions = [];
    this.error = "";
    this.notice = "";
    this.preview = null;
  }

  _revokePreview() {
    if (this.preview?.url) {
      URL.revokeObjectURL(this.preview.url);
      this.preview = null;
    }
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
    } catch (err) {
      this.error = err.message || "Failed to load asset";
    } finally {
      this.loading = false;
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
    if (!window.confirm("Delete this asset? References to it will dangle.")) {
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
    if (!asset) return html`<div class="preview-box"><span>Loading...</span></div>`;
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
            <button class="btn btn-danger" @click=${this._deleteAsset}>Delete</button>
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
                  <button class="btn btn-secondary" @click=${this._regenerateProxy}>
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
                          <option value=${s} ?selected=${asset.status === s}>${s}</option>
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
                          ${v.format ?? "?"} &middot; ${formatBytes(v.file_size)} &middot;
                          ${v.proxy_path ? "proxy ready" : "no proxy"} &middot;
                          ${v.created_at ? new Date(v.created_at).toLocaleDateString() : ""}
                        </span>
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
      </div>
    `;
  }
}

customElements.define("asset-detail", AssetDetail);
