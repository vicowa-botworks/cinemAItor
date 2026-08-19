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
