import { css, html, LitElement } from "lit";
import { api } from "../api.js";

export class AssetCard extends LitElement {
  static styles = css`
    .card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      overflow: hidden;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
      border-color: var(--color-primary);
    }

    .thumb {
      width: 100%;
      height: 130px;
      background: linear-gradient(135deg, var(--color-surface-hover),
        var(--color-border));
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-muted);
      overflow: hidden;
    }

    .thumb svg {
      width: 38px;
      height: 38px;
      opacity: 0.5;
    }

    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .card-content {
      padding: 14px 16px 16px;
    }

    .card-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .card-slug {
      font-size: 12px;
      color: var(--color-primary);
      margin-bottom: 8px;
      word-break: break-all;
    }

    .chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .chip {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
    }

    .chip.status-approved {
      color: #7bc47f;
    }

    .chip.status-rejected {
      color: var(--color-error);
    }

    .card-updated {
      margin-top: 8px;
      font-size: 12px;
      color: var(--color-text-muted);
    }
  `;

  static properties = {
    asset: { type: Object },
    thumb: { state: true },
  };

  constructor() {
    super();
    this.asset = null;
    this.thumb = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._revokeThumb();
  }

  _revokeThumb() {
    if (this.thumb) {
      URL.revokeObjectURL(this.thumb);
      this.thumb = null;
    }
  }

  async _loadThumb() {
    const asset = this.asset;
    this._revokeThumb();
    if (!asset || !asset.active_version_id) return;
    try {
      const media = await api.getAssetPreviewUrl(asset.id);
      // Bail if the card was recycled to a different asset meanwhile.
      if (!this.isConnected || this.asset !== asset) {
        URL.revokeObjectURL(media.url);
        return;
      }
      this.thumb = media.type?.startsWith("image/") ? media.url : null;
    } catch {
      // No preview available; the placeholder icon stays.
    }
  }

  willUpdate(changed) {
    if (changed.has("asset")) {
      this._loadThumb();
    }
  }

  _formatUpdated() {
    if (!this.asset?.updated_at) return "";
    const date = new Date(this.asset.updated_at);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString();
  }

  render() {
    const a = this.asset;
    if (!a) return null;

    return html`
      <div class="card" @click=${this._click}>
        <div class="thumb">
          ${this.thumb
            ? html`<img src=${this.thumb} alt=${a.display_name} />`
            : this._thumbPlaceholder()}
        </div>
        <div class="card-content">
          <div class="card-title">${a.display_name}</div>
          <div class="card-slug">@${a.unique_slug}</div>
          <div class="chips">
            <span class="chip">${a.asset_type}</span>
            <span class="chip">${a.library_scope}</span>
            <span class="chip status-${a.status}">${a.status}</span>
          </div>
          ${this._formatUpdated()
            ? html`<div class="card-updated">Updated ${this._formatUpdated()}</div>`
            : ""}
        </div>
      </div>
    `;
  }

  _thumbPlaceholder() {
    return html`
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.5">
        <path
          d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm4-1v3m8-3v3M4 9h16M9 21v-3m6 3v-3" />
      </svg>
    `;
  }

  _click() {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        detail: this.asset.id,
        bubbles: true,
      }),
    );
  }
}

customElements.define("asset-card", AssetCard);
