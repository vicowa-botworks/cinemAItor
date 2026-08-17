# Project State - CinemaItor

## Current Status: Initial Setup Complete

### Completed

- [x] Project initialization (Deno 2.x workspace)
- [x] Backend structure with Oak web framework
- [x] SQLite database with schema (users, movies, scenes, prompts)
- [x] Authentication system (JWT + PBKDF2 password hashing)
- [x] REST API for movies and scenes (CRUD + ownership enforcement)
- [x] Frontend structure with Lit web components
- [x] Shadow DOM components: app-root, app-header, login-form, movie-list, movie-card, movie-detail
- [x] Hash-based client-side routing
- [x] API client with token management
- [x] Linting configured (Deno lint)
- [x] Formatting configured (Deno fmt)
- [x] Backend test suite (schema operations)
- [x] Frontend test suite (API client)
- [x] GitHub Actions CI pipeline (lint, format, test)
- [x] Documentation: README.md, ARCHITECTURE.md

### In Progress

- [ ] Create movie form component
- [ ] Edit movie functionality
- [ ] Scene management UI
- [ ] AI prompt interface

### Planned

- [ ] User roles (admin, user) with authorization middleware
- [ ] OAuth providers (Google, GitHub)
- [ ] File upload for posters/backdrops
- [ ] Image storage (local or cloud)
- [ ] AI integration (scene generation, dialogue writing)
- [ ] E2E tests (Playwright/Cypress)
- [ ] Docker configuration
- [ ] Production deployment setup
- [ ] PostgreSQL migration path
- [ ] Real-time collaboration
- [ ] Movie sharing (public/private)
- [ ] Rating and review system

### Known Issues

- [ ] Frontend uses Lit via CDN; consider bundling for production
- [ ] No rate limiting on auth endpoints
- [ ] JWT secret defaults to dev value (enforced via .env.example)

### Version

- Initial setup: Mon Aug 17 2026
