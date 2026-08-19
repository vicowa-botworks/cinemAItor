# Audio

Import, versioning, non-destructive trim/gain and waveform access for audio assets (Workstream 11,
Milestone 6 part 1).

## Concepts

- Audio assets are regular library assets with audio `asset_type`
  (`audio | music | sfx | voiceover | ambience`); versions are immutable, content-addressed files
  (wav/mp3/flac/ogg/m4a/aac).
- **Technical metadata** lives in `asset_versions.technical_metadata_json` under the `audio` key:
  - `duration`, `sample_rate`, `channels`, `bit_rate` — from ffprobe when the configured ffmpeg
    binary is available.
  - `waveform` — 200 peak-amplitude buckets (0..1) computed by decoding to mono s16le at 8 kHz.
  - `analysis_status` — `analyzed | unavailable | failed`; uploads never require ffmpeg (metadata
    stays null until analysis succeeds).
  - `adjustments` — non-destructive editorial parameters applied at render time (this workstream):
    `trim: {start, end}` (seconds), `gain_db` (-60..24). No new file/version is created.
- The waveform endpoint re-analyzes on demand when a version was stored before ffmpeg became
  available; a 503 is returned while analysis is impossible.

## Endpoints

| Method | Endpoint                                                   | Description                                                                                                                       |
| ------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/audio/upload`                                     | Multipart upload (fields: `asset_type?`, `display_name?`, `project_id?`, `notes?` + `file`) → creates the audio asset + version 1 |
| GET    | `/api/v1/audio/assets`                                     | List audio assets (filters: `asset_type`, `project_id`, `library_scope`)                                                          |
| POST   | `/api/v1/audio/assets/:id/versions`                        | New version: multipart `file`, or JSON `{content_hash, notes?}` for stored content                                                |
| PATCH  | `/api/v1/audio/assets/:id/versions/:versionId/adjustments` | Set `trim` and/or `gain_db` (merged, validated against known duration)                                                            |
| GET    | `/api/v1/audio/assets/:id/versions/:versionId/waveform`    | `{version_id, waveform, duration}` or 503 while unanalyzable                                                                      |

All endpoints require authentication; mutations follow asset write permissions (project scope
included).
