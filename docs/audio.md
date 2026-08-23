# Audio

Import, generation, versioning, non-destructive trim/gain and waveform access for audio assets
(Workstream 11 + Workstream 14 audio generation).

## Concepts

- Audio assets are regular library assets with audio `asset_type`
  (`audio | music | sfx | voiceover | ambience`); versions are immutable, content-addressed files
  (wav/mp3/flac/ogg/m4a/aac).
- **Technical metadata** lives in `asset_versions.technical_metadata_json` under the `audio` key:
  - `duration`, `sample_rate`, `channels`, `bit_rate` — from ffprobe (`FFPROBE_PATH`, default
    `ffprobe`) when it is available.
  - `waveform` — 200 peak-amplitude buckets (0..1) computed by decoding to mono s16le at 8 kHz.
  - `analysis_status` — `analyzed | unavailable | failed`; uploads never require ffmpeg (metadata
    stays null until analysis succeeds).
  - `adjustments` — non-destructive editorial parameters applied at render time (this workstream):
    `trim: {start, end}` (seconds), `gain_db` (-60..24). No new file/version is created.
- The waveform endpoint re-analyzes on demand when a version was stored before ffmpeg became
  available; a 503 is returned while analysis is impossible.

## Endpoints

| Method | Endpoint                                                   | Description                                                                                                                                                                                       |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/audio/generate`                                   | Generate from prompt: `{kind: music\|voiceover\|sfx, prompt, project_id?\|scene_id?, model_id?, seed?, settings?}` → `202 {job_id, job_type, asset_id, model_id}`                                 |
| POST   | `/api/v1/audio/upload`                                     | Raw-bytes streaming upload (file as the body; `X-File-Name`, `X-Upload-Notes?`, `X-Asset-Type?`, `X-Display-Name?`, `X-Project-Id?` headers) → creates the audio asset + version 1                |
| GET    | `/api/v1/audio/assets`                                     | List audio assets (filters: `asset_type`, `project_id`, `library_scope`)                                                                                                                          |
| POST   | `/api/v1/audio/assets/:id/versions`                        | New version: raw-bytes streaming upload (`X-File-Name`, `X-Upload-Notes?`), or JSON `{content_hash, notes?}` for stored content                                                                   |
| PATCH  | `/api/v1/audio/assets/:id/versions/:versionId/adjustments` | Set `trim` and/or `gain_db` (merged, validated against known duration); edited from the Asset Detail "Audio adjustments" section (waveform, trim window, gain, reset)                             |
| GET    | `/api/v1/audio/assets/:id/versions/:versionId/waveform`    | `{version_id, waveform, duration}` or 503 while unanalyzable                                                                                                                                      |
| POST   | `/api/v1/audio/assets/:id/versions/:versionId/cleanup`     | Audio cleanup (AUD-012): `{denoise?: true, normalize?: true}` — at least one required → `202 {job_id, job_type, asset_id, source_version_id, source_version_number, operations}`                  |
| POST   | `/api/v1/audio/assets/:id/versions/:versionId/subtitles`   | Subtitle generation (AUD-014): transcribe the version into SRT candidates → `202 {job_id, job_type: "transcribe", asset_id, model_id, source_asset_id, source_version_id, source_version_number}` |

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

## Cleanup (AUD-012)

Denoise and/or normalize an existing audio version into a **new version** of the same asset — the
source version is never modified. Edited from the Asset Detail "Audio cleanup" section (denoise /
normalize checkboxes).

- Request body: `{denoise?: true, normalize?: true}` — at least one operation is required (unknown
  keys and empty bodies are rejected with 400).
- Runs as a model-less `audio_cleanup` job through the job queue (same lease/recovery semantics as
  other jobs; cancellable while queued or running). The job runner executes the pass with ffmpeg:
  - **denoise** — `afftdn` spectral-denoise pass (runs first).
  - **normalize** — EBU R128 single pass, `loudnorm=I=-16:TP=-1.5:LRA=11`.
- The cleaned file is kept in the source format (`mp3 | aac | m4a | flac | ogg`, otherwise `wav`),
  stored in the content store, and re-analyzed for duration/waveform metadata.
- On hosts without ffmpeg the job completes with a deterministic mock output so the queue,
  versioning, and provenance paths stay testable (CI-safe).
- On success the new version is non-active, noted as `Cleanup of vN (…)` with the job id, and
  recorded in the version's technical metadata under the `cleanup` key (`operations`, `engine`,
  `source_version_id/number`, `job_id`). Proxy generation is queued for it automatically; promotion
  happens through the normal version restore flow.

## Subtitle generation (AUD-014)

Transcribe an audio (dialogue/voiceover) version into SRT candidates — edited from the Asset Detail
"Subtitle generation" section.

- Requires an enabled model with task type `transcribe` (or pass `model_id`); 400 when no such model
  is enabled, when the model lacks the `transcribe` task, for non-audio assets, or for a version
  without a stored file. Foreign assets 404 for non-writers, like the other routes here.
- The request enqueues a `transcribe` model job. Each candidate is stored as an SRT version (`.srt`,
  `application/x-subrip`) of a **fresh global `subtitle` asset** (`subtitle_<hex>` slug, display
  name `Subtitles: <source asset>`), so candidates flow through the normal review board (approve /
  reject / shortlist) and the approved one becomes the active version of that asset — ready to play
  through `subtitle` timeline tracks (see `docs/timelines.md`).
- Job settings carry the source pointer
  (`source: {asset_id, version_id, version_number,
  display_name}`) plus `source_duration` when the
  version has ffprobe-derived audio metadata.
- The mock adapter synthesizes a deterministic seeded SRT: 2–5 cues of 1.5–3.5 s spanning the source
  duration, each cue line referencing the seed so candidates within one job differ. Real adapters
  replace the synthesis with an actual transcription call.
