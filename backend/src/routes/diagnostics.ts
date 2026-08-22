import { Router } from "@oak/oak/router";
import type { Context } from "@oak/oak";
import { type AuthedContext, authMiddleware } from "@cinemaItor/middleware/auth.ts";
import { getUserById } from "@cinemaItor/db/schema.ts";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "@cinemaItor/errors.ts";
import {
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
    ctx.response.body = await storageReport();
  })
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
