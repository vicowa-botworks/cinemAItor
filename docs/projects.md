# Projects

Projects are the top-level containers for assets, scenes, timelines, and exports.

## Endpoints

| Method | Endpoint               | Description                     |
| ------ | ---------------------- | ------------------------------- |
| GET    | `/api/v1/projects`     | List accessible projects        |
| POST   | `/api/v1/projects`     | Create a project                |
| GET    | `/api/v1/projects/:id` | Get a project                   |
| PATCH  | `/api/v1/projects/:id` | Update project settings or name |
| DELETE | `/api/v1/projects/:id` | Soft-delete a project           |

## Behavior

- Projects get unique UUID identifiers.
- New projects receive default aspect ratio, frame rate, resolution, and audio settings.
- The creating user receives `admin` project permission.
- Access checks use project ownership and `project_permissions`.
- `DELETE` marks a project `deleted` instead of removing rows, preserving references and audit
  history.
- Create, update, and delete actions are written to `audit_logs`.

## Project templates

Templates are global, read-only starting structures applied at project creation time. Three system
templates are seeded by migration 0018:

| id               | name            | structure                                                                                      |
| ---------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `tpl-blank`      | Blank           | no timeline (the `template_id` is still recorded)                                              |
| `tpl-short-film` | Short film      | timeline "Main": Picture (video), Dialogue (dialogue), Music (music), Captions (text)          |
| `tpl-podcast`    | Podcast / audio | timeline "Main": Dialogue (dialogue), Music (music), Ambience (ambience), Subtitles (subtitle) |

`GET /api/v1/templates` (auth) lists them in the shape
`{ id, name, description, structure: { timeline_name: string|null, tracks: [{ name, track_type }] },
is_system }`.

A project created with `body.template_id` records the id on the row and, for non-blank templates,
materializes the structure: the named timeline is created with its tracks in order. The template
must exist (unknown ids are rejected with 400 before the project row is written), and a
materialization failure removes the half-built timeline (and, at the route, the project itself)
before the error propagates — a failed create never leaves partial structure behind.
