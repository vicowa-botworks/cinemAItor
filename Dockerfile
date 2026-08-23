# syntax=docker/dockerfile:1
FROM denoland/deno:2.9.5

# ffmpeg so media proxies, thumbnails, audio cleanup and renders work in-container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Keep the Deno cache in a fixed place so the non-root runtime user can read
# what the build (which runs as root) cached.
ENV DENO_DIR=/deno-deps

RUN useradd --create-home --uid 1000 app \
    && mkdir -p /app /data /deno-deps \
    && chown -R app:app /app /data /deno-deps

WORKDIR /app

# Note: deno.lock files are intentionally not committed in this repo, so the
# image resolves jsr/npm dependencies at build time (same as CI).
COPY backend/deno.json backend/
COPY backend/src backend/src/
COPY frontend/deno.json frontend/
COPY frontend/index.html frontend/index.html
COPY frontend/src frontend/src/
COPY docker docker/

# Cache the module graph as root (deno writes a generated deno.lock next to
# each root-owned config), then hand everything to the runtime user.
RUN cd /app/backend && deno cache src/server.ts
RUN cd /app/frontend && deno cache src/server.js
# Pre-warm the sqlite driver's native library download so runtime does not
# need network access for it.
RUN cd /app/backend && deno eval "import { Database } from '@db/sqlite'; const db = new Database(':memory:'); console.log('sqlite plugin loaded');"

RUN chown -R app:app /app /deno-deps
USER app

ENV PORT=8123 \
    FRONTEND_PORT=8124 \
    BACKEND_URL=http://localhost:8123 \
    APP_DATA_DIR=/data \
    DB_PATH=/data/cinemaItor.db

VOLUME ["/data"]
EXPOSE 8123 8124

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD deno eval "fetch('http://localhost:8123/api/v1/health').then((r) => Deno.exit(r.ok ? 0 : 1)).catch(() => Deno.exit(1))"

ENTRYPOINT ["deno", "run", "-A", "/app/docker/entrypoint.ts"]
