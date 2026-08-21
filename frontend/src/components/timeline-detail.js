import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import { jobEvents } from "../job-events.js";
import "./audio-dialog.js";

const SCALE = 60;
const LABEL_W = 210;
const TEXT_TRACK_TYPES = ["text", "subtitle"];
const AUDIO_TRACK_TYPES = [
  "dialogue",
  "voiceover",
  "music",
  "sfx",
  "ambience",
];
const TRACK_TYPES = [
  "video",
  "overlay",
  "dialogue",
  "voiceover",
  "music",
  "sfx",
  "ambience",
  "text",
  "subtitle",
  "effect",
  "transition",
];
const TRACK_COLORS = {
  video: "#3b82f6",
  overlay: "#0ea5e9",
  dialogue: "#8b5cf6",
  voiceover: "#a855f7",
  music: "#10b981",
  sfx: "#ef4444",
  ambience: "#14b8a6",
  text: "#f59e0b",
  subtitle: "#f97316",
  effect: "#6366f1",
  transition: "#94a3b8",
};
const TRANSITIONS = [
  "",
  "cut",
  "fade",
  "dissolve",
  "wipeleft",
  "wiperight",
  "slideleft",
  "slideright",
];
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

function round2(x) {
  return Math.round(x * 100) / 100;
}

function isTextTrack(track) {
  return TEXT_TRACK_TYPES.includes(track.track_type);
}

export class TimelineDetail extends LitElement {
  static styles = css`
    .detail {
      display: flex;
      flex-direction: column;
      gap: 18px;
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

    .tl-header {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .tl-name {
      font-size: 24px;
      font-weight: 700;
    }

    .tl-name-input {
      font-size: 22px;
      font-weight: 700;
      padding: 6px 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
    }

    .chip {
      padding: 4px 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text-muted);
      font-size: 12px;
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
      padding: 4px 10px;
      font-size: 12px;
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      cursor: pointer;
    }

    .btn-small:hover:not(:disabled) {
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
      color: #1d4ed8;
      font-size: 13px;
      background: rgba(59, 130, 246, 0.12);
      padding: 8px 12px;
      border-radius: var(--radius);
    }

    .card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .card-title {
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
    }

    /* --- canvas --- */

    .canvas {
      overflow-x: auto;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background-color: var(--color-bg);
    }

    .canvas-inner {
      position: relative;
    }

    .row {
      display: flex;
    }

    .row-label {
      position: sticky;
      left: 0;
      z-index: 5;
      width: ${LABEL_W}px;
      min-width: ${LABEL_W}px;
      background-color: var(--color-surface);
      border-right: 1px solid var(--color-border);
      padding: 6px 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .ruler {
      height: 30px;
      position: relative;
      border-bottom: 1px solid var(--color-border);
      cursor: crosshair;
      user-select: none;
      touch-action: none;
    }

    .tick {
      position: absolute;
      bottom: 0;
      width: 1px;
      height: 8px;
      background-color: var(--color-border);
    }

    .tick.major {
      height: 14px;
    }

    .tick-label {
      position: absolute;
      bottom: 16px;
      font-size: 10px;
      color: var(--color-text-muted);
      transform: translateX(3px);
    }

    .marker-strip {
      height: 22px;
      position: relative;
      border-bottom: 1px solid var(--color-border);
    }

    .marker-flag {
      position: absolute;
      top: 0;
      font-size: 11px;
      color: #b45309;
      cursor: pointer;
      background: var(--color-surface);
      padding: 0 3px;
      border-radius: 0 0 3px 3px;
      border: 1px solid var(--color-border);
      border-top: none;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .track-lane {
      height: 46px;
      position: relative;
      border-bottom: 1px solid var(--color-border);
    }

    .track-lane.locked {
      background-color: rgba(148, 163, 184, 0.12);
    }

    .item {
      position: absolute;
      top: 5px;
      height: 36px;
      border-radius: 6px;
      border-left: 4px solid;
      cursor: grab;
      display: flex;
      align-items: center;
      padding: 0 8px;
      overflow: hidden;
      user-select: none;
      touch-action: none;
    }

    .item.selected {
      outline: 2px solid var(--color-primary);
      outline-offset: 1px;
    }

    .item .waveform {
      flex: 1;
      min-width: 24px;
      height: 26px;
      margin-left: 8px;
    }

    .track-lane.locked .item {
      cursor: not-allowed;
      opacity: 0.65;
    }

    .item-label {
      font-size: 11px;
      color: white;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }

    .playhead {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background-color: #ef4444;
      z-index: 4;
      pointer-events: none;
    }

    .track-name {
      color: var(--color-text);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 90px;
    }

    .track-type {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.85;
    }

    .track-actions {
      margin-left: auto;
      display: flex;
      gap: 2px;
      flex-shrink: 0;
    }

    .icon-btn {
      border: none;
      background: transparent;
      color: var(--color-text-muted);
      cursor: pointer;
      font-size: 12px;
      padding: 2px 4px;
      border-radius: 4px;
      line-height: 1;
    }

    .icon-btn:hover {
      background-color: var(--color-surface-hover);
    }

    .icon-btn.on {
      color: #b45309;
      font-weight: 700;
    }

    .add-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      padding: 8px 10px;
      background-color: var(--color-surface);
      border-top: 1px solid var(--color-border);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .field label {
      font-size: 10px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    input,
    select,
    textarea {
      padding: 6px 10px;
      background-color: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
      font-family: inherit;
    }

    input[type="number"] {
      width: 84px;
    }

    textarea {
      min-width: 220px;
      resize: vertical;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 10px;
    }

    .marker-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      padding: 6px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
    }

    .marker-row .time {
      font-variant-numeric: tabular-nums;
      color: var(--color-text-muted);
      min-width: 52px;
    }

    .snap-row,
    .export-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      padding: 6px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
    }

    .snap-row .when,
    .export-row .when {
      color: var(--color-text-muted);
      font-size: 12px;
      margin-left: auto;
    }

    .progress {
      height: 8px;
      border-radius: 999px;
      background-color: var(--color-surface-hover);
      overflow: hidden;
    }

    .progress-bar {
      height: 100%;
      background-color: var(--color-primary);
      transition: width 0.4s ease;
    }

    .status-chip {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 999px;
      border: 1px solid var(--color-border);
      color: var(--color-text-muted);
      background-color: var(--color-surface);
    }

    .status-chip.succeeded {
      background-color: #0d9488;
      border-color: #0d9488;
      color: white;
    }

    .status-chip.failed {
      background-color: #dc2626;
      border-color: #dc2626;
      color: white;
    }

    .status-chip.cancelled {
      background-color: #6b7280;
      border-color: #6b7280;
      color: white;
    }

    a.link {
      color: var(--color-primary);
      font-size: 13px;
      text-decoration: none;
    }

    a.link:hover {
      text-decoration: underline;
    }

    .empty-note {
      color: var(--color-text-muted);
      font-size: 13px;
    }
  `;

  static properties = {
    timelineId: {},
    timeline: { state: true },
    tracks: { state: true },
    markers: { state: true },
    snapshots: { state: true },
    presets: { state: true },
    exports: { state: true },
    assets: { state: true },
    clipNames: { state: true },
    waveforms: { state: true },
    showAudioGen: { state: true },
    loading: { state: true },
    error: { state: true },
    notice: { state: true },
    busy: { state: true },
    editingName: { state: true },
    nameDraft: { state: true },
    playhead: { state: true },
    dragPreview: { state: true },
    selectedItemId: { state: true },
    fx: { state: true },
    fxError: { state: true },
    savingFx: { state: true },
    showPlace: { state: true },
    placeTrackId: { state: true },
    placeAssetId: { state: true },
    placeVersions: { state: true },
    placeVersionId: { state: true },
    placeVersionLoading: { state: true },
    placeStart: { state: true },
    placeDuration: { state: true },
    placeText: { state: true },
    placeError: { state: true },
    placing: { state: true },
    newTrackType: { state: true },
    newTrackName: { state: true },
    markerLabel: { state: true },
    snapshotName: { state: true },
    renderPresetId: { state: true },
    renderJob: { state: true },
    renderError: { state: true },
    renderBusy: { state: true },
  };

  constructor() {
    super();
    this.timeline = null;
    this.tracks = [];
    this.markers = [];
    this.snapshots = [];
    this.presets = [];
    this.exports = [];
    this.assets = [];
    this.clipNames = new Map();
    this.waveforms = new Map();
    this.showAudioGen = false;
    this.loading = false;
    this.error = "";
    this.notice = "";
    this.busy = false;
    this.editingName = false;
    this.nameDraft = "";
    this.playhead = 0;
    this.previewVersions = new Map();
    this._rulerEl = null;
    this.dragPreview = null;
    this.selectedItemId = null;
    this.fx = null;
    this.fxError = "";
    this.savingFx = false;
    this.showPlace = false;
    this.placeTrackId = "";
    this.placeAssetId = "";
    this.placeVersions = [];
    this.placeVersionId = "";
    this.placeVersionLoading = false;
    this.placeStart = "0";
    this.placeDuration = "2";
    this.placeText = "";
    this.placeError = "";
    this.placing = false;
    this.newTrackType = "video";
    this.newTrackName = "";
    this.markerLabel = "";
    this.snapshotName = "";
    this.renderPresetId = "";
    this.renderJob = null;
    this.renderError = "";
    this.renderBusy = false;
    this._renderTimer = null;
    this._drag = null;
    this._unsubscribeEvents = null;
  }

  async connectedCallback() {
    super.connectedCallback?.();
    this._timelineId = this.timelineId ??
      decodeURIComponent(
        (window.location.hash.match(/#\/timeline\/([^/?]+)/) ?? [])[1] ??
          "",
      );
    await this._load();
    this._unsubscribeEvents = jobEvents.subscribe((ev) => this._onLiveEvent(ev));
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._stopRenderPolling();
    this._unsubscribeEvents?.();
    this._unsubscribeEvents = null;
    window.removeEventListener("pointermove", this._onDragMove);
    window.removeEventListener("pointerup", this._onDragUp);
    window.removeEventListener("pointermove", this._onRulerScrubMove);
    window.removeEventListener("pointerup", this._onRulerScrubEnd);
  }

  async _load() {
    this.loading = true;
    this.error = "";
    try {
      const detail = await api.getTimeline(this._timelineId);
      this._applyDetail(detail);
      this.presets = await api
        .listRenderPresets()
        .catch(() => []);
      if (
        !this.renderPresetId && this.presets.length > 0
      ) {
        this.renderPresetId = this.presets.find((p) => p.kind === "final")?.id ??
          this.presets[0].id;
      }
      this.assets = await api
        .listAssets({ project_id: detail.timeline.project_id })
        .catch(() => []);
      this._buildClipNames();
      this._loadAudioWaveforms();
      this._buildPreviewVersions();
      if (this.placeTrackId && !this._trackById(this.placeTrackId)) {
        this.placeTrackId = this.tracks[0]?.id ?? "";
      }
      if (!this.placeTrackId && this.tracks.length > 0) {
        this.placeTrackId = this.tracks[0].id;
      }
      this.snapshots = await api
        .listTimelineSnapshots(this._timelineId)
        .catch(() => []);
      this.exports = await api
        .listExports({ project_id: detail.timeline.project_id })
        .catch(() => []);
    } catch (e) {
      this.error = e.message ?? "Failed to load timeline.";
    } finally {
      this.loading = false;
    }
  }

  _applyDetail(detail) {
    this.timeline = detail.timeline;
    this.tracks = (detail.tracks ?? []).slice().sort(
      (a, b) => a.track_order - b.track_order,
    );
    this.markers = detail.markers ?? [];
  }

  _buildClipNames() {
    const map = new Map();
    for (const asset of this.assets) {
      if (asset.active_version_id) {
        map.set(asset.active_version_id, asset.name);
      }
    }
    this.clipNames = map;
  }

  // Maps each resolvable version id to the asset context the preview player
  // needs to fetch media (proxy-first, master fallback for the active or
  // preview version only). Generated audio is global-scoped, so the audio
  // asset list is merged in the same way the waveform loader does.
  async _buildPreviewVersions() {
    const map = new Map();
    const add = (asset) => {
      for (
        const versionId of [
          asset.active_version_id,
          asset.preview_version_id,
        ]
      ) {
        if (!versionId || map.has(versionId)) continue;
        map.set(versionId, {
          assetId: asset.id,
          name: asset.name,
          assetType: asset.asset_type,
          activeVersionId: asset.active_version_id,
          previewVersionId: asset.preview_version_id,
        });
      }
    };
    for (const asset of this.assets) add(asset);
    const audioAssets = await api
      .listAudioAssets()
      .catch(() => []);
    for (const asset of audioAssets) {
      if (!this.assets.some((a) => a.id === asset.id)) add(asset);
    }
    this.previewVersions = map;
  }

  async _loadAudioWaveforms() {
    const versionIds = new Set();
    for (const track of this.tracks) {
      if (!AUDIO_TRACK_TYPES.includes(track.track_type)) continue;
      for (const item of track.items) {
        if (item.asset_version_id) versionIds.add(item.asset_version_id);
      }
    }
    if (versionIds.size === 0) {
      this.waveforms = new Map();
      return;
    }
    // Version ids only identify the asset via the asset lists; generated
    // audio is global-scoped, so include the audio asset list as well.
    let versionAsset = new Map();
    for (const asset of this.assets) {
      if (asset.active_version_id && versionIds.has(asset.active_version_id)) {
        versionAsset.set(asset.active_version_id, asset.id);
      }
    }
    if (versionAsset.size < versionIds.size) {
      const audioAssets = await api
        .listAudioAssets()
        .catch(() => []);
      for (const asset of audioAssets) {
        if (
          asset.active_version_id &&
          versionIds.has(asset.active_version_id) &&
          !versionAsset.has(asset.active_version_id)
        ) {
          versionAsset.set(asset.active_version_id, asset.id);
        }
      }
    }
    const targets = [...versionAsset.entries()];
    const results = await Promise.allSettled(
      targets.map(([versionId, assetId]) => api.getAudioWaveform(assetId, versionId)),
    );
    const map = new Map();
    for (let i = 0; i < targets.length; i++) {
      if (results[i].status === "fulfilled" && results[i].value?.waveform) {
        map.set(targets[i][0], results[i].value.waveform.peaks);
      }
    }
    this.waveforms = map;
  }

  _waveformPath(peaks) {
    const step = Math.ceil(peaks.length / 200);
    const pts = [];
    for (let i = 0; i < peaks.length; i += step) {
      const x = (i / (peaks.length - 1)) * 100;
      const amp = Math.max(0.6, Math.min(1, Number(peaks[i]) || 0)) * 10.5;
      pts.push(`${x.toFixed(2)},${(12 - amp).toFixed(2)}`);
      pts.push(`${x.toFixed(2)},${(12 + amp).toFixed(2)}`);
    }
    return pts.join(" ");
  }

  _trackById(id) {
    return this.tracks.find((t) => t.id === id);
  }

  _itemById(itemId) {
    for (const track of this.tracks) {
      const item = track.items.find((i) => i.id === itemId);
      if (item) return { item, track };
    }
    return null;
  }

  _canvasWidth() {
    const duration = this.timeline?.duration ?? 0;
    return Math.max(duration, 30) * SCALE + 200;
  }

  _formatTime(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(s / 60);
    const rest = s - m * 60;
    return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
  }

  // --- name / header ---

  _startRename() {
    this.editingName = true;
    this.nameDraft = this.timeline.name;
  }

  async _saveName() {
    const name = this.nameDraft.trim();
    if (!name) return;
    this.savingFx = false;
    try {
      await api.updateTimeline(this._timelineId, { name });
      this.editingName = false;
      this.timeline = { ...this.timeline, name };
    } catch (e) {
      this.error = e.message ?? "Failed to rename timeline.";
    }
  }

  async _deleteTimeline() {
    if (!window.confirm("Delete this timeline and all its tracks/items?")) {
      return;
    }
    this.busy = true;
    try {
      await api.deleteTimeline(this._timelineId);
      window.location.hash = "#/timelines";
    } catch (e) {
      this.error = e.message ?? "Failed to delete timeline.";
      this.busy = false;
    }
  }

  // --- tracks ---

  async _addTrack() {
    const body = {
      track_type: this.newTrackType,
      name: this.newTrackName.trim() || this.newTrackType,
    };
    this.busy = true;
    this.error = "";
    try {
      await api.createTimelineTrack(this._timelineId, body);
      this.newTrackName = "";
      await this._load();
    } catch (e) {
      this.error = e.message ?? "Failed to add track.";
    } finally {
      this.busy = false;
    }
  }

  async _toggleTrackFlag(track, key) {
    this.busy = true;
    try {
      await api.updateTimelineTrack(
        this._timelineId,
        track.id,
        { [key]: !track[key] },
      );
      await this._load();
    } catch (e) {
      this.error = e.message ?? "Failed to update track.";
    } finally {
      this.busy = false;
    }
  }

  async _moveTrack(track, dir) {
    const index = this.tracks.findIndex((t) => t.id === track.id);
    const other = this.tracks[index + dir];
    if (!other) return;
    this.busy = true;
    try {
      // The backend swap-semantics move the target-position track here.
      await api.updateTimelineTrack(
        this._timelineId,
        track.id,
        { track_order: other.track_order },
      );
      await this._load();
    } catch (e) {
      this.error = e.message ?? "Failed to reorder track.";
    } finally {
      this.busy = false;
    }
  }

  async _deleteTrack(track) {
    if (
      !window.confirm(
        `Delete track "${track.name}" and its ${track.items.length} item(s)?`,
      )
    ) {
      return;
    }
    this.busy = true;
    try {
      await api.deleteTimelineTrack(this._timelineId, track.id);
      if (this.placeTrackId === track.id) this.placeTrackId = "";
      await this._load();
    } catch (e) {
      this.error = e.message ?? "Failed to delete track.";
    } finally {
      this.busy = false;
    }
  }

  // --- item placement ---

  _openPlace() {
    this.showPlace = !this.showPlace;
    this.placeError = "";
    this.placeAssetId = "";
    this.placeVersions = [];
    this.placeVersionId = "";
    this.placeText = "";
    this.placeStart = String(this.playhead);
  }

  async _onPlaceAsset() {
    this.placeVersions = [];
    this.placeVersionId = "";
    if (!this.placeAssetId) return;
    this.placeVersionLoading = true;
    try {
      this.placeVersions = await api.listAssetVersions(this.placeAssetId);
      this.placeVersionId = this.placeVersions[0]?.id ?? "";
    } catch (e) {
      this.placeError = e.message ?? "Failed to load versions.";
    } finally {
      this.placeVersionLoading = false;
    }
  }

  async _placeItem() {
    const track = this._trackById(this.placeTrackId);
    if (!track) {
      this.placeError = "Choose a track.";
      return;
    }
    const start = Number(this.placeStart);
    const duration = Number(this.placeDuration);
    if (!Number.isFinite(start) || start < 0) {
      this.placeError = "Start time must be 0 or greater.";
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      this.placeError = "Duration must be positive.";
      return;
    }
    const body = {
      track_id: track.id,
      start_time: round2(start),
      end_time: round2(start + duration),
      asset_version_id: null,
    };
    if (isTextTrack(track)) {
      const text = this.placeText.trim();
      if (!text) {
        this.placeError = "Text is required for text/subtitle tracks.";
        return;
      }
      body.text = text;
    } else if (!this.placeVersionId) {
      this.placeError = "Choose an asset version.";
      return;
    } else {
      body.asset_version_id = this.placeVersionId;
    }
    this.placing = true;
    this.placeError = "";
    try {
      const item = await api.createTimelineItem(this._timelineId, body);
      this.showPlace = false;
      await this._load();
      this._selectItem(item);
    } catch (e) {
      this.placeError = e.message ?? "Failed to place item.";
    } finally {
      this.placing = false;
    }
  }

  // --- drag / selection ---

  _selectItem(item) {
    this.selectedItemId = item.id;
    this.fx = {
      start_time: item.start_time,
      end_time: item.end_time,
      speed: item.speed ?? 1,
      transition: item.transition ?? "",
      transition_duration: item.transition_duration ?? 0.5,
      fade_in: item.fade_in ?? "",
      fade_out: item.fade_out ?? "",
      text: item.item_text ?? "",
      font_size: item.text_style?.font_size ?? "",
      font_color: item.text_style?.font_color ?? "",
      position: item.text_style?.position ?? "",
      margin: item.text_style?.margin ?? "",
      brightness: item.color_grade?.brightness ?? "",
      contrast: item.color_grade?.contrast ?? "",
      saturation: item.color_grade?.saturation ?? "",
      temperature: item.color_grade?.temperature ?? "",
    };
    this.fxError = "";
  }

  _onItemPointerDown(e, item, track) {
    if (track.locked) {
      this._selectItem(item);
      return;
    }
    e.preventDefault();
    this._selectItem(item);
    this._drag = {
      startX: e.clientX,
      origStart: item.start_time,
      duration: item.end_time - item.start_time,
    };
    window.addEventListener("pointermove", this._onDragMove);
    window.addEventListener("pointerup", this._onDragUp);
  }

  _onDragMove = (e) => {
    if (!this._drag) return;
    const delta = (e.clientX - this._drag.startX) / SCALE;
    this.dragPreview = {
      start: Math.max(0, round2(this._drag.origStart + delta)),
    };
  };

  _onDragUp = () => {
    window.removeEventListener("pointermove", this._onDragMove);
    window.removeEventListener("pointerup", this._onDragUp);
    const drag = this._drag;
    const preview = this.dragPreview;
    this._drag = null;
    this.dragPreview = null;
    if (!drag || !preview) return;
    if (Math.abs(preview.start - drag.origStart) < 0.01) return;
    this._moveItem(preview.start, drag.duration);
  };

  async _moveItem(start, duration) {
    const id = this.selectedItemId;
    if (!id) return;
    this.busy = true;
    try {
      await api.updateTimelineItem(this._timelineId, id, {
        start_time: start,
        end_time: round2(start + duration),
      });
      await this._load();
    } catch (e) {
      this.error = e.message ?? "Failed to move item.";
    } finally {
      this.busy = false;
    }
  }

  // --- item fx panel ---

  async _saveFx() {
    const f = this.fx;
    const start = Number(f.start_time);
    const end = Number(f.end_time);
    if (!Number.isFinite(start) || start < 0) {
      this.fxError = "Invalid start time.";
      return;
    }
    if (!Number.isFinite(end) || end <= start) {
      this.fxError = "End time must be after start time.";
      return;
    }
    const body = {
      start_time: round2(start),
      end_time: round2(end),
      speed: f.speed === "" ? null : Number(f.speed),
      transition: f.transition === "" ? null : f.transition,
      transition_duration: f.transition_duration === "" ? 0.5 : Number(f.transition_duration),
      fade_in: f.fade_in === "" ? null : Number(f.fade_in),
      fade_out: f.fade_out === "" ? null : Number(f.fade_out),
    };
    const entry = this._itemById(this.selectedItemId);
    if (entry && isTextTrack(entry.track)) {
      const text = f.text.trim();
      body.text = text ? text : null;
      const style = {};
      if (f.font_size !== "") style.font_size = Number(f.font_size);
      if (f.font_color) style.font_color = f.font_color;
      if (f.position) style.position = f.position;
      if (f.margin !== "") style.margin = Number(f.margin);
      body.text_style = Object.keys(style).length > 0 ? style : null;
    }
    const grade = {};
    if (f.brightness !== "") grade.brightness = Number(f.brightness);
    if (f.contrast !== "") grade.contrast = Number(f.contrast);
    if (f.saturation !== "") grade.saturation = Number(f.saturation);
    if (f.temperature !== "") grade.temperature = Number(f.temperature);
    body.color_grade = Object.keys(grade).length > 0 ? grade : null;
    this.savingFx = true;
    this.fxError = "";
    try {
      await api.updateTimelineItem(this._timelineId, this.selectedItemId, body);
      await this._load();
      const again = this._itemById(this.selectedItemId);
      if (again) this._selectItem(again.item);
    } catch (e) {
      this.fxError = e.message ?? "Failed to save item.";
    } finally {
      this.savingFx = false;
    }
  }

  async _duplicateItem() {
    if (!this.selectedItemId) return;
    this.busy = true;
    try {
      const item = await api.duplicateTimelineItem(
        this._timelineId,
        this.selectedItemId,
      );
      await this._load();
      this._selectItem(item);
    } catch (e) {
      this.error = e.message ?? "Failed to duplicate item.";
    } finally {
      this.busy = false;
    }
  }

  async _deleteItem() {
    if (!this.selectedItemId) return;
    if (!window.confirm("Delete this item?")) return;
    this.busy = true;
    try {
      await api.deleteTimelineItem(this._timelineId, this.selectedItemId);
      this.selectedItemId = null;
      this.fx = null;
      await this._load();
    } catch (e) {
      this.error = e.message ?? "Failed to delete item.";
    } finally {
      this.busy = false;
    }
  }

  // --- markers ---

  _onRulerPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this._rulerEl = e.currentTarget;
    this._setPlayheadFromClientX(e.clientX);
    window.addEventListener("pointermove", this._onRulerScrubMove);
    window.addEventListener("pointerup", this._onRulerScrubEnd, { once: true });
  }

  _onRulerScrubMove = (e) => {
    this._setPlayheadFromClientX(e.clientX);
  };

  _onRulerScrubEnd = () => {
    window.removeEventListener("pointermove", this._onRulerScrubMove);
    this._rulerEl = null;
  };

  _setPlayheadFromClientX(clientX) {
    if (!this._rulerEl) return;
    const rect = this._rulerEl.getBoundingClientRect();
    const sec = (clientX - rect.left) / SCALE;
    this.playhead = Math.max(0, round2(sec));
  }

  async _addMarker() {
    this.busy = true;
    try {
      await api.createTimelineMarker(this._timelineId, {
        time: this.playhead,
        label: this.markerLabel.trim() || null,
      });
      this.markerLabel = "";
      await this._load();
    } catch (e) {
      this.error = e.message ?? "Failed to add marker.";
    } finally {
      this.busy = false;
    }
  }

  async _deleteMarker(marker) {
    this.busy = true;
    try {
      await api.deleteTimelineMarker(this._timelineId, marker.id);
      await this._load();
    } catch (e) {
      this.error = e.message ?? "Failed to delete marker.";
    } finally {
      this.busy = false;
    }
  }

  // --- snapshots ---

  async _saveSnapshot() {
    this.busy = true;
    try {
      await api.createTimelineSnapshot(this._timelineId, {
        name: this.snapshotName.trim() || "Snapshot",
      });
      this.snapshotName = "";
      await this._load();
    } catch (e) {
      this.error = e.message ?? "Failed to create snapshot.";
    } finally {
      this.busy = false;
    }
  }

  async _restoreSnapshot(snapshot) {
    if (!window.confirm(`Restore "${snapshot.name}"? Current state is replaced.`)) {
      return;
    }
    this.busy = true;
    try {
      const detail = await api.restoreTimelineSnapshot(
        this._timelineId,
        snapshot.id,
      );
      this._applyDetail(detail);
      this.selectedItemId = null;
      this.fx = null;
      this.notice = `Restored snapshot "${snapshot.name}".`;
    } catch (e) {
      this.error = e.message ?? "Failed to restore snapshot.";
    } finally {
      this.busy = false;
    }
  }

  // --- render ---

  async _queueRender() {
    this.renderError = "";
    this.renderBusy = true;
    try {
      const job = await api.queueRender({
        project_id: this.timeline.project_id,
        timeline_id: this._timelineId,
        preset_id: this.renderPresetId || undefined,
      });
      this.renderJob = job;
      this._startRenderPolling();
    } catch (e) {
      this.renderError = e.message ?? "Failed to queue render.";
    } finally {
      this.renderBusy = false;
    }
  }

  _startRenderPolling() {
    this._stopRenderPolling();
    this._renderTimer = setInterval(() => {
      if (!this.renderJob) return;
      api
        .getRenderJob(this.renderJob.id)
        .then((job) => this._applyRenderJob(job))
        .catch(() => {});
    }, 2000);
  }

  _applyRenderJob(job) {
    this.renderJob = job;
    if (TERMINAL_STATUSES.has(job.status)) {
      this._stopRenderPolling();
      if (job.status === "succeeded") {
        this._loadExports();
      }
    }
  }

  /** Live render updates over the WebSocket fast path. */
  _onLiveEvent(ev) {
    if (!ev || !this.renderJob || ev.renderId !== this.renderJob.id) return;
    if (ev.kind === "progress" && typeof ev.progress === "number") {
      this.renderJob = { ...this.renderJob, progress: ev.progress };
    } else if (ev.kind === "status") {
      api
        .getRenderJob(this.renderJob.id)
        .then((job) => this._applyRenderJob(job))
        .catch(() => {});
    }
  }

  _stopRenderPolling() {
    if (this._renderTimer) {
      clearInterval(this._renderTimer);
      this._renderTimer = null;
    }
  }

  async _cancelRender() {
    if (!this.renderJob) return;
    this.renderBusy = true;
    try {
      const job = await api.cancelRenderJob(this.renderJob.id);
      this.renderJob = job;
      if (job.status === "cancelled") this._stopRenderPolling();
    } catch (e) {
      this.renderError = e.message ?? "Failed to cancel render.";
    } finally {
      this.renderBusy = false;
    }
  }

  async _loadExports() {
    this.exports = await api
      .listExports({ project_id: this.timeline.project_id })
      .catch(() => []);
  }

  _renderExport() {
    if (!this.renderJob) return null;
    return this.exports.find((x) => x.render_job_id === this.renderJob.id);
  }

  // --- render ---

  render() {
    if (this.loading && !this.timeline) {
      return html`<div class="empty-note">Loading timeline...</div>`;
    }
    if (!this.timeline) {
      return html`<div class="error">${this.error || "Timeline not found."}</div>`;
    }

    const width = this._canvasWidth();

    return html`
      <div class="detail">
        <a class="back-link" href="#/timelines">&larr; Timelines</a>

        <div class="tl-header">
          ${this.editingName
            ? html`
              <input
                class="tl-name-input"
                .value=${this.nameDraft}
                @input=${(e) => (this.nameDraft = e.target.value)}
                @keydown=${(e) => {
                  if (e.key === "Enter") this._saveName();
                }}>
            `
            : html`<span class="tl-name">${this.timeline.name}</span>`}
          <span class="chip">${this._formatTime(this.timeline.duration)} total</span>
          ${this.editingName
            ? html`
              <button class="btn-small" @click=${this._saveName}>Save</button>
              <button
                class="btn-small"
                @click=${() => (this.editingName = false)}>
                Cancel
              </button>
            `
            : html`
              <button class="btn-small" @click=${this._startRename}>
                Rename
              </button>
            `}
          <button
            class="btn-small"
            style="margin-left:auto;"
            @click=${() => (this.showAudioGen = !this.showAudioGen)}>
            ${this.showAudioGen ? "Hide audio" : "Generate audio"}
          </button>
          <button
            class="btn-small"
            ?disabled=${this.busy}
            @click=${this._deleteTimeline}>
            Delete
          </button>
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : null}
        ${this.notice ? html`<div class="notice">${this.notice}</div>` : null}

        ${this.showAudioGen
          ? html`
            <audio-dialog
              .projectId=${this.timeline.project_id ?? null}></audio-dialog>
          `
          : null}

        <timeline-preview
          .tracks=${this.tracks}
          .versions=${this.previewVersions}
          .duration=${this.timeline.duration}
          .playhead=${this.playhead}
          @playheadchange=${(e) => (this.playhead = e.detail)}></timeline-preview>

        ${this._renderCanvas(width)}

        ${this._renderFxPanel()}

        ${this._renderMarkersCard()}

        ${this._renderTracksCard()}

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;">
          ${this._renderSnapshotsCard()}
          ${this._renderRenderCard()}
        </div>
      </div>
    `;
  }

  _renderCanvas(width) {
    const ticks = Array.from(
      { length: Math.ceil(width / SCALE) },
      (_v, i) => i,
    );
    return html`
      <div class="canvas">
        <div class="canvas-inner" style="width:${width}px;">
          <div class="row">
            <div class="row-label">Ruler (click or drag to set playhead)</div>
            <div
              class="ruler"
              style="flex:1;"
              @pointerdown=${this._onRulerPointerDown}>
              ${ticks.map(
                (i) =>
                  html`
                    <span
                      class="tick ${i % 5 === 0 ? "major" : ""}"
                      style="left:${i * SCALE}px;"></span>
                  `,
              )}
              ${ticks
                .filter((i) => i % 5 === 0)
                .map(
                  (i) =>
                    html`
                      <span
                        class="tick-label"
                        style="left:${i * SCALE}px;">
                                          ${i}s
                                        </span>
                    `,
                )}
            </div>
          </div>

          <div class="row">
            <div class="row-label">Markers</div>
            <div class="marker-strip" style="flex:1;">
              ${this.markers.map(
                (m) =>
                  html`
                    <span
                      class="marker-flag"
                      style="left:${m.time * SCALE}px;"
                      title="${m.label ?? ""} @ ${this._formatTime(m.time)}"
                      @click=${() => (this.playhead = m.time)}>
                                    ${m.label ?? "•"}
                                  </span>
                  `,
              )}
            </div>
          </div>

          ${this.tracks.map((track) => this._renderTrackRow(track))}

          <div
            class="playhead"
            style="left:${LABEL_W + this.playhead * SCALE}px;"></div>
        </div>
      </div>
    `;
  }

  _renderTrackRow(track) {
    const color = TRACK_COLORS[track.track_type] ?? "#64748b";
    const index = this.tracks.indexOf(track);
    return html`
      <div class="row">
        <div class="row-label">
          <span class="track-name">${track.name}</span>
          <span
            class="track-type"
            style="color:${color};">${track.track_type}</span>
          <div class="track-actions">
            <button
              class="icon-btn ${track.locked ? "on" : ""}"
              title=${track.locked ? "Unlock track" : "Lock track"}
              ?disabled=${this.busy}
              @click=${() => this._toggleTrackFlag(track, "locked")}>
              ${track.locked ? "🔒" : "🔓"}
            </button>
            <button
              class="icon-btn ${track.muted ? "on" : ""}"
              title=${track.muted ? "Unmute track" : "Mute track"}
              ?disabled=${this.busy}
              @click=${() => this._toggleTrackFlag(track, "muted")}>
              ${track.muted ? "🔇" : "🔊"}
            </button>
            <button
              class="icon-btn"
              title="Move up"
              ?disabled=${this.busy || index === 0}
              @click=${() => this._moveTrack(track, -1)}>
              ↑
            </button>
            <button
              class="icon-btn"
              title="Move down"
              ?disabled=${this.busy || index === this.tracks.length - 1}
              @click=${() => this._moveTrack(track, 1)}>
              ↓
            </button>
            <button
              class="icon-btn"
              title="Delete track"
              ?disabled=${this.busy}
              @click=${() => this._deleteTrack(track)}>
              ✕
            </button>
          </div>
        </div>
        <div
          class="track-lane ${track.locked ? "locked" : ""}"
          style="flex:1;">
          ${track.items.map((item) => this._renderItem(item, track, color))}
        </div>
      </div>
    `;
  }

  _itemLabel(item) {
    if (item.item_text) {
      const t = item.item_text;
      return `“${t.length > 26 ? `${t.slice(0, 26)}…` : t}”`;
    }
    if (item.asset_version_id) {
      return this.clipNames.get(item.asset_version_id) ??
        `clip ${item.asset_version_id.slice(0, 8)}`;
    }
    return "empty item";
  }

  _renderItem(item, track, color) {
    const start = this.dragPreview !== null &&
        this.selectedItemId === item.id
      ? this.dragPreview.start
      : item.start_time;
    const width = Math.max(
      8,
      (item.end_time - item.start_time) * SCALE,
    );
    const peaks = item.asset_version_id ? this.waveforms.get(item.asset_version_id) : undefined;
    const showWave = AUDIO_TRACK_TYPES.includes(track.track_type) &&
      Array.isArray(peaks) && peaks.length > 1;
    return html`
      <div
        class="item ${this.selectedItemId === item.id ? "selected" : ""}"
        style="left:${start * SCALE}px; width:${width}px;
              background:${color}99; border-left-color:${color};"
        @pointerdown=${(e) => this._onItemPointerDown(e, item, track)}
        title="${this._itemLabel(item)} · ${this._formatTime(
          item.start_time,
        )} → ${this._formatTime(item.end_time)}">
        <span class="item-label">${this._itemLabel(item)}</span>
        ${showWave
          ? html`
            <svg
              class="waveform"
              viewBox="0 0 100 24"
              preserveAspectRatio="none"
              aria-hidden="true">
              <polyline
                points=${this._waveformPath(peaks)}
                fill="none"
                stroke="rgba(255,255,255,0.85)"
                stroke-width="0.7"></polyline>
            </svg>
          `
          : null}
      </div>
    `;
  }

  _renderFxPanel() {
    const entry = this.selectedItemId ? this._itemById(this.selectedItemId) : null;
    if (!entry || !this.fx) return null;
    const { item, track } = entry;
    const f = this.fx;
    const textTrack = isTextTrack(track);
    return html`
      <div class="card">
        <div class="card-title">
          Item
          <span style="font-weight:400;text-transform:none;">
            on ${track.name} (${track.track_type}) — ${this._itemLabel(item)}
          </span>
        </div>
        <div class="grid">
          <div class="field">
            <label>Start (s)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              .value=${f.start_time}
              @input=${(e) => (f.start_time = e.target.value)}>
          </div>
          <div class="field">
            <label>End (s)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              .value=${f.end_time}
              @input=${(e) => (f.end_time = e.target.value)}>
          </div>
          <div class="field">
            <label>Speed</label>
            <input
              type="number"
              step="0.05"
              min="0.1"
              .value=${f.speed}
              @input=${(e) => (f.speed = e.target.value)}>
          </div>
          <div class="field">
            <label>Transition</label>
            <select
              .value=${f.transition}
              @change=${(e) => (f.transition = e.target.value)}>
              ${TRANSITIONS.map(
                (t) => html`<option value=${t}>${t === "" ? "none (hard cut)" : t}</option>`,
              )}
            </select>
          </div>
          <div class="field">
            <label>Transition dur (s)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="3"
              ?disabled=${f.transition === ""}
              .value=${f.transition_duration}
              @input=${(e) => (f.transition_duration = e.target.value)}>
          </div>
          <div class="field">
            <label>Fade in (s)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              placeholder="none"
              .value=${f.fade_in}
              @input=${(e) => (f.fade_in = e.target.value)}>
          </div>
          <div class="field">
            <label>Fade out (s)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              placeholder="none"
              .value=${f.fade_out}
              @input=${(e) => (f.fade_out = e.target.value)}>
          </div>
        </div>
        ${textTrack
          ? html`
            <div class="grid">
              <div class="field" style="grid-column:1/-1;">
                <label>Overlay text</label>
                <textarea
                  rows="2"
                  maxlength="512"
                  .value=${f.text}
                  @input=${(e) => (f.text = e.target.value)}></textarea>
              </div>
              <div class="field">
                <label>Font size</label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  placeholder="24"
                  .value=${f.font_size}
                  @input=${(e) => (f.font_size = e.target.value)}>
              </div>
              <div class="field">
                <label>Font color</label>
                <input
                  type="text"
                  placeholder="white / #ff0000"
                  .value=${f.font_color}
                  @input=${(e) => (f.font_color = e.target.value)}>
              </div>
              <div class="field">
                <label>Position</label>
                <select
                  .value=${f.position}
                  @change=${(e) => (f.position = e.target.value)}>
                  <option value="">bottom (default)</option>
                  <option value="top">top</option>
                  <option value="middle">middle</option>
                  <option value="bottom">bottom</option>
                </select>
              </div>
              <div class="field">
                <label>Margin (0–100)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="0"
                  .value=${f.margin}
                  @input=${(e) => (f.margin = e.target.value)}>
              </div>
            </div>
          `
          : null}
        <div>
          <div class="card-title" style="margin-bottom:8px;">Color grade</div>
          <div class="grid">
            <div class="field">
              <label>Brightness (−1..1)</label>
              <input
                type="number"
                step="0.05"
                min="-1"
                max="1"
                placeholder="0"
                .value=${f.brightness}
                @input=${(e) => (f.brightness = e.target.value)}>
            </div>
            <div class="field">
              <label>Contrast (0.25..4)</label>
              <input
                type="number"
                step="0.05"
                min="0.25"
                max="4"
                placeholder="1"
                .value=${f.contrast}
                @input=${(e) => (f.contrast = e.target.value)}>
            </div>
            <div class="field">
              <label>Saturation (0..2)</label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="2"
                placeholder="1"
                .value=${f.saturation}
                @input=${(e) => (f.saturation = e.target.value)}>
            </div>
            <div class="field">
              <label>Temperature (−1..1)</label>
              <input
                type="number"
                step="0.05"
                min="-1"
                max="1"
                placeholder="0"
                .value=${f.temperature}
                @input=${(e) => (f.temperature = e.target.value)}>
            </div>
          </div>
        </div>
        ${this.fxError ? html`<div class="error">${this.fxError}</div>` : null}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button
            class="btn"
            ?disabled=${this.savingFx}
            @click=${this._saveFx}>
            ${this.savingFx ? "Saving..." : "Save item"}
          </button>
          <button
            class="btn btn-secondary"
            ?disabled=${this.busy}
            @click=${this._duplicateItem}>
            Duplicate
          </button>
          <button
            class="btn btn-danger"
            ?disabled=${this.busy}
            @click=${this._deleteItem}>
            Delete
          </button>
        </div>
      </div>
    `;
  }

  _renderMarkersCard() {
    return html`
      <div class="card">
        <div class="card-title">Markers</div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
          <div class="field">
            <label>Time (playhead)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              .value=${this.playhead}
              @input=${(e) => (this.playhead = Number(e.target.value))}>
          </div>
          <div class="field" style="flex:1;min-width:180px;">
            <label>Label</label>
            <input
              type="text"
              .value=${this.markerLabel}
              @input=${(e) => (this.markerLabel = e.target.value)}
              placeholder="Act one starts">
          </div>
          <button
            class="btn btn-secondary"
            ?disabled=${this.busy}
            @click=${this._addMarker}>
            Add marker
          </button>
        </div>
        ${this.markers.length === 0
          ? html`<div class="empty-note">No markers yet.</div>`
          : this.markers.slice()
            .sort((a, b) => a.time - b.time)
            .map(
              (m) =>
                html`
                  <div class="marker-row">
                    <span class="time">${this._formatTime(m.time)}</span>
                    <span
                      style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                      @click=${() => (this.playhead = m.time)}>
                      ${m.label ?? "(no label)"}
                    </span>
                    <button
                      class="icon-btn"
                      title="Delete marker"
                      @click=${() => this._deleteMarker(m)}>
                      ✕
                    </button>
                  </div>
                `,
            )}
      </div>
    `;
  }

  _renderTracksCard() {
    return html`
      <div class="card">
        <div class="card-title">Tracks (${this.tracks.length}/32)</div>
        <div class="add-row">
          <div class="field">
            <label>Type</label>
            <select
              .value=${this.newTrackType}
              @change=${(e) => (this.newTrackType = e.target.value)}>
              ${TRACK_TYPES.map(
                (t) => html`<option value=${t}>${t}</option>`,
              )}
            </select>
          </div>
          <div class="field" style="flex:1;min-width:160px;">
            <label>Name</label>
            <input
              type="text"
              .value=${this.newTrackName}
              @input=${(e) => (this.newTrackName = e.target.value)}
              placeholder=${this.newTrackType}>
          </div>
          <button
            class="btn btn-secondary"
            ?disabled=${this.busy || this.tracks.length >= 32}
            @click=${this._addTrack}>
            Add track
          </button>
          <button
            class="btn btn-primary"
            ?disabled=${this.busy}
            @click=${this._openPlace}>
            ${this.showPlace ? "Hide item placement" : "Place item"}
          </button>
        </div>
        ${this.tracks.length === 0
          ? html`<div class="empty-note">
            No tracks yet. Add a video track, then place clips on it.
          </div>`
          : null}
        ${this.showPlace ? this._renderPlacePanel() : null}
      </div>
    `;
  }

  _renderPlacePanel() {
    const track = this._trackById(this.placeTrackId);
    const textTrack = track ? isTextTrack(track) : false;
    return html`
      <div
        style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;padding:12px;border:1px dashed var(--color-border);border-radius:var(--radius);">
        <div class="field">
          <label>Track</label>
          <select
            .value=${this.placeTrackId}
            @change=${(e) => (this.placeTrackId = e.target.value)}>
            ${this.tracks.map(
              (t) => html`<option value=${t.id}>${t.name} (${t.track_type})</option>`,
            )}
          </select>
        </div>
        <div class="field">
          <label>Start (s)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            .value=${this.placeStart}
            @input=${(e) => (this.placeStart = e.target.value)}>
        </div>
        <div class="field">
          <label>Duration (s)</label>
          <input
            type="number"
            step="0.1"
            min="0.1"
            .value=${this.placeDuration}
            @input=${(e) => (this.placeDuration = e.target.value)}>
        </div>
        ${textTrack
          ? html`
            <div class="field" style="grid-column:1/-1;">
              <label>Text (required)</label>
              <textarea
                rows="2"
                maxlength="512"
                .value=${this.placeText}
                @input=${(e) => (this.placeText = e.target.value)}></textarea>
            </div>
          `
          : html`
            <div class="field">
              <label>Asset</label>
              <select
                .value=${this.placeAssetId}
                @change=${(e) => {
                  this.placeAssetId = e.target.value;
                  this._onPlaceAsset();
                }}>
                <option value="">choose…</option>
                ${this.assets.map(
                  (a) => html`<option value=${a.id}>${a.name}</option>`,
                )}
              </select>
            </div>
            <div class="field">
              <label>Version</label>
              <select
                .value=${this.placeVersionId}
                ?disabled=${!this.placeAssetId || this.placeVersionLoading}
                @change=${(e) => (this.placeVersionId = e.target.value)}>
                ${this.placeVersionLoading
                  ? html`<option>loading…</option>`
                  : this.placeVersions.map(
                    (v) => html`<option value=${v.id}>v${v.version_number}</option>`,
                  )}
              </select>
            </div>
          `}
        <div class="field" style="align-items:flex-end;">
          <button
            class="btn"
            ?disabled=${this.placing}
            @click=${this._placeItem}>
            ${this.placing ? "Placing..." : "Place"}
          </button>
        </div>
        ${this.placeError
          ? html`<div class="error" style="grid-column:1/-1;">${this.placeError}</div>`
          : null}
      </div>
    `;
  }

  _renderSnapshotsCard() {
    return html`
      <div class="card">
        <div class="card-title">Snapshots</div>
        <div style="display:flex;gap:8px;">
          <input
            type="text"
            style="flex:1;"
            .value=${this.snapshotName}
            @input=${(e) => (this.snapshotName = e.target.value)}
            placeholder="Before re-cut">
          <button
            class="btn btn-secondary"
            ?disabled=${this.busy}
            @click=${this._saveSnapshot}>
            Snapshot
          </button>
        </div>
        ${this.snapshots.length === 0
          ? html`<div class="empty-note">No snapshots yet.</div>`
          : this.snapshots.map(
            (s) =>
              html`
                <div class="snap-row">
                  <span style="flex:1;">${s.name}</span>
                  <button
                    class="btn-small"
                    ?disabled=${this.busy}
                    @click=${() => this._restoreSnapshot(s)}>
                    Restore
                  </button>
                  <span class="when">${new Date(
                    s.created_at,
                  ).toLocaleString()}</span>
                </div>
              `,
          )}
      </div>
    `;
  }

  _renderRenderCard() {
    const job = this.renderJob;
    const active = job && !TERMINAL_STATUSES.has(job.status);
    const result = job?.status === "succeeded" ? this._renderExport() : null;
    return html`
      <div class="card">
        <div class="card-title">Render / Export</div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
          <div class="field" style="flex:1;min-width:180px;">
            <label>Preset</label>
            <select
              .value=${this.renderPresetId}
              ?disabled=${this.renderBusy || active}
              @change=${(e) => (this.renderPresetId = e.target.value)}>
              ${this.presets.map(
                (p) => html`<option value=${p.id}>${p.name} (${p.kind})</option>`,
              )}
            </select>
          </div>
          <button
            class="btn"
            ?disabled=${this.renderBusy || active || this.tracks.length === 0}
            @click=${this._queueRender}>
            ${this.renderBusy ? "Queuing..." : "Render"}
          </button>
          ${active
            ? html`
              <button
                class="btn btn-danger"
                ?disabled=${this.renderBusy}
                @click=${this._cancelRender}>
                Cancel
              </button>
            `
            : null}
        </div>
        ${this.renderError ? html`<div class="error">${this.renderError}</div>` : null}
        ${job
          ? html`
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="status-chip ${job.status}">${job.status}</span>
              <span class="chip">${job.engine ?? "engine n/a"}</span>
              <span class="chip" style="margin-left:auto;">
                ${job.progress}%
              </span>
            </div>
            <div class="progress">
              <div
                class="progress-bar"
                style="width:${job.progress}%;"></div>
            </div>
            ${job.error_text ? html`<div class="error">${job.error_text}</div>` : null}
            ${result
              ? html`
                <div class="empty-note">
                  Exported as
                  ${result.asset_id
                    ? html`
                      <a
                        class="link"
                        href="#/asset/${encodeURIComponent(result.asset_id)}">
                                            asset ${result.format}</a>
                    `
                    : html`<span>${result.format}</span>`}
                  · ${new Date(result.created_at).toLocaleString()}
                </div>
              `
              : null}
          `
          : null}
        <div class="card-title" style="margin-top:6px;">Recent exports</div>
        ${this.exports.length === 0
          ? html`<div class="empty-note">No exports for this project yet.</div>`
          : this.exports.slice(0, 5).map(
            (x) =>
              html`
                <div class="export-row">
                  <span>${x.format}</span>
                  ${x.asset_id
                    ? html`
                      <a
                        class="link"
                        href="#/asset/${encodeURIComponent(x.asset_id)}">
                                          view asset</a>
                    `
                    : null}
                  <span class="when">${new Date(
                    x.created_at,
                  ).toLocaleString()}</span>
                </div>
              `,
          )}
      </div>
    `;
  }
}

customElements.define("timeline-detail", TimelineDetail);
