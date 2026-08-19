# Reference Engine & Prompt Versioning

Prompts are plain text that can reference studio assets with `@name` tokens. The reference engine
parses them, resolves them against live assets, and stores the results so audits and
broken-reference warnings work across the project.

## Token syntax

```
@slug            -> resolves to the asset's active version
@slug:v<N>       -> resolves to a specific version of the asset
```

Slugs are lower-case `[a-z0-9_]` (max 64). Tokens embedded in words (`foo@hero`, emails) do not
match.

## Resolution statuses

- `resolved` - slug exists, the caller has read access, and (for versioned tokens) the version
  exists.
- `missing` - no such asset, no read access, or the requested version does not exist.
- `ambiguous` - reserved for future multi-match resolution.

## Prompt versioning

- Prompts belong to a scope: `generic`, `prompt`, `scene`, `shot`, `storyboard_panel` (+ a
  `scope_id` chosen by the caller, e.g. a scene id).
- Every save appends a new `prompt_versions` row (`version_number`, `content_hash`,
  `parent_prompt_id` pointer to the previous version).
- Saving content identical to the latest version does not create a row (duplicate detection by
  SHA-256); references are still re-resolved.
- Restore appends an old version's content as a new version; history is never mutated.

## Endpoints

| Method | Endpoint                                       | Description                                                   |
| ------ | ---------------------------------------------- | ------------------------------------------------------------- |
| POST   | `/api/v1/references/parse`                     | Parse + resolve text; optionally persist rows                 |
| GET    | `/api/v1/references/audit`                     | Audit list (filter: source_type, source_id, asset_id, status) |
| POST   | `/api/v1/references/:id/replace`               | Remap a reference (e.g. a broken one) to an asset             |
| POST   | `/api/v1/prompts`                              | Save a prompt version (201, or 200 + duplicate)               |
| GET    | `/api/v1/prompts/:scope_type/:scope_id`        | Version history (newest first)                                |
| GET    | `/api/v1/prompts/:scope_type/:scope_id/latest` | Latest version + its references                               |
| GET    | `/api/v1/prompts/:id`                          | One version + its persisted references                        |
| POST   | `/api/v1/prompts/:id/restore`                  | Append an older version as the new latest                     |

`POST /api/v1/references/parse` body:

```json
{
  "text": "@hero walks into @room with @ghost",
  "roles": { "hero": "character", "room": "location" },
  "persist": { "scope_type": "prompt", "scope_id": "scene-42" }
}
```

Response: `{ tokens: [...], warnings: [...] }`. Each token carries `status`, `role`, `start`/`end`
offsets, and (when resolved) the asset + version it points at. `warnings` contains one
human-readable line per unresolved token.

## Behavior

- Saving a prompt re-parses its content and **replaces** the persisted reference rows for that scope
  (positions and statuses stay in sync with the text).
- An audit entry is a reference row plus asset context and a computed `broken` flag: broken = status
  `missing`/`ambiguous`, or the referenced asset was soft-deleted.
- `replace` re-points a reference row (usually a broken one) at a live asset, re-resolves its
  version, and sets status `resolved`.
- Assets the caller cannot read are treated as `missing` (their existence is not leaked).
- All save/replace actions are written to `audit_logs`.
