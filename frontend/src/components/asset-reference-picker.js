import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import { IMAGE_ASSET_TYPES, isImageAssetType, VIDEO_ASSET_TYPES } from "./asset-generation.js";

const MAX_REFERENCES = 8;

/**
 * Pick existing image/video assets to attach as generation references.
 * Selections use the ACTIVE version of each asset (the backend default).
 *
 * Events: "change" → detail.references = [{ asset_id }]
 */
export class AssetReferencePicker extends LitElement {
  static styles = css`
    .picker {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      padding: 3px 10px;
      border-radius: 12px;
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .chip button {
      border: none;
      background: none;
      color: var(--color-text-muted);
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 0;
    }

    .chip button:hover {
      color: var(--color-error);
    }

    .list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 10px;
      max-height: 300px;
      overflow-y: auto;
    }

    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 6px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background-color: var(--color-surface);
      cursor: pointer;
    }

    .row:hover {
      border-color: var(--color-primary);
    }

    .row.selected {
      border-color: var(--color-primary);
      background-color: var(--color-surface-hover);
    }

    .row.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .thumb {
      width: 42px;
      height: 42px;
      flex: none;
      border-radius: calc(var(--radius) - 2px);
      overflow: hidden;
      background: var(--color-surface-hover);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-muted);
    }

    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .thumb svg {
      width: 20px;
      height: 20px;
      opacity: 0.5;
    }

    .row-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .row-name {
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .row-slug {
      font-size: 11px;
      color: var(--color-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .hint {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
    }
  `;

  static properties = {
    kind: {},
    excludeAssetId: {},
    selected: { state: true },
    loading: { state: true },
    error: { state: true },
    _candidates: { state: true },
  };

  constructor() {
    super();
    this.kind = null; // "image" | "video" | null (any media)
    this.excludeAssetId = null;
    this.selected = [];
    this.loading = false;
    this.error = "";
    this._candidates = [];
    this._thumbs = new Map();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    for (const url of this._thumbs.values()) {
      if (url) URL.revokeObjectURL(url);
    }
    this._thumbs = new Map();
  }

  firstUpdated() {
    this._load();
  }

  _candidateTypes() {
    if (this.kind === "image") return IMAGE_ASSET_TYPES;
    if (this.kind === "video") return VIDEO_ASSET_TYPES;
    return [...IMAGE_ASSET_TYPES, ...VIDEO_ASSET_TYPES];
  }

  async _load() {
    this.loading = true;
    this.error = "";
    try {
      const assets = await api.listAssets({ limit: 200 });
      const types = this._candidateTypes();
      this._candidates = (assets ?? []).filter(
        (a) =>
          types.includes(a.asset_type) &&
          a.active_version_id &&
          a.id !== this.excludeAssetId,
      );
    } catch (err) {
      this.error = err.message || "Could not load assets";
    } finally {
      this.loading = false;
    }
  }

  _isSelected(assetId) {
    return this.selected.some((r) => r.asset_id === assetId);
  }

  _atLimit() {
    return this.selected.length >= MAX_REFERENCES;
  }

  async _ensureThumb(asset) {
    const cached = this._thumbs.get(asset.id);
    if (cached !== undefined) return cached;
    let url = null;
    if (isImageAssetType(asset.asset_type)) {
      try {
        const media = await api.getAssetPreviewUrl(asset.id);
        url = media.type?.startsWith("image/") ? media.url : null;
      } catch {
        url = null;
      }
    }
    this._thumbs.set(asset.id, url);
    return url;
  }

  _toggle(asset) {
    if (this._isSelected(asset.id)) {
      this.selected = this.selected.filter((r) => r.asset_id !== asset.id);
    } else {
      if (this._atLimit()) return;
      this.selected = [...this.selected, { asset_id: asset.id }];
    }
    this._emit();
  }

  _removeSelected(assetId) {
    this.selected = this.selected.filter((r) => r.asset_id !== assetId);
    this._emit();
  }

  _emit() {
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { references: this.selected },
        bubbles: true,
      }),
    );
  }

  _icon() {
    return html`
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path
          d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm4-1v3m8-3v3M4 9h16M9 21v-3m6 3v-3" />
      </svg>
    `;
  }

  async _renderRows() {
    // Ensure thumbnails are resolved before rendering rows.
    for (const a of this._candidates) {
      if (!this._thumbs.has(a.id)) {
        await this._ensureThumb(a);
      }
    }
    if (!this.isConnected) return html``;
    if (this._candidates.length === 0) {
      return html`<div class="hint">
        No image or video assets with an active version yet.
      </div>`;
    }
    return html`
      <div class="list">
        ${this._candidates.map(
          (a) => {
            const selected = this._isSelected(a.id);
            const disabled = !selected && this._atLimit();
            return html`
              <div class="row ${selected ? "selected" : ""} ${disabled ? "disabled" : ""}"
                role="button"
                aria-pressed=${selected ? "true" : "false"}
                @click=${() => this._toggle(a)}>
                <div class="thumb">
                  ${this._thumbs.get(a.id)
                    ? html`
                      <img
                        src=${this._thumbs.get(a.id)}
                        alt=${a.display_name} />
                    `
                    : this._icon()}
                </div>
                <div class="row-info">
                  <span class="row-name">${a.display_name}</span>
                  <span class="row-slug">@${a.unique_slug}</span>
                </div>
              </div>
            `;
          },
        )}
      </div>
    `;
  }

  render() {
    return html`
      <div class="picker">
        ${this.selected.length
          ? html`
            <div class="chips">
              ${this.selected.map((ref) => {
                const asset = this._candidates.find((c) => c.id === ref.asset_id);
                return html`
                  <span class="chip" key=${ref.asset_id}>
                    ${asset ? `@${asset.unique_slug}` : ref.asset_id}
                    <button type="button" title="Remove reference"
                      @click=${(e) => {
                        e.stopPropagation();
                        this._removeSelected(ref.asset_id);
                      }}>&times;</button>
                  </span>
                `;
              })}
            </div>
          `
          : ""}
        ${this.error ? html`<div class="error">${this.error}</div>` : ""}
        ${this.loading
          ? html`<div class="hint">Loading assets...</div>`
          : html`${await this._renderRows()}`}
        <div class="hint">
          Up to ${MAX_REFERENCES} references — the active version of each
          asset is used.
        </div>
      </div>
    `;
  }
}

customElements.define("asset-reference-picker", AssetReferencePicker);
