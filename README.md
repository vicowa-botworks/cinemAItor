# CinemAItor

AI-assisted movie creation platform. Plan, write, and generate movies with AI.

## Quick Start

### Prerequisites

- [Deno 2.x](https://deno.com/) installed
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/vicowa-botworks/cinemAItor.git
cd cinemAItor

# Install dependencies (Deno resolves on first run, but this locks versions)
deno install
```

### Environment Setup

```bash
# Backend
cp backend/.env.example backend/.env
# Edit backend/.env and set a secure JWT_SECRET
```

`deno task dev`, `dev:backend`, and `start` auto-load `backend/.env` when starting the backend. Real
environment variables take precedence over values in the file, and a missing file only produces a
warning.

### Running Locally

Start both servers with a single command:

```bash
deno task dev
```

Or run them separately:

**Backend:**

```bash
deno task dev:backend
```

The backend starts on `http://localhost:8123`.

**Frontend:**

```bash
deno task dev:frontend
```

The frontend starts on `http://localhost:8124`.

Open `http://localhost:8124` in your browser.

### Running with Docker

The whole stack (backend + frontend + ffmpeg) ships as a single image:

```bash
docker compose up -d --build
```

Then open `http://localhost:8124`:

- Port **8124** — UI (frontend static files + `/api` proxy).
- Port **8123** — backend direct; the browser connects to it for the live job feed (`/ws/v1/jobs`
  WebSocket).
- All state (SQLite database, media, generated proxies, the auto-generated JWT secret) lives in the
  `cinemaitor-data` volume mounted at `/data`.

`JWT_SECRET` is optional: when unset the first start generates one and stores it in the data volume,
so it stays stable across restarts. Set it explicitly (for example via a root `.env`, see
`.env.example`) for production deployments. If you serve the UI from another host/port, set
`CORS_ORIGINS` to a comma-separated list of allowed origins (default: `http://localhost:8124`).

To run without compose:

```bash
docker build -t cinemaitor .
docker run -d -p 8124:8124 -p 8123:8123 -v cinemaItor-data:/data --name cinemaitor cinemaitor
```

### Development Tasks

```bash
# Run all tests
deno task test

# Run only backend tests
deno task test:backend

# Run only frontend tests
deno task test:frontend

# Lint all code (backend: deno lint, frontend: ESLint)
deno task lint

# Type check all code
deno task check

# Format all code
deno task fmt

# Start the backend (production)
deno task start
```

## Project Structure

```
cinemAItor/
├── backend/              # Deno backend
│   ├── src/
│   │   ├── server.ts     # Entry point (router + middleware wiring)
│   │   ├── routes/       # API route handlers (19 routers)
│   │   ├── db/           # Repositories + permission checks
│   │   ├── db/migrations/  # Ordered, idempotent SQL migrations
│   │   ├── services/     # Business logic (jobs, adapters, rendering, …)
│   │   ├── storage/      # Content-addressed media store
│   │   └── middleware/   # Auth middleware
│   └── tests/            # Backend tests (incl. HTTP-level acceptance flow)
├── docs/                 # Per-domain API + behavior documentation
├── docker/               # Container entrypoint supervisor (production)
├── Dockerfile            # Single-image deployment (backend + frontend + ffmpeg)
├── docker-compose.yml    # One-command start with a persistent data volume
├── frontend/             # Browser app: vanilla JS + Lit (no build step)
│   ├── src/
│   │   ├── app.js        # Main app component
│   │   ├── api.js        # API client
│   │   ├── server.js     # Static file server (Deno, dev only)
│   │   ├── components/   # Web components
│   │   └── styles/       # Global styles
│   ├── tests/            # Frontend tests (pure modules + API client)
│   └── index.html
└── .github/workflows/    # CI pipeline
```

## API

The v1 API lives under `/api/v1/*`. All authenticated endpoints require a `Bearer <token>` header
(tokens come from `/api/v1/auth/bootstrap` or `/api/v1/auth/login`). Authorization is layered: the
`admin` role bypasses all checks, creators hold implicit admin over their own projects/assets, and
`project_permissions` / `asset_permissions` rows otherwise decide (`read` < `write` < `admin`).
Per-domain behavior, request/response shapes, and examples are documented in [`docs/`](docs/).

| Domain       | Base path(s)                                                                                               | `docs/`          |
| ------------ | ---------------------------------------------------------------------------------------------------------- | ---------------- |
| Health       | `/api/v1/health`                                                                                           | —                |
| Auth         | `/api/v1/auth/*` (bootstrap, login, logout, me, setup-status, password)                                    | `email.md`       |
| Users        | `/api/v1/users/*` (admin; list/create/patch/delete, registration settings)                                 | —                |
| Invitations  | `/api/v1/invitations/*` (admin email invites) + public accept/confirm/reset routes                         | `email.md`       |
| Projects     | `/api/v1/projects/*` (CRUD, template on create)                                                            | `projects.md`    |
| Templates    | `/api/v1/templates` (read-only starting structures)                                                        | `projects.md`    |
| Assets       | `/api/v1/assets/*` (CRUD, raw-bytes upload, versions/restore, previews, proxies, dependencies)             | `assets.md`      |
| Audio        | `/api/v1/audio/*` (generation, adjustments, cleanup, subtitles, waveform)                                  | `audio.md`       |
| Models       | `/api/v1/models/*` (registry, install/verify/remove, health, benchmark, hardware)                          | `models.md`      |
| Jobs         | `/api/v1/jobs/*` + WebSocket `/ws/v1/jobs`                                                                 | `jobs.md`        |
| Storyboards  | `/api/v1/storyboards/*` (+ ordered panels)                                                                 | `storyboards.md` |
| Scenes/Shots | `/api/v1/scenes/*` (+ `/scenes/:id/shots/*`), `projects/:id/scenes/from-script`, `projects/:id/continuity` | `storyboards.md` |
| Review       | `/api/v1/review/*` (candidates, approve/reject/shortlist)                                                  | `review.md`      |
| Skills       | `/api/v1/skills/*` (versioned definitions + runs)                                                          | `skills.md`      |
| Timelines    | `/api/v1/timelines/*` (tracks, items, markers, snapshots, atomic state restore, score)                     | `timelines.md`   |
| Rendering    | `/api/v1/render-presets`, `/api/v1/renders/*`, `/api/v1/exports`                                           | `renders.md`     |
| Diagnostics  | `/api/v1/diagnostics/*` (hardware, storage, logs, backups, cleanup)                                        | `diagnostics.md` |
| Prompts      | `/api/v1/prompts/*` (versioned history + restore)                                                          | `references.md`  |
| References   | `/api/v1/references/*` (parse, audit, replace)                                                             | `references.md`  |

Legacy routes: `/api/auth/register|login|me` remain as a multi-user test helper (self-registration
gated by an admin toggle); the v0 `/api/movies` demo routes were removed.

## Testing

- `deno task test` — backend + frontend. The backend suite includes an HTTP-level MVP acceptance
  flow (`backend/tests/mvp_acceptance.test.ts`) that drives the full studio journey over live routes
  (auth → media → jobs → timeline → render/export → backup/restore).
- Browser-level E2E (Playwright/Cypress) is not implemented; frontend tests cover the pure modules
  and the API client.

## License

MIT
