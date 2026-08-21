import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals } from "jsr:@std/assert";
import {
  audioFormFromMeta,
  parseAudioMetadata,
  validateAudioAdjustments,
} from "../src/audio-adjustments.js";

describe("parseAudioMetadata", () => {
  it("returns null for empty or invalid json", () => {
    assertEquals(parseAudioMetadata(null), null);
    assertEquals(parseAudioMetadata(""), null);
    assertEquals(parseAudioMetadata("not json"), null);
  });

  it("returns null when there is no audio object", () => {
    assertEquals(parseAudioMetadata(JSON.stringify({ video: { duration: 2 } })), null);
  });

  it("returns the audio object", () => {
    const meta = { audio: { duration: 3.5, waveform: { peaks: [0.1] } } };
    assertEquals(parseAudioMetadata(JSON.stringify(meta)), meta.audio);
  });
});

describe("audioFormFromMeta", () => {
  it("prefills empty values when there are no adjustments", () => {
    assertEquals(
      audioFormFromMeta({ duration: 3 }),
      { start: "", end: "", gain: "" },
    );
    assertEquals(audioFormFromMeta(null), { start: "", end: "", gain: "" });
  });

  it("prefills stored trim and gain", () => {
    const form = audioFormFromMeta({
      adjustments: { trim: { start: 0.5, end: 2.5 }, gain_db: -3 },
    });
    assertEquals(form, { start: "0.5", end: "2.5", gain: "-3" });
  });

  it("treats a stored 0 dB gain as unset", () => {
    const form = audioFormFromMeta({ adjustments: { gain_db: 0 } });
    assertEquals(form.gain, "");
  });
});

describe("validateAudioAdjustments", () => {
  it("fills blank fields with the neutral values", () => {
    assertEquals(
      validateAudioAdjustments({ start: "", end: "", gain: "" }, 4),
      { trim: { start: 0, end: 4 }, gain_db: 0 },
    );
  });

  it("passes explicit values through", () => {
    assertEquals(
      validateAudioAdjustments({ start: "1", end: "2.5", gain: "-6" }, 10),
      { trim: { start: 1, end: 2.5 }, gain_db: -6 },
    );
  });

  it("allows the end to be blank only when the duration is unknown", () => {
    assert(validateAudioAdjustments({ start: "0", end: "", gain: "" }, null).error);
  });

  it("rejects a non-numeric form value", () => {
    assert(
      validateAudioAdjustments({ start: "abc", end: "2", gain: "" }, 5).error,
    );
  });

  it("rejects start < 0 and end <= start", () => {
    assert(
      validateAudioAdjustments({ start: "-1", end: "2", gain: "" }, 5).error,
    );
    assert(
      validateAudioAdjustments({ start: "2", end: "2", gain: "" }, 5).error,
    );
    assert(
      validateAudioAdjustments({ start: "3", end: "2", gain: "" }, 5).error,
    );
  });

  it("rejects a trim end beyond the known duration", () => {
    const result = validateAudioAdjustments({ start: "0", end: "12", gain: "" }, 10);
    assert(result.error);
    assert(result.error.includes("12"));
  });

  it("allows a trim end at the duration boundary", () => {
    const result = validateAudioAdjustments({ start: "0", end: "10", gain: "" }, 10);
    assertEquals(result, { trim: { start: 0, end: 10 }, gain_db: 0 });
  });

  it("rejects gain outside -60..24 dB", () => {
    assert(validateAudioAdjustments({ start: "", end: "", gain: "-60.5" }, 5).error);
    assert(validateAudioAdjustments({ start: "", end: "", gain: "24.5" }, 5).error);
  });

  it("accepts the gain boundary values", () => {
    assertEquals(
      validateAudioAdjustments({ start: "", end: "", gain: "-60" }, 5),
      { trim: { start: 0, end: 5 }, gain_db: -60 },
    );
    assertEquals(
      validateAudioAdjustments({ start: "", end: "", gain: "24" }, 5),
      { trim: { start: 0, end: 5 }, gain_db: 24 },
    );
  });
});
