import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { freshMemoryDb, withServer } from "./helpers/http.ts";
import { getDb } from "../src/db/database.ts";
import { createAssetVersion } from "../src/db/assets.ts";
import { addDiagnostic } from "../src/db/diagnostics.ts";
import { getContentStore, resetContentStore } from "../src/storage/content_store.ts";
import { mediaTypeFor } from "../src/storage/media_types.ts";

let appData: string;
let ownerToken = "";
let memberToken = "";
let projectId = "";
let ownerId = 0;
let assetId = "";
let versionId = "";

async function req(
  base: string,
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  // Oak's first listen() is async; retry the initial connect like
  // fetchWithRetry does elsewhere.
  let res: Response;
  for (let attempt = 0;; attempt++) {
    try {
      res = await fetch(`${base}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      break;
    } catch (err) {
      if (attempt >= 40) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as unknown) : null,
  };
}

describe("diagnostics endpoints", () => {
  beforeEach(async () => {
    appData = await Deno.makeTempDir({ prefix: "cinemaitor-diagnostics-" });
    Deno.env.set("APP_DATA_DIR", appData);
    Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
    Deno.env.set("LOG_LEVEL", "error");
    freshMemoryDb();
    resetContentStore();

    await withServer(async (base) => {
      const boot = await req(base, "/api/v1/auth/bootstrap", {
        method: "POST",
        body: {
          email: `diag-${crypto.randomUUID()}@example.com`,
          password: "diagnostics-passw0rd",
          display_name: "Diagnostic Owner",
        },
      });
      assertEquals(boot.status, 201);
      const bootBody = boot.body as { token: string; user: { id: number } };
      ownerToken = bootBody.token;
      ownerId = bootBody.user.id;

      const member = await req(base, "/api/auth/register", {
        method: "POST",
        body: {
          email: `diag-member-${crypto.randomUUID()}@example.com`,
          password: "diagnostics-passw0rd",
          display_name: "Plain Member",
        },
      });
      assertEquals(member.status, 201);
      memberToken = (member.body as { token: string }).token;

      const project = await req(base, "/api/v1/projects", {
        method: "POST",
        token: ownerToken,
        body: { name: "Diag Project" },
      });
      assertEquals(project.status, 201);
      projectId = (project.body as { id: string }).id;

      // One referenced media file, turned into a real version, plus one
      // missing file path and one orphaned content file for DIA-003.
      const source = join(appData, "clip.mp4");
      await Deno.writeFile(source, new Uint8Array(8192).fill(7));
      const stored = await getContentStore().put(source, "clip.mp4");

      const asset = await req(base, "/api/v1/assets", {
        method: "POST",
        token: ownerToken,
        body: {
          unique_slug: "diag_clip",
          display_name: "Clip",
          asset_type: "video",
          library_scope: "project",
          project_id: projectId,
        },
      });
      assertEquals(asset.status, 201);
      assetId = (asset.body as { id: string }).id;

      // Create the version via the repository instead of the API route:
      // the route also queues a proxy job, whose runner (mock engine when
      // ffmpeg is absent) stores an extra content-store blob and races the
      // media-count assertions in the tests below.
      const versionType = mediaTypeFor(stored.path);
      versionId = createAssetVersion(assetId, ownerId, {
        content_hash: stored.hash,
        file_path: stored.path,
        format: versionType.format,
        mime_type: versionType.mime,
        file_size: stored.size,
      }).id;

      // Point the version at a file that does not exist.
      getDb()
        .prepare("UPDATE asset_versions SET file_path = ? WHERE id = ?")
        .run(join(appData, "does-not-exist.mp4"), versionId);

      // Orphaned content file: a plausible content-addressed blob nothing
      // references.
      const orphanHash = `${"f".repeat(63)}a`;
      await Deno.mkdir(join(appData, "media", "ff", "ff"), {
        recursive: true,
      });
      await Deno.writeFile(
        join(appData, "media", "ff", "ff", `${orphanHash}.mp4`),
        new Uint8Array(1024),
      );

      addDiagnostic("system", "info", "seeded marker");
    });
  });

  afterEach(() => {
    resetContentStore();
    Deno.removeSync(appData, { recursive: true });
  });

  it("requires authentication", async () => {
    await withServer(async (base) => {
      const res = await req(base, "/api/v1/diagnostics/hardware");
      assertEquals(res.status, 401);
    });
  });

  it("serves hardware, models and storage reports", async () => {
    await withServer(async (base) => {
      const hardware = await req(base, "/api/v1/diagnostics/hardware", {
        token: ownerToken,
      });
      assertEquals(hardware.status, 200);
      const hw = hardware.body as {
        platform: string;
        deno: string;
        hardware: { cpu_count: number };
      };
      assertEquals(hw.platform, Deno.build.os);
      assert(/^\d+\.\d+\.\d+/.test(hw.deno));
      assert(hw.hardware.cpu_count > 0);

      const models = await req(base, "/api/v1/diagnostics/models", {
        token: ownerToken,
      });
      assertEquals(models.status, 200);
      const mr = models.body as { total: number; enabled: number; models: [] };
      assertEquals(mr.total, 0);
      assertEquals(mr.enabled, 0);
      assertEquals(mr.models, []);

      const storage = await req(base, "/api/v1/diagnostics/storage", {
        token: ownerToken,
      });
      assertEquals(storage.status, 200);
      const sr = storage.body as {
        app_data_dir: string;
        directories: { path: string; files: number; bytes: number }[];
        content_store: {
          files: number;
          bytes: number;
          orphaned: string[];
        };
        missing_versions: { asset_version_id: string; file_path: string }[];
      };
      assertEquals(sr.app_data_dir, appData);
      const media = sr.directories.find((d) => d.path === "media");
      assertExists(media);
      // clip.mp4 (8 KiB referenced) + orphan blob (1 KiB)
      assertEquals(media.files, 2);
      assertEquals(media.bytes, 9216);
      assertEquals(sr.content_store.files, 2);
      assertEquals(sr.content_store.orphaned, ["f".repeat(63) + "a"]);
      assertEquals(sr.missing_versions.length, 1);
      assertEquals(sr.missing_versions[0].asset_version_id, versionId);
    });
  });

  it("serves logs with query filters", async () => {
    await withServer(async (base) => {
      const res = await req(base, "/api/v1/diagnostics/logs", {
        token: memberToken,
      });
      assertEquals(res.status, 200);
      const body = res.body as {
        count: number;
        entries: { category: string; severity: string; message: string }[];
      };
      assert(body.count >= 1);
      const marker = body.entries.find((e) => e.message === "seeded marker");
      assertExists(marker);
      assertEquals(marker.category, "system");
      assertEquals(marker.severity, "info");

      const filtered = await req(
        base,
        "/api/v1/diagnostics/logs?category=system&limit=50",
        { token: memberToken },
      );
      assertEquals(filtered.status, 200);
      for (
        const e of (filtered.body as {
          entries: { category: string }[];
        }).entries
      ) {
        assertEquals(e.category, "system");
      }

      assertEquals(
        (await req(base, "/api/v1/diagnostics/logs?limit=9999", {
          token: memberToken,
        })).status,
        400,
      );
      assertEquals(
        (await req(base, "/api/v1/diagnostics/logs?since_hours=-1", {
          token: memberToken,
        })).status,
        400,
      );
    });
  });

  it("exports a redacted bundle for admins only", async () => {
    await withServer(async (base) => {
      const memberExport = await req(
        base,
        "/api/v1/diagnostics/export",
        { method: "POST", token: memberToken },
      );
      assertEquals(memberExport.status, 403);

      const res = await req(base, "/api/v1/diagnostics/export", {
        method: "POST",
        token: ownerToken,
      });
      assertEquals(res.status, 201);
      const out = res.body as { path: string; generated_at: string; size: number };
      assertExists(out.path);
      assert(out.path.startsWith(appData));
      const raw = await Deno.readTextFile(out.path);
      const parsed = JSON.parse(raw) as {
        generated_at: string;
        app: { deno: string; app_data_dir: string; db_path: string };
        hardware: { platform: string };
        models: { total: number };
        storage: { app_data_dir: string };
        diagnostics: { category: string }[];
      };
      assertEquals(parsed.app.app_data_dir, appData);
      assertEquals(parsed.hardware.platform, Deno.build.os);
      assertEquals(parsed.models.total, 0);
      assertEquals(parsed.storage.app_data_dir, appData);
      const categories = new Set(parsed.diagnostics.map((d) => d.category));
      assert(categories.has("system"));
      // Secrets never leave the box.
      assert(!raw.includes("test-jwt-secret-for-ci-only"));
      assert(!raw.toLowerCase().includes("diagnostics-passw0rd"));
    });
  });

  it("verify=1 re-hashes the content store and flags drifted files", async () => {
    await withServer(async (base) => {
      const defaultRes = await req(base, "/api/v1/diagnostics/storage", {
        token: ownerToken,
      });
      assertEquals(defaultRes.status, 200);
      assertEquals((defaultRes.body as { integrity: unknown }).integrity, null);

      const res = await req(base, "/api/v1/diagnostics/storage?verify=1", {
        token: ownerToken,
      });
      assertEquals(res.status, 200);
      const sr = res.body as {
        integrity: { verified: number; corrupted: { file_path: string }[] };
      };
      // Both media files are hashed; the referenced clip is intact, but the
      // seeded orphan blob carries a name that does not match its content.
      assertEquals(sr.integrity.verified, 2);
      assertEquals(sr.integrity.corrupted.length, 1);
      assert(sr.integrity.corrupted[0].file_path.endsWith(".mp4"));
    });
  });

  it("cleanup is admin-only and removes regenerable caches, never referenced media", async () => {
    await withServer(async (base) => {
      // Seed regenerable cache files in all three layout dirs.
      for (
        const [dir, name] of [
          ["previews", "a.png"],
          ["proxies", "b.mp4"],
          ["thumbnails", "c.jpg"],
        ] as const
      ) {
        const d = join(appData, dir);
        await Deno.mkdir(d, { recursive: true });
        await Deno.writeTextFile(join(d, name), "cache");
      }
      // The referenced media file lives under media/ (8 KiB from setup);
      // content files are nested two levels deep, so walk recursively.
      async function walkFiles(dir: string): Promise<string[]> {
        const out: string[] = [];
        try {
          for await (const entry of Deno.readDir(dir)) {
            const p = join(dir, entry.name);
            if (entry.isDirectory) out.push(...(await walkFiles(p)));
            else if (entry.isFile) out.push(p);
          }
        } catch {
          // Missing dir contributes nothing.
        }
        return out;
      }
      const mediaFilesBefore = await walkFiles(join(appData, "media"));
      assertEquals(mediaFilesBefore.length, 2);

      const denied = await req(base, "/api/v1/diagnostics/storage/cleanup", {
        method: "POST",
        token: memberToken,
      });
      assertEquals(denied.status, 403);

      const res = await req(base, "/api/v1/diagnostics/storage/cleanup", {
        method: "POST",
        token: ownerToken,
      });
      assertEquals(res.status, 200);
      const report = res.body as {
        directories: { path: string; files: number; bytes: number }[];
        orphaned_media: { files: number; bytes: number };
        total_files: number;
        bytes_freed: number;
      };
      assertEquals(
        report.directories,
        [
          { path: "previews", files: 1, bytes: 5 },
          { path: "proxies", files: 1, bytes: 5 },
          { path: "thumbnails", files: 1, bytes: 5 },
        ],
      );
      assertEquals(report.total_files, 3);
      assertEquals(report.orphaned_media, { files: 0, bytes: 0 });

      // Referenced media (and, by default, the orphan) survived.
      for (const file of mediaFilesBefore) {
        await Deno.stat(file);
      }

      // Explicitly requesting orphaned media removes the unreference blob.
      const orphans = await req(base, "/api/v1/diagnostics/storage/cleanup", {
        method: "POST",
        token: ownerToken,
        body: { include_orphaned_media: true },
      });
      assertEquals(orphans.status, 200);
      assertEquals(
        (orphans.body as {
          orphaned_media: { files: number; bytes: number };
        }).orphaned_media,
        { files: 1, bytes: 1024 },
      );

      const after = await req(base, "/api/v1/diagnostics/storage", {
        token: ownerToken,
      });
      const sr = after.body as {
        content_store: { files: number; orphaned: string[] };
      };
      assertEquals(sr.content_store.files, 1);
      assertEquals(sr.content_store.orphaned, []);
    });
  });
});
