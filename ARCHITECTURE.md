# Architecture & Technical Documentation

## Overview

CinemaItor is a full-stack web application for AI-assisted movie creation. Users can plan movies,
write scenes, and generate content using AI tools.

## Tech Stack

### Backend

| Component      | Technology                 | Justification                                                                       |
| -------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| Runtime        | Deno 2.x                   | Secure by default, built-in TypeScript, excellent std library                       |
| Web Framework  | Oak (`@oak/oak`)           | Mature, Express-like middleware framework for Deno                                  |
| Router         | Oak Router (`@oak/router`) | Decorator-based routing                                                             |
| Database       | SQLite (via `@db/sqlite`)  | Lightweight, zero-config, file-based, perfect for startup                           |
| Authentication | Custom JWT with PBKDF2     | Self-implemented for full control; PBKDF2 with 100k iterations for password hashing |
| CORS           | `@oak/cors`                | Standard CORS middleware                                                            |

### Frontend

| Component    | Technology                                     | Justification                                              |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------- |
| Runtime      | Deno (serve command)                           | Serves static files and proxies API requests               |
| UI Framework | Lit (ESM CDN via import map)                   | Lightweight web components library with reactive rendering |
| Styling      | CSS with Shadow DOM                            | Encapsulated styles per component                          |
| State        | Browser storage (localStorage) + custom events | Simple, no external state management                       |
| Routing      | Hash-based (`#/movies`, `#/login`)             | No server-side routing needed                              |

### Development

| Component  | Technology                                     |
| ---------- | ---------------------------------------------- |
| Linting    | `deno lint` (backend), ESLint (frontend)       |
| Type Check | `deno check` (backend and frontend)            |
| Formatting | Deno built-in `deno fmt`                       |
| Testing    | Deno built-in test runner (`@std/testing/bdd`) |
| CI/CD      | GitHub Actions                                 |

## Architecture

### High-Level Architecture

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Browser    │────────▶│   Frontend   │────────▶│    Backend   │
│  (Client)    │◀────────│  (Deno)      │◀────────│   (Deno)     │
│              │         │  :8124       │         │   :8123      │
└──────────────┘         └──────────────┘         └──────┬───────┘
                                                          │
                                                          ▼
                                                 ┌──────────────┐
                                                 │    SQLite    │
                                                 │   Database   │
                                                 └──────────────┘
```

### Frontend Architecture

The frontend is plain JavaScript (no build step). It uses a component-based architecture built on
Web Components with Lit, loaded from an ESM CDN via an import map. For production, a minifier is the
only planned processing step:

```
app-root (main router)
├── app-header (navigation)
├── login-form (auth)
├── movie-list (grid view)
│   └── movie-card (individual item)
└── movie-detail (detail view)
```

**Key design decisions:**

- **Shadow DOM**: Each component encapsulates its styles and markup, preventing CSS leakage
- **Hash-based routing**: Simple client-side routing without server configuration
- **Custom events**: Components communicate via `CustomEvent` dispatching
- **API client**: Singleton `ApiClient` class handles all HTTP communication with automatic token
  injection

### Backend Architecture

```
server.ts (entry point)
├── CORS middleware
├── Error handling middleware
├── Health routes (/api/v1/health)
├── Auth routes (/api/v1/auth/*)
│   ├── POST /bootstrap (first user, becomes admin)
│   ├── POST /login
│   ├── POST /logout
│   └── GET /me
├── Project routes (/api/v1/projects/*, auth middleware)
│   ├── GET / (list accessible)
│   ├── POST / (create)
│   ├── GET /:id
│   ├── PATCH /:id
│   └── DELETE /:id (soft delete)
├── Asset routes (/api/v1/assets/*, auth middleware)
│   ├── CRUD + upload + versions + restore + aliases + tags + preview
│   └── (see docs/assets.md)
├── Prompt routes (/api/v1/prompts/*, auth middleware)
│   ├── Versioned prompt history per scope + restore
│   └── (see docs/references.md)
├── Reference routes (/api/v1/references/*, auth middleware)
│   ├── POST /parse (resolve @tokens), GET /audit, GET /:id, POST /:id/replace
│   └── (see docs/references.md)
├── Model routes (/api/v1/models/*, auth middleware, admin for mutations)
│   ├── Registry, install/verify (SHA-256), remove, enable/disable, /:id/health-check
│   ├── Hardware detection + requirement warnings (/hardware)
│   └── (see docs/models.md)
 ├── Job routes (/api/v1/jobs/*, auth middleware)
 │   ├── Queue + events, cancel/retry; in-process runner with leases + recovery
 │   ├── Adapters: mock (deterministic); provenance on produced asset versions
 │   └── (see docs/jobs.md)
 ├── Storyboard/scene/shot routes (auth middleware, project-permission gated)
 │   ├── Storyboards + ordered panels; scenes + ordered shots
 │   ├── Prompt versioning + reference resolution on creative objects
 │   ├── generate-preview (t2i) and scene generate (i2v/t2v) -> job queue; runner
 │   │   links preview/clip outputs back to panels and shots
 │   └── (see docs/storyboards.md)
 ├── Review routes (/api/v1/review/*, auth middleware, asset write permission)
 │   ├── Job candidate comparison; approve (promote active) / reject / shortlist + notes
 │   └── (see docs/review.md)
 ├── Timeline routes (/api/v1/timelines/*, auth middleware, project-permission gated)
 │   ├── Timelines + typed tracks (swap reorder, lock/mute) + placed items (move/trim/
 │   │   speed/transform/fades/effects), item duplicate, duration recompute, markers
 │   ├── Full-state snapshots with restore
 │   └── (see docs/timelines.md)
 └── Legacy demo routes (/api/auth/*, /api/movies/*)
```

**Database layer:**

- `database.ts`: Singleton `Database` instance, schema initialization
- `migrations/`: Ordered, idempotent SQL migrations tracked in `schema_migrations`
- `schema.ts`: Legacy CRUD functions with parameterized queries (SQL injection safe)
- `projects.ts`: Project repository + project permission checks
- `assets.ts`: Asset/alias/tag/version repository + asset permission checks

### Storage layer:

- `storage/paths.ts`: `app_data` layout and content-addressed paths
- `storage/checksums.ts`: incremental SHA-256 file hashing
- `storage/content_store.ts`: atomic, deduplicated media file storage
- `storage/media_types.ts`: extension → MIME/type inference

See `docs/storage.md` and `docs/assets.md` for the storage and asset contracts.

### Authorization

- `admin` role users bypass all checks.
- Creators hold implicit `admin` over their projects and assets.
- Otherwise the highest permission rank wins: `project_permissions` (inherited by project-scoped
  assets) and `asset_permissions` rows (`read` < `write` < `admin`).

### Authentication Flow

```
Bootstrap (once):
  1. Client sends email + password + display_name
  2. Server hashes password with PBKDF2 (salt + 100k iterations)
  3. First user is created with role 'admin'
  4. Session row + JWT generated; token returned to client

Login:
  1. Client sends email + password
  2. Server verifies password with PBKDF2
  3. Session row + fresh JWT issued

Logout:
  1. Session row is revoked (jti)

Authenticated Request:
  1. Client sends Bearer token in Authorization header
  2. Auth middleware verifies JWT signature and expiry
  3. Session looked up by jti; revoked/expired sessions are rejected
  4. Request proceeds with user context
```

### Data Models

**User:**

- `id` (INTEGER, PK, AUTOINCREMENT)
- `email` (TEXT, UNIQUE)
- `password_hash` (TEXT) - format: `base64url(salt):base64url(hash)`
- `display_name` (TEXT)
- `role` (TEXT, default: 'user')
- `created_at`, `updated_at` (TEXT, datetime)

**Movie:**

- `id` (INTEGER, PK, AUTOINCREMENT)
- `title` (TEXT)
- `description`, `genre` (TEXT, nullable)
- `year`, `runtime_minutes` (INTEGER, nullable)
- `poster_url`, `backdrop_url` (TEXT, nullable)
- `rating` (REAL, default: 0)
- `user_id` (INTEGER, FK -> users)
- `created_at`, `updated_at`

**Scene:**

- `id` (INTEGER, PK, AUTOINCREMENT)
- `movie_id` (INTEGER, FK -> movies)
- `scene_number` (INTEGER)
- `description` (TEXT)
- `dialogue`, `visual_description` (TEXT, nullable)
- `duration_seconds` (INTEGER, nullable)
- `user_id` (INTEGER, FK -> users)
- `created_at`, `updated_at`

**Prompt:**

- `id` (INTEGER, PK, AUTOINCREMENT)
- `movie_id`, `scene_id` (INTEGER, nullable FKs)
- `user_id` (INTEGER, FK -> users)
- `role` (TEXT) - e.g., 'system', 'user', 'assistant'
- `content` (TEXT)
- `created_at`

### Security

- **Password hashing**: PBKDF2 with SHA-256, 100,000 iterations, 16-byte random salt
- **JWT**: HMAC-SHA256, 7-day expiry, stored in localStorage
- **SQL**: All queries use parameterized statements (no string concatenation)
- **CORS**: Restricted to `http://localhost:8124` in development
- **Data isolation**: All movie/scene queries filter by `user_id` (ownership enforcement)

### Dependencies

#### Backend

- `jsr:@oak/oak` - Web framework
- `jsr:@oak/router` - Decorator-based routing
- `jsr:@oak/cors` - CORS middleware
- `jsr:@db/sqlite` - SQLite driver
- `jsr:@std/testing/bdd` - Test framework
- `jsr:@oslo-jwt/jwt` - JWT utilities

#### Frontend

- Lit (loaded from ESM CDN via import map in the browser) - Web components library
- No other dependencies

## Future Considerations

### Database Migration

SQLite is the initial database. The data access layer is abstracted via `schema.ts`, making it
feasible to swap in PostgreSQL or another database later.

### Authentication Options

Current JWT implementation provides full control but may be replaced with:

- **Auth.js / NextAuth-style** for Deno (if available)
- **Supabase Auth** for managed auth
- **Custom OAuth** providers (Google, GitHub)

### AI Integration

The `prompts` table is structured to support:

- Conversation history per movie/scene
- Role-based messages (system/user/assistant)
- Associating AI outputs with specific scenes

### Testing Strategy

- **Backend**: Unit tests for schema layer, integration tests for routes
- **Frontend**: Unit tests for API client, component tests with mock DOM
- **E2E**: Not yet implemented; consider Cypress or Playwright

### Deployment

- Backend: Deploy to Deno Deploy, Fly.io, or self-hosted Deno runtime
- Frontend: Same host as backend (proxied) or separate static hosting
- Database: SQLite file on persistent storage; migrate to managed PostgreSQL for production scale
