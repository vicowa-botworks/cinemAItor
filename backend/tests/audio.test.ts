import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import * as schema from "../src/db/schema.ts";
import { getDb, resetDb } from "../src/db/database.ts";
import { createAsset, createAssetVersion } from "../src/db/assets.ts";
import {
  getAudioVersion,
  parseAudioMetadata,
  setAudioAdjustments,
  setAudioAnalysis,
} from "../src/db/audio.ts";

let ownerId: number;
let assetId: string;

function makeWav(seconds: number, sampleRate = 8000) {
  // Minimal valid PCM WAV; valid enough for ffprobe to parse.
  const n = Math.floor(seconds * sampleRate);
  const dataSize = n * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < n; i++) {
    view.setInt16(44 + i * 2, Math.floor(Math.sin(i / 10) * 3000), true);
  }
  return new Uint8Array(buf);
}

describe("audio version metadata", () => {
  beforeEach(() => {
    resetDb();
    getDb(":memory:");
    ownerId = schema.createUser("owner@example.com", "hash123", "Owner", "admin");
    assetId = createAsset(
      {
        unique_slug: `mus_${Math.random().toString(36).slice(2, 8)}`,
        display_name: "Music",
        asset_type: "music",
        library_scope: "global",
      },
      ownerId,
    ).id;
  });

  afterEach(() => {
    resetDb();
  });

  async function seedVersion(): Promise<string> {
    const appData = Deno.makeTempDirSync({ prefix: "cinemaitor_audio_db_" });
    try {
      const wavPath = `${appData}/seed.wav`;
      await Deno.writeFile(wavPath, makeWav(0.5));
      const version = createAssetVersion(assetId, ownerId, {
        content_hash: "a".repeat(64),
        file_path: wavPath,
        format: "wav",
        mime_type: "audio/wav",
        file_size: 16044,
        make_active: true,
      });
      return version.id;
    } finally {
      Deno.removeSync(appData, { recursive: true });
    }
  }

  it("parses audio metadata from technical metadata", async () => {
    const versionId = await seedVersion();
    const analysis = {
      audio: {
        duration: 0.5,
        sample_rate: 8000,
        channels: 1,
        bit_rate: null,
        waveform: { bucket_count: 3, peaks: [0.1, 0.2, 0.3] },
        analysis_status: "analyzed",
        analysis_error: null,
        adjustments: {},
      },
    };
    setAudioAnalysis(versionId, analysis.audio as Record<string, unknown>);
    const view = getAudioVersion(versionId);
    assert(view);
    assertEquals(view.audio?.duration, 0.5);
    assertEquals((view.audio?.waveform as { peaks: number[] }).peaks.length, 3);
    assertEquals(parseAudioMetadata(view.version)?.sample_rate, 8000);
  });

  it("merges adjustments without touching the rest of the metadata", async () => {
    const versionId = await seedVersion();
    setAudioAnalysis(versionId, {
      duration: 0.5,
      sample_rate: 8000,
      analysis_status: "analyzed",
      adjustments: {},
    });
    const updated = setAudioAdjustments(versionId, { gain_db: 3 });
    assert(updated);
    assertEquals((updated.audio?.adjustments as { gain_db: number }).gain_db, 3);
    assertEquals(updated.audio?.duration, 0.5);

    const again = setAudioAdjustments(versionId, {
      trim: { start: 0.1, end: 0.4 },
    });
    assert(again);
    const adjustments = again.audio?.adjustments as Record<string, unknown>;
    assertEquals(adjustments.gain_db, 3);
    assertEquals(adjustments.trim, { start: 0.1, end: 0.4 });
  });

  it("returns undefined for unknown versions", () => {
    assertEquals(getAudioVersion("nope"), undefined);
    assertEquals(setAudioAdjustments("nope", {}), undefined);
    assertEquals(setAudioAnalysis("nope", {}), undefined);
    void getDb;
  });
});
