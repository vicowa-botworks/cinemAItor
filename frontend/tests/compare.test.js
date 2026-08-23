import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import {
  COMPARE_PAIR_SIZE,
  CompareSync,
  isTimeMedia,
  resolveComparePair,
  toggleComparePair,
  versionCompareRows,
} from "../src/compare.js";

describe("toggleComparePair", () => {
  it("selects up to two ids in selection order", () => {
    assertEquals(toggleComparePair([], "v1"), ["v1"]);
    assertEquals(toggleComparePair(["v1"], "v2"), ["v1", "v2"]);
  });

  it("does not grow past the pair size", () => {
    assertEquals(
      toggleComparePair(["v1", "v2"], "v3"),
      ["v2", "v3"],
    );
  });

  it("deselects an id already in the selection", () => {
    assertEquals(toggleComparePair(["v1", "v2"], "v1"), ["v2"]);
    assertEquals(toggleComparePair(["v1"], "v1"), []);
  });

  it("re-selecting after replacement keeps the newest two", () => {
    let sel = toggleComparePair([], "v1");
    sel = toggleComparePair(sel, "v2");
    sel = toggleComparePair(sel, "v3"); // v1 drops out
    sel = toggleComparePair(sel, "v1"); // v2 drops out
    assertEquals(sel, ["v3", "v1"]);
  });

  it("never mutates its input", () => {
    const current = ["v1"];
    toggleComparePair(current, "v2");
    assertEquals(current, ["v1"]);
  });

  it("treats a missing selection as empty", () => {
    assertEquals(toggleComparePair(null, "v1"), ["v1"]);
    assertEquals(toggleComparePair(undefined, "v1"), ["v1"]);
  });
});

describe("resolveComparePair", () => {
  const items = [
    { id: "v1", value: 1 },
    { id: "v2", value: 2 },
    { id: "v3", value: 3 },
  ];
  const getId = (item) => item.id;

  it("resolves the selected ids into { a, b } in selection order", () => {
    const pair = resolveComparePair(items, getId, ["v2", "v1"]);
    assertEquals(pair, { a: { id: "v2", value: 2 }, b: { id: "v1", value: 1 } });
  });

  it("returns null with fewer than two selections", () => {
    assertEquals(resolveComparePair(items, getId, []), null);
    assertEquals(resolveComparePair(items, getId, ["v1"]), null);
  });

  it("ignores ids that do not resolve to items", () => {
    assertEquals(resolveComparePair(items, getId, ["nope", "v1"]), null);
    const pair = resolveComparePair(items, getId, ["nope", "v1", "v2"]);
    assertEquals(pair?.a?.id, "v1");
  });

  it("skips duplicate selections", () => {
    assertEquals(resolveComparePair(items, getId, ["v1", "v1"]), null);
  });

  it("matches ids as strings against nested item shapes", () => {
    const byVersion = (c) => c.asset_version.id;
    const candidates = [
      { asset_version: { id: "a" } },
      { asset_version: { id: "b" } },
    ];
    const pair = resolveComparePair(candidates, byVersion, ["b", "a"]);
    assertEquals(pair?.a?.asset_version.id, "b");
    assertEquals(pair?.b?.asset_version.id, "a");
  });
});

describe("isTimeMedia", () => {
  it("is true for video and audio, false for still images and text", () => {
    assertEquals(isTimeMedia("video"), true);
    assertEquals(isTimeMedia("audio"), true);
    assertEquals(isTimeMedia("music"), false);
    assertEquals(isTimeMedia("image"), false);
    assertEquals(isTimeMedia("subtitle"), false);
  });
});

describe("versionCompareRows", () => {
  const base = {
    version_number: 1,
    format: "mp4",
    file_size: 2048,
    proxy_path: "media/proxy.mp4",
    created_at: "2026-08-23T10:00:00Z",
  };

  it("labels rows and flags differing values", () => {
    const rows = versionCompareRows(base, {
      ...base,
      version_number: 2,
      file_size: 4096,
      proxy_path: null,
    });
    assertEquals(
      rows.map((r) => r.label),
      ["Version", "Format", "Size", "Created", "Proxy", "Duration", "Gain", "Trim", "Notes"],
    );
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    assertEquals(byLabel.Format.differs, false);
    assertEquals(byLabel.Size.differs, true);
    assertEquals(byLabel.Proxy, {
      label: "Proxy",
      a: "ready",
      b: "none",
      differs: true,
    });
    assertEquals(byLabel.Version.a, "v1");
    assertEquals(byLabel.Version.b, "v2");
  });

  it("formats sizes human-readably", () => {
    const rows = versionCompareRows(
      { ...base, file_size: 1024 },
      { ...base, file_size: 5 * 1024 * 1024 },
    );
    const size = rows.find((r) => r.label === "Size");
    assertEquals(size.a, "1.0 KB");
    assertEquals(size.b, "5.0 MB");
  });

  it("shows audio duration, gain and trim from the metadata", () => {
    const withMeta = (meta) => ({
      ...base,
      technical_metadata_json: JSON.stringify({ audio: meta }),
    });
    const rows = versionCompareRows(
      withMeta({ duration: 12.5 }),
      withMeta({
        duration: 12.5,
        adjustments: { trim: { start: 1, end: 10 }, gain_db: -3 },
      }),
    );
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    assertEquals(byLabel.Duration.a, "12.500 s");
    assertEquals(byLabel.Duration.differs, false);
    assertEquals(byLabel.Gain.a, "—");
    assertEquals(byLabel.Gain.b, "-3 dB");
    assertEquals(byLabel.Trim.a, "—");
    assertEquals(byLabel.Trim.b, "1–10 s");
  });

  it("treats gain 0 and zero-size as absent", () => {
    const rows = versionCompareRows(
      {
        ...base,
        file_size: 0,
        technical_metadata_json: JSON.stringify({
          audio: { adjustments: { gain_db: 0, trim: { start: 0, end: 5 } } },
        }),
      },
      base,
    );
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    assertEquals(byLabel.Size.a, "—");
    assertEquals(byLabel.Gain.a, "—");
    assertEquals(byLabel.Trim.a, "0–5 s");
  });

  it("tolerates broken metadata and missing fields", () => {
    const rows = versionCompareRows(
      { version_number: 1, technical_metadata_json: "{not json" },
      {},
    );
    for (const row of rows) {
      assert(typeof row.a === "string" && typeof row.b === "string");
    }
    assertEquals(rows.find((r) => r.label === "Duration").a, "—");
    assertEquals(rows.find((r) => r.label === "Version").a, "v1");
  });
});

describe("CompareSync", () => {
  function fakePlayer(time = 0) {
    return {
      played: 0,
      paused: 0,
      currentTime: time,
      play() {
        this.played++;
        return Promise.resolve();
      },
      pause() {
        this.paused++;
      },
    };
  }

  it("registers players by key and removes them", () => {
    const sync = new CompareSync();
    const a = fakePlayer();
    const b = fakePlayer();
    sync.setPlayer("a", a);
    sync.setPlayer("b", b);
    sync.each(() => {});
    sync.setPlayer("a", null);
    let count = 0;
    sync.each(() => count++);
    assertEquals(count, 1);
  });

  it("ignores elements that do not expose a media API", () => {
    const sync = new CompareSync();
    sync.setPlayer("node", { tagName: "DIV" });
    sync.setPlayer("bogus", { not: "media" });
    let count = 0;
    sync.each(() => count++);
    assertEquals(count, 0);
  });

  it("plays and pauses every media player", () => {
    const sync = new CompareSync();
    const a = fakePlayer();
    const b = fakePlayer();
    sync.setPlayer("a", a);
    sync.setPlayer("b", b);
    sync.play();
    sync.pause();
    assertEquals(a.played, 1);
    assertEquals(b.played, 1);
    assertEquals(a.paused, 1);
    assertEquals(b.paused, 1);
  });

  it("stop pauses and rewinds", () => {
    const sync = new CompareSync();
    const a = fakePlayer(10);
    sync.setPlayer("a", a);
    sync.stop();
    assertEquals(a.currentTime, 0);
    assertEquals(a.paused, 1);
  });

  it("mirrors seeks between players that drifted", () => {
    const sync = new CompareSync();
    const a = fakePlayer(0);
    const b = fakePlayer(0);
    sync.setPlayer("a", a);
    sync.setPlayer("b", b);
    a.currentTime = 5;
    sync.handleSeeked({ currentTarget: a });
    assertEquals(b.currentTime, 5);
  });

  it("does not mirror small drift (under 0.25s)", () => {
    const sync = new CompareSync();
    const a = fakePlayer(0);
    const b = fakePlayer(0.1);
    sync.setPlayer("a", a);
    sync.setPlayer("b", b);
    a.currentTime = 0.2;
    sync.handleSeeked({ currentTarget: a });
    assertEquals(b.currentTime, 0.1);
  });

  it("tolerates events without a current target", () => {
    const sync = new CompareSync();
    const a = fakePlayer();
    sync.setPlayer("a", a);
    sync.handleSeeked({});
    sync.handleSeeked(null);
    assertEquals(a.currentTime, 0);
  });
});

describe("COMPARE_PAIR_SIZE", () => {
  it("is two", () => {
    assertEquals(COMPARE_PAIR_SIZE, 2);
  });
});
