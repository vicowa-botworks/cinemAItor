# Timeline Editor

Project-scoped timelines: ordered tracks, placed asset-version items, markers, and restorable
snapshots (Workstream 10, Milestone 5).

## Concepts

- **Timeline** (`timelines`): belongs to a project; `duration` is recomputed to the furthest item
  end time on every item mutation.
- **Track** (`tracks`): typed lane
  (`video | dialogue | voiceover | music | sfx |
  ambience | overlay | text | subtitle | effect | transition`),
  unique `track_order` per timeline, lock/mute flags. Max 32 tracks.
- **Timeline item** (`timeline_items`): a placed `asset_version_id` with `start_time`/`end_time`
  (timeline seconds), `source_offset`, `speed`, plus transform, fades, transition, effect chain,
  color grade and audio settings (JSON). Max 1024 items per timeline. Locked tracks reject item
  writes. Items on `text`/`subtitle` tracks may be versionless text overlays (see below).
- **Markers** (`timeline_markers`): time + label + notes.
- **Snapshots** (`timeline_snapshots`): full state (tracks, items, markers, duration, settings).
  Restore replaces the timeline's tracks/items/markers with the snapshot contents (original row ids
  preserved). Max 32 tracks / 1024 items enforced on creation.

## Item fx (applied at render time)

- **Transition** (`transition`): blend between an item and the one preceding it —
  `cut | fade | dissolve | wipeleft | wiperight | slideleft | slideright` (default `cut` = hard
  cut). `transition_duration` (seconds, default 0.5, max 3) sets the blend length.
- **Fades** (`fade_in` / `fade_out`): fade lengths in seconds; each must be shorter than the item
  duration.
- **Color grade** (`color_grade`): JSON object with optional `brightness` (-1..1), `contrast`
  (0.25..4), `saturation` (0..2), `temperature` (-1..1). Unknown keys or out-of-range values are
  rejected with 400.

Sending `null` for any item field in a PATCH clears it (back to the plain setting); omitting the
field keeps the stored value.

## Text overlays (subtitles)

Items on `text` and `subtitle` tracks can carry an inline text payload instead of (or in addition
to) an asset version; it is drawn as a video overlay at render time (`drawtext`).

- `text`: the overlay string (max 512 characters, non-empty). Only allowed on `text`/`subtitle`
  tracks — rejected with 400 elsewhere.
- `text_style`: JSON object with optional `font_size` (integer 1..200), `font_color` (a name or
  `#RGB`/`#RRGGBB` hex), `position` (`top | middle | bottom`), `margin` (0..100). Unknown keys are
  rejected with 400. Defaults at render time: 24, white, bottom-anchored.
- `asset_version_id` is optional on `text`/`subtitle` tracks (a versionless, textless item is an
  inert placeholder); it is still required on media tracks.

All endpoints require authentication and follow project permissions (read for fetches, write for
mutations).

## Endpoints

| Method | Endpoint                                              | Description                                                                                                                             |
| ------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/timelines`                                   | List (filter `project_id`)                                                                                                              |
| POST   | `/api/v1/timelines`                                   | Create `{project_id, name, settings?}`                                                                                                  |
| GET    | `/api/v1/timelines/:id`                               | Timeline + tracks (with items) + markers                                                                                                |
| PATCH  | `/api/v1/timelines/:id`                               | Update name/duration/settings                                                                                                           |
| DELETE | `/api/v1/timelines/:id`                               | Delete (cascades)                                                                                                                       |
| POST   | `/api/v1/timelines/:id/tracks`                        | Create track (auto or explicit order)                                                                                                   |
| PATCH  | `/api/v1/timelines/:id/tracks/:trackId`               | Update name/order (swap semantics)/locked/muted                                                                                         |
| DELETE | `/api/v1/timelines/:id/tracks/:trackId`               | Delete track + its items                                                                                                                |
| POST   | `/api/v1/timelines/:id/items`                         | Place an item (required: track_id, start_time, end_time; `asset_version_id` required on media tracks, optional on text/subtitle tracks) |
| PATCH  | `/api/v1/timelines/:id/items/:itemId`                 | Move/trim/detune an item                                                                                                                |
| POST   | `/api/v1/timelines/:id/items/:itemId/duplicate`       | Copy an item (`{at_time?}`; default: right after)                                                                                       |
| DELETE | `/api/v1/timelines/:id/items/:itemId`                 | Delete item                                                                                                                             |
| POST   | `/api/v1/timelines/:id/markers`                       | Create marker `{time, label?, notes?}`                                                                                                  |
| GET    | `/api/v1/timelines/:id/markers`                       | List markers                                                                                                                            |
| DELETE | `/api/v1/timelines/:id/markers/:markerId`             | Delete marker                                                                                                                           |
| POST   | `/api/v1/timelines/:id/snapshots`                     | Create snapshot `{name, notes?}`                                                                                                        |
| GET    | `/api/v1/timelines/:id/snapshots`                     | List snapshots (newest first)                                                                                                           |
| POST   | `/api/v1/timelines/:id/snapshots/:snapshotId/restore` | Restore snapshot (returns full detail)                                                                                                  |
