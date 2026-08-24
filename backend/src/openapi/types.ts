/**
 * OpenAPI 3.1 building blocks shared by the spec builder (spec.ts) and the
 * per-route operation metadata exported by each module in src/routes/.
 *
 * The spec is generated from the live routers: paths, methods, path
 * parameters, security and rate-limiting are derived from what is actually
 * mounted (see spec.ts). What cannot be derived — request bodies, response
 * schemas, summaries, query parameters — is declared next to each route as
 * an `openApiOps` record keyed by "METHOD /path". A test asserts the two
 * sides stay in lockstep (see backend/tests/openapi.test.ts).
 */

/** A JSON Schema fragment (OpenAPI 3.1 dialect), as plain JSON. */
export type OpenApiSchema = Record<string, unknown>;

/** Reference to a component schema defined in components.schemas. */
export function ref(name: string): OpenApiSchema {
  return { $ref: `#/components/schemas/${name}` };
}

export interface ResponseMeta {
  description: string;
  /** JSON response schema. Omit for empty (204) responses. */
  schema?: OpenApiSchema;
  /**
   * For non-JSON responses (raw media previews, HTML): the response content
   * media type. When set, the body is documented as a binary stream.
   */
  mediaType?: string;
}

export interface ParameterMeta {
  schema: OpenApiSchema;
  description?: string;
  required?: boolean;
}

export interface OperationMeta {
  summary?: string;
  description?: string;
  /**
   * Request body. `contentType` defaults to application/json; use
   * application/octet-stream for raw uploads.
   */
  requestBody?: {
    description?: string;
    schema: OpenApiSchema;
    contentType?: string;
  };
  /** HTTP status (as string) or "default", mapped to the response metadata. */
  responses: Record<string, ResponseMeta>;
  /**
   * Extra query-string parameters. Path parameters are derived automatically
   * from the route pattern.
   */
  parameters?: Record<string, ParameterMeta>;
  /**
   * True when the handler enforces the admin role in code (there is no
   * admin middleware to derive it from).
   */
  adminOnly?: boolean;
  deprecated?: boolean;
}

/**
 * Descriptions for the standard error envelope statuses. Every error body
 * has the shape of the `Error` component schema ({ error: { code, message,
 * details?, traceId } }).
 */
const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "Validation error: the request body or parameters are invalid",
  401: "Authentication is required, or the token/session is invalid",
  403: "The authenticated user lacks permission for this operation",
  404: "The referenced resource does not exist",
  409: "The request conflicts with the current state of the resource",
  429: "Too many requests: the auth rate limit was exceeded",
  500: "Unexpected internal error",
  503: "Service unavailable: a required dependency (ffmpeg, SMTP, ...) is missing or failed",
};

/**
 * Expand a set of error statuses into standard `Error`-schema responses.
 * Per-operation overrides may spread these and then replace individual keys.
 */
export function errorResponses(
  ...codes: number[]
): Record<string, ResponseMeta> {
  const out: Record<string, ResponseMeta> = {};
  for (const code of codes) {
    out[String(code)] = {
      description: ERROR_DESCRIPTIONS[code] ?? `Error ${code}`,
      schema: ref("Error"),
    };
  }
  return out;
}
