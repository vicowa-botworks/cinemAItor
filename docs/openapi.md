# OpenAPI / Swagger

The API documentation is **generated, not hand-written**. The OpenAPI 3.1 document is derived from
the live route registrations at request time, merged with per-endpoint operation metadata declared
next to each route, and served as JSON with a Swagger UI on top. `backend/tests/openapi.test.ts`
enforces that the two sides stay in lockstep, so the spec and the routes cannot drift apart.

## Endpoints

| Method | Endpoint               | Auth   | Description                                                        |
| ------ | ---------------------- | ------ | ------------------------------------------------------------------ |
| GET    | `/api/v1/openapi.json` | public | The full generated OpenAPI 3.1 document (JSON)                     |
| GET    | `/api/v1/docs`         | public | Swagger UI (loads the pinned `swagger-ui-dist` 5.17.14 from a CDN) |

Both are public (no bearer token). In development they are reachable through the frontend proxy at
`http://localhost:8124/api/v1/docs` as well as directly on the backend port 8123. The spec is built
once per process and cached (`routes/openapi.ts`).

## How the spec is built

```
src/openapi/
├── types.ts     # OperationMeta / ResponseMeta / ParameterMeta, ref(), errorResponses()
├── schemas.ts   # SCHEMAS — every shared component schema (entities, request/response
│                #   shapes, the Error envelope); TAG_DESCRIPTIONS for the tag list
├── registry.ts  # apiRouters() + allOps() — every mounted router and its openApiOps
└── spec.ts      # buildOpenApiSpec() — introspects the routers and assembles the document
```

**Derived from the routers (no declaration needed):**

- paths and HTTP methods (the `:param` syntax is converted to `{param}`)
- path parameters, with integer ids for the `users` / `invitations` tags and string ids everywhere
  else (see the entity id conventions)
- `security`: an operation requires the bearer token exactly when its middleware stack contains
  `authMiddleware`
- `x-rate-limited` when the stack contains the auth rate-limit middleware
- `x-transport: websocket` for the `/ws/v1/jobs` stream (documented as a WebSocket, not an HTTP GET)

**Declared per endpoint** (in each module under `src/routes/` as an `openApiOps` record keyed by
`"METHOD /path"`): summaries, request bodies, response schemas, query parameters, `x-admin-only`
(admin enforced in the handler, not the middleware) and `deprecated`.

**operationId** is `method + pascal-cased path` (`postAuthLogin`); the legacy `/api/*` routes (the
multi-user test helper) carry a `Legacy` infix (`postLegacyAuthLogin`) so they never collide with
their v1 twins.

## Adding a route

1. Add the route to the router in `src/routes/<module>.ts`.
2. Add its entry to that module's `openApiOps` (`"POST /api/v1/things"`, with request/response
   schemas; reuse the shared schemas in `src/openapi/schemas.ts` and add new ones there when an
   entity shape is missing).
3. `deno task test` runs the coverage checks — `buildOpenApiSpec()` throws when a mounted route has
   no operation entry or an entry matches no route.

## Conventions

- Shared entity/request/response shapes live in `SCHEMAS` (`src/openapi/schemas.ts`) and are
  referenced as `ref("Asset")` and friends; every schema defined there must be referenced by at
  least one operation (the test fails on unreachable schemas).
- Every error body uses the `Error` envelope; `errorResponses(400, 401, ...)` in `types.ts` expands
  standard descriptions. Secured operations must document a `401`.
- The spec is OpenAPI **3.1** (JSON-Schema dialect; nullable types as `["string", "null"]` type
  arrays).
