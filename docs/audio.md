# Audio

Import, generation, versioning, non-destructive trim/gain and waveform access for audio assets
(Workstream 11 + Workstream 14 audio generation).

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

| Method | Endpoint                                                   | Description                                                                                                                                                           |
| ------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/audio/generate`                                   | Generate from prompt: `{kind: music\|voiceover\|sfx, prompt, project_id?\|scene_id?, model_id?, seed?, settings?}` → `202 {job_id, job_type, asset_id, model_id}`     |
| POST   | `/api/v1/audio/upload`                                     | Multipart upload (fields: `asset_type?`, `display_name?`, `project_id?`, `notes?` + `file`) → creates the audio asset + version 1                                     |
| GET    | `/api/v1/audio/assets`                                     | List audio assets (filters: `asset_type`, `project_id`, `library_scope`)                                                                                              |
| POST   | `/api/v1/audio/assets/:id/versions`                        | New version: multipart `file`, or JSON `{content_hash, notes?}` for stored content                                                                                    |
| PATCH  | `/api/v1/audio/assets/:id/versions/:versionId/adjustments` | Set `trim` and/or `gain_db` (merged, validated against known duration); edited from the Asset Detail "Audio adjustments" section (waveform, trim window, gain, reset) |
| GET    | `/api/v1/audio/assets/:id/versions/:versionId/waveform`    | `{version_id, waveform, duration}` or 503 while unanalyzable                                                                                                          |

All endpoints require authentication; mutations follow asset write permissions (project scope
included).

## Generation (AUD-009/010/011)

- `kind` maps to a model task type: `music` → `music`, `voiceover` → `voice`, `sfx` → `audio`. An
  enabled model with the matching task type is required (or pass `model_id`).
- Each generation targets a fresh `audio` asset (`<kind>_<hex>` slug, display name derived from the
  prompt); the job runner stores candidates as immutable versions with full generation provenance,
  and candidates are compared/promoted through the review workflow.
- Scoping: `scene_id` (scene write) implies the scene's project; otherwise `project_id` (project
  write) is required. The job records `project_id`/`scene_id` for provenance.
