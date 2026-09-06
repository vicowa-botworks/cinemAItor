import { css, html, LitElement, nothing } from "lit";
import { api } from "../api.js";
import { buildHighlightSegments } from "../reference-styles.js";

// <ref-input> is a drop-in replacement for a prompt <textarea> that renders
// @reference tokens as color-coded chips. The visible text is a real,
// editable <div contenteditable> so typing, caret, IME, paste and mobile all
// behave natively; each @reference is an inline <span class="chip"> that
// carries an optional thumbnail BEFORE the @ (an in-flow <img>, so it reserves
// its own space and never overlaps the surrounding text) plus a larger hover
// preview. Because the chips are part of the real text flow there is no
// separate highlight layer to keep in sync. The component owns debounced
// reference parsing and re-emits standard `input`/`change` events (with
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
    .ed {
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
      color: var(--color-text, #eaeaea);
      outline: none;
      caret-color: var(--color-primary, #e94560);
    }
    .ed:focus {
      border-color: var(--color-primary, #e94560);
    }
    .ed[contenteditable="false"] {
      opacity: 0.6;
      cursor: default;
    }
    .ed:empty::before {
      content: attr(data-placeholder);
      color: var(--color-muted, #666);
      pointer-events: none;
    }
    .chip {
      position: relative;
      border-radius: 4px;
      padding: 0 2px;
      background: color-mix(in srgb, var(--ref) 50%, transparent);
      box-shadow: 0 0 0 1px var(--ref) inset;
    }
    .chip.missing {
      background: transparent;
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--ref) 55%, transparent)
        inset;
      border-bottom: 1px dashed var(--ref);
    }
    .icon {
      display: inline-block;
      width: 15px;
      height: 15px;
      object-fit: cover;
      border-radius: 3px;
      border: 1px solid color-mix(in srgb, var(--ref) 70%, #888);
      vertical-align: middle;
      margin-right: 3px;
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
    this._inflight = new Set();
    this._ed = null;
    this._pendingCaret = null;
    this._focusValue = null;
  }

  // ---- textarea-compatible facade (used by hosts) ----
  get selectionStart() {
    return this._selectionOffset();
  }
  get selectionEnd() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return this.value.length;
    return this._rangeOffset(
      sel.getRangeAt(0).endContainer,
      sel.getRangeAt(0).endOffset,
    );
  }
  setSelectionRange(start, end) {
    const ed = this._ed;
    if (!ed || this.disabled) return;
    if (end == null) end = start;
    ed.focus();
    this._setCaretRange(start, end);
  }
  focus(options) {
    this._ed?.focus(options);
  }
  select() {
    const ed = this._ed;
    if (!ed || this.disabled) return;
    ed.focus();
    const range = document.createRange();
    range.selectNodeContents(ed);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  firstUpdated() {
    this._ed = this.renderRoot.querySelector(".ed");
    this._rebuildSegments();
    this._renderEditable();
    this._scheduleParse();
  }

  updated(changed) {
    // Rebuild the token-filtered segments whenever the value changes. Gated on
    // `value` (not `_segments`) so the resulting `_segments` update does not
    // re-trigger this and loop. Also re-schedule the (debounced) parse here so
    // a PROGRAMMATIC `el.value = …` assignment still triggers reference
    // parsing: user typing goes through `_commitValue` (which schedules it),
    // but a host setting `value` directly only fires `updated`, and without
    // this the parse would never run and no chips would render.
    if (changed.has("value")) {
      this._rebuildSegments();
      this._scheduleParse();
    }
    if (
      changed.has("_segments") ||
      changed.has("_thumbs") ||
      changed.has("value") ||
      changed.has("placeholder") ||
      changed.has("rows") ||
      changed.has("disabled")
    ) {
      this._renderEditable();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    if (this._parseTimer) clearTimeout(this._parseTimer);
    this._revokeThumbs();
  }

  // ---- editing ----
  // Plain text of the editable DOM, treating <br> as a newline. The DOM is kept
  // flat (chips are inline spans, no block structure) so this is the value.
  _plainText(node) {
    let out = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) out += child.nodeValue;
      else if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "BR") {
        out += "\n";
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        out += this._plainText(child);
      }
    }
    return out;
  }

  // Extract the value, normalizing the contenteditable "deleted to empty" case
  // where the browser leaves a lone <br> that would otherwise read back as "\n".
  _extractValue(ed) {
    const val = this._plainText(ed);
    const hasRealText = Array.from(ed.childNodes).some((n) =>
      n.nodeType === Node.TEXT_NODE
        ? n.nodeValue.length > 0
        : n.nodeType === Node.ELEMENT_NODE && n.tagName !== "BR"
        ? n.textContent.length > 0
        : false
    );
    return val === "\n" && !hasRealText ? "" : val;
  }

  _commitValue(ed, caret) {
    this._pendingCaret = caret;
    this.value = this._extractValue(ed);
    this._rebuildSegments();
    this._scheduleParse();
  }

  _emit(type) {
    this.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  }

  _onInput(e) {
    if (this.disabled || e.isComposing) return;
    const ed = e.target;
    this._commitValue(ed, this._selectionOffset());
    this._emit("input");
  }

  _onCompositionend(e) {
    if (this.disabled) return;
    this._commitValue(e.target, this._selectionOffset());
    this._emit("input");
  }

  _onKeydown(e) {
    if (this.disabled) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const start = this.selectionStart;
      const end = this.selectionEnd;
      const val = this.value;
      this._pendingCaret = start + 1;
      this.value = val.slice(0, start) + "\n" + val.slice(end);
      this._rebuildSegments();
      this._scheduleParse();
      this._emit("input");
    }
  }

  _onPaste(e) {
    if (this.disabled) return;
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") ?? "").replace(
      /\r\n?/g,
      "\n",
    );
    if (!text) return;
    const start = this.selectionStart;
    const end = this.selectionEnd;
    const val = this.value;
    this._pendingCaret = start + text.length;
    this.value = val.slice(0, start) + text + val.slice(end);
    this._rebuildSegments();
    this._scheduleParse();
    this._emit("input");
  }

  _onFocus() {
    this._focusValue = this.value;
  }

  _onBlur() {
    if (this.value !== this._focusValue) this._emit("change");
    if (this._hover) this._hover = null;
  }

  // ---- caret <-> offset mapping ----
  // The editable is flat text (chips contribute their @slug text, icons none),
  // so a Range's text length equals the caret offset in the value.
  _rangeOffset(container, offset) {
    const ed = this._ed;
    if (!ed) return 0;
    const pre = document.createRange();
    pre.selectNodeContents(ed);
    try {
      pre.setEnd(container, offset);
    } catch {
      return this.value.length;
    }
    return pre.toString().length;
  }

  _selectionOffset() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return this.value.length;
    const r = sel.getRangeAt(0);
    return this._rangeOffset(r.startContainer, r.startOffset);
  }

  // Find the (text node, in-node offset) that corresponds to a char position.
  _nodeAndOffset(pos) {
    const ed = this._ed;
    if (!ed) return null;
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let remaining = pos;
    let node;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue.length;
      if (remaining <= len) return { node, offset: remaining };
      remaining -= len;
    }
    const last = this._lastTextNode(ed);
    if (last) return { node: last, offset: last.nodeValue.length };
    return { node: ed, offset: 0 };
  }

  _lastTextNode(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let last = null;
    let n;
    while ((n = walker.nextNode())) last = n;
    return last;
  }

  _setCaretRange(start, end) {
    const ed = this._ed;
    const sel = window.getSelection();
    if (!ed || !sel) return;
    const s = Math.max(0, Math.min(start, this.value.length));
    const e2 = Math.max(0, Math.min(end ?? start, this.value.length));
    const sp = this._nodeAndOffset(s);
    const ep = this._nodeAndOffset(e2);
    if (!sp || !ep) return;
    const range = document.createRange();
    try {
      range.setStart(sp.node, sp.offset);
      range.setEnd(ep.node, ep.offset);
    } catch {
      return;
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---- segments ----
  // Keep the chips in sync with the text on every edit, reusing the last parsed
  // tokens but only where the token text is still present, so chips never land
  // on the wrong characters between parses.
  _rebuildSegments() {
    const val = this.value ?? "";
    const tokens = this._lastTokens.filter(
      (t) => val.slice(t.start, t.end) === t.raw,
    );
    this._segments = buildHighlightSegments(val, tokens);
  }

  _scheduleParse() {
    const val = this.value ?? "";
    if (this._parseTimer) clearTimeout(this._parseTimer);
    if (val === "") {
      this._lastTokens = [];
      this._segments = [];
      return;
    }
    this._parseTimer = setTimeout(() => {
      this._parseTimer = null;
      this._parse(val);
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
          this._thumbs = {
            ...this._thumbs,
            [key]: { icon: url, preview: null },
          };
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

  _onMousemove(e) {
    if (this.disabled) return;
    const target = e.target;
    const chip = target instanceof Element ? target.closest(".chip[data-index]") : null;
    if (!chip) {
      if (this._hover) this._hover = null;
      return;
    }
    const seg = this._segments.find(
      (s) => s.type === "ref" && s.index === Number(chip.dataset.index),
    );
    if (!seg) return;
    if (seg.visual) this._loadPreview(seg);
    const wrapper = this.renderRoot.querySelector(".wrapper");
    const wrapRect = wrapper.getBoundingClientRect();
    const r = chip.getBoundingClientRect();
    this._hover = {
      index: seg.index,
      left: r.right - wrapRect.left,
      top: r.bottom - wrapRect.top,
    };
  }

  _onMouseleave() {
    if (this._hover) this._hover = null;
  }

  // ---- editable content ----
  // The editable's inner HTML: escaped plain text plus one inline chip per
  // @reference token. Chips (and their thumbnail <img>) are in normal flow so
  // they reserve their own space. Built as a string + `.innerHTML` to emit zero
  // stray whitespace.
  _editableHtml() {
    const esc = (s) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    let s = "";
    for (const seg of this._segments) {
      if (seg.type === "text") {
        s += esc(seg.text);
        continue;
      }
      const thumb = this._thumbs[this._thumbKey(seg)];
      const icon = seg.visual && thumb?.icon
        ? `<img class="icon" src="${esc(thumb.icon)}" alt="">`
        : "";
      s += `<span class="chip${
        seg.status === "missing" ? " missing" : ""
      }" data-index="${seg.index}" style="--ref:${seg.color}">${icon}${esc(seg.raw)}</span>`;
    }
    return s;
  }

  // Re-render the editable DOM from the segments, preserving the caret.
  _renderEditable() {
    const ed = this._ed;
    if (!ed) return;
    const explicit = this._pendingCaret;
    this._pendingCaret = null;
    const hadFocus = document.activeElement === ed;
    const restoreTo = explicit != null ? explicit : hadFocus ? this._selectionOffset() : null;
    ed.innerHTML = this._editableHtml();
    if (restoreTo != null && !this.disabled) {
      this._setCaretRange(restoreTo, restoreTo);
    }
  }

  render() {
    const hoverSeg = this._hover
      ? this._segments.find((s) => s.type === "ref" && s.index === this._hover.index)
      : null;
    const hoverThumb = hoverSeg ? this._thumbs[this._thumbKey(hoverSeg)] : null;
    const previewUrl = hoverSeg?.visual ? (hoverThumb?.preview ?? null) : null;
    const previewLoading = hoverSeg?.visual && !previewUrl;
    const rows = this.rows ?? 4;

    return html`
      <div
        class="wrapper"
        @mousemove=${this._onMousemove}
        @mouseleave=${this._onMouseleave}
      >
        <div
          class="ed"
          .contentEditable=${this.disabled ? "false" : "true"}
          role="textbox"
          aria-multiline="true"
          data-placeholder=${this.placeholder ?? ""}
          style="min-height:calc(${rows} * 1.35rem + 18px)"
          @input=${this._onInput}
          @compositionend=${this._onCompositionend}
          @keydown=${this._onKeydown}
          @paste=${this._onPaste}
          @focus=${this._onFocus}
          @blur=${this._onBlur}></div>
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
