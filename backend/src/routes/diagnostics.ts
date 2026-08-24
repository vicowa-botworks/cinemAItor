import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { getUserById } from "@cinemaItor/db/schema.ts";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "@cinemaItor/errors.ts";
import {
  cleanupStorageCache,
  exportDiagnostics,
  hardwareReport,
  logsReport,
  modelsReport,
  storageReport,
} from "@cinemaItor/services/diagnostics.ts";
import { dirname, join } from "@std/path";
import { ensureLayout } from "@cinemaItor/storage/paths.ts";
import { loadConfig } from "@cinemaItor/config.ts";
import { getProjectAccessible } from "@cinemaItor/db/projects.ts";
import {
  createBackupRecord,
  deleteBackup,
  getBackup,
  listBackups,
} from "@cinemaItor/db/backups.ts";
import {
  backupCounts,
  backupMediaManifest,
  buildProjectBackupData,
  bundleDirForBackupFile,
  bundleMediaEntries,
  restoreBundleMedia,
  restoreProjectBackup,
} from "@cinemaItor/services/project_backup.ts";
import { getContentStore } from "@cinemaItor/storage/content_store.ts";
import type { OperationMeta } from "@cinemaItor/openapi/types.ts";
import { errorResponses, ref } from "@cinemaItor/openapi/types.ts";

function requireUserId(ctx: Context): number {
  const userId = (ctx as AuthedContext).userId;
  if (!userId) throw unauthorized("Authentication required");
  return userId;
}

async function readJsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = ctx.request.body;
  if (body.type() !== "json") {
    throw badRequest("Request body must be JSON");
  }
  return await body.json() as Record<string, unknown>;
}

export const diagnosticsRouter = new Router()
  .get("/api/v1/diagnostics/hardware", authMiddleware, async (ctx, _next) => {
    requireUserId(ctx);
    ctx.response.body = await hardwareReport();
  })
  .get("/api/v1/diagnostics/models", authMiddleware, async (ctx, _next) => {
    requireUserId(ctx);
    ctx.response.body = await modelsReport();
  })
  .get("/api/v1/diagnostics/storage", authMiddleware, async (ctx, _next) => {
    requireUserId(ctx);
    const params = (ctx.request.url as unknown as URL).searchParams;
    const verify = params.has("verify") && params.get("verify") !== "0";
    ctx.response.body = await storageReport({ verify });
  })
  .post(
    "/api/v1/diagnostics/storage/cleanup",
    authMiddleware,
    async (ctx, _next) => {
      const userId = requireUserId(ctx);
      const user = getUserById(userId);
      if (!user || user.role !== "admin") {
        throw forbidden("Admin role required for storage cleanup");
      }
      let body: Record<string, unknown> = {};
      if (ctx.request.body.type() === "json") {
        try {
          body = await ctx.request.body.json();
        } catch {
          throw badRequest("Request body must be JSON");
        }
      }
      const includeOrphanedMedia = typeof body.include_orphaned_media === "boolean" &&
        body.include_orphaned_media;
      ctx.response.status = 200;
      ctx.response.body = await cleanupStorageCache({ includeOrphanedMedia });
    },
  )
  .get("/api/v1/diagnostics/logs", authMiddleware, (ctx, _next) => {
    requireUserId(ctx);
    const search = ctx.request.url as unknown as URL;
    const params = search.searchParams;
    const limitParam = params.get("limit");
    const sinceParam = params.get("since_hours");
    try {
      ctx.response.body = logsReport({
        category: params.get("category") ?? undefined,
        severity: params.get("severity") ?? undefined,
        limit: limitParam === null ? undefined : Number(limitParam),
        sinceHours: sinceParam === null ? undefined : Number(sinceParam),
      });
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : String(err));
    }
  })
  .post("/api/v1/diagnostics/export", authMiddleware, async (ctx, _next) => {
    const userId = requireUserId(ctx);
    const user = getUserById(userId);
    if (!user || user.role !== "admin") {
      throw forbidden("Admin role required for diagnostics export");
    }
    ctx.response.status = 201;
    ctx.response.body = await exportDiagnostics();
  })
  .post(
    "/api/v1/diagnostics/backups",
    authMiddleware,
    async (ctx, _next) => {
      const userId = requireUserId(ctx);
      const body = await readJsonBody(ctx);
      const projectId = typeof body.project_id === "string" ? body.project_id : "";
      if (!projectId) throw badRequest("project_id is required");
      const project = getProjectAccessible(projectId, userId, "read");
      if (!project) throw notFound("Project not found");

      const data = buildProjectBackupData(projectId);
      const counts = backupCounts(data);
      const manifest = backupMediaManifest(
        data,
        (hash) => getContentStore().resolveExisting(hash),
      );
      const layout = ensureLayout(loadConfig().appDataDir);
      const id = crypto.randomUUID();
      const filePath = join(layout.backups, `backup-${id}.json`);
      await Deno.writeTextFile(filePath, JSON.stringify(data, null, 2));
      const bundleDir = bundleDirForBackupFile(filePath);
      for (
        const entry of bundleMediaEntries(
          data,
          (hash) => getContentStore().resolveExisting(hash),
        )
      ) {
        const dest = join(bundleDir, entry.relPath);
        await Deno.mkdir(dirname(dest), { recursive: true });
        await Deno.copyFile(entry.srcPath, dest);
      }
      const record = createBackupRecord({
        id,
        project_id: projectId,
        project_name: project.name,
        file_path: filePath,
        counts: counts as unknown as Record<string, number>,
        created_by_user_id: userId,
      });
      ctx.response.status = 201;
      ctx.response.body = {
        backup: record,
        counts,
        media: manifest,
      };
    },
  )
  .get("/api/v1/diagnostics/backups", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const user = getUserById(userId);
    ctx.response.body = {
      backups: listBackups(userId, user?.role === "admin"),
    };
  })
  .post(
    "/api/v1/diagnostics/backups/:id/restore",
    authMiddleware,
    async (ctx, _next) => {
      const userId = requireUserId(ctx);
      const user = getUserById(userId);
      const backup = getBackup(ctx.params.id);
      if (!backup || (backup.created_by_user_id !== userId && user?.role !== "admin")) {
        throw notFound("Backup not found");
      }
      let text: string;
      try {
        text = await Deno.readTextFile(backup.file_path);
      } catch {
        throw conflict(`Backup file is missing on disk: ${backup.file_path}`);
      }
      let data: Parameters<typeof restoreProjectBackup>[0];
      try {
        data = JSON.parse(text) as Parameters<typeof restoreProjectBackup>[0];
      } catch {
        throw conflict("Backup file is corrupted");
      }
      let projectName: string | undefined;
      if (ctx.request.body) {
        const body = await readJsonBody(ctx).catch(() => ({} as Record<string, unknown>));
        if (typeof body.project_name === "string" && body.project_name) {
          projectName = body.project_name;
        }
      }
      // Transferable bundles: copy any media the bundle carries into the
      // content store before the state restore probes for missing files.
      const media = await restoreBundleMedia(
        bundleDirForBackupFile(backup.file_path),
        getContentStore(),
      );
      const result = restoreProjectBackup(data, {
        userId,
        project_name: projectName,
        resolveContent: (hash) => getContentStore().resolveExisting(hash),
      });
      for (const hash of media.corrupted) {
        result.issues.push(
          `media hash ${
            hash.slice(0, 12)
          }…: bundle copy failed checksum verification, not restored`,
        );
      }
      ctx.response.status = 201;
      ctx.response.body = { ...result, media };
    },
  )
  .delete("/api/v1/diagnostics/backups/:id", authMiddleware, (ctx, _next) => {
    const userId = requireUserId(ctx);
    const user = getUserById(userId);
    const backup = getBackup(ctx.params.id);
    if (!backup || (backup.created_by_user_id !== userId && user?.role !== "admin")) {
      throw notFound("Backup not found");
    }
    const removed = deleteBackup(backup.id);
    if (removed) {
      Deno.remove(backup.file_path).catch(() => undefined);
      Deno.remove(bundleDirForBackupFile(backup.file_path), {
        recursive: true,
      }).catch(() => undefined);
    }
    ctx.response.body = { message: "Backup deleted" };
  });

export const openApiOps: Record<string, OperationMeta> = {
  "GET /api/v1/diagnostics/hardware": {
    summary: "Hardware report (CPU/RAM/GPU/OS) (DIA-001)",
    responses: {
      200: {
        description: "The hardware report",
        schema: ref("HardwareReport"),
      },
      ...errorResponses(401),
    },
  },
  "GET /api/v1/diagnostics/models": {
    summary: "Model health batch report (DIA-002)",
    responses: {
      200: {
        description: "The models report",
        schema: ref("ModelsReport"),
      },
      ...errorResponses(401),
    },
  },
  "GET /api/v1/diagnostics/storage": {
    summary: "Storage report: usage, orphans, missing media (STO-010/011)",
    description: "Adds a content-store checksum `integrity` block when `?verify=1`.",
    parameters: {
      verify: {
        schema: { type: "string" },
        description: "Pass `1` to run the content-store checksum integrity pass.",
      },
    },
    responses: {
      200: {
        description: "The storage report",
        schema: ref("StorageReport"),
      },
      ...errorResponses(401),
    },
  },
  "POST /api/v1/diagnostics/storage/cleanup": {
    summary: "Remove regenerable caches (admin) (STO-012)",
    description: "Removes regenerable preview/proxy/thumbnail caches and, only when " +
      "`include_orphaned_media` is true, orphaned media. Referenced media " +
      "is never touched.",
    requestBody: {
      schema: {
        type: "object",
        properties: {
          include_orphaned_media: { type: "boolean" },
        },
      },
    },
    responses: {
      200: {
        description: "What was removed",
        schema: ref("CleanupReport"),
      },
      ...errorResponses(400, 401, 403),
    },
  },
  "GET /api/v1/diagnostics/logs": {
    summary: "Browse the durable diagnostics log (DIA-003/005)",
    parameters: {
      category: { schema: { type: "string" } },
      severity: { schema: { type: "string" } },
      limit: { schema: { type: "integer" } },
      since_hours: { schema: { type: "number" } },
    },
    responses: {
      200: {
        description: "The log report",
        schema: ref("LogsReport"),
      },
      ...errorResponses(400, 401),
    },
  },
  "POST /api/v1/diagnostics/export": {
    summary: "Export a redacted diagnostics bundle (admin) (DIA-004)",
    responses: {
      201: {
        description: "The export (file path + contents summary)",
        schema: {
          type: "object",
          additionalProperties: true,
        },
      },
      ...errorResponses(401, 403),
    },
  },
  "POST /api/v1/diagnostics/backups": {
    summary: "Create a project backup (DIA-006)",
    description: "Schema-3 bundles cover assets, timelines (tracks/items/markers/" +
      "snapshots) and creative objects (storyboards/panels, scenes/shots, " +
      "prompt versions, references). A media bundle is written alongside " +
      "the JSON for transferability.",
    requestBody: {
      schema: {
        type: "object",
        required: ["project_id"],
        properties: {
          project_id: { type: "string" },
        },
      },
    },
    responses: {
      201: {
        description: "The backup record, object counts and media manifest",
        schema: {
          type: "object",
          required: ["backup", "counts", "media"],
          properties: {
            backup: { $ref: "#/components/schemas/Backup" },
            counts: {
              type: "object",
              additionalProperties: { type: "integer" },
            },
            media: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
      },
      ...errorResponses(400, 401, 404),
    },
  },
  "GET /api/v1/diagnostics/backups": {
    summary: "List backups (admin sees all, users see their own)",
    responses: {
      200: {
        description: "The backups",
        schema: {
          type: "object",
          required: ["backups"],
          properties: {
            backups: { type: "array", items: ref("Backup") },
          },
        },
      },
      ...errorResponses(401),
    },
  },
  "POST /api/v1/diagnostics/backups/{id}/restore": {
    summary: "Restore a project backup (DIA-007)",
    description: "Remaps every creative FK, rewrites snapshot-embedded ids, and " +
      "imports the bundle media (SHA-256 verified). Reports dangling " +
      "links and missing/corrupt media. An optional `project_name` " +
      "restores the data under a new project name.",
    requestBody: {
      schema: {
        type: "object",
        properties: {
          project_name: { type: "string" },
        },
      },
    },
    responses: {
      201: {
        description: "The restore result with issue list and media summary",
        schema: {
          type: "object",
          required: ["project_id", "project_name", "counts", "issues", "media"],
          properties: {
            project_id: { type: "string" },
            project_name: { type: "string" },
            counts: { type: "object", additionalProperties: { type: "integer" } },
            issues: { type: "array", items: { type: "string" } },
            media: { type: "object", additionalProperties: true },
          },
        },
      },
      ...errorResponses(400, 401, 404, 409),
    },
  },
  "DELETE /api/v1/diagnostics/backups/{id}": {
    summary: "Delete a backup (owner or admin)",
    responses: {
      200: {
        description: "Deletion confirmation",
        schema: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
      },
      ...errorResponses(401, 404),
    },
  },
};
