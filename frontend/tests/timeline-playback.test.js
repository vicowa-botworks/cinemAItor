import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert";
import {
  activeAudioItems,
  activeTextItems,
  activeVisual,
  audioVolumeFor,
  fadeFactorAt,
  gradeFilter,
  itemAt,
  playbackRange,
  sourceTimeAt,
} from "../src/timeline-playback.js";

function item({
  id = "i",
  start = 0,
  end = 2,
  offset = 0,
  speed = 1,
  fade_in = null,
  fade_out = null,
  color_grade = null,
} = {}) {
  return {
    id,
    start_time: start,
    end_time: end,
    source_offset: offset,
    speed,
    fade_in,
    fade_out,
    color_grade,
  };
}

function tracks(...defs) {
  return defs.map(
    ({ type, order, locked = false, muted = false, items: itms = [] }, i) => ({
      id: `t${i}`,
      track_type: type,
      track_order: order ?? i,
      locked,
      muted,
      items: itms,
    }),
  );
}

describe("itemAt", () => {
  it("is inclusive of the start and exclusive of the end", () => {
    const i = item({ start: 1, end: 3 });
    assert(itemAt(i, 1));
    assert(itemAt(i, 2));
    assert(!itemAt(i, 3));
    assert(!itemAt(i, 0.99));
  });
});

describe("sourceTimeAt", () => {
  it("maps timeline time through source_offset and speed", () => {
    const i = item({ start: 10, offset: 5, speed: 2 });
    assertEquals(sourceTimeAt(i, 10), 5);
    assertEquals(sourceTimeAt(i, 12), 9);
  });

  it("treats a missing speed as 1", () => {
    const i = item({ speed: null });
    assertEquals(sourceTimeAt(i, 3), 3);
  });
});

describe("fadeFactorAt", () => {
  it("is 1 outside the fade windows", () => {
    const i = item({ end: 4, fade_in: 1, fade_out: 1 });
    assertEquals(fadeFactorAt(i, 1.5), 1);
    assertEquals(fadeFactorAt(i, 2.5), 1);
  });

  it("ramps up across fade_in and down across fade_out", () => {
    const i = item({ end: 5, fade_in: 2, fade_out: 2 });
    assertEquals(fadeFactorAt(i, 0), 0);
    assertEquals(fadeFactorAt(i, 1), 0.5);
    assertEquals(fadeFactorAt(i, 1.5), 0.75);
    assertEquals(fadeFactorAt(i, 3), 1);
    assertEquals(fadeFactorAt(i, 4), 0.5);
    assertEquals(fadeFactorAt(i, 5), 0);
  });

  it("takes the minimum when the fades overlap", () => {
    const i = item({ start: 0, end: 2, fade_in: 2, fade_out: 2 });
    assertEquals(fadeFactorAt(i, 1), 0.5);
    const j = item({ start: 0, end: 4, fade_in: 4, fade_out: 4 });
    assertEquals(fadeFactorAt(j, 2), 0.5);
  });

  it("stays 1 without fades", () => {
    assertEquals(fadeFactorAt(item(), 0.5), 1);
  });
});

describe("activeVisual", () => {
  it("picks the topmost unlocked video/overlay item at t", () => {
    const lower = item({ id: "lower", start: 0, end: 5 });
    const upper = item({ id: "upper", start: 1, end: 3 });
    const ts = tracks(
      { type: "video", order: 0, items: [lower] },
      { type: "overlay", order: 1, items: [upper] },
    );
    assertEquals(activeVisual(ts, 0.5)?.item.id, "lower");
    assertEquals(activeVisual(ts, 2)?.item.id, "upper");
    assertEquals(activeVisual(ts, 4)?.item.id, "lower");
    assertEquals(activeVisual(ts, 6), null);
  });

  it("skips locked tracks and other track types", () => {
    const locked = item({ id: "locked", start: 0, end: 5 });
    const text = item({ id: "text", start: 0, end: 5 });
    const ts = tracks(
      { type: "video", order: 0, locked: true, items: [locked] },
      { type: "text", order: 1, items: [text] },
    );
    assertEquals(activeVisual(ts, 1), null);
  });

  it("reports the mute flag of the winning track", () => {
    const i = item({ start: 0, end: 5 });
    const ts = tracks({ type: "video", order: 0, muted: true, items: [i] });
    assertEquals(activeVisual(ts, 1), { item: i, muted: true });
  });
});

describe("activeAudioItems", () => {
  it("collects items from audio track types only", () => {
    const a = item({ id: "a", start: 0, end: 4 });
    const b = item({ id: "b", start: 2, end: 6 });
    const v = item({ id: "v", start: 0, end: 4 });
    const ts = tracks(
      { type: "music", order: 0, items: [a] },
      { type: "dialogue", order: 1, items: [b] },
      { type: "video", order: 2, items: [v] },
    );
    const at2 = activeAudioItems(ts, 2).map((e) => e.item.id);
    assertEquals(at2.sort(), ["a", "b"]);
    const at5 = activeAudioItems(ts, 5).map((e) => e.item.id);
    assertEquals(at5, ["b"]);
  });
});

describe("activeTextItems", () => {
  it("collects text and subtitle items at t", () => {
    const a = item({ id: "a", start: 0, end: 2 });
    const b = item({ id: "b", start: 1, end: 3 });
    const ts = tracks(
      { type: "text", order: 0, items: [a] },
      { type: "subtitle", order: 1, items: [b] },
      { type: "video", order: 2, items: [item()] },
    );
    assertEquals(
      activeTextItems(ts, 1.5).map((e) => e.item.id).sort(),
      ["a", "b"],
    );
    assertEquals(activeTextItems(ts, 0.5).map((e) => e.item.id), ["a"]);
  });
});

describe("gradeFilter", () => {
  it("is empty for neutral or missing grades", () => {
    assertEquals(gradeFilter(null), "");
    assertEquals(
      gradeFilter({
        brightness: 0,
        contrast: 1,
        saturation: 1,
        temperature: 0,
      }),
      "",
    );
  });

  it("maps the neutral-offset values onto css filters", () => {
    const f = gradeFilter({ brightness: 0.5, contrast: 1.5, saturation: 2 });
    assertEquals(f, "brightness(1.500) contrast(1.500) saturation(2.000)");
  });

  it("approximates temperature with sepia (warm) and hue-rotate (cool)", () => {
    assertEquals(gradeFilter({ temperature: 1 }), "sepia(0.350)");
    assertEquals(
      gradeFilter({ temperature: -1 }),
      "hue-rotate(35.0deg) brightness(0.920)",
    );
  });
});

describe("audioVolumeFor", () => {
  it("applies gain_db as 10^(db/20), matching the renderer scale", () => {
    assertEquals(audioVolumeFor(0, 1), 1);
    assertAlmostEquals(audioVolumeFor(-6, 1), Math.pow(10, -6 / 20));
    assertAlmostEquals(audioVolumeFor(-6, 0.5), Math.pow(10, -6 / 20) * 0.5);
  });

  it("clamps to 0..1", () => {
    assertEquals(audioVolumeFor(30, 1), 1);
    assertAlmostEquals(audioVolumeFor(6, 0.4), 0.4 * Math.pow(10, 6 / 20));
    assertEquals(audioVolumeFor(0, 2), 1);
    assertEquals(audioVolumeFor(0, 0), 0);
  });
});

describe("playbackRange", () => {
  it("returns null for blank, invalid, or inverted values", () => {
    assertEquals(playbackRange("", ""), null);
    assertEquals(playbackRange("", "3"), null);
    assertEquals(playbackRange("3", ""), null);
    assertEquals(playbackRange("-1", "3"), null);
    assertEquals(playbackRange("3", "3"), null);
    assertEquals(playbackRange("5", "2"), null);
  });

  it("parses a valid range (also from numbers)", () => {
    assertEquals(playbackRange("1", "4"), { from: 1, to: 4 });
    assertEquals(playbackRange(1, 4), { from: 1, to: 4 });
  });
});
