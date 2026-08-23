import { getDb } from "./database.ts";
import { type AssetVersion, getAssetVersion } from "./assets.ts";

export const AUDIO_ASSET_TYPES = ["audio", "music", "sfx", "voiceover", "ambience"] as const;
export type AudioAssetType = (typeof AUDIO_ASSET_TYPES)[number];

export function isAudioAssetType(value: string): value is AudioAssetType {
  return (AUDIO_ASSET_TYPES as readonly string[]).includes(value);
}

export interface AudioVersionView {
  version: AssetVersion;
  audio: Record<string, unknown> | null;
}

export function parseAudioMetadata(
  version: AssetVersion,
): Record<string, unknown> | null {
  if (!version.technical_metadata_json) return null;
  try {
    const parsed = JSON.parse(version.technical_metadata_json) as {
      audio?: Record<string, unknown>;
    };
    return parsed.audio ?? null;
  } catch {
    return null;
  }
}

export function getAudioVersion(
  versionId: string,
): AudioVersionView | undefined {
  const version = getAssetVersion(versionId);
  if (!version) return undefined;
  return { version, audio: parseAudioMetadata(version) };
}

/** Replace the version's audio analysis metadata (duration/waveform/etc). */
export function setAudioAnalysis(
  versionId: string,
  audio: Record<string, unknown>,
): AudioVersionView | undefined {
  const db = getDb();
  (db.prepare(
    "UPDATE asset_versions SET technical_metadata_json = ? WHERE id = ?",
  ).run as (...params: unknown[]) => unknown)(JSON.stringify({ audio }), versionId);
  return getAudioVersion(versionId);
}

/**
 * Merge non-destructive edits (trim, gain) into the version's audio metadata.
 * No new file or version is created; a renderer applies these at render time.
 */
export function setAudioAdjustments(
  versionId: string,
  adjustments: Record<string, unknown>,
): AudioVersionView | undefined {
  const current = getAudioVersion(versionId);
  if (!current) return undefined;
  const audio: Record<string, unknown> = { ...(current.audio ?? {}) };
  const existing = (audio.adjustments ?? {}) as Record<string, unknown>;
  audio.adjustments = { ...existing, ...adjustments };
  const merged = JSON.stringify({ audio });
  const db = getDb();
  (db.prepare(
    "UPDATE asset_versions SET technical_metadata_json = ? WHERE id = ?",
  ).run as (...params: unknown[]) => unknown)(merged, versionId);
  return getAudioVersion(versionId);
}
