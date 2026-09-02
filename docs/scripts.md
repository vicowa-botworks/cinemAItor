# Movie Scripts

A **movie script** is a first-class, versioned Fountain-lite screenplay document that belongs to a
project. It is the creative source of a project: paste a screenplay, edit it, or generate one (or a
continuation of one) with the LLM. Every manual edit and every generation is stored as a **version**,
so the full edit + generation history is available to browse and restore.

## Versioning

The script's text is stored in the shared prompt-versioning engine (`prompt_versions`) under the
`movie_script` scope, keyed by the script's id. This gives:

- **Duplicate detection** — saving identical content is not re-stored (the version pointer and the
  reference set are still refreshed).
- **`@token` reference resolution** — the text is scanned for `@slug` asset references and unresolved
  references are surfaced as warnings (see references.md).
- **Restore** — restoring a historical version appends it as a *new* version (history is never
  rewritten).

The script row's `prompt_version_id` always points at the latest version.

## LLM generation

Scripts are generated through the existing assist endpoint `POST /api/v1/llm/assist` (see
llm.md) using two purposes:

- **`write_script`** — write a new script from an idea/outline.
- **`extend_script`** — continue or expand an existing script. The request's `context` is the current
  script text plus the writer's instruction (e.g. "continue two more scenes"), so the model works on
  top of the pasted/edited content. The UI composes this from the editor buffer + a short instruction.

Both are one-shot: the model returns text that the user reviews in the editor before saving it as a
version. Nothing is written automatically — saving a version is an explicit user action.

## Endpoints

| Method | Endpoint                                | Description                                                  |
| ------ | --------------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/v1/scripts`                       | List (filter `project_id`)                                    |
| POST   | `/api/v1/scripts`                       | Create `{project_id, name}` (status `draft`)                  |
| GET    | `/api/v1/scripts/:id`                   | Script + current text (`prompt`) + version history (`versions`) |
| PATCH  | `/api/v1/scripts/:id`                   | Update `name` / `status` (`draft` \| `active` \| `archived`)  |
| DELETE | `/api/v1/scripts/:id`                   | Soft delete (keeps version + audit history)                   |
| POST   | `/api/v1/scripts/:id/versions`          | Save the text as a new version, body `{content}`              |
| GET    | `/api/v1/scripts/:id/versions`          | List versions, newest first                                   |
| POST   | `/api/v1/scripts/:id/versions/:vid/restore` | Restore a version (appends it as a new version)            |

All endpoints require authentication; project access is gated (read for GET, write for mutations)
through the project permission model. The `GET /:id` detail returns
`{ script, prompt, versions }` where `prompt` is the latest version's
`{ content, version_number, version_id, warnings }` (or `null` before the first save).

## UI

- `#/scripts` → **script-list**: project filter + create form (name + project), cards linking into
  the detail page.
- `#/script/:id` → **script-detail**:
  - **Editor** — a large textarea holds the current script text (paste or edit). **Save version**
    stores the buffer as a new version (and flags duplicate content).
  - **Generate with AI** — a purpose picker (*Write from idea* = `write_script`, *Continue / extend*
    = `extend_script`) plus an instruction field, running the shared `ai-assist-dialog`. The returned
    text drops into the editor for review; *Replace* swaps the buffer, *Append* adds to it, and the
    user saves when satisfied.
  - **History** — every version listed newest-first with version number, timestamp, and a restore
    action; the current version is flagged.
  - Name / status editing and delete (soft) round out the header.

## Notes

- The parser used for the scene-list **Import script** feature (SCN-015, see storyboards.md) is a
  separate concern: it turns pasted screenplays into draft *scenes*. A **movie script** here is the
  stored, versioned screenplay document itself — the upstream creative source.
