// Pure client-side undo/redo history for timeline full-state. Kept in memory
// only: a refresh clears it (durable checkpoints stay server-side snapshots).
//
// Entries carry the flattened full-state body accepted by
// `POST /timelines/:id/state` (duration, settings, tracks without nested
// items, flat items, markers). `detailToState` builds one from the timeline
// detail response shape, which is both what the UI has on hand and what the
// state-restore endpoint returns, so apply/reload stay symmetric.

export const MAX_HISTORY = 50;

function stripNestedItems(track) {
  const copy = { ...track };
  delete copy.items;
  return copy;
}

/** Convert a timeline detail response into a restorable full-state body. */
export function detailToState(detail) {
  const tracks = detail.tracks ?? [];
  return {
    duration: detail.timeline?.duration ?? 0,
    settings: detail.timeline?.settings ?? null,
    tracks: tracks.map(stripNestedItems),
    items: tracks.flatMap((t) => t.items ?? []),
    markers: detail.markers ?? [],
  };
}

/**
 * Bounded linear history. `push(previous)` is called right before applying a
 * change the server accepted; `undo()`/`redo()` return the stored state to
 * send back (they do not apply it themselves). A new change after a partial
 * undo discards the redo tail, as in editors.
 */
export class UndoHistory {
  constructor({ max = MAX_HISTORY, onChange } = {}) {
    this.max = max;
    this.onChange = onChange;
    this._past = [];
    this._future = [];
  }

  get canUndo() {
    return this._past.length > 0;
  }

  get canRedo() {
    return this._future.length > 0;
  }

  /** Previous labels, oldest first — drives button tooltips. */
  get undoLabel() {
    return this._past.length ? this._past[this._past.length - 1].label : "";
  }

  get redoLabel() {
    return this._future.length ? this._future[this._future.length - 1].label : "";
  }

  push(previous, label = "") {
    this._past.push({ state: previous, label });
    if (this._past.length > this.max) this._past.shift();
    this._future.length = 0;
    this._notify();
  }

  /** Pop the next undo target, or undefined when there is none. */
  undo() {
    const entry = this._past.pop();
    // Undoing older states goes to the front of the redo stack so that
    // `redo()` replays them in the original order.
    if (entry) this._future.unshift(entry);
    this._notify();
    return entry?.state;
  }

  /** Pop the next redo target, or undefined when there is none. */
  redo() {
    const entry = this._future.pop();
    if (entry) this._past.push(entry);
    this._notify();
    return entry?.state;
  }

  /**
   * Roll back a failed apply: after `undo()`/`redo()` popped the entry it may
   * still be in the wrong stack if the server restore failed, so find the
   * entry by state identity and put it where it came from (the end of the
   * stack that pops it, so retrying repeats the same step).
   */
  rollback(state) {
    const fi = this._future.findIndex((x) => x.state === state);
    if (fi !== -1) {
      const [entry] = this._future.splice(fi, 1);
      this._past.push(entry);
      this._notify();
      return;
    }
    const pi = this._past.findIndex((x) => x.state === state);
    if (pi !== -1) {
      const [entry] = this._past.splice(pi, 1);
      this._future.push(entry);
      this._notify();
    }
  }

  clear() {
    this._past.length = 0;
    this._future.length = 0;
    this._notify();
  }

  _notify() {
    if (typeof this.onChange === "function") this.onChange();
  }
}
