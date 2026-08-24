/**
 * OpenAPI endpoints: the generated spec (GET /api/v1/openapi.json) and the
 * Swagger UI page (GET /api/v1/docs).
 */

import { Router } from "@oak/oak/router";
import { buildOpenApiSpec } from "@cinemaItor/openapi/spec.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { ref } from "@cinemaItor/openapi/types.ts";

let cachedSpec: Record<string, unknown> | undefined;

function spec(): Record<string, unknown> {
  cachedSpec ??= buildOpenApiSpec();
  return cachedSpec;
}

// Swagger UI assets are pinned to a specific release; the page only loads
// them in a developer's browser, so a CDN is fine (the backend itself needs
// no runtime network).
const SWAGGER_VERSION = "5.17.14";

const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CinemAItor API</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-standalone-preset.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/v1/openapi.json",
      dom_id: "#swagger-ui",
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: "StandaloneLayout",
      deepLinking: true,
    });
  </script>
</body>
</html>
`;

export const router = new Router()
  .get("/api/v1/openapi.json", (ctx) => {
    ctx.response.body = spec();
  })
  .get("/api/v1/docs", (ctx) => {
    ctx.response.headers.set("content-type", "text/html; charset=utf-8");
    ctx.response.body = DOCS_HTML;
  });

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/openapi.json": {
    summary: "The generated OpenAPI 3.1 document for this API",
    responses: {
      200: {
        description: "The full OpenAPI document (JSON)",
        schema: ref("OpenApiDocument"),
      },
    },
  },
  "GET /api/v1/docs": {
    summary: "Swagger UI for exploring and calling this API",
    responses: {
      200: {
        description: "Swagger UI (HTML)",
        mediaType: "text/html",
      },
    },
  },
};
