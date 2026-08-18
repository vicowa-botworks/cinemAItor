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
| UI Framework | Lit (via CDN)                                  | Lightweight web components library with reactive rendering |
| Styling      | CSS with Shadow DOM                            | Encapsulated styles per component                          |
| State        | Browser storage (localStorage) + custom events | Simple, no external state management                       |
| Routing      | Hash-based (`#/movies`, `#/login`)             | No server-side routing needed                              |

### Development

| Component  | Technology                                     |
| ---------- | ---------------------------------------------- |
| Linting    | `deno lint` (backend), ESLint (frontend)       |
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

The frontend uses a component-based architecture built on Web Components with Lit:

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
├── Auth routes (/api/auth/*)
│   ├── POST /register
│   ├── POST /login
│   └── GET /me
├── Movie routes (/api/movies/*)
│   ├── GET / (list)
│   ├── GET /:id
│   ├── POST / (create)
│   ├── PUT /:id (update)
│   ├── DELETE /:id
│   ├── GET /:id/scenes
│   └── POST /:id/scenes
└── Auth middleware (protects movie routes)
```

**Database layer:**

- `database.ts`: Singleton `Database` instance, schema initialization
- `schema.ts`: CRUD functions with parameterized queries (SQL injection safe)

### Authentication Flow

```
Registration:
  1. Client sends email + password + display_name
  2. Server hashes password with PBKDF2 (salt + 100k iterations)
  3. User stored in database
  4. JWT generated (HS256, 7-day expiry)
  5. Token returned to client

Login:
  1. Client sends email + password
  2. Server retrieves user by email
  3. Server verifies password with PBKDF2
  4. JWT generated and returned

Authenticated Request:
  1. Client sends Bearer token in Authorization header
  2. Auth middleware verifies JWT signature and expiry
  3. User ID extracted from token payload
  4. User fetched from database
  5. Request proceeds with user context
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

- Lit (loaded via CDN in browser) - Web components library
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
