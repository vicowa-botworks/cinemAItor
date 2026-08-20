import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { freshMemoryDb, withServer } from "./helpers/http.ts";
import { getUserByEmail } from "../src/db/schema.ts";
import { createProject } from "../src/db/projects.ts";
import { addAlias, addTag, createAsset, createAssetVersion } from "../src/db/assets.ts";
import { getContentStore, resetContentStore } from "../src/storage/content_store.ts";

let appData: string;
let adminToken: string;
let memberToken: string;
let projectId: string;

interface Resp {
  status: number;
  body: Record<string, unknown>;
}

async function req(
  base: string,
  method: string,
  path: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<Resp> {
  let res: Response;
  for (let attempt = 0;; attempt++) {
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      break;
    } catch (err) {
      if (attempt >= 40) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

async function bootstrapUser(
  base: string,
  email: string,
  name: string,
): Promise<string> {
  const res = await req(
    base,
    "POST",
    "/api/v1/auth/bootstrap",
    "",
    { email, password: "password123", display_name: name },
  );
  return String(res.body.token);
}

function removeDir(path: string): void {
  try {
    Deno.removeSync(path, { recursive: true });
  } catch {
    // already gone
  }
}

describe("diagnostics backup api", () => {
  beforeEach(async () => {
    appData = Deno.makeTempDirSync({ prefix: "cinemaitor_backup_api_test_" });
    Deno.env.set("APP_DATA_DIR", appData);
    Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
    resetContentStore();
    freshMemoryDb();

    await withServer(async (base) => {
      adminToken = await bootstrapUser(base, "backup-admin@example.com", "BA");
      const memberRes = await req(
        base,
        "POST",
        "/api/auth/register",
        "",
        {
          email: "backup-member@example.com",
          password: "password123",
          display_name: "BM",
        },
      );
      assertEquals(memberRes.status, 201, JSON.stringify(memberRes.body));
      memberToken = String(memberRes.body.token);
      const adminId = getUserByEmail("backup-admin@example.com")?.id ?? 0;

      projectId = createProject(
        { name: "Backup Source" },
        adminId,
      ).id;

      const assetId = createAsset(
        {
          unique_slug: "api_hero_clip",
          display_name: "API Hero Clip",
          asset_type: "video",
          library_scope: "project",
          project_id: projectId,
        },
        adminId,
      ).id;
      const tmp = Deno.makeTempFileSync();
      await Deno.writeTextFile(tmp, "backup-api-bytes");
      const stored = await getContentStore().put(tmp, "api_clip.mp4");
      Deno.removeSync(tmp);
      createAssetVersion(assetId, adminId, {
        content_hash: stored.hash,
        file_path: stored.path,
        format: "mp4",
        mime_type: "video/mp4",
        file_size: stored.size,
        make_active: true,
      });
      addAlias(assetId, adminId, "apihero");
      addTag(assetId, adminId, "api");
    });
  });

  afterEach(() => {
    freshMemoryDb();
    removeDir(appData);
  });

  it("requires authentication", async () => {
    await withServer(async (base) => {
      const res = await req(base, "GET", "/api/v1/diagnostics/backups", "");
      assertEquals(res.status, 401);
    });
  });

  it("creates, lists, restores, and deletes backups over HTTP", async () => {
    await withServer(async (base) => {
      const created = await req(
        base,
        "POST",
        "/api/v1/diagnostics/backups",
        adminToken,
        { project_id: projectId },
      );
      assertEquals(created.status, 201);
      const backup = created.body.backup as Record<string, unknown>;
      const backupId = String(backup.id);
      const counts = created.body.counts as Record<string, number>;
      assertEquals(counts.assets, 1);
      const media = created.body.media as { present: boolean }[];
      assertEquals(media.length, 1);
      assertEquals(media[0].present, true);

      const filePath = String(backup.file_path);
      const stat = Deno.statSync(filePath);
      assertEquals(stat.isFile, true);

      const list = await req(
        base,
        "GET",
        "/api/v1/diagnostics/backups",
        adminToken,
      );
      assertEquals(list.status, 200);
      const backups = list.body.backups as Record<string, string>[];
      assertEquals(backups.length, 1);
      assertEquals(backups[0].id, backupId);

      const restored = await req(
        base,
        "POST",
        `/api/v1/diagnostics/backups/${backupId}/restore`,
        adminToken,
        { project_name: "Copied" },
      );
      assertEquals(restored.status, 201);
      assert(String(restored.body.project_id) !== projectId);
      assertEquals(restored.body.project_name, "Copied");
      assertEquals(restored.body.issues, []);

      const memberRestored = await req(
        base,
        "POST",
        `/api/v1/diagnostics/backups/${backupId}/restore`,
        memberToken,
        {},
      );
      assertEquals(memberRestored.status, 404);

      const memberList = await req(
        base,
        "GET",
        "/api/v1/diagnostics/backups",
        memberToken,
      );
      assertEquals((memberList.body.backups as unknown[]).length, 0);

      const deleted = await req(
        base,
        "DELETE",
        `/api/v1/diagnostics/backups/${backupId}`,
        adminToken,
      );
      assertEquals(deleted.status, 200);
      let exists = true;
      try {
        Deno.statSync(filePath);
      } catch {
        exists = false;
      }
      assertEquals(exists, false);
    });
  });

  it("rejects backups of inaccessible projects", async () => {
    await withServer(async (base) => {
      const res = await req(
        base,
        "POST",
        "/api/v1/diagnostics/backups",
        memberToken,
        { project_id: projectId },
      );
      assertEquals(res.status, 404);
    });
  });
});
