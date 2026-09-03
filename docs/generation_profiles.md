# Generation Profiles (Draft / Production)

Implementation contract for issue #155: per-model **draft** and **production** settings profiles for
prompt-based generation, plus the draft→production workflow (feed the approved draft back as a
reference and regenerate at production quality).

## Concept

Prompt-based generation (asset generate / edit — `POST /api/v1/assets/generate` and
`POST /api/v1/assets/:id/generate`) runs on a model whose invocation is described by the model's
`default_settings`. A model can additionally carry two optional override profiles:

- **`draft_settings`** — speed-first overrides (e.g. lower resolution, fewer steps, shorter
  duration) for cheap composition iterations.
- **`production_settings`** — quality-first overrides (e.g. full resolution, more steps, longer
  duration) for the final take.

Both are free-form JSON objects of the same shape as `default_settings` (model/runner-specific keys;
the app does not interpret them). Precedence when the runner builds the adapter settings:

```text
job settings  >  profile settings  >  default_settings
```

The profile can tune quality knobs but can never break the invocation: job-level keys (`candidates`,
`device`, `min_free_vram_mb`, …) always win, and a profile must not be able to drop `command` /
`endpoint` / `workflow`. An empty (`{}`) or absent profile changes nothing — models without profiles
behave exactly as before.

The profile is chosen per generation request (`profile: "draft" | "production"`), recorded in the
job's `settings.profile`, and therefore visible in job details and carried in the produced version's
job-settings provenance.

## Draft → production workflow

1. Generate a video with `profile: "draft"` (composition pass — fast, cheap).
2. Approve the best candidate (review board / asset detail — it becomes the active version).
3. Regenerate the same asset: same prompt, same other references, with `profile: "production"` and
   the current (approved draft) version included as a reference (`include_current: true`) — for
   models that accept a video reference (e.g. minimax H3 reference-to-video), the approved draft
   becomes an additional input.
4. Approve the production candidate as the final version.

No new endpoint: step 3 composes from the existing generate endpoint's `references` +
`include_current` + the new `profile` field.

## Storage (migration 0030)

`models` table:

```sql
ALTER TABLE models ADD COLUMN draft_settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE models ADD COLUMN production_settings_json TEXT NOT NULL DEFAULT '{}';
```

Validated as JSON objects at register/update (the route's `jsonObject` helper); no backend-specific
contract (a profile never has to carry `command` / `endpoint` / `workflow` — it only overrides).

## API

### Models (admin writes)

- `POST /api/v1/models` — optional `draft_settings`, `production_settings` (JSON objects)
- `PATCH /api/v1/models/:id` — same fields, patch semantics
- `GET /api/v1/models[/:id]` — return both profiles (default `{}`)

### Generation

- `POST /api/v1/assets/generate` and `POST /api/v1/assets/:id/generate` accept
  `profile: "draft" | "production"` (400 for any other value). The profile is stored in the job's
  `settings.profile`. The runner merges `default_settings` ← profile ← job settings when building
  the adapter settings (pure helper `mergeProfileSettings`, unit-tested).

## Frontend

- **Model manager (admin):** a per-model **Profiles** button (next to Settings, on the model card)
  opens a small editor with two JSON textareas — `draft_settings` and `production_settings` (same
  free-form shape as `default_settings`, `{}` = use the defaults); saving patches both fields in one
  `PATCH /api/v1/models/:id`.
- **Asset generate form (create + edit):** a "Quality profile" select (model default / draft — fast
  / production — quality); non-default values are sent as `profile`. In edit mode with an active
  version, a "Produce final from current version (production profile)" button sets
  `profile="production"` + "use current version" and submits — the draft→production loop in one
  click, prompt and references untouched.

## Non-goals (v1)

- Profiles on scene/shot, storyboard, audio, skill, or timeline-score generation paths (the
  mechanism is generic; those endpoints can adopt it later)
- Per-asset or per-request ad-hoc profile JSON (profiles live on the model)
- Profile validation against the runner's known keys (runner-specific keys pass through untouched)

## Tests

- `migrations.test.ts`: 0030 filename + `schema_migrations` count
- `db/models.ts`: register/update round-trip of both profiles; `{}` defaults; non-object rejected
- `mergeProfileSettings`: precedence table (default < profile < job settings; empty profile =
  defaults; absent profile; job keys win)
- Generate routes: `profile` accepted → job settings carry it; invalid value 400; absent profile →
  no `profile` key, behavior unchanged
- Model routes: register/patch persist + expose both profiles
