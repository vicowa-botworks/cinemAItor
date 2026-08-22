import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import { detailToState, MAX_HISTORY, UndoHistory } from "../src/undo-history.js";

function detail(tracks = [], markers = [], duration = 10) {
  return {
    timeline: { duration, settings: { fps: 24 } },
    tracks,
    markers,
  };
}

describe("detailToState", () => {
  it("flattens nested items and strips them from track rows", () => {
    const d = detail(
      [
        {
          id: "t1",
          track_type: "video",
          items: [{ id: "i1", track_id: "t1" }, { id: "i2", track_id: "t1" }],
        },
        { id: "t2", track_type: "text", items: [] },
      ],
      [{ id: "m1", label: "x" }],
      7,
    );
    const s = detailToState(d);
    assertEquals(s.duration, 7);
    assertEquals(s.settings, { fps: 24 });
    assertEquals(s.tracks.map((t) => t.id), ["t1", "t2"]);
    assertEquals(s.tracks[0].items, undefined);
    assertEquals(s.items.map((i) => i.id), ["i1", "i2"]);
    assertEquals(s.markers, [{ id: "m1", label: "x" }]);
  });

  it("tolerates a minimal detail", () => {
    const s = detailToState({});
    assertEquals(s.duration, 0);
    assertEquals(s.settings, null);
    assertEquals(s.tracks, []);
    assertEquals(s.items, []);
    assertEquals(s.markers, []);
  });
});

describe("UndoHistory", () => {
  it("push/undo/redo round trip", () => {
    const h = new UndoHistory();
    assertEquals(h.canUndo, false);
    h.push({ v: 0 }, "load");
    assertEquals(h.canUndo, true);
    h.push({ v: 1 }, "change A");
    assertEquals(h.undoLabel, "change A");

    assertEquals(h.undo(), { v: 1 });
    assertEquals(h.redoLabel, "change A");
    assertEquals(h.undo(), { v: 0 });
    assertEquals(h.canUndo, false);

    assertEquals(h.redo(), { v: 1 });
    assertEquals(h.canRedo, true);
    assertEquals(h.redo(), { v: 0 });
    assertEquals(h.canRedo, false);
  });

  it("a new push after undo discards the redo tail", () => {
    const h = new UndoHistory();
    h.push({ v: 0 });
    h.push({ v: 1 });
    h.push({ v: 2 });
    h.undo();
    assertEquals(h.canRedo, true);
    h.push({ v: 3 });
    assertEquals(h.canRedo, false);
    assertEquals(h.undo(), { v: 3 });
  });

  it("fires onChange on every mutation", () => {
    let calls = 0;
    const h = new UndoHistory({ onChange: () => calls++ });
    h.push({ v: 0 });
    h.undo();
    h.redo();
    h.clear();
    assertEquals(calls, 4);
  });

  it("bounds the past to max entries, dropping the oldest", () => {
    const h = new UndoHistory({ max: 2 });
    h.push({ v: 0 });
    h.push({ v: 1 });
    h.push({ v: 2 });
    assertEquals(h.undo(), { v: 2 });
    assertEquals(h.undo(), { v: 1 });
    assertEquals(h.canUndo, false);
    assertEquals(MAX_HISTORY, 50);
  });

  it("rollback puts a failed undo back on the undo stack", () => {
    const h = new UndoHistory();
    const s0 = { v: 0 };
    const s1 = { v: 1 };
    h.push(s0);
    h.push(s1);
    const undone = h.undo();
    assertEquals(h.canRedo, true);
    h.rollback(undone);
    assertEquals(h.canRedo, false);
    assertEquals(h.canUndo, true);
    assertEquals(h.undo(), s1);
  });

  it("rollback puts a failed redo back on the redo stack", () => {
    const h = new UndoHistory();
    const s0 = { v: 0 };
    const s1 = { v: 1 };
    h.push(s0);
    h.push(s1);
    h.undo();
    const redone = h.redo();
    h.rollback(redone);
    assertEquals(h.canUndo, true);
    assertEquals(h.redo(), s1);
  });

  it("clear drops both stacks", () => {
    const h = new UndoHistory();
    h.push({ v: 0 });
    h.push({ v: 1 });
    h.undo();
    h.clear();
    assertEquals(h.canUndo, false);
    assertEquals(h.canRedo, false);
    assert(h.undo() === undefined);
  });
});
