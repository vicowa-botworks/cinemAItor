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
    _mention: { state: true },
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

    .mention {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      margin-top: 4px;
      z-index: 4;
      background: var(--color-surface, #1a1a2e);
      border: 1px solid var(--color-border, #2a2a4a);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
      max-height: 260px;
      overflow-y: auto;
      padding: 4px;
    }
    .mention-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
      color: var(--color-text, #eaeaea);
    }
    .mention-item.active,
    .mention-item:hover {
      background: color-mix(in srgb, var(--color-primary, #e94560) 22%,
        transparent);
    }
    .mention-slug {
      font-weight: 600;
      color: var(--color-primary, #e94560);
    }
    .mention-name {
      color: var(--color-muted, #888);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mention-empty {
      padding: 8px;
      color: var(--color-muted, #888);
      font-size: 0.85rem;
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
    this._lastCaretOffset = -1;
    this._lastCaretValue = null;
    this._renderedChipSig = "[]";
    // True right after a native keystroke committed the value. The browser has
    // already updated the editable DOM and positioned the caret, so `updated()`
    // must NOT rebuild innerHTML for it (a rebuild would reset the caret). A
    // programmatic value set (host, Enter, paste, mention) leaves this false.
    this._nativeEdit = false;
    this._focusValue = null;
    this._mention = {
      open: false,
      start: -1,
      prefix: "",
      items: [],
      activeIndex: 0,
      loading: false,
    };
    this._mentionSeq = 0;
    this._mentionAutoTimer = null;
  }

  // ---- textarea-compatible facade (used by hosts) ----
  get selectionStart() {
    return this._selectionOffset();
  }
  get selectionEnd() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return this.value.length;
    const r = sel.getRangeAt(0);
    const ed = this._ed;
    if (ed && ed.contains(r.endContainer)) {
      return this._rangeOffset(r.endContainer, r.endOffset);
    }
    return document.activeElement === this ? this.value.length : 0;
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
    // parsing: user typing goes through `_commitValue` (which sets `value`),
    // but a host setting `value` directly only fires `updated`, and without
    // this the parse would never run and no chips would render.
    let nativeEdit = false;
    if (changed.has("value")) {
      nativeEdit = this._nativeEdit;
      this._nativeEdit = false;
      this._rebuildSegments();
      this._scheduleParse();
    }
    // Rebuild the editable DOM ONLY when it is genuinely out of sync — never on
    // a plain native keystroke, because replacing `innerHTML` destroys the
    // browser's live selection and makes the caret jump. Three cases need a
    // rebuild:
    //   structural  — thumbnails / placeholder / rows / disabled changed;
    //   chipsChanged — a parse landed, so a reference chip appeared or
    //                  disappeared (`_segments` changed AND its chip signature
    //                  differs from what is rendered — plain text edits keep
    //                  the signature the same and skip);
    //   staleDom    — the value was set PROGRAMMATICALLY (a host `el.value = …`,
    //                  the Enter / Paste handlers, or a mention insertion), not
    //                  by a native keystroke. A native keystroke already
    //                  rewrote the editable in place (DOM + caret), so a rebuild
    //                  would only reset the caret. We track this with a flag set
    //                  in the input handlers rather than comparing live DOM text,
    //                  because real-browser contenteditable DOM can drift
    //                  between the input read and this microtask read.
    const structural = changed.has("_thumbs") ||
      changed.has("placeholder") ||
      changed.has("rows") ||
      changed.has("disabled");
    const chipsChanged = changed.has("_segments") && this._chipsChanged();
    const staleDom = changed.has("value") && !nativeEdit && this._ed != null;
    if (structural || chipsChanged || staleDom) {
      this._renderEditable();
    }
  }

  _chipSig(segs) {
    return JSON.stringify(
      (segs || []).filter((s) => s.type === "ref").map((
        s,
      ) => [s.index, s.label]),
    );
  }

  _chipsChanged() {
    return this._chipSig(this._segments) !== this._renderedChipSig;
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

  _commitValue(ed) {
    // Only push the value; `updated()` handles the segment rebuild + the
    // debounced parse. The editable DOM itself is NOT rebuilt here — the
    // browser already holds the freshly-typed text and its caret, and we only
    // replace `innerHTML` when a reference chip actually appears/disappears
    // (see `updated` + `_chipsChanged`).
    this.value = this._extractValue(ed);
  }

  _emit(type) {
    this.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  }

  _onInput(e) {
    if (this.disabled || e.isComposing) return;
    this._commitValue(e.target);
    // This came from a native keystroke: the browser already rewrote the
    // editable (DOM + caret), so `updated()` must not rebuild it.
    this._nativeEdit = true;
    // Capture the caret now, while the browser's selection is trustworthy
    // (immediately after the native edit). A later chip rebuild restores from
    // this instead of the live selection, which is unreliable once innerHTML
    // is swapped in the same tick.
    this._lastCaretOffset = this._selectionOffset();
    this._lastCaretValue = this.value;
    this._emit("input");
    this._detectMention();
  }

  _onCompositionend(e) {
    if (this.disabled) return;
    this._commitValue(e.target);
    this._nativeEdit = true;
    this._lastCaretOffset = this._selectionOffset();
    this._lastCaretValue = this.value;
    this._emit("input");
  }

  _onKeydown(e) {
    if (this.disabled) return;
    const m = this._mention;
    if (m?.open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (m.items.length) {
          const n = m.items.length;
          this._mention = { ...m, activeIndex: (m.activeIndex + 1) % n };
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (m.items.length) {
          const n = m.items.length;
          this._mention = { ...m, activeIndex: (m.activeIndex - 1 + n) % n };
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this._closeMention();
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && m.items.length) {
        e.preventDefault();
        this._acceptMention(m.activeIndex);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const start = this.selectionStart;
      const end = this.selectionEnd;
      const val = this.value;
      // The inserted newline shifts the caret target past the current
      // selection, so carry the desired offset explicitly; `updated()`
      // rebuilds the DOM (its text no longer matches) and restores it there.
      this._pendingCaret = start + 1;
      this.value = val.slice(0, start) + "\n" + val.slice(end);
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
    // Carry the caret target (after the pasted text); `updated()` rebuilds
    // the DOM and restores the caret there.
    this._pendingCaret = start + text.length;
    this.value = val.slice(0, start) + text + val.slice(end);
    this._emit("input");
  }

  _onFocus() {
    this._focusValue = this.value;
    this._lastCaretOffset = this._selectionOffset();
    this._lastCaretValue = this.value;
  }

  _onBlur() {
    if (this.value !== this._focusValue) this._emit("change");
    if (this._hover) this._hover = null;
    this._closeMention();
  }

  // ---- @-mention autocomplete ----

  // Detect an active `@prefix` fragment at the caret and open/refresh the
  // suggestion popup. Runs on input so a plain `@` (or `@part`) shows matches
  // as the user types, with no separate click-to-picker step.
  _detectMention() {
    if (this.disabled) return this._closeMention();
    const val = this.value ?? "";
    const caret = this._selectionOffset();
    const lo = Math.max(0, caret - 64);
    const atRel = val.slice(lo, caret).lastIndexOf("@");
    if (atRel === -1) return this._closeMention();
    const at = lo + atRel;
    // A mention starts only at a token boundary — the char before `@` must not
    // be a word char (keeps `user@domain` and existing chip slugs inert).
    if (at > 0 && /[a-z0-9_@]/i.test(val[at - 1])) return this._closeMention();
    if (this._lastTokens.some((t) => t.start === at)) {
      return this._closeMention();
    }
    const prefix = val.slice(at + 1, caret);
    if (!/^[a-z0-9_]*$/.test(prefix)) return this._closeMention();
    if (
      this._mention.open &&
      this._mention.start === at &&
      this._mention.prefix === prefix
    ) {
      return; // already showing this exact fragment
    }
    this._mention = {
      ...this._mention,
      open: true,
      start: at,
      prefix,
      activeIndex: 0,
      loading: true,
    };
    this._fetchMention(prefix);
  }

  async _fetchMention(prefix) {
    const seq = ++this._mentionSeq;
    this._clearMentionAuto();
    try {
      const assets = await api.listAssets({
        q: prefix || undefined,
        limit: 15,
      });
      if (seq !== this._mentionSeq) return;
      const p = prefix.toLowerCase();
      const scored = (Array.isArray(assets) ? assets : []).map((a) => {
        const slug = (a.unique_slug || "").toLowerCase();
        return {
          slug: a.unique_slug,
          name: a.display_name || "",
          assetId: a.id,
          rank: slug.startsWith(p) ? 0 : slug.includes(p) ? 1 : 2,
        };
      });
      // Stable rank sort: slug-prefix matches first, then slug-substring, then
      // name/description matches; recent-first order kept within a rank.
      const items = scored
        .map((it, i) => ({ it, i }))
        .sort((a, b) => a.it.rank - b.it.rank || a.i - b.i)
        .map((x) => x.it)
        .slice(0, 8);
      if (seq !== this._mentionSeq) return;
      this._mention = {
        ...this._mention,
        items,
        activeIndex: 0,
        loading: false,
      };
      this._maybeAutoInsert(prefix, items, seq);
    } catch {
      if (seq !== this._mentionSeq) return;
      this._mention = {
        ...this._mention,
        items: [],
        activeIndex: 0,
        loading: false,
      };
    }
  }

  // "Auto single-match": when exactly one reference's slug starts with the
  // typed prefix, insert it without a key or click (after a short settle).
  _maybeAutoInsert(prefix, items, seq) {
    this._clearMentionAuto();
    if (prefix === "") return;
    const exact = items.filter((it) => it.rank === 0);
    if (exact.length !== 1) return;
    this._mentionAutoTimer = setTimeout(() => {
      this._mentionAutoTimer = null;
      if (seq !== this._mentionSeq) return;
      const m = this._mention;
      if (!m.open || m.prefix !== prefix) return;
      const val = this.value ?? "";
      const caret = this._selectionOffset();
      if (val.slice(m.start + 1, caret) !== prefix) return;
      this._acceptMention(0);
    }, 250);
  }

  _acceptMention(index) {
    const m = this._mention;
    if (!m.open) return;
    const it = m.items[index] ?? m.items[0];
    if (!it) {
      this._closeMention();
      return;
    }
    const val = this.value ?? "";
    const caret = this._selectionOffset();
    const token = `@${it.slug}`;
    const before = val.slice(0, m.start);
    const after = val.slice(caret);
    this._pendingCaret = m.start + token.length;
    this.value = before + token + after;
    this._closeMention();
    this._emit("input");
  }

  _closeMention() {
    this._clearMentionAuto();
    if (this._mention?.open) {
      this._mentionSeq++;
      this._mention = {
        ...this._mention,
        open: false,
        items: [],
        loading: false,
      };
    }
  }

  _clearMentionAuto() {
    if (this._mentionAutoTimer) {
      clearTimeout(this._mentionAutoTimer);
      this._mentionAutoTimer = null;
    }
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
    const ed = this._ed;
    if (ed && ed.contains(r.startContainer)) {
      return this._rangeOffset(r.startContainer, r.startOffset);
    }
    // Some engines (notably Chromium with a shadow-DOM contenteditable) report
    // the caret on a light-DOM ancestor (e.g. <body>) after a native edit, so
    // the in-node offset is unreadable. The dominant case is end-of-text
    // editing, so fall back there — 0 (the start) would yank the caret to the
    // beginning of the line on the next rebuild, which is always wrong.
    return this.value.length;
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
  // Called only when the DOM is genuinely out of sync (a programmatic value
  // set) or the chip structure changed — never on plain native keystrokes —
  // so the browser's live caret survives typing.
  _renderEditable() {
    const ed = this._ed;
    if (!ed) return;
    const explicit = this._pendingCaret;
    this._pendingCaret = null;
    // For a shadow-DOM contenteditable the focus is on the HOST; `ed` is only
    // the shadowRoot's activeElement. (Comparing against the light-DOM
    // `document.activeElement` is always false here.)
    const hadFocus = this.shadowRoot.activeElement === ed;
    // Where the caret goes after the rebuild. An explicit target (Enter /
    // Paste / mention shifted the caret) wins. Otherwise prefer the caret we
    // captured at the last input/focus — reading the LIVE selection here is
    // unreliable, because it is taken in the same tick as the innerHTML swap
    // that resets it, so the caret jumps to the start in real browsers. Only
    // trust that capture while the value is unchanged: a chip landing keeps the
    // value (the offset stays valid), but a programmatic value replace
    // invalidates it, so we fall back to the live selection in that case.
    let restoreTo;
    if (explicit != null) {
      restoreTo = explicit;
    } else if (
      this._lastCaretOffset >= 0 && this._lastCaretValue === this.value
    ) {
      restoreTo = Math.min(this._lastCaretOffset, this.value.length);
    } else if (hadFocus) {
      restoreTo = this._selectionOffset();
    } else {
      restoreTo = null;
    }
    ed.innerHTML = this._editableHtml();
    this._renderedChipSig = this._chipSig(this._segments);
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
        ${this._mention?.open
          ? html`
            <div class="mention" role="listbox">
              ${this._mention.items.length === 0
                ? html`
                  <div class="mention-empty">
                    ${this._mention.loading ? "Loading…" : "No references"}
                  </div>
                `
                : this._mention.items.map(
                  (it, i) =>
                    html`
                      <div
                        class="mention-item${i === this._mention.activeIndex ? " active" : ""}"
                        role="option"
                        aria-selected=${i === this._mention.activeIndex}
                        data-i=${i}
                        @mousedown=${(e) => {
                          e.preventDefault();
                          this._acceptMention(i);
                        }}>
                        <span class="mention-slug">@${it.slug}</span>
                        ${it.name ? html`<span class="mention-name">${it.name}</span>` : nothing}
                      </div>
                    `,
                )}
            </div>
          `
          : nothing}
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
