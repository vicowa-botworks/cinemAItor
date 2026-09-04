import { css, html, LitElement, nothing } from "lit";
import { api } from "../api.js";
import { buildHighlightSegments } from "../reference-styles.js";

// <ref-input> is a drop-in replacement for a prompt <textarea> that renders
// @reference tokens as color-coded pills. The visible text is always a real
// <textarea> (so typing, caret, IME, paste and mobile all behave natively); a
// paint-only backdrop layered behind it draws a rounded pill (solid ring + 50%
// opacity fill) behind each token, and image/video references additionally get
// a small thumbnail before the @ plus a larger hover preview. The component
// owns debounced reference parsing and re-emits a standard `input` event (with
// `value` on the element) so hosts keep using `e.target.value`.
export class RefInput extends LitElement {
  static properties = {
    value: { type: String },
    placeholder: { type: String },
    rows: { type: Number },
    disabled: { type: Boolean },
    name: { type: String },
    _segments: { state: true },
    _thumbs: { state: true },
    _hover: { state: true },
  };

  static styles = css`
    :host {
      display: block;
    }
    .wrapper {
      position: relative;
    }
    .backdrop,
    .ta {
      font-family: inherit;
      font-size: 0.9rem;
      line-height: 1.5;
      letter-spacing: normal;
      tab-size: 4;
      padding: 8px 10px;
      margin: 0;
      border: 1px solid var(--color-border, #2a2a4a);
      border-radius: 6px;
      box-sizing: border-box;
      width: 100%;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      display: block;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      z-index: 0;
      overflow: hidden;
      pointer-events: none;
      border-color: transparent;
      color: transparent;
      background: transparent;
    }
    .ta {
      position: relative;
      z-index: 1;
      background: transparent;
      color: var(--color-text, #eaeaea);
      resize: vertical;
      min-height: calc(1.5em + 16px + 2px);
    }
    .ta:focus {
      outline: none;
      border-color: var(--color-primary, #e94560);
    }
    .ta:disabled {
      opacity: 0.6;
      resize: none;
    }
    .pill {
      position: relative;
      border-radius: 4px;
      padding: 0 1px;
      background: color-mix(in srgb, var(--ref) 50%, transparent);
      box-shadow: 0 0 0 1px var(--ref) inset;
    }
    .pill.missing {
      background: transparent;
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--ref) 55%, transparent) inset;
      border-bottom: 1px dashed var(--ref);
    }
    .icon {
      position: absolute;
      right: 100%;
      top: 50%;
      transform: translateY(-50%);
      margin-right: 3px;
      width: 15px;
      height: 15px;
      object-fit: cover;
      border-radius: 3px;
      border: 1px solid color-mix(in srgb, var(--ref) 70%, #888);
    }
    .preview {
      position: absolute;
      z-index: 3;
      pointer-events: none;
      width: 240px;
      max-width: 60vw;
      background: var(--color-surface, #1a1a2e);
      border: 1px solid var(--color-border, #2a2a4a);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
      overflow: hidden;
    }
    .preview img {
      display: block;
      width: 100%;
      height: auto;
      max-height: 240px;
      object-fit: contain;
      background: #000;
    }
    .preview .caption {
      font-size: 0.75rem;
      padding: 4px 8px;
      color: var(--color-text, #eaeaea);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  constructor() {
    super();
    this.value = "";
    this.rows = 4;
    this._segments = [];
    this._thumbs = {};
    this._hover = null;
    this._lastTokens = [];
    this._parseTimer = null;
    this._fingerprint = "";
    this._inflight = new Set();
    this._ta = null;
    this._backdrop = null;
  }

  // ---- textarea-compatible facade (used by hosts) ----
  get selectionStart() {
    return this._ta ? this._ta.selectionStart : this.value.length;
  }
  get selectionEnd() {
    return this._ta ? this._ta.selectionEnd : this.value.length;
  }
  setSelectionRange(start, end) {
    this._ta?.setSelectionRange(start, end);
  }
  focus(options) {
    this._ta?.focus(options);
  }
  select() {
    this._ta?.select();
  }

  firstUpdated() {
    this._ta = this.renderRoot.querySelector(".ta");
    this._backdrop = this.renderRoot.querySelector(".backdrop");
    if (this._ta && this._ta.value !== this.value) {
      this._ta.value = this.value;
    }
    this._rebuildSegments();
    this._scheduleParse();
  }

  updated(changed) {
    const ta = this._ta;
    if (ta && changed.has("value") && ta.value !== this.value) {
      ta.value = this.value;
      this._rebuildSegments();
      this._scheduleParse();
    }
    this._syncScroll();
    this._ensureThumbs();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    if (this._parseTimer) clearTimeout(this._parseTimer);
    this._revokeThumbs();
  }

  // ---- input handling ----
  _onInput(e) {
    this.value = e.target.value;
    this._rebuildSegments();
    this._scheduleParse();
    this.dispatchEvent(
      new Event("input", { bubbles: true, composed: true }),
    );
  }

  _onChange(e) {
    this.value = e.target.value;
    this.dispatchEvent(
      new Event("change", { bubbles: true, composed: true }),
    );
  }

  _onScroll(e) {
    if (this._backdrop) {
      this._backdrop.scrollTop = e.target.scrollTop;
      this._backdrop.scrollLeft = e.target.scrollLeft;
    }
    this._hover = null;
  }

  _syncScroll() {
    if (this._ta && this._backdrop) {
      this._backdrop.scrollTop = this._ta.scrollTop;
      this._backdrop.scrollLeft = this._ta.scrollLeft;
    }
  }

  // Keep the backdrop in sync with the text on every keystroke, reusing the
  // last parsed tokens but only where the token text is still present, so pills
  // never land on the wrong characters between parses.
  _rebuildSegments() {
    const val = this.value ?? "";
    const tokens = this._lastTokens.filter(
      (t) => val.slice(t.start, t.end) === t.raw,
    );
    this._segments = buildHighlightSegments(val, tokens);
  }

  _scheduleParse() {
    const val = this.value ?? "";
    const fp = val;
    if (this._parseTimer) clearTimeout(this._parseTimer);
    if (fp === "") {
      this._lastTokens = [];
      this._fingerprint = fp;
      this._segments = [];
      return;
    }
    this._parseTimer = setTimeout(() => {
      this._parseTimer = null;
      this._parse(fp);
    }, 350);
  }

  async _parse(text) {
    let result;
    try {
      result = await api.parseReferences({ text });
    } catch {
      return; // keep the last good tokens on a transient failure
    }
    if ((this.value ?? "") !== text) return; // stale response
    const tokens = Array.isArray(result?.tokens) ? result.tokens : [];
    this._lastTokens = tokens;
    this._fingerprint = text;
    this._rebuildSegments();
    this._ensureThumbs();
    this.dispatchEvent(
      new CustomEvent("references", {
        bubbles: true,
        composed: true,
        detail: { tokens, warnings: result?.warnings ?? [] },
      }),
    );
  }

  // ---- thumbnails + hover preview ----
  _thumbKey(seg) {
    return `${seg.assetId}:${seg.versionId ?? "active"}`;
  }

  _ensureThumbs() {
    for (const seg of this._segments) {
      if (seg.type !== "ref" || !seg.visual || !seg.assetId) continue;
      const key = this._thumbKey(seg);
      if (this._thumbs[key] || this._inflight.has(key)) continue;
      this._inflight.add(key);
      const versionId = seg.versionId;
      api
        .getAssetThumbnailUrl(seg.assetId, versionId, 0, 48)
        .then(({ url }) => {
          this._thumbs = { ...this._thumbs, [key]: { icon: url, preview: null } };
        })
        .catch(() => {})
        .finally(() => this._inflight.delete(key));
    }
  }

  _loadPreview(seg) {
    const key = this._thumbKey(seg);
    const existing = this._thumbs[key];
    if (existing?.preview) return existing.preview;
    if (!seg.assetId || this._inflight.has(`preview:${key}`)) return null;
    this._inflight.add(`preview:${key}`);
    api
      .getAssetThumbnailUrl(seg.assetId, seg.versionId, 0, 480)
      .then(({ url }) => {
        const cur = this._thumbs[this._thumbKey(seg)];
        this._thumbs = {
          ...this._thumbs,
          [key]: { icon: cur?.icon ?? url, preview: url },
        };
      })
      .catch(() => {})
      .finally(() => this._inflight.delete(`preview:${key}`));
    return null;
  }

  _revokeThumbs() {
    for (const t of Object.values(this._thumbs)) {
      if (t.icon) URL.revokeObjectURL(t.icon);
      if (t.preview && t.preview !== t.icon) URL.revokeObjectURL(t.preview);
    }
    this._thumbs = {};
    this._inflight.clear();
  }

  _hitTest(e) {
    const wrapper = this.renderRoot.querySelector(".wrapper");
    if (!wrapper) return null;
    const wrapRect = wrapper.getBoundingClientRect();
    const x = e.clientX - wrapRect.left;
    const y = e.clientY - wrapRect.top;
    const pills = this.renderRoot.querySelectorAll(".pill[data-index]");
    for (const pill of pills) {
      const r = pill.getBoundingClientRect();
      const left = r.left - wrapRect.left;
      const right = r.right - wrapRect.left;
      const top = r.top - wrapRect.top;
      const bottom = r.bottom - wrapRect.top;
      const iconPad = 20; // icon sits just left of the pill
      if (x >= left - iconPad && x <= right && y >= top && y <= bottom) {
        const seg = this._segments.find((s) =>
          s.type === "ref" &&
          s.index === Number(pill.dataset.index)
        );
        if (!seg) continue;
        this._hoverSeg = seg;
        const anchorRight = r.right - wrapRect.left;
        const anchorBottom = r.bottom - wrapRect.top;
        return { seg, left: anchorRight, top: anchorBottom };
      }
    }
    return null;
  }

  _onMousemove(e) {
    if (this.disabled) return;
    const hit = this._hitTest(e);
    if (!hit) {
      if (this._hover) this._hover = null;
      return;
    }
    if (hit.seg.visual) this._loadPreview(hit.seg);
    this._hover = {
      index: hit.seg.index,
      left: hit.left,
      top: hit.top,
    };
  }

  _onMouseleave() {
    if (this._hover) this._hover = null;
  }

  render() {
    const segs = this._segments;
    const hoverSeg = this._hover
      ? this._segments.find((s) =>
        s.type === "ref" &&
        s.index === this._hover.index
      )
      : null;
    const hoverThumb = hoverSeg ? this._thumbs[this._thumbKey(hoverSeg)] : null;
    const previewUrl = hoverSeg?.visual ? (hoverThumb?.preview ?? null) : null;
    const previewLoading = hoverSeg?.visual && !previewUrl;

    return html`
      <div class="wrapper">
        <div class="backdrop" aria-hidden="true">
          ${segs.map((seg) =>
            seg.type === "text" ? seg.text : html`
              <span
                class="pill ${seg.status === "missing" ? "missing" : ""}"
                data-index=${seg.index}
                style="--ref:${seg.color}"
              >${seg.visual && this._thumbs[this._thumbKey(seg)]?.icon
                ? html`
                  <img
                    class="icon"
                    src=${this._thumbs[this._thumbKey(seg)].icon}
                    alt=""
                    ?disabled=${this.disabled}
                  >
                `
                : nothing}${seg.raw}</span>
            `
          )}${"\n"}
        </div>
        <textarea
          class="ta"
          .value=${this.value}
          placeholder=${this.placeholder ?? nothing}
          rows=${this.rows ?? 4}
          ?disabled=${this.disabled}
          name=${this.name ?? nothing}
          @input=${this._onInput}
          @change=${this._onChange}
          @scroll=${this._onScroll}
          @mousemove=${this._onMousemove}
          @mouseleave=${this._onMouseleave}></textarea>
        ${hoverSeg
          ? html`
            <div
              class="preview"
              style="left:${this._hover.left}px;top:${this._hover.top}px"
            >
                          ${previewUrl ? html`<img src=${previewUrl} alt="">` : previewLoading
                            ? html`
                              <div
                                class="caption"
                                style="padding:24px;text-align:center"
                              >Loading…</div>
                            `
                            : nothing}
                          <div class="caption">@${hoverSeg.slug}</div>
                        </div>
          `
          : nothing}
      </div>
    `;
  }
}

customElements.define("ref-input", RefInput);
