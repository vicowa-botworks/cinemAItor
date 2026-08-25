/**
 * Component schemas for the OpenAPI document (components.schemas).
 *
 * Schemas mirror the shapes the handlers actually return, not the raw DB
 * rows: timestamps are ISO-8601 strings, booleans arrive as booleans, and
 * ids keep their wire types (string for domain entities, integer for
 * users/invitations).
 *
 * Reference them from operation metadata with ref("Name") from types.ts.
 * backend/tests/openapi.test.ts verifies that every $ref in the document
 * resolves to a schema defined here.
 */

import { type OpenApiSchema, ref } from "./types.ts";

const isoDate = { type: "string", format: "date-time" };

const SCHEMAS: Record<string, OpenApiSchema> = {
  /** Standard error envelope returned by the error middleware. */
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "traceId"],
        properties: {
          code: {
            type: "string",
            description: "Stable machine-readable error code",
            enum: [
              "VALIDATION",
              "AUTH_REQUIRED",
              "PERMISSION_DENIED",
              "NOT_FOUND",
              "CONFLICT",
              "RATE_LIMITED",
              "EMAIL_NOT_CONFIRMED",
              "MISSING_FILE",
              "CORRUPT_FILE",
              "MODEL_MISSING",
              "MODEL_UNHEALTHY",
              "GENERATION_FAILED",
              "RENDER_FAILED",
              "STORAGE_ERROR",
              "NETWORK_ERROR",
              "INTERNAL",
            ],
          },
          message: { type: "string" },
          details: { type: "string" },
          traceId: {
            type: "string",
            description: "Correlates with server log entries",
          },
        },
      },
    },
  },

  /** A user as returned by the API (never includes password_hash). */
  User: {
    type: "object",
    required: [
      "id",
      "email",
      "display_name",
      "role",
      "must_change_password",
      "email_confirmed",
    ],
    properties: {
      id: { type: "integer" },
      email: { type: "string", format: "email" },
      display_name: { type: "string" },
      role: { type: "string", enum: ["user", "admin"] },
      must_change_password: { type: "boolean" },
      email_confirmed: { type: "boolean" },
    },
  },

  /**
   * A user extended with the admin-only fields returned by the user
   * management endpoints (publicUser in routes/users.ts).
   */
  UserAdmin: {
    allOf: [
      { $ref: "#/components/schemas/User" },
      {
        type: "object",
        required: ["is_active", "created_at"],
        properties: {
          is_active: {
            type: "boolean",
            description: "Deactivated (soft-deleted) accounts keep their rows but cannot log in",
          },
          created_at: isoDate,
        },
      },
    ],
  },

  /** Liveness check response. */
  Health: {
    type: "object",
    required: ["status", "name", "version", "time"],
    properties: {
      status: { type: "string", example: "ok" },
      name: { type: "string", example: "cinemaItor" },
      version: { type: "string" },
      time: isoDate,
    },
  },

  /** Plain acknowledgement body: { message: "..." }. */
  Message: {
    type: "object",
    required: ["message"],
    properties: { message: { type: "string" } },
  },

  /** GET /api/v1/auth/setup-status body. */
  SetupStatus: {
    type: "object",
    required: ["registered", "registration_enabled"],
    properties: {
      registered: {
        type: "boolean",
        description: "Whether at least one user account exists",
      },
      registration_enabled: {
        type: "boolean",
        description: "Whether self-registration is currently allowed",
      },
    },
  },

  /** Response of bootstrap/login: a session token plus the user. */
  SessionIssued: {
    type: "object",
    required: ["token", "user"],
    properties: {
      token: {
        type: "string",
        description: "JWT to send as Authorization: Bearer <token>",
      },
      user: { $ref: "#/components/schemas/User" },
      message: {
        type: "string",
        description: "Present (instead of a token) when the account must first confirm its email",
      },
    },
  },

  /** POST /api/v1/auth/bootstrap body. */
  BootstrapRequest: {
    type: "object",
    required: ["email", "password", "display_name"],
    properties: {
      email: { type: "string", format: "email" },
      password: {
        type: "string",
        format: "password",
        minLength: 8,
        description: "At least 8 characters",
      },
      display_name: { type: "string", minLength: 1, maxLength: 200 },
    },
  },

  /** Login body (v1 + legacy). */
  LoginRequest: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", format: "password" },
    },
  },

  /** PUT /api/v1/auth/password body. */
  PasswordChangeRequest: {
    type: "object",
    required: ["current_password", "new_password"],
    properties: {
      current_password: { type: "string", format: "password" },
      new_password: { type: "string", format: "password", minLength: 8 },
    },
  },

  /** Body with a single email field (reset request, confirmation resend). */
  EmailRequest: {
    type: "object",
    required: ["email"],
    properties: { email: { type: "string", format: "email" } },
  },

  /** POST /api/v1/auth/password-reset/confirm body. */
  PasswordResetConfirmRequest: {
    type: "object",
    required: ["token", "new_password"],
    properties: {
      token: { type: "string", description: "Single-use reset token from the email" },
      new_password: { type: "string", format: "password", minLength: 8 },
    },
  },

  /** Body with a single token field (email confirmation). */
  TokenRequest: {
    type: "object",
    required: ["token"],
    properties: {
      token: {
        type: "string",
        description: "Single-use confirmation token from the email",
      },
    },
  },

  /** A movie project. */
  Project: {
    type: "object",
    required: ["id", "name", "status", "created_at", "updated_at"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: ["string", "null"] },
      media_directory: { type: ["string", "null"] },
      output_directory: { type: ["string", "null"] },
      aspect_ratio: { type: ["string", "null"], example: "16:9" },
      frame_rate: { type: ["number", "null"], example: 24 },
      resolution_width: { type: ["integer", "null"] },
      resolution_height: { type: ["integer", "null"] },
      color_space: { type: ["string", "null"], example: "bt709" },
      audio_sample_rate: { type: ["integer", "null"] },
      default_export_preset_id: { type: ["string", "null"] },
      default_model_preferences_json: {
        type: ["string", "null"],
        description: "JSON-encoded per-task model preferences",
      },
      template_id: { type: ["string", "null"] },
      status: { type: "string", enum: ["active", "archived", "deleted"] },
      created_at: isoDate,
      updated_at: isoDate,
      created_by_user_id: { type: ["integer", "null"] },
    },
  },

  /** POST /api/v1/projects body. */
  ProjectInput: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string" },
      aspect_ratio: { type: "string" },
      frame_rate: { type: "number", exclusiveMinimum: 0 },
      resolution_width: { type: "integer", exclusiveMinimum: 0 },
      resolution_height: { type: "integer", exclusiveMinimum: 0 },
      color_space: { type: "string" },
      audio_sample_rate: { type: "integer", exclusiveMinimum: 0 },
      default_export_preset_id: { type: "string" },
      default_model_preferences: {
        description: "Object or JSON string of per-task model preferences",
      },
      template_id: {
        type: "string",
        description: "Optional template to materialize as the starting timeline",
      },
    },
  },

  /** PATCH /api/v1/projects/{id} body — all fields optional, at least one required. */
  ProjectUpdates: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: ["string", "null"] },
      aspect_ratio: { type: "string" },
      frame_rate: { type: "number", exclusiveMinimum: 0 },
      resolution_width: { type: "integer", exclusiveMinimum: 0 },
      resolution_height: { type: "integer", exclusiveMinimum: 0 },
      color_space: { type: "string" },
      audio_sample_rate: { type: "integer", exclusiveMinimum: 0 },
      default_export_preset_id: { type: ["string", "null"] },
      default_model_preferences: {
        description: "Object, JSON string, or null to clear",
      },
      template_id: { type: ["string", "null"] },
    },
  },

  /** A system project template (read-only). */
  Template: {
    type: "object",
    required: ["id", "name", "structure", "is_system"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: ["string", "null"] },
      structure: {
        type: "object",
        required: ["timeline_name", "tracks"],
        properties: {
          timeline_name: {
            type: ["string", "null"],
            description: "null means the template creates no timeline (blank project)",
          },
          tracks: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "track_type"],
              properties: {
                name: { type: "string" },
                track_type: { type: "string" },
              },
            },
          },
        },
      },
      is_system: { type: "boolean" },
    },
  },

  /** POST /api/v1/users body. */
  UserCreateRequest: {
    type: "object",
    required: ["email", "display_name", "password"],
    properties: {
      email: { type: "string", format: "email" },
      display_name: { type: "string", minLength: 1, maxLength: 100 },
      password: { type: "string", format: "password", minLength: 8 },
      role: { type: "string", enum: ["user", "admin"], default: "user" },
      must_change_password: {
        type: "boolean",
        default: true,
        description: "Defaults to true for provisioned accounts",
      },
    },
  },

  /** PATCH /api/v1/users/{id} body — all fields optional, at least one required. */
  UserUpdateRequest: {
    type: "object",
    properties: {
      role: { type: "string", enum: ["user", "admin"] },
      is_active: { type: "boolean" },
      must_change_password: { type: "boolean" },
      email_confirmed: { type: "boolean" },
      display_name: { type: "string", minLength: 1, maxLength: 100 },
      password: {
        type: "string",
        format: "password",
        minLength: 8,
        description:
          "Assigns a temporary password and forces a change at next login unless must_change_password=false",
      },
    },
  },

  /** GET /api/v1/users/settings/email response. */
  EmailSettings: {
    type: "object",
    required: [
      "smtp_host",
      "smtp_port",
      "smtp_user",
      "smtp_from",
      "smtp_tls",
      "app_base_url",
      "smtp_password_set",
      "email_confirmation_required",
    ],
    properties: {
      smtp_host: { type: "string", description: "Empty when unconfigured" },
      smtp_port: { type: "integer", minimum: 1, maximum: 65535 },
      smtp_user: { type: "string" },
      smtp_from: { type: "string" },
      smtp_tls: { type: "string", enum: ["none", "starttls", "implicit"] },
      app_base_url: {
        type: "string",
        format: "uri",
        description: "Base URL used in the links inside emails",
      },
      smtp_password_set: {
        type: "boolean",
        description: "The secret itself is never returned",
      },
      email_confirmation_required: {
        type: "boolean",
        description:
          "When true (and SMTP is configured) self-registered accounts must confirm their email",
      },
    },
  },

  /** PATCH /api/v1/users/settings/email body — partial update, unknown keys ignored. */
  EmailSettingsUpdate: {
    type: "object",
    properties: {
      smtp_host: { type: "string" },
      smtp_port: { type: "integer", minimum: 1, maximum: 65535 },
      smtp_user: { type: "string" },
      smtp_from: { type: "string" },
      smtp_tls: { type: "string", enum: ["none", "starttls", "implicit"] },
      app_base_url: { type: "string", format: "uri" },
      smtp_password: {
        type: ["string", "null"],
        description: "New secret, or null to clear",
      },
      email_confirmation_required: { type: "boolean" },
    },
  },

  /** An admin invitation (list shape). */
  Invitation: {
    type: "object",
    required: [
      "id",
      "email",
      "created_by_name",
      "created_at",
      "expires_at",
      "status",
    ],
    properties: {
      id: { type: "integer" },
      email: { type: "string", format: "email" },
      display_name: { type: ["string", "null"] },
      created_by_name: { type: "string" },
      created_at: isoDate,
      expires_at: isoDate,
      status: {
        type: "string",
        enum: ["pending", "accepted", "revoked", "expired"],
      },
    },
  },

  /** POST /api/v1/invitations response. */
  InvitationCreated: {
    type: "object",
    required: ["id", "email", "status", "sent", "transport"],
    properties: {
      id: { type: "integer" },
      email: { type: "string", format: "email" },
      display_name: { type: ["string", "null"] },
      status: { type: "string", enum: ["pending"] },
      sent: { type: "boolean" },
      transport: { type: "string", enum: ["smtp", "mock"] },
    },
  },

  /** POST /api/v1/invitations body. */
  InvitationCreateRequest: {
    type: "object",
    required: ["email"],
    properties: {
      email: { type: "string", format: "email" },
      display_name: { type: "string", maxLength: 100 },
    },
  },

  /** POST /api/v1/invitations/accept body (public). */
  InvitationAcceptRequest: {
    type: "object",
    required: ["token", "password"],
    properties: {
      token: { type: "string", description: "Single-use token from the invitation email" },
      password: { type: "string", format: "password", minLength: 8 },
      display_name: { type: "string", maxLength: 100 },
    },
  },

  /** A stored (immutable) prompt version. */
  PromptVersion: {
    type: "object",
    required: [
      "id",
      "scope_type",
      "scope_id",
      "version_number",
      "content",
      "content_hash",
      "created_at",
    ],
    properties: {
      id: { type: "string" },
      scope_type: {
        type: "string",
        enum: ["generic", "prompt", "scene", "shot", "storyboard_panel"],
      },
      scope_id: { type: "string" },
      version_number: { type: "integer", minimum: 1 },
      content: { type: "string" },
      content_hash: { type: "string" },
      parent_prompt_id: { type: ["string", "null"] },
      created_at: isoDate,
      created_by_user_id: { type: ["integer", "null"] },
    },
  },

  /** A prompt version plus its resolved @references. */
  PromptDetail: {
    allOf: [
      { $ref: "#/components/schemas/PromptVersion" },
      {
        type: "object",
        required: ["references"],
        properties: {
          references: { type: "array", items: { $ref: "#/components/schemas/Reference" } },
        },
      },
    ],
  },

  /** POST /api/v1/prompts body. */
  PromptSaveRequest: {
    type: "object",
    required: ["scope_type", "scope_id", "content"],
    properties: {
      scope_type: {
        type: "string",
        enum: ["generic", "prompt", "scene", "shot", "storyboard_panel"],
      },
      scope_id: { type: "string" },
      content: { type: "string", maxLength: 100000 },
      roles: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Optional map of @slug → role for the tokens in content",
      },
    },
  },

  /** Save/restore prompt response. */
  PromptSaved: {
    type: "object",
    required: ["version", "duplicate", "warnings", "references"],
    properties: {
      version: { $ref: "#/components/schemas/PromptVersion" },
      duplicate: {
        type: "boolean",
        description: "True when the saved content was unchanged (200 instead of 201)",
      },
      warnings: { type: "array", items: { type: "string" } },
      references: { type: "array", items: { $ref: "#/components/schemas/Reference" } },
    },
  },

  /** A stored reference row. */
  Reference: {
    type: "object",
    required: [
      "id",
      "source_type",
      "source_id",
      "raw_text",
      "status",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string" },
      source_type: {
        type: "string",
        enum: ["prompt", "scene", "shot", "storyboard_panel"],
      },
      source_id: { type: "string" },
      asset_id: { type: ["string", "null"] },
      asset_version_id: { type: ["string", "null"] },
      role: { type: ["string", "null"] },
      raw_text: { type: "string", example: "@hero" },
      start_index: { type: ["integer", "null"] },
      end_index: { type: ["integer", "null"] },
      status: { type: "string", enum: ["resolved", "missing", "ambiguous"] },
      notes: { type: ["string", "null"] },
      created_at: isoDate,
      updated_at: isoDate,
    },
  },

  /** A token returned by references/parse. */
  ReferenceToken: {
    type: "object",
    required: ["raw", "slug", "start", "end", "status"],
    properties: {
      raw: { type: "string", example: "@hero:v2" },
      slug: { type: "string" },
      version: { type: ["integer", "null"] },
      start: { type: "integer" },
      end: { type: "integer" },
      status: { type: "string", enum: ["resolved", "missing", "ambiguous"] },
      role: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      id: {
        type: "string",
        description: "Present when the parse was persisted against a scope",
      },
      asset: {
        description: "The resolved asset (null when missing/ambiguous)",
        oneOf: [
          { type: "null" },
          {
            type: "object",
            required: ["id", "slug", "display_name"],
            properties: {
              id: { type: "string" },
              slug: { type: "string" },
              display_name: { type: "string" },
              active_version_id: { type: ["string", "null"] },
            },
          },
        ],
      },
    },
  },

  /** POST /api/v1/references/parse body. */
  ReferenceParseRequest: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string", maxLength: 100000 },
      roles: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Optional map of @slug → role",
      },
      persist: {
        type: "object",
        required: ["scope_type", "scope_id"],
        properties: {
          scope_type: {
            type: "string",
            enum: ["prompt", "scene", "shot", "storyboard_panel"],
          },
          scope_id: { type: "string" },
        },
        description: "When present, the resolved references are stored against this scope",
      },
    },
  },

  /** POST /api/v1/references/{id}/replace body. */
  ReferenceReplaceRequest: {
    type: "object",
    required: ["slug"],
    properties: {
      slug: { type: "string", description: "Slug of the asset to retarget to" },
      version: { type: "integer", minimum: 1 },
    },
  },

  /** Placeholder for the OpenAPI document itself (self-describing). */
  OpenApiDocument: {
    type: "object",
    required: ["openapi", "info", "paths"],
    properties: {
      openapi: { type: "string", example: "3.1.0" },
      info: { type: "object" },
      servers: { type: "array", items: { type: "object" } },
      tags: { type: "array", items: { type: "object" } },
      paths: { type: "object" },
      components: { type: "object" },
    },
    additionalProperties: true,
  },
  /** The prompt currently attached to a creative object (panel/scene/shot). */
  CreativePrompt: {
    type: "object",
    required: ["content", "version_number", "version_id", "warnings"],
    properties: {
      content: { type: "string" },
      version_number: { type: "integer" },
      version_id: { type: "string" },
      warnings: {
        type: "array",
        items: { type: "string" },
        description: "Reference warnings (broken @tokens, unknown assets, ...)",
      },
    },
  },

  // ---------------------------------------------------------------------
  // Assets
  // ---------------------------------------------------------------------

  /** A media asset (the row shape; aliases/tags/active_version added in AssetDetail). */
  Asset: {
    type: "object",
    required: [
      "id",
      "library_scope",
      "unique_slug",
      "display_name",
      "asset_type",
      "status",
      "source_type",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string" },
      library_scope: { type: "string", enum: ["global", "project"] },
      project_id: { type: ["string", "null"] },
      unique_slug: { type: "string", description: "The @slug used in prompts" },
      display_name: { type: "string" },
      asset_type: { type: "string" },
      description: { type: ["string", "null"] },
      status: { type: "string", enum: ["active", "deleted"] },
      source_type: { type: "string" },
      license: { type: ["string", "null"] },
      rights_status: { type: ["string", "null"] },
      attribution: { type: ["string", "null"] },
      parent_asset_id: { type: ["string", "null"] },
      active_version_id: { type: ["string", "null"] },
      preview_version_id: { type: ["string", "null"] },
      created_at: isoDate,
      updated_at: isoDate,
      created_by_user_id: { type: ["integer", "null"] },
    },
  },

  /** One version of an asset's media (content-addressed in the content store). */
  AssetVersion: {
    type: "object",
    required: [
      "id",
      "asset_id",
      "version_number",
      "status",
      "checksum_algorithm",
      "created_at",
    ],
    properties: {
      id: { type: "string" },
      asset_id: { type: "string" },
      version_number: { type: "integer" },
      status: { type: "string" },
      content_hash: { type: ["string", "null"] },
      file_path: { type: ["string", "null"] },
      proxy_path: { type: ["string", "null"] },
      format: { type: ["string", "null"] },
      mime_type: { type: ["string", "null"] },
      file_size: { type: ["integer", "null"] },
      checksum_algorithm: { type: "string" },
      technical_metadata_json: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      created_at: isoDate,
      created_by_user_id: { type: ["integer", "null"] },
    },
  },

  /** Asset detail: the asset plus its aliases, tags and active version. */
  AssetDetail: {
    allOf: [
      { $ref: "#/components/schemas/Asset" },
      {
        type: "object",
        required: ["aliases", "tags", "active_version"],
        properties: {
          aliases: {
            type: "array",
            items: { type: "string" },
            description: "Alternate @slug spellings",
          },
          tags: { type: "array", items: { type: "string" } },
          active_version: {
            oneOf: [
              { $ref: "#/components/schemas/AssetVersion" },
              { type: "null" },
            ],
          },
        },
      },
    ],
  },

  /** POST /api/v1/assets body. */
  AssetCreateRequest: {
    type: "object",
    required: ["unique_slug", "display_name", "asset_type"],
    properties: {
      unique_slug: {
        type: "string",
        pattern: "^[a-z0-9][a-z0-9_]{0,63}$",
      },
      display_name: { type: "string", maxLength: 200 },
      asset_type: {
        type: "string",
        pattern: "^[a-z0-9_+-]{1,50}$",
      },
      library_scope: {
        type: "string",
        enum: ["global", "project"],
        default: "global",
      },
      project_id: { type: ["string", "null"] },
      description: { type: "string" },
    },
  },

  /** Shared image/video reference item for asset generation bodies. */
  AssetReference: {
    type: "object",
    required: ["asset_id"],
    properties: {
      asset_id: { type: "string" },
      version_number: {
        type: "integer",
        minimum: 1,
        description: "Defaults to the asset's active version",
      },
    },
  },

  /** POST /api/v1/assets/generate body. */
  AssetGenerateRequest: {
    type: "object",
    required: ["kind", "prompt", "unique_slug"],
    properties: {
      kind: { type: "string", enum: ["image", "video"] },
      prompt: { type: "string" },
      unique_slug: {
        type: "string",
        pattern: "^[a-z0-9][a-z0-9_]{0,63}$",
      },
      display_name: { type: "string", maxLength: 200 },
      asset_type: {
        type: "string",
        description: "Defaults to the kind. character / location / prop / image for the " +
          "image kind; video for the video kind.",
      },
      library_scope: {
        type: "string",
        enum: ["global", "project"],
        default: "global",
      },
      project_id: { type: "string" },
      model_id: { type: "string" },
      seed: { type: "string" },
      candidates: {
        type: "integer",
        minimum: 1,
        maximum: 8,
        default: 2,
      },
      references: {
        type: "array",
        maxItems: 8,
        items: ref("AssetReference"),
      },
    },
  },

  /** POST /api/v1/assets/{id}/generate body. */
  AssetEditRequest: {
    type: "object",
    required: ["kind", "prompt"],
    properties: {
      kind: { type: "string", enum: ["image", "video"] },
      prompt: {
        type: "string",
        description: "Edit instructions for the new version",
      },
      model_id: { type: "string" },
      seed: { type: "string" },
      candidates: {
        type: "integer",
        minimum: 1,
        maximum: 8,
        default: 2,
      },
      include_current: {
        type: "boolean",
        default: false,
        description: "Use the asset's active version as a reference input",
      },
      references: {
        type: "array",
        maxItems: 8,
        items: ref("AssetReference"),
      },
    },
  },

  /** POST /api/v1/assets[/generate] response (202). */
  AssetGenerateResult: {
    type: "object",
    required: ["job_id", "job_type", "asset_id", "model_id"],
    properties: {
      job_id: { type: "string" },
      job_type: {
        type: "string",
        description: "Task type: text_to_image / image_to_image / text_to_video / image_to_video",
      },
      asset_id: { type: "string", description: "The target asset" },
      model_id: { type: "string" },
    },
  },

  /** PATCH /api/v1/assets/{id} body (all fields optional). */
  AssetUpdateRequest: {
    type: "object",
    properties: {
      display_name: { type: "string", maxLength: 200 },
      asset_type: {
        type: "string",
        pattern: "^[a-z0-9_+-]{1,50}$",
      },
      description: { type: "string" },
      license: { type: ["string", "null"] },
      rights_status: { type: ["string", "null"] },
      attribution: { type: ["string", "null"] },
      source_type: { type: "string" },
    },
  },

  /** POST /api/v1/assets/{id}/versions body (hash must exist in the content store). */
  AssetVersionHashRequest: {
    type: "object",
    required: ["content_hash"],
    properties: {
      content_hash: {
        type: "string",
        pattern: "^[0-9a-f]{64}$",
        description: "SHA-256 hex of a file already in the content store",
      },
      notes: { type: "string" },
    },
  },

  /** Upload/restore response: the asset (detail) plus the version in question. */
  AssetUploadResult: {
    type: "object",
    required: ["asset", "version"],
    properties: {
      asset: { $ref: "#/components/schemas/AssetDetail" },
      version: { $ref: "#/components/schemas/AssetVersion" },
    },
  },

  /** Restore-version response. */
  AssetVersionRestored: {
    type: "object",
    required: ["message", "asset", "version"],
    properties: {
      message: { type: "string" },
      asset: { $ref: "#/components/schemas/AssetDetail" },
      version: { $ref: "#/components/schemas/AssetVersion" },
    },
  },

  /** Alias add/remove response: a message plus the asset's full alias list. */
  AssetAliasChange: {
    type: "object",
    required: ["message", "aliases"],
    properties: {
      message: { type: "string" },
      aliases: { type: "array", items: { type: "string" } },
    },
  },

  /** Tag add/remove response: a message plus the asset's full tag list. */
  AssetTagChange: {
    type: "object",
    required: ["message", "tags"],
    properties: {
      message: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },

  /** DELETE /api/v1/assets/{id} response. */
  AssetDeleted: {
    type: "object",
    required: ["message", "referenced_by", "warnings"],
    properties: {
      message: { type: "string" },
      referenced_by: {
        type: "integer",
        description: "References still pointing at the deleted asset",
      },
      warnings: { type: "array", items: { type: "string" } },
    },
  },

  /** GET /api/v1/assets/{id}/dependencies report (AST-015). */
  AssetDependencies: {
    type: "object",
    required: [
      "asset_id",
      "prompt_references",
      "timeline_items",
      "panels",
      "shots",
      "totals",
    ],
    properties: {
      asset_id: { type: "string" },
      prompt_references: {
        type: "array",
        items: {
          type: "object",
          required: [
            "id",
            "source_type",
            "source_id",
            "raw_text",
            "status",
            "broken",
          ],
          properties: {
            id: { type: "string" },
            source_type: { type: "string" },
            source_id: { type: "string" },
            raw_text: { type: "string" },
            role: { type: ["string", "null"] },
            status: { type: "string" },
            broken: { type: "boolean" },
          },
        },
      },
      timeline_items: {
        type: "array",
        items: {
          type: "object",
          required: [
            "item_id",
            "timeline_id",
            "timeline_name",
            "track_id",
            "track_name",
            "track_type",
            "version_id",
          ],
          properties: {
            item_id: { type: "string" },
            timeline_id: { type: "string" },
            timeline_name: { type: "string" },
            track_id: { type: "string" },
            track_name: { type: "string" },
            track_type: { type: "string" },
            version_id: { type: "string" },
          },
        },
      },
      panels: {
        type: "array",
        items: {
          type: "object",
          required: [
            "pointer",
            "storyboard_id",
            "storyboard_name",
            "panel_id",
            "version_id",
          ],
          properties: {
            pointer: { type: "string", enum: ["preview", "clip"] },
            storyboard_id: { type: "string" },
            storyboard_name: { type: "string" },
            panel_id: { type: "string" },
            shot_number: { type: ["string", "null"] },
            version_id: { type: "string" },
          },
        },
      },
      shots: {
        type: "array",
        items: {
          type: "object",
          required: [
            "scene_id",
            "scene_name",
            "shot_id",
            "shot_order",
            "version_id",
          ],
          properties: {
            scene_id: { type: "string" },
            scene_name: { type: "string" },
            shot_id: { type: "string" },
            shot_order: { type: "integer" },
            version_id: { type: "string" },
          },
        },
      },
      totals: {
        type: "object",
        required: [
          "prompt_references",
          "timeline_items",
          "panels",
          "shots",
          "total",
        ],
        properties: {
          prompt_references: { type: "integer" },
          timeline_items: { type: "integer" },
          panels: { type: "integer" },
          shots: { type: "integer" },
          total: { type: "integer" },
        },
      },
    },
  },

  // ---------------------------------------------------------------------
  // Audio
  // ---------------------------------------------------------------------

  /** POST /api/v1/audio/generate body. */
  AudioGenerateRequest: {
    type: "object",
    required: ["kind", "prompt"],
    properties: {
      kind: { type: "string", enum: ["music", "voiceover", "sfx"] },
      prompt: { type: "string" },
      project_id: { type: "string" },
      scene_id: { type: "string" },
      model_id: { type: "string" },
      seed: { type: "string" },
      settings: { type: "object", additionalProperties: true },
    },
  },

  /** POST /api/v1/audio/generate response (202). */
  AudioGenerateResult: {
    type: "object",
    required: ["job_id", "job_type", "asset_id", "model_id"],
    properties: {
      job_id: { type: "string" },
      job_type: {
        type: "string",
        description: "Task type: music / voice / audio",
      },
      asset_id: { type: "string", description: "The fresh audio asset" },
      model_id: { type: "string" },
    },
  },

  /** POST /api/v1/audio/upload response (201). */
  AudioUploadResult: {
    type: "object",
    required: ["asset", "version", "audio"],
    properties: {
      asset: { $ref: "#/components/schemas/AssetDetail" },
      version: { $ref: "#/components/schemas/AssetVersion" },
      audio: {
        description:
          "ffprobe analysis (duration, sample rate, channels, waveform) or null without ffmpeg",
        type: ["object", "null"],
        additionalProperties: true,
      },
    },
  },

  /** JSON body for registering an existing content-store hash as a new version. */
  AudioVersionCreate: {
    type: "object",
    required: ["content_hash"],
    properties: {
      content_hash: {
        type: "string",
        pattern: "^[0-9a-f]{64}$",
      },
      notes: { type: "string" },
    },
  },

  /** Version + analysis response (upload / new version / adjustments). */
  AudioVersionResult: {
    type: "object",
    required: ["version", "audio"],
    properties: {
      version: { $ref: "#/components/schemas/AssetVersion" },
      audio: {
        description: "ffprobe analysis or null without ffmpeg",
        type: ["object", "null"],
        additionalProperties: true,
      },
    },
  },

  /** PATCH .../adjustments body (non-destructive, applied at render time). */
  AudioAdjustmentsRequest: {
    type: "object",
    properties: {
      trim: {
        type: "object",
        properties: {
          start: { type: "number", minimum: 0 },
          end: { type: "number", minimum: 0 },
        },
      },
      gain_db: { type: "number" },
    },
  },

  /** POST .../cleanup body (AUD-012). */
  AudioCleanupRequest: {
    type: "object",
    properties: {
      denoise: { type: "boolean", default: true },
      normalize: { type: "boolean", default: true },
    },
  },

  /** POST .../cleanup response (202): the queued model-less cleanup job. */
  AudioCleanupResult: {
    type: "object",
    required: [
      "job_id",
      "job_type",
      "asset_id",
      "source_version_id",
      "source_version_number",
      "operations",
    ],
    properties: {
      job_id: { type: "string" },
      job_type: { type: "string", enum: ["audio_cleanup"] },
      asset_id: { type: "string" },
      source_version_id: { type: "string" },
      source_version_number: { type: "integer" },
      operations: {
        type: "object",
        required: ["denoise", "normalize"],
        properties: {
          denoise: { type: "boolean" },
          normalize: { type: "boolean" },
        },
      },
    },
  },

  /** POST .../subtitles body (AUD-014). */
  AudioSubtitleRequest: {
    type: "object",
    properties: {
      model_id: { type: "string" },
      seed: { type: "string" },
      settings: { type: "object", additionalProperties: true },
    },
  },

  /** POST .../subtitles response (202): the queued transcription job. */
  AudioSubtitleResult: {
    type: "object",
    required: [
      "job_id",
      "job_type",
      "asset_id",
      "model_id",
      "source_asset_id",
      "source_version_id",
      "source_version_number",
    ],
    properties: {
      job_id: { type: "string" },
      job_type: { type: "string", enum: ["transcribe"] },
      asset_id: {
        type: "string",
        description: "The fresh global subtitle asset that receives the SRT candidates",
      },
      model_id: { type: "string" },
      source_asset_id: { type: "string" },
      source_version_id: { type: "string" },
      source_version_number: { type: "integer" },
    },
  },

  // ---------------------------------------------------------------------
  // Creative objects (storyboards, scenes, shots)
  // ---------------------------------------------------------------------

  /** A storyboard board. */
  Storyboard: {
    type: "object",
    required: [
      "id",
      "project_id",
      "name",
      "status",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string" },
      project_id: { type: "string" },
      name: { type: "string" },
      status: { type: "string" },
      created_at: isoDate,
      updated_at: isoDate,
    },
  },

  /** POST /api/v1/storyboards/{id}/panels body. */
  PanelInput: {
    type: "object",
    required: ["panel_order"],
    properties: {
      panel_order: { type: "integer" },
      shot_number: { type: "string" },
      description: { type: "string" },
      prompt: { type: "string" },
      duration: { type: "number" },
      camera_settings: { type: "object", additionalProperties: true },
      mood: { type: "string" },
      lighting: { type: "string" },
      time_of_day: { type: "string" },
      dialogue: { type: "string" },
      voiceover: { type: "string" },
      music_cue: { type: "string" },
      sfx: { type: "string" },
      transition: { type: "string" },
      notes: { type: "string" },
      status: { type: "string" },
    },
  },

  /** A storyboard panel with its resolved prompt (detail endpoints). */
  PanelWithPrompt: {
    allOf: [
      {
        type: "object",
        required: [
          "id",
          "storyboard_id",
          "panel_order",
          "status",
          "created_at",
          "updated_at",
        ],
        properties: {
          id: { type: "string" },
          storyboard_id: { type: "string" },
          panel_order: { type: "integer" },
          shot_number: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          prompt_version_id: { type: ["string", "null"] },
          duration: { type: ["number", "null"] },
          camera_settings: {
            type: ["object", "null"],
            additionalProperties: true,
          },
          mood: { type: ["string", "null"] },
          lighting: { type: ["string", "null"] },
          time_of_day: { type: ["string", "null"] },
          dialogue: { type: ["string", "null"] },
          voiceover: { type: ["string", "null"] },
          music_cue: { type: ["string", "null"] },
          sfx: { type: ["string", "null"] },
          transition: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
          status: { type: "string" },
          preview_asset_version_id: { type: ["string", "null"] },
          generated_clip_asset_version_id: { type: ["string", "null"] },
          created_at: isoDate,
          updated_at: isoDate,
        },
      },
      {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: {
            oneOf: [
              { $ref: "#/components/schemas/CreativePrompt" },
              { type: "null" },
            ],
          },
        },
      },
    ],
  },

  /** The result of enqueueing a single creative generation (t2i / i2v / t2v). */
  CreativeGenerateResult: {
    type: "object",
    required: ["job_id", "asset_id", "model_id", "warnings"],
    properties: {
      job_id: { type: "string" },
      job_type: {
        type: "string",
        enum: ["text_to_image", "image_to_video", "text_to_video"],
        description: "Present for scene generation",
      },
      asset_id: {
        type: "string",
        description: "The creative asset the candidates land on (panel_*/scene_*/shot_*)",
      },
      model_id: { type: "string" },
      warnings: { type: "array", items: { type: "string" } },
    },
  },

  /** A scene. */
  Scene: {
    type: "object",
    required: [
      "id",
      "project_id",
      "name",
      "status",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string" },
      project_id: { type: "string" },
      storyboard_id: { type: ["string", "null"] },
      name: { type: "string" },
      description: { type: ["string", "null"] },
      prompt_version_id: { type: ["string", "null"] },
      status: { type: "string" },
      target_duration: { type: ["number", "null"] },
      aspect_ratio_override: { type: ["string", "null"] },
      frame_rate_override: { type: ["number", "null"] },
      notes: { type: ["string", "null"] },
      audio_plan: { type: ["object", "null"], additionalProperties: true },
      created_at: isoDate,
      updated_at: isoDate,
    },
  },

  /** POST /api/v1/scenes body. */
  SceneInput: {
    type: "object",
    required: ["project_id", "name"],
    properties: {
      project_id: { type: "string" },
      name: { type: "string" },
      storyboard_id: { type: "string" },
      description: { type: "string" },
      prompt: { type: "string" },
      status: { type: "string" },
      target_duration: { type: "number" },
      aspect_ratio_override: { type: "string" },
      frame_rate_override: { type: "number" },
      notes: { type: "string" },
      audio_plan: { type: "object", additionalProperties: true },
    },
  },

  /** A scene with its resolved prompt (detail endpoints). */
  SceneWithPrompt: {
    allOf: [
      { $ref: "#/components/schemas/Scene" },
      {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: {
            oneOf: [
              { $ref: "#/components/schemas/CreativePrompt" },
              { type: "null" },
            ],
          },
        },
      },
    ],
  },

  /** POST /api/v1/scenes/{id}/shots body. */
  ShotInput: {
    type: "object",
    required: ["shot_order"],
    properties: {
      shot_order: { type: "integer" },
      name: { type: "string" },
      prompt: { type: "string" },
      duration: { type: "number" },
      camera_settings: { type: "object", additionalProperties: true },
      status: { type: "string" },
      notes: { type: "string" },
    },
  },

  /** A shot with its resolved prompt (detail endpoints). */
  ShotWithPrompt: {
    allOf: [
      {
        type: "object",
        required: ["id", "scene_id", "shot_order", "status", "created_at", "updated_at"],
        properties: {
          id: { type: "string" },
          scene_id: { type: "string" },
          shot_order: { type: "integer" },
          name: { type: ["string", "null"] },
          prompt_version_id: { type: ["string", "null"] },
          duration: { type: ["number", "null"] },
          camera_settings: {
            type: ["object", "null"],
            additionalProperties: true,
          },
          status: { type: "string" },
          generated_asset_version_id: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
          created_at: isoDate,
          updated_at: isoDate,
        },
      },
      {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: {
            oneOf: [
              { $ref: "#/components/schemas/CreativePrompt" },
              { type: "null" },
            ],
          },
        },
      },
    ],
  },

  /** Batch scene generation (one job per shot) response (202). */
  CreativeBatchGenerateResult: {
    type: "object",
    required: ["scene_id", "job_type", "model_id", "jobs", "skipped", "warnings"],
    properties: {
      scene_id: { type: "string" },
      job_type: { type: "string", enum: ["image_to_video", "text_to_video"] },
      model_id: { type: "string" },
      jobs: {
        type: "array",
        items: {
          type: "object",
          required: ["shot_id", "job_id", "asset_id"],
          properties: {
            shot_id: { type: "string" },
            job_id: { type: "string" },
            asset_id: { type: "string" },
          },
        },
      },
      skipped: {
        type: "array",
        items: {
          type: "object",
          required: ["shot_id", "reason"],
          properties: {
            shot_id: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
  },

  // ---------------------------------------------------------------------
  // Timelines
  // ---------------------------------------------------------------------

  /** A timeline (no tracks/items — see TimelineDetail). */
  Timeline: {
    type: "object",
    required: ["id", "project_id", "name", "duration", "created_at", "updated_at"],
    properties: {
      id: { type: "string" },
      project_id: { type: "string" },
      name: { type: "string" },
      duration: { type: "number" },
      settings: { type: ["object", "null"], additionalProperties: true },
      created_at: isoDate,
      updated_at: isoDate,
    },
  },

  /** A timeline track. */
  Track: {
    type: "object",
    required: [
      "id",
      "timeline_id",
      "track_type",
      "name",
      "track_order",
      "locked",
      "muted",
      "gain_db",
      "duck_db",
    ],
    properties: {
      id: { type: "string" },
      timeline_id: { type: "string" },
      track_type: {
        type: "string",
        enum: [
          "video",
          "dialogue",
          "voiceover",
          "music",
          "sfx",
          "ambience",
          "overlay",
          "text",
          "subtitle",
          "effect",
          "transition",
        ],
      },
      name: { type: "string" },
      track_order: { type: "integer" },
      locked: { type: "boolean" },
      muted: { type: "boolean" },
      gain_db: { type: "number", description: "Mixer gain in dB; 0 is neutral" },
      duck_db: {
        type: "number",
        description: "Ducking reduction in dB while dialogue sounds; 0 is off",
      },
    },
  },

  /** POST /api/v1/timelines/{id}/tracks body. */
  TrackInput: {
    type: "object",
    required: ["track_type", "name"],
    properties: {
      track_type: {
        type: "string",
        enum: [
          "video",
          "dialogue",
          "voiceover",
          "music",
          "sfx",
          "ambience",
          "overlay",
          "text",
          "subtitle",
          "effect",
          "transition",
        ],
      },
      name: { type: "string" },
      track_order: { type: "integer" },
      locked: { type: "boolean" },
      muted: { type: "boolean" },
      gain_db: { type: "number" },
      duck_db: { type: "number" },
    },
  },

  /** PATCH .../tracks/{trackId} body (all fields optional). */
  TrackUpdateInput: {
    type: "object",
    properties: {
      name: { type: "string" },
      track_order: { type: "integer" },
      locked: { type: "boolean" },
      muted: { type: "boolean" },
      gain_db: { type: "number" },
      duck_db: { type: "number" },
    },
  },

  /** A placed timeline item. */
  TimelineItem: {
    type: "object",
    required: [
      "id",
      "timeline_id",
      "track_id",
      "start_time",
      "end_time",
      "source_offset",
      "speed",
      "transition_duration",
      "status",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string" },
      timeline_id: { type: "string" },
      track_id: { type: "string" },
      asset_version_id: { type: ["string", "null"] },
      item_text: {
        type: ["string", "null"],
        description: "Inline text payload for text/subtitle tracks",
      },
      text_style: {
        type: ["object", "null"],
        additionalProperties: true,
      },
      start_time: { type: "number" },
      end_time: { type: "number" },
      source_offset: { type: "number" },
      speed: { type: "number" },
      transform: { type: ["object", "null"], additionalProperties: true },
      fade_in: { type: ["number", "null"] },
      fade_out: { type: ["number", "null"] },
      transition: { type: ["string", "null"] },
      transition_duration: { type: "number" },
      effect_chain: { type: ["array", "null"], items: {} },
      color_grade: {
        type: ["object", "null"],
        additionalProperties: true,
      },
      audio_settings: {
        type: ["object", "null"],
        additionalProperties: true,
      },
      notes: { type: ["string", "null"] },
      status: { type: "string", enum: ["active", "muted", "archived"] },
      created_at: isoDate,
      updated_at: isoDate,
    },
  },

  /** POST /api/v1/timelines/{id}/items body. */
  ItemInput: {
    type: "object",
    required: ["track_id", "asset_version_id", "start_time", "end_time"],
    properties: {
      track_id: { type: "string" },
      asset_version_id: {
        type: ["string", "null"],
        description: "Required for media items; nullable for text/subtitle overlays",
      },
      start_time: { type: "number", minimum: 0 },
      end_time: { type: "number", minimum: 0 },
      source_offset: { type: "number", minimum: 0 },
      speed: { type: "number", exclusiveMinimum: 0 },
      transform: { type: "object", additionalProperties: true },
      fade_in: { type: ["number", "null"] },
      fade_out: { type: ["number", "null"] },
      transition: { type: ["string", "null"] },
      transition_duration: { type: ["number", "null"] },
      effect_chain: { type: ["array", "null"], items: {} },
      color_grade: {
        type: ["object", "null"],
        additionalProperties: true,
      },
      audio_settings: {
        type: ["object", "null"],
        additionalProperties: true,
      },
      notes: { type: "string" },
      text: {
        type: ["string", "null"],
        description: "Inline text overlay; only on text/subtitle tracks",
      },
      text_style: { type: "object", additionalProperties: true },
    },
  },

  /** PATCH .../items/{itemId} body (all fields optional). */
  ItemUpdateInput: {
    type: "object",
    properties: {
      track_id: { type: "string" },
      asset_version_id: { type: ["string", "null"] },
      text: { type: ["string", "null"] },
      text_style: { type: "object", additionalProperties: true },
      start_time: { type: "number", minimum: 0 },
      end_time: { type: "number", minimum: 0 },
      source_offset: { type: "number", minimum: 0 },
      speed: { type: "number", exclusiveMinimum: 0 },
      transform: { type: "object", additionalProperties: true },
      fade_in: { type: ["number", "null"] },
      fade_out: { type: ["number", "null"] },
      transition: { type: ["string", "null"] },
      transition_duration: { type: ["number", "null"] },
      effect_chain: { type: ["array", "null"], items: {} },
      color_grade: {
        type: ["object", "null"],
        additionalProperties: true,
      },
      audio_settings: {
        type: ["object", "null"],
        additionalProperties: true,
      },
      notes: { type: "string" },
      status: { type: "string", enum: ["active", "muted", "archived"] },
    },
  },

  /** A timeline marker. */
  TimelineMarker: {
    type: "object",
    required: ["id", "timeline_id", "time", "created_at"],
    properties: {
      id: { type: "string" },
      timeline_id: { type: "string" },
      time: { type: "number", minimum: 0 },
      label: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      created_at: isoDate,
    },
  },

  /** A full-state snapshot (editor undo/redo checkpoint). */
  TimelineSnapshot: {
    type: "object",
    required: ["id", "timeline_id", "name", "created_at"],
    properties: {
      id: { type: "string" },
      timeline_id: { type: "string" },
      name: { type: "string" },
      notes: { type: ["string", "null"] },
      created_at: isoDate,
      created_by_user_id: { type: ["integer", "null"] },
    },
  },

  /** GET /api/v1/timelines/{id} response: the timeline with its full state. */
  TimelineDetail: {
    allOf: [
      { $ref: "#/components/schemas/Timeline" },
      {
        type: "object",
        required: ["tracks", "items", "markers"],
        properties: {
          tracks: { type: "array", items: { $ref: "#/components/schemas/Track" } },
          items: {
            type: "array",
            items: { $ref: "#/components/schemas/TimelineItem" },
          },
          markers: {
            type: "array",
            items: { $ref: "#/components/schemas/TimelineMarker" },
          },
        },
      },
    ],
  },

  /** POST /api/v1/timelines/{id}/state body (atomic full-state restore). */
  TimelineState: {
    type: "object",
    required: ["tracks", "items", "markers"],
    properties: {
      duration: { type: "number", minimum: 0 },
      settings: { type: ["object", "null"], additionalProperties: true },
      tracks: {
        type: "array",
        items: { $ref: "#/components/schemas/Track" },
      },
      items: {
        type: "array",
        items: { $ref: "#/components/schemas/TimelineItem" },
      },
      markers: {
        type: "array",
        items: { $ref: "#/components/schemas/TimelineMarker" },
      },
    },
  },

  /** A deterministic music-score suggestion (MS-8). */
  ScoreSuggestion: {
    type: "object",
    required: [
      "prompt",
      "duration_seconds",
      "time_of_day",
      "lighting",
      "mood",
      "music_cues",
      "has_existing_music",
      "has_dialogue",
      "sources",
    ],
    properties: {
      prompt: { type: "string" },
      duration_seconds: {
        type: "integer",
        description: "Target score length in whole five-second steps",
      },
      time_of_day: { type: ["string", "null"] },
      lighting: { type: ["string", "null"] },
      mood: { type: ["string", "null"] },
      music_cues: { type: "array", items: { type: "string" } },
      has_existing_music: { type: "boolean" },
      has_dialogue: { type: "boolean" },
      sources: {
        type: "array",
        items: { type: "string" },
        description: "Human-readable reasons behind the suggestion",
      },
    },
  },

  // ---------------------------------------------------------------------
  // Models, jobs, review
  // ---------------------------------------------------------------------

  /** A registered model. */
  Model: {
    type: "object",
    required: [
      "id",
      "name",
      "version",
      "backend",
      "task_types",
      "input_types",
      "output_types",
      "dependencies",
      "default_settings",
      "enabled",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      version: { type: "string" },
      source: { type: ["string", "null"], enum: ["local", "url", "mock", null] },
      repository_url: { type: ["string", "null"] },
      source_path: { type: ["string", "null"] },
      file_hash: { type: ["string", "null"] },
      license: { type: ["string", "null"] },
      backend: { type: "string", enum: ["mock", "local_cli", "comfyui", "local_http"] },
      task_types: { type: "array", items: { type: "string" } },
      input_types: { type: "array", items: { type: "string" } },
      output_types: { type: "array", items: { type: "string" } },
      supported_resolutions: { type: ["array", "null"], items: { type: "string" } },
      supported_frame_rates: { type: ["array", "null"], items: { type: "number" } },
      supported_duration: { type: ["array", "null"], items: { type: "number" } },
      vram_requirement_mb: { type: ["integer", "null"] },
      ram_requirement_mb: { type: ["integer", "null"] },
      dependencies: {
        type: "array",
        items: { type: "string" },
        description: "Required CLI tools (ffmpeg, ...)",
      },
      default_settings: {
        type: "object",
        additionalProperties: true,
      },
      known_limitations: { type: ["array", "null"], items: { type: "string" } },
      enabled: { type: "boolean" },
      installed_at: { type: ["string", "null"] },
      last_used_at: { type: ["string", "null"] },
      health_status: { type: ["string", "null"] },
      health_error: { type: ["string", "null"] },
      health_checked_at: { type: ["string", "null"] },
      created_at: isoDate,
      updated_at: isoDate,
    },
  },

  /** POST /api/v1/models body (admin). */
  ModelCreateRequest: {
    type: "object",
    required: ["backend", "source"],
    properties: {
      name: { type: "string" },
      version: { type: "string" },
      backend: { type: "string", enum: ["mock", "local_cli", "comfyui", "local_http"] },
      source: { type: "string", enum: ["local", "url", "mock"] },
      repository_url: { type: "string" },
      source_path: { type: "string" },
      license: { type: "string" },
      task_types: { type: "array", items: { type: "string" } },
      input_types: { type: "array", items: { type: "string" } },
      output_types: { type: "array", items: { type: "string" } },
      supported_resolutions: { type: "array", items: { type: "string" } },
      supported_frame_rates: { type: "array", items: { type: "number" } },
      supported_duration: { type: "array", items: { type: "number" } },
      vram_requirement_mb: { type: "integer" },
      ram_requirement_mb: { type: "integer" },
      dependencies: { type: "array", items: { type: "string" } },
      default_settings: { type: "object", additionalProperties: true },
      known_limitations: { type: "array", items: { type: "string" } },
      enabled: { type: "boolean" },
    },
  },

  /** PATCH /api/v1/models/{id} body (admin, all fields optional). */
  ModelUpdateRequest: {
    type: "object",
    properties: {
      name: { type: "string" },
      version: { type: "string" },
      license: { type: "string" },
      backend: { type: "string", enum: ["mock", "local_cli", "comfyui", "local_http"] },
      repository_url: { type: "string" },
      source_path: { type: "string" },
      task_types: { type: "array", items: { type: "string" } },
      input_types: { type: "array", items: { type: "string" } },
      output_types: { type: "array", items: { type: "string" } },
      supported_resolutions: { type: "array", items: { type: "string" } },
      supported_frame_rates: { type: "array", items: { type: "number" } },
      supported_duration: { type: "array", items: { type: "number" } },
      vram_requirement_mb: { type: "integer" },
      ram_requirement_mb: { type: "integer" },
      dependencies: { type: "array", items: { type: "string" } },
      default_settings: { type: "object", additionalProperties: true },
      enabled: { type: "boolean" },
    },
  },

  /** The generation job queue row. */
  Job: {
    type: "object",
    required: [
      "id",
      "job_type",
      "settings",
      "input_asset_versions",
      "status",
      "progress",
      "created_at",
    ],
    properties: {
      id: { type: "string" },
      project_id: { type: ["string", "null"] },
      asset_id: { type: ["string", "null"] },
      scene_id: { type: ["string", "null"] },
      shot_id: { type: ["string", "null"] },
      storyboard_panel_id: { type: ["string", "null"] },
      job_type: { type: "string" },
      model_id: { type: ["string", "null"] },
      model_version: { type: ["string", "null"] },
      prompt_version_id: { type: ["string", "null"] },
      prompt_text: { type: ["string", "null"] },
      negative_prompt: { type: ["string", "null"] },
      seed: { type: ["string", "null"] },
      settings: { type: "object", additionalProperties: true },
      input_asset_versions: {
        type: "array",
        items: {
          type: "object",
          required: ["asset_id", "version_number"],
          properties: {
            asset_id: { type: "string" },
            version_number: { type: "integer" },
          },
        },
      },
      reference_roles: {
        type: ["object", "null"],
        additionalProperties: { type: "string" },
      },
      status: {
        type: "string",
        enum: ["queued", "running", "cancelling", "succeeded", "failed", "cancelled"],
      },
      progress: { type: "number", minimum: 0, maximum: 1 },
      error_text: { type: ["string", "null"] },
      output_asset_version_id: { type: ["string", "null"] },
      candidate_count: { type: ["integer", "null"] },
      candidate_version_ids: {
        type: ["array", "null"],
        items: { type: "string" },
      },
      lease_owner: { type: ["string", "null"] },
      lease_expires_at: { type: ["string", "null"] },
      created_by_user_id: { type: ["integer", "null"] },
      created_at: isoDate,
      started_at: { type: ["string", "null"] },
      finished_at: { type: ["string", "null"] },
    },
  },

  /** POST /api/v1/jobs body. */
  JobCreateRequest: {
    type: "object",
    required: ["job_type"],
    properties: {
      project_id: { type: "string" },
      asset_id: { type: "string" },
      scene_id: { type: "string" },
      shot_id: { type: "string" },
      storyboard_panel_id: { type: "string" },
      prompt_version_id: { type: "string" },
      job_type: { type: "string" },
      model_id: { type: "string" },
      model_version: { type: "string" },
      prompt_text: {
        type: "string",
        description: "Required for non-image tasks",
      },
      negative_prompt: { type: "string" },
      seed: { type: "string" },
      settings: { type: "object", additionalProperties: true },
      input_asset_versions: {
        type: "array",
        items: {
          type: "object",
          required: ["asset_id", "version_number"],
          properties: {
            asset_id: { type: "string" },
            version_number: { type: "integer" },
          },
        },
      },
    },
  },

  /** A job log event. */
  JobEvent: {
    type: "object",
    required: ["id", "job_id", "event_type", "created_at"],
    properties: {
      id: { type: "string" },
      job_id: { type: "string" },
      event_type: { type: "string" },
      message: { type: ["string", "null"] },
      data: { type: ["object", "null"], additionalProperties: true },
      created_at: isoDate,
    },
  },

  /** A review decision on a job candidate. */
  ReviewDecision: {
    type: "object",
    required: [
      "id",
      "asset_version_id",
      "decision",
      "decided_by_user_id",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string" },
      asset_version_id: { type: "string" },
      job_id: { type: ["string", "null"] },
      decision: { type: "string", enum: ["approved", "rejected", "shortlisted"] },
      notes: { type: ["string", "null"] },
      decided_by_user_id: { type: "integer" },
      created_at: isoDate,
      updated_at: isoDate,
    },
  },

  /** approve/reject/shortlist body. */
  ReviewNotesRequest: {
    type: "object",
    properties: {
      notes: { type: "string" },
    },
  },

  // ---------------------------------------------------------------------
  // Renders
  // ---------------------------------------------------------------------

  /** A render preset. */
  RenderPreset: {
    type: "object",
    required: ["id", "name", "kind", "output_format", "created_at", "updated_at"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      kind: { type: "string", enum: ["draft", "final"] },
      output_format: { type: "string" },
      resolution: { type: ["string", "null"] },
      frame_rate: { type: ["number", "null"] },
      codec: { type: ["string", "null"] },
      audio_codec: { type: ["string", "null"] },
      bitrate: { type: ["string", "null"] },
      settings: { type: ["object", "null"], additionalProperties: true },
      created_at: isoDate,
      updated_at: isoDate,
    },
  },

  /** POST /api/v1/render-presets body (admin). */
  PresetInput: {
    type: "object",
    required: ["name", "kind", "output_format"],
    properties: {
      name: { type: "string" },
      kind: { type: "string", enum: ["draft", "final"] },
      output_format: { type: "string" },
      resolution: { type: "string" },
      frame_rate: { type: "number" },
      codec: { type: "string" },
      audio_codec: { type: "string" },
      bitrate: { type: "string" },
      settings: { type: "object", additionalProperties: true },
    },
  },

  /** A render job. */
  RenderJob: {
    type: "object",
    required: [
      "id",
      "project_id",
      "timeline_id",
      "status",
      "progress",
      "created_by_user_id",
      "created_at",
    ],
    properties: {
      id: { type: "string" },
      project_id: { type: "string" },
      timeline_id: { type: "string" },
      preset_id: { type: ["string", "null"] },
      engine: { type: ["string", "null"] },
      status: { type: "string" },
      progress: { type: "number" },
      error_text: { type: ["string", "null"] },
      output_path: { type: ["string", "null"] },
      validation_report: {
        type: ["object", "null"],
        additionalProperties: true,
      },
      created_by_user_id: { type: "integer" },
      created_at: isoDate,
      started_at: { type: ["string", "null"] },
      finished_at: { type: ["string", "null"] },
    },
  },

  /** A render log event. */
  RenderEvent: {
    type: "object",
    required: ["id", "render_job_id", "level", "message", "created_at"],
    properties: {
      id: { type: "string" },
      render_job_id: { type: "string" },
      level: { type: "string" },
      message: { type: "string" },
      created_at: isoDate,
    },
  },

  // ---------------------------------------------------------------------
  // Skills
  // ---------------------------------------------------------------------

  /** A skill definition (JSON, v1: audio-generation definitions). */
  SkillDefinition: {
    type: "object",
    required: ["name", "version", "inputs", "steps"],
    properties: {
      name: { type: "string" },
      version: { type: "string" },
      author: { type: ["string", "null"] },
      license: { type: ["string", "null"] },
      description: { type: ["string", "null"] },
      inputs: {
        type: "object",
        additionalProperties: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", enum: ["string", "number", "boolean"] },
            required: { type: "boolean" },
            default: {},
          },
        },
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          required: ["type", "prompt"],
          properties: {
            type: { type: "string", enum: ["music", "voiceover", "sfx"] },
            prompt: { type: "string" },
            model_id: { type: ["string", "null"] },
            seed: { type: ["string", "null"] },
          },
        },
      },
    },
  },

  /** A stored skill (definition + system rows). */
  Skill: {
    type: "object",
    required: [
      "id",
      "name",
      "version",
      "definition",
      "enabled",
      "is_system",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: ["string", "null"] },
      author: { type: ["string", "null"] },
      version: { type: "string" },
      definition: { $ref: "#/components/schemas/SkillDefinition" },
      enabled: { type: "boolean" },
      is_system: { type: "boolean" },
      created_by_user_id: { type: ["integer", "null"] },
      created_at: isoDate,
      updated_at: isoDate,
    },
  },

  /** POST /api/v1/skills body. */
  SkillCreateRequest: {
    type: "object",
    required: ["id", "definition"],
    properties: {
      id: { type: "string" },
      definition: { $ref: "#/components/schemas/SkillDefinition" },
    },
  },

  /** An immutable version snapshot of a skill definition. */
  SkillVersion: {
    type: "object",
    required: ["id", "skill_id", "version", "definition", "created_at"],
    properties: {
      id: { type: "integer" },
      skill_id: { type: "string" },
      version: { type: "string" },
      definition: { $ref: "#/components/schemas/SkillDefinition" },
      created_by_user_id: { type: ["integer", "null"] },
      created_at: isoDate,
    },
  },

  /** POST /api/v1/skills/{id}/run body. */
  SkillRunRequest: {
    type: "object",
    required: ["project_id"],
    properties: {
      project_id: { type: "string" },
      inputs: {
        type: "object",
        additionalProperties: true,
        description: "Typed inputs keyed by the definition's input names",
      },
    },
  },

  /** A skill run (settles lazily from its step jobs). */
  SkillRun: {
    type: "object",
    required: [
      "id",
      "skill_id",
      "project_id",
      "status",
      "inputs",
      "steps",
      "created_at",
      "updated_at",
    ],
    properties: {
      id: { type: "string" },
      skill_id: { type: "string" },
      project_id: { type: "string" },
      status: { type: "string", enum: ["running", "succeeded", "failed"] },
      inputs: { type: "object", additionalProperties: true },
      steps: {
        type: "array",
        items: {
          type: "object",
          required: [
            "step_index",
            "kind",
            "job_type",
            "job_id",
            "asset_id",
            "model_id",
          ],
          properties: {
            step_index: { type: "integer" },
            kind: { type: "string", enum: ["music", "voiceover", "sfx"] },
            job_type: { type: "string" },
            job_id: { type: "string" },
            asset_id: { type: "string" },
            model_id: { type: "string" },
          },
        },
      },
      error_text: { type: ["string", "null"] },
      created_by_user_id: { type: ["integer", "null"] },
      created_at: isoDate,
      updated_at: isoDate,
    },
  },

  // ---------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------

  /** Detected hardware (CPU/RAM/GPU/OS). */
  HardwareInfo: {
    type: "object",
    required: ["platform", "arch", "cpu_count", "detected_at"],
    properties: {
      platform: { type: "string" },
      arch: { type: "string" },
      cpu_count: { type: "integer" },
      mem_total_mb: { type: ["integer", "null"] },
      gpu: {
        oneOf: [
          {
            type: "object",
            required: ["vendor", "model"],
            properties: {
              vendor: { type: "string" },
              model: { type: "string" },
              vram_mb: { type: ["integer", "null"] },
              vram_used_mb: { type: ["integer", "null"] },
              driver_version: { type: ["string", "null"] },
              cuda_version: { type: ["string", "null"] },
            },
          },
          { type: "null" },
        ],
      },
      detected_at: isoDate,
    },
  },

  /** GET /api/v1/diagnostics/hardware report. */
  HardwareReport: {
    type: "object",
    required: ["platform", "arch", "deno", "uptime_sec", "hardware"],
    properties: {
      platform: { type: "string" },
      arch: { type: "string" },
      deno: { type: "string" },
      uptime_sec: { type: "integer" },
      hardware: { $ref: "#/components/schemas/HardwareInfo" },
    },
  },

  /** GET /api/v1/diagnostics/models report (per-model health batch). */
  ModelsReport: {
    type: "object",
    required: ["total", "enabled", "unhealthy", "models"],
    properties: {
      total: { type: "integer" },
      enabled: { type: "integer" },
      unhealthy: { type: "integer" },
      models: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "name", "backend", "enabled", "check"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            backend: { type: "string" },
            enabled: { type: "boolean" },
            installed_at: { type: ["string", "null"] },
            health_status: { type: ["string", "null"] },
            health_error: { type: ["string", "null"] },
            check: {
              type: "object",
              required: ["status", "message"],
              properties: {
                status: { type: "string", enum: ["ok", "error"] },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
  },

  /** GET /api/v1/diagnostics/storage report (STO-010/011). */
  StorageReport: {
    type: "object",
    required: [
      "app_data_dir",
      "database_file",
      "database_bytes",
      "directories",
      "content_store",
      "missing_versions",
      "projects",
      "top_assets",
      "integrity",
    ],
    properties: {
      app_data_dir: { type: "string" },
      database_file: { type: "string" },
      database_bytes: { type: ["integer", "null"] },
      directories: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "files", "bytes"],
          properties: {
            path: { type: "string" },
            files: { type: "integer" },
            bytes: { type: "integer" },
          },
        },
      },
      content_store: {
        type: "object",
        required: ["files", "bytes", "orphaned"],
        properties: {
          files: { type: "integer" },
          bytes: { type: "integer" },
          orphaned: {
            type: "array",
            items: { type: "string" },
            description: "Content-store files no asset version references",
          },
        },
      },
      missing_versions: {
        type: "array",
        items: {
          type: "object",
          required: ["asset_version_id", "file_path"],
          properties: {
            asset_version_id: { type: "string" },
            file_path: { type: "string" },
          },
        },
      },
      projects: {
        type: "array",
        items: {
          type: "object",
          required: ["project_id", "name", "files", "bytes"],
          properties: {
            project_id: { type: ["string", "null"] },
            name: { type: ["string", "null"] },
            files: { type: "integer" },
            bytes: { type: "integer" },
          },
        },
      },
      top_assets: {
        type: "array",
        items: {
          type: "object",
          required: ["asset_id", "display_name", "files", "bytes"],
          properties: {
            asset_id: { type: "string" },
            display_name: { type: "string" },
            project_id: { type: ["string", "null"] },
            files: { type: "integer" },
            bytes: { type: "integer" },
          },
        },
      },
      integrity: {
        description: "Present only with ?verify=1 — content-store checksum re-verification",
        oneOf: [
          {
            type: "object",
            required: ["verified", "corrupted"],
            properties: {
              verified: { type: "integer" },
              corrupted: {
                type: "array",
                items: {
                  type: "object",
                  required: ["file_path", "content_hash"],
                  properties: {
                    file_path: { type: "string" },
                    content_hash: { type: "string" },
                  },
                },
              },
            },
          },
          { type: "null" },
        ],
      },
    },
  },

  /** POST /api/v1/diagnostics/storage/cleanup response (admin, STO-012). */
  CleanupReport: {
    type: "object",
    required: ["directories", "orphaned_media", "total_files", "bytes_freed"],
    properties: {
      directories: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "files", "bytes"],
          properties: {
            path: { type: "string" },
            files: { type: "integer" },
            bytes: { type: "integer" },
          },
        },
      },
      orphaned_media: {
        type: "object",
        required: ["files", "bytes"],
        properties: {
          files: { type: "integer" },
          bytes: { type: "integer" },
        },
      },
      total_files: { type: "integer" },
      bytes_freed: { type: "integer" },
    },
  },

  /** GET /api/v1/diagnostics/logs report. */
  LogsReport: {
    type: "object",
    required: ["count", "entries"],
    properties: {
      count: { type: "integer" },
      entries: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "category", "severity", "message", "created_at"],
          properties: {
            id: { type: "string" },
            category: { type: "string" },
            severity: { type: "string" },
            message: { type: "string" },
            data: { type: ["object", "null"], additionalProperties: true },
            created_at: isoDate,
          },
        },
      },
    },
  },

  /** A project backup record (DIA-006/007). */
  Backup: {
    type: "object",
    required: [
      "id",
      "project_id",
      "project_name",
      "file_path",
      "counts",
      "created_at",
    ],
    properties: {
      id: { type: "string" },
      project_id: { type: "string" },
      project_name: { type: "string" },
      file_path: { type: "string" },
      counts: {
        type: "object",
        additionalProperties: { type: "integer" },
      },
      created_at: isoDate,
      created_by_user_id: { type: ["integer", "null"] },
    },
  },

  /** LLM endpoint settings as returned to admins (API key masked). */
  LlmSettings: {
    type: "object",
    required: [
      "enabled",
      "baseUrl",
      "apiKeySet",
      "model",
      "temperature",
      "maxTokens",
      "timeoutSeconds",
    ],
    properties: {
      enabled: { type: "boolean" },
      baseUrl: { type: "string" },
      apiKeySet: { type: "boolean", description: "Whether an API key is stored" },
      model: { type: "string" },
      temperature: { type: "string", description: "Empty string = not set" },
      maxTokens: { type: "string", description: "Empty string = not set" },
      timeoutSeconds: { type: "integer" },
    },
  },
  HuggingFaceRepoSummary: {
    type: "object",
    required: ["id", "likes", "downloads", "pipeline_tag", "tags", "license"],
    properties: {
      id: { type: "string", description: "`owner/name` repo id" },
      likes: { type: "integer" },
      downloads: { type: "integer" },
      pipeline_tag: { type: ["string", "null"] },
      tags: { type: "array", items: { type: "string" } },
      license: { type: ["string", "null"] },
    },
  },
  HuggingFaceRepoFile: {
    type: "object",
    required: ["path", "size", "type"],
    properties: {
      path: { type: "string" },
      size: { type: "integer", description: "Bytes" },
      type: { type: "string", enum: ["file", "directory"] },
    },
  },
  HuggingFaceRepos: {
    type: "array",
    items: { $ref: "#/components/schemas/HuggingFaceRepoSummary" },
  },
  HuggingFaceRepo: {
    type: "object",
    required: ["repo", "files"],
    properties: {
      repo: { $ref: "#/components/schemas/HuggingFaceRepoSummary" },
      files: {
        type: "array",
        items: { $ref: "#/components/schemas/HuggingFaceRepoFile" },
      },
    },
  },
  HuggingFaceRegisterRequest: {
    type: "object",
    required: ["repo_id"],
    properties: {
      repo_id: { type: "string", description: "`owner/name` HuggingFace repo" },
      file: {
        type: "string",
        description: "Explicit weight file path (default: largest weight file)",
      },
      backend: { type: "string", description: "Default: local_cli" },
      task_types: { type: "array", items: { type: "string" } },
      name: { type: "string", description: "Default: the repo id" },
      version: { type: "string", description: "Default: 1.0" },
      min_vram_mb: { type: "integer" },
      dependencies: { type: "array", items: { type: "string" } },
      known_limitations: { type: "array", items: { type: "string" } },
    },
  },
};

/** Tag descriptions shown in Swagger UI's tag list. */
export const TAG_DESCRIPTIONS: Record<string, string> = {
  health: "Liveness and version checks",
  auth: "Bootstrap, login, logout, password and email-confirmation flows",
  users: "User management (admin) and global settings",
  invitations: "Admin invitation links",
  projects: "Projects and their settings",
  templates: "System project templates (read-only)",
  assets: "Media assets, versions, aliases, tags, previews, proxies",
  audio: "Audio generation, upload, analysis, adjustments, cleanup",
  models: "Model registry, health, benchmarks, hardware",
  jobs: "Generation job queue, events, WebSocket stream",
  review: "Job candidate review: approve, reject, shortlist",
  renders: "Render presets, render queue, exports",
  skills: "Skill definitions, versions, runs",
  storyboards: "Storyboards and panels",
  scenes: "Scenes, shots, script import, continuity",
  prompts: "Versioned prompts per creative scope",
  references: "@reference parsing, audit and repair",
  timelines: "Timelines, tracks, items, markers, snapshots, scoring",
  diagnostics: "Hardware, storage, logs, backups, diagnostics",
  llm: "LLM assistant: endpoint settings, chat, creative assist, Model Copilot",
  openapi: "API documentation endpoints",
};

export { SCHEMAS };
