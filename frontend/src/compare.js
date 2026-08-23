// Shared pure helpers for A/B comparison (review board) and version
// comparison (asset detail). Both UIs pick exactly two items of the same
// asset/job and render them side by side; these helpers keep the selection
// rules and the version-diff building in one testable place.

export const COMPARE_PAIR_SIZE = 2;

/**
 * Toggle an id in a compare-selection (at most COMPARE_PAIR_SIZE entries).
 * Selecting a third replaces the oldest entry so the newest two are always
 * compared. Returns a new array; `current` is never mutated.
 */
export function toggleComparePair(current, id) {
  const list = [...(Array.isArray(current) ? current : [])];
  const idx = list.indexOf(id);
  if (idx >= 0) {
    list.splice(idx, 1);
    return list;
  }
  list.push(id);
  while (list.length > COMPARE_PAIR_SIZE) list.shift();
  return list;
}

/**
 * Resolve a selection against an item list into `{ a, b }` in selection
 * order. `getId` extracts each item's id. Returns null unless exactly two
 * distinct selected ids resolve to items.
 */
export function resolveComparePair(items, getId, selectedIds) {
  const byId = new Map();
  for (const item of items ?? []) {
    const id = getId(item);
    if (id !== null && id !== undefined) byId.set(String(id), item);
  }
  const seen = new Set();
  const resolved = [];
  for (const id of selectedIds ?? []) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (byId.has(key)) resolved.push(byId.get(key));
  }
  if (resolved.length !== COMPARE_PAIR_SIZE) return null;
  return { a: resolved[0], b: resolved[1] };
}

/** True for media types with a time axis (playback can be synchronized). */
export function isTimeMedia(assetType) {
  return assetType === "video" || assetType === "audio";
}

function isMediaElement(el) {
  return (
    el !== null &&
    typeof el === "object" &&
    typeof el.play === "function" &&
    typeof el.pause === "function" &&
    typeof el.currentTime === "number"
  );
}

/**
 * Keeps the players of an A/B pane in sync (play/pause/stop all, seek
 * mirroring). Works with any object exposing play/pause/currentTime so it
 * can be unit-tested without a DOM.
 */
export class CompareSync {
  constructor() {
    this._players = new Map();
    this._lock = false;
  }

  setPlayer(key, el) {
    if (el) this._players.set(key, el);
    else this._players.delete(key);
  }

  clear() {
    this._players.clear();
  }

  each(fn) {
    for (const el of this._players.values()) {
      if (isMediaElement(el)) fn(el);
    }
  }

  play() {
    this.each((el) => {
      el.play()?.catch?.(() => {});
    });
  }

  pause() {
    this.each((el) => el.pause());
  }

  stop() {
    this.each((el) => {
      el.pause();
      el.currentTime = 0;
    });
  }

  /** Handler to bind to each player's "seeked" event. */
  handleSeeked(e) {
    const src = e?.currentTarget;
    if (this._lock || !isMediaElement(src)) return;
    const t = src.currentTime;
    this._lock = true;
    this.each((el) => {
      if (el !== src && Math.abs(el.currentTime - t) > 0.25) el.currentTime = t;
    });
    setTimeout(() => {
      this._lock = false;
    }, 0);
  }
}

function dash(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function bytes(size) {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = size;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function audioMetaOf(version) {
  if (!version || !version.technical_metadata_json) return null;
  try {
    const audio = JSON.parse(version.technical_metadata_json)?.audio;
    return audio && typeof audio === "object" ? audio : null;
  } catch {
    return null;
  }
}

function trimOf(adjustments) {
  const t = adjustments?.trim;
  return t && typeof t === "object" ? t : "";
}

/**
 * Build the side-by-side comparison table for two asset version rows (the
 * full rows returned by listAssetVersions). Returns
 * `[{ label, a, b, differs }]` with display-ready strings; "—" marks absent
 * values. `differs` flags the rows whose two values do not match.
 */
export function versionCompareRows(va, vb) {
  const rows = [];
  const push = (label, rawA, rawB, fmt = String) => {
    const a = fmt(rawA);
    const b = fmt(rawB);
    rows.push({ label, a, b, differs: a !== b });
  };
  push("Version", `v${va?.version_number ?? "?"}`, `v${vb?.version_number ?? "?"}`);
  push("Format", va?.format ?? "", vb?.format ?? "", dash);
  push("Size", va?.file_size ?? "", vb?.file_size ?? "", (s) => s === "" ? "—" : bytes(s) || "—");
  push(
    "Created",
    va?.created_at ?? "",
    vb?.created_at ?? "",
    (s) => s === "" ? "—" : new Date(s).toLocaleDateString() || "—",
  );
  push("Proxy", va?.proxy_path ? "ready" : "none", vb?.proxy_path ? "ready" : "none");
  const audioA = audioMetaOf(va);
  const audioB = audioMetaOf(vb);
  push(
    "Duration",
    audioA?.duration ?? "",
    audioB?.duration ?? "",
    (s) => s === "" ? "—" : `${Number(s).toFixed(3)} s`,
  );
  const adjA = audioA?.adjustments ?? null;
  const adjB = audioB?.adjustments ?? null;
  push(
    "Gain",
    adjA?.gain_db ?? "",
    adjB?.gain_db ?? "",
    (s) => s === "" || s === 0 ? "—" : `${s} dB`,
  );
  push("Trim", trimOf(adjA), trimOf(adjB), (t) => (t === "" ? "—" : `${t.start}–${t.end} s`));
  push("Notes", va?.notes ?? "", vb?.notes ?? "", dash);
  return rows;
}
