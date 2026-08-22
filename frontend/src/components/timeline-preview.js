import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import { parseAudioMetadata } from "../audio-adjustments.js";
import {
  activeAudioItems,
  activeTextItems,
  activeVisual,
  audioVolumeFor,
  duckGainAt,
  fadeFactorAt,
  gradeFilter,
  playbackRange,
  sourceTimeAt,
} from "../timeline-playback.js";

const SEEK_TOLERANCE = 0.25;
const AUDIO_SEEK_TOLERANCE = 0.3;
const EMIT_INTERVAL_MS = 100;
const RATES = [0.25, 0.5, 1, 1.5, 2];

function clampRate(rate) {
  return Math.min(16, Math.max(0.0625, rate));
}

/**
 * Timeline preview: plays the timeline in the browser using proxy-first
 * media resolution. Video sources come from unlocked video/overlay tracks
 * (same selection as the render runner); audio track items are mixed with
 * their version-level gain and the item fades; text/subtitle items render
 * as overlays. Color grades and temperatures are approximated with CSS
 * filters, so this is a preview, not a final render.
 */
class TimelinePreview extends LitElement {
  static properties = {
    tracks: {},
    versions: {},
    duration: { attribute: false },
    playhead: { state: true },
    playing: { state: true },
    rate: { state: true },
    from: { state: true },
    to: { state: true },
    hint: { state: true },
  };

  static styles = css`
    :host {
      display: block;
    }
    .preview {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .controls {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .controls .btn {
      min-width: 74px;
    }
    .controls .btn-stop {
      min-width: 44px;
    }
    select,
    input[type="number"] {
      background: #0b1220;
      border: 1px solid #263244;
      border-radius: 6px;
      color: inherit;
      font: inherit;
      font-size: 12px;
      padding: 4px 6px;
    }
    input[type="number"] {
      width: 70px;
    }
    .time {
      font-variant-numeric: tabular-nums;
      font-size: 13px;
      opacity: 0.85;
    }
    .range {
      display: flex;
      gap: 6px;
      align-items: center;
      font-size: 12px;
      opacity: 0.85;
    }
    .viewport {
      position: relative;
      aspect-ratio: 16 / 9;
      max-height: 320px;
      width: 100%;
      background: #000;
      border: 1px solid #263244;
      border-radius: 8px;
      overflow: hidden;
    }
    .viewport video,
    .viewport img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: none;
    }
    #overlay-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .text-overlay {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      max-width: 90%;
      text-align: center;
      font-weight: 600;
      color: #fff;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
      word-break: break-word;
    }
    .placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.45);
      padding: 12px;
      text-align: center;
    }
  `;

  constructor() {
    super();
    this.tracks = [];
    this.versions = new Map();
    this.duration = 0;
    this.playhead = 0;
    this.playing = false;
    this.rate = 1;
    this.from = "";
    this.to = "";
    this.hint = "";
    this._videoEl = null;
    this._imageEl = null;
    this._overlayLayer = null;
    this._audioPool = new Map();
    this._textPool = new Map();
    this._mediaCache = new Map();
    this._failedMedia = new Set();
    this._audioMetaCache = new Map();
    this._raf = null;
    this._lastFrame = 0;
    this._lastEmit = 0;
  }

  firstUpdated() {
    const viewport = this.renderRoot.querySelector(".viewport");
    this._videoEl = document.createElement("video");
    this._videoEl.playsInline = true;
    this._videoEl.preload = "auto";
    this._videoEl.dataset.versionId = "";
    this._imageEl = document.createElement("img");
    this._imageEl.alt = "";
    this._imageEl.dataset.versionId = "";
    this._overlayLayer = document.createElement("div");
    this._overlayLayer.id = "overlay-layer";
    viewport.append(this._videoEl, this._imageEl, this._overlayLayer);
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this.playing = false;
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    for (const entry of this._audioPool.values()) entry.el.pause();
    this._videoEl?.pause();
    this._revokeAll();
    this._audioPool.clear();
    this._textPool.clear();
    this._mediaCache.clear();
    this._audioMetaCache.clear();
    this._failedMedia.clear();
  }

  updated(changed) {
    if (
      (changed.has("tracks") || changed.has("versions")) && !this.playing
    ) {
      this._syncMedia();
    }
    if (changed.has("playhead") && !this.playing) {
      this._syncMedia();
    }
  }

  _togglePlay() {
    if (this.playing) this._pause();
    else this._play();
  }

  _play() {
    const end = this._playbackEnd();
    if (!(end > 0)) return;
    const range = playbackRange(this.from, this.to);
    if (this.playhead >= end - 1e-6) {
      this.playhead = range ? range.from : 0;
    }
    if (this.playhead >= end - 1e-6) return;
    this.playing = true;
    this._lastFrame = performance.now();
    this._loop();
  }

  _pause() {
    this.playing = false;
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    this._syncMedia();
  }

  _stop() {
    this._pause();
    this.playhead = 0;
    this._syncMedia();
    this._emitPlayhead();
  }

  _playbackEnd() {
    const duration = Number(this.duration) || 0;
    const range = playbackRange(this.from, this.to);
    if (range) return Math.min(range.to, duration);
    return duration;
  }

  _loop() {
    if (this._raf !== null) cancelAnimationFrame(this._raf);
    const step = (now) => {
      this._raf = null;
      if (!this.playing) return;
      const dt = Math.min(0.1, (now - this._lastFrame) / 1000);
      this._lastFrame = now;
      this.playhead += dt * this.rate;
      const end = this._playbackEnd();
      const range = playbackRange(this.from, this.to);
      if (this.playhead >= end) {
        if (range) {
          this.playhead = range.from;
        } else {
          this.playhead = end;
          this._pause();
          this._emitPlayhead();
          return;
        }
      }
      this._syncMedia();
      if (now - this._lastEmit >= EMIT_INTERVAL_MS) {
        this._lastEmit = now;
        this._emitPlayhead();
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _emitPlayhead() {
    this.dispatchEvent(
      new CustomEvent("playheadchange", {
        detail: this.playhead,
        bubbles: true,
        composed: true,
      }),
    );
  }

  // --- media resolution -------------------------------------------------

  _mediaFor(versionId, info, kind) {
    let cached = this._mediaCache.get(versionId);
    if (cached) return cached;
    cached = (async () => {
      if (kind === "audio") {
        const master = await api.getAssetPreviewUrl(info.assetId);
        return { url: master.url };
      }
      try {
        const proxy = await api.getAssetProxyUrl(info.assetId, versionId);
        return { url: proxy.url };
      } catch {
        if (
          versionId === info.activeVersionId ||
          versionId === info.previewVersionId
        ) {
          const master = await api.getAssetPreviewUrl(info.assetId);
          return { url: master.url };
        }
      }
      return null;
    })();
    this._mediaCache.set(versionId, cached);
    return cached;
  }

  async _audioAdjustments(info) {
    let cached = this._audioMetaCache.get(info.assetId);
    if (cached) return cached;
    cached = api
      .getAsset(info.assetId)
      .then((detail) => {
        const meta = parseAudioMetadata(
          detail?.active_version?.technical_metadata_json,
        );
        return meta?.adjustments ?? null;
      })
      .catch(() => null);
    this._audioMetaCache.set(info.assetId, cached);
    return cached;
  }

  _revokeAll() {
    for (const entry of this._mediaCache.values()) {
      entry.then((m) => m?.url && URL.revokeObjectURL(m.url)).catch(() => {});
    }
  }

  // --- frame sync -------------------------------------------------------

  _syncMedia() {
    const t = this.playhead;
    const visual = activeVisual(this.tracks, t);

    let wantEl = null;
    let wantHint = "";
    if (visual === null) {
      wantHint = "No clip at this time";
    } else {
      const info = this.versions?.get(visual.item.asset_version_id);
      if (!info) {
        wantHint = "Clip media not found";
      } else {
        const kind = info.assetType === "image"
          ? "image"
          : info.assetType === "video"
          ? "video"
          : null;
        if (!kind) {
          wantHint = "No previewable media for this clip";
        } else if (this._failedMedia.has(visual.item.asset_version_id)) {
          wantHint = "Clip media failed to load";
        } else {
          wantEl = kind === "video" ? this._videoEl : this._imageEl;
          this._configureVisual(visual, info, kind);
        }
      }
    }

    if (this._videoEl) {
      const showVideo = wantEl === this._videoEl;
      this._videoEl.style.display = showVideo ? "block" : "none";
      if (!showVideo || !this.playing) {
        if (!this._videoEl.paused) this._videoEl.pause();
      } else if (
        this._videoEl.dataset.versionId !== "" && this._videoEl.paused
      ) {
        try {
          this._videoEl.play().catch(() => {});
        } catch {
          // not loaded yet; the rAF loop keeps retrying
        }
      }
    }
    if (this._imageEl) {
      this._imageEl.style.display = wantEl === this._imageEl ? "block" : "none";
    }

    this.hint = wantHint;
    this._syncAudio(t);
    this._syncText(t);
  }

  _configureVisual(visual, info, kind) {
    const item = visual.item;
    const t = this.playhead;
    const fade = fadeFactorAt(item, t);
    const filter = gradeFilter(item.color_grade) || "none";
    const target = kind === "video" ? this._videoEl : this._imageEl;
    if (target.dataset.versionId === item.asset_version_id) {
      target.style.opacity = String(fade);
      target.style.filter = filter;
      if (kind === "video") {
        target.playbackRate = clampRate(Number(item.speed) || 1);
        target.muted = visual.muted;
        this._seekVideo(sourceTimeAt(item, t));
      }
      return;
    }
    target._pendingFor = item.asset_version_id;
    this._mediaFor(item.asset_version_id, info, kind)
      .then((media) => {
        if (!media || target._pendingFor !== item.asset_version_id) {
          if (!media) this._failedMedia.add(item.asset_version_id);
          return;
        }
        target.dataset.versionId = item.asset_version_id;
        target.src = media.url;
        if (kind === "video") {
          target.playbackRate = clampRate(Number(item.speed) || 1);
          target.muted = visual.muted;
          target.onloadedmetadata = () => this._syncMedia();
        }
        this._syncMedia();
      })
      .catch(() => {
        this._failedMedia.add(item.asset_version_id);
      });
  }

  _seekVideo(seconds) {
    const el = this._videoEl;
    if (!el || el.dataset.versionId === "") return;
    try {
      if (Math.abs(el.currentTime - seconds) > SEEK_TOLERANCE) {
        el.currentTime = seconds;
      }
    } catch {
      // metadata not ready yet
    }
  }

  _syncAudio(t) {
    const audios = activeAudioItems(this.tracks, t);
    const activeIds = new Set(audios.map((a) => a.item.id));
    for (const [id, entry] of this._audioPool) {
      if (!activeIds.has(id)) entry.el.pause();
    }
    for (const { item, track } of audios) {
      const info = this.versions?.get(item.asset_version_id);
      let entry = this._audioPool.get(item.id);
      // /preview streams the asset's active/preview version file, so audio
      // can only be served for those versions — any other version would
      // play the wrong file, so skip it.
      const available = info !== undefined &&
        info.assetType === "audio" &&
        (item.asset_version_id === info.activeVersionId ||
          item.asset_version_id === info.previewVersionId);
      if (!info || !available) {
        if (entry) entry.el.pause();
        continue;
      }
      if (!entry) {
        entry = this._createAudioEntry(item, info);
        this._audioPool.set(item.id, entry);
      }
      const S = sourceTimeAt(item, t);
      const adjust = (adj) => {
        const trim = adj?.trim ?? null;
        const inTrim = trim === null ||
          (S >= trim.start - 1e-6 && S <= trim.end + 1e-6);
        const el = entry.el;
        if (track.muted || !inTrim || el.dataset.versionId === "") {
          el.pause();
          return;
        }
        const fade = fadeFactorAt(item, t);
        const duck = duckGainAt(this.tracks, item, t);
        el.volume = audioVolumeFor(
          (adj?.gain_db ?? 0) + Number(track.gain_db ?? 0),
          fade * duck,
        );
        try {
          if (Math.abs(el.currentTime - S) > AUDIO_SEEK_TOLERANCE) {
            el.currentTime = S;
          }
        } catch {
          // metadata not ready yet
        }
        if (this.playing && el.paused) el.play().catch(() => {});
        if (!this.playing && !el.paused) el.pause();
      };
      entry.adjustments.then(adjust).catch(() => adjust(null));
    }
  }

  _createAudioEntry(item, info) {
    const el = document.createElement("audio");
    el.preload = "auto";
    el.dataset.versionId = "";
    const entry = {
      el,
      // Only active versions carry adjustments (the adjustments UI targets the
      // active version), so they may only be applied to that version.
      adjustments: item.asset_version_id === info.activeVersionId
        ? this._audioAdjustments(info)
        : Promise.resolve(null),
    };
    this._mediaFor(item.asset_version_id, info, "audio")
      .then((media) => {
        if (!media || this._audioPool.get(item.id) !== entry) return;
        el.dataset.versionId = item.asset_version_id;
        el.src = media.url;
        this._syncMedia();
      })
      .catch(() => {});
    return entry;
  }

  _syncText(t) {
    if (!this._overlayLayer) return;
    const texts = activeTextItems(this.tracks, t);
    const activeIds = new Set(texts.map((a) => a.item.id));
    for (const [id, node] of this._textPool) {
      if (!activeIds.has(id)) node.remove();
    }
    for (const { item } of texts) {
      let node = this._textPool.get(item.id);
      if (!node) {
        node = document.createElement("div");
        node.className = "text-overlay";
        this._overlayLayer.append(node);
        this._textPool.set(item.id, node);
      }
      const style = item.text_style ?? {};
      node.textContent = item.item_text ?? "";
      node.style.fontSize = `${Number(style.font_size) > 0 ? Number(style.font_size) : 24}px`;
      node.style.color = style.font_color || "#ffffff";
      const margin = Number(style.margin) >= 0 ? Number(style.margin) : 0;
      node.style.top = "";
      node.style.bottom = "";
      node.style.transform = "translateX(-50%)";
      const position = style.position || "bottom";
      if (position === "top") {
        node.style.top = `${margin}%`;
      } else if (position === "middle") {
        node.style.top = "50%";
        node.style.transform = "translate(-50%, -50%)";
      } else {
        node.style.bottom = `${margin}%`;
      }
      node.style.opacity = String(fadeFactorAt(item, t));
    }
  }

  // --- template ---------------------------------------------------------

  render() {
    const total = Number(this.duration) || 0;
    return html`
      <div class="preview">
        <div class="controls">
          <button
            class="btn"
            ?disabled=${total <= 0}
            @click=${this._togglePlay}>
            ${this.playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            class="btn btn-stop"
            title="Stop and reset the playhead"
            @click=${this._stop}>⏹</button>
          <select
            title="Playback rate"
            .value=${String(this.rate)}
            @change=${(e) => (this.rate = Number(e.target.value))}>
            ${RATES.map(
              (r) => html`<option value=${r}>${r}x</option>`,
            )}
          </select>
          <span class="time">
            ${this._fmt(this.playhead)} / ${this._fmt(total)}
          </span>
          <span class="range">
            <label
            >In
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="0"
                .value=${this.from}
                @input=${(e) => (this.from = e.target.value)}>
            </label>
            <label
            >Out
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="end"
                .value=${this.to}
                @input=${(e) => (this.to = e.target.value)}>
            </label>
          </span>
        </div>
        <div class="viewport">
          ${this.hint ? html`<div class="placeholder">${this.hint}</div>` : null}
        </div>
      </div>
    `;
  }

  _fmt(secs) {
    const s = Number.isFinite(secs) ? Math.max(0, secs) : 0;
    const m = Math.floor(s / 60);
    const rest = s - m * 60;
    return m > 0 ? `${m}:${rest.toFixed(1).padStart(4, "0")}` : `${rest.toFixed(1)}s`;
  }
}

customElements.define("timeline-preview", TimelinePreview);
