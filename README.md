# CinemaItor

AI-assisted movie creation platform. Plan, write, and generate movies with AI.

## Quick Start

### Prerequisites

- [Deno 2.x](https://deno.com/) installed
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/cinemAItor.git
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
│   │   ├── server.ts     # Entry point
│   │   ├── routes/       # API route handlers
│   │   ├── db/           # Database layer
│   │   └── middleware/   # Auth middleware
│   └── tests/            # Backend tests
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
│   ├── tests/            # Frontend tests
│   └── index.html
└── .github/workflows/    # CI pipeline
```

## API Endpoints

### Authentication

| Method | Endpoint             | Description       | Auth Required |
| ------ | -------------------- | ----------------- | ------------- |
| POST   | `/api/auth/register` | Register new user | No            |
| POST   | `/api/auth/login`    | Login             | No            |
| GET    | `/api/auth/me`       | Get current user  | Yes           |

### Movies

| Method | Endpoint                 | Description     | Auth Required |
| ------ | ------------------------ | --------------- | ------------- |
| GET    | `/api/movies`            | List all movies | Yes           |
| GET    | `/api/movies/:id`        | Get a movie     | Yes           |
| POST   | `/api/movies`            | Create a movie  | Yes           |
| PUT    | `/api/movies/:id`        | Update a movie  | Yes           |
| DELETE | `/api/movies/:id`        | Delete a movie  | Yes           |
| GET    | `/api/movies/:id/scenes` | List scenes     | Yes           |
| POST   | `/api/movies/:id/scenes` | Add a scene     | Yes           |

All authenticated endpoints require a `Bearer <token>` header.

## License

MIT
