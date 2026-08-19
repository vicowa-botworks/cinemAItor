import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { getDb, resetDb } from "../src/db/database.ts";
import * as schema from "../src/db/schema.ts";
import { createProject } from "../src/db/projects.ts";
import {
  addAlias,
  addTag,
  createAsset,
  createAssetVersion,
  deleteAsset,
  getAssetAccessible,
  getAssetBySlug,
  getAssetVersion,
  hasAssetPermission,
  listAliases,
  listAssets,
  listAssetVersions,
  listTags,
  removeAlias,
  removeTag,
  restoreAssetVersion,
} from "../src/db/assets.ts";

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueSlug(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function grantProjectPermission(
  projectId: string,
  userId: number,
  permission: string,
): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO project_permissions (id, project_id, user_id, permission, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    projectId,
    userId,
    permission,
    new Date().toISOString(),
  );
}

function grantAssetPermission(
  assetId: string,
  userId: number,
  permission: string,
): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO asset_permissions (id, asset_id, user_id, permission, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    assetId,
    userId,
    permission,
    new Date().toISOString(),
  );
}

function insertReference(assetId: string, rawText: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO asset_references (
      id, source_type, source_id, asset_id, raw_text, status, created_at, updated_at
    ) VALUES (?, 'scene', 'scene-1', ?, ?, 'resolved', ?, ?)`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    assetId,
    rawText,
    now,
    now,
  );
}

describe("assets", () => {
  let ownerId: number;
  let otherId: number;

  beforeEach(() => {
    getDb(":memory:");
    ownerId = schema.createUser(uniqueEmail("owner"), "hash123", "Owner");
    otherId = schema.createUser(uniqueEmail("other"), "hash456", "Other");
  });

  afterEach(() => {
    resetDb();
  });

  it("creates a global asset and resolves it by slug", () => {
    const slug = uniqueSlug("hero");
    const asset = createAsset(
      {
        unique_slug: slug,
        display_name: "Hero",
        asset_type: "character",
        library_scope: "global",
      },
      ownerId,
    );

    assertEquals(asset.library_scope, "global");
    assertEquals(asset.project_id, null);
    assertEquals(asset.status, "draft");
    assertEquals(asset.source_type, "uploaded");
    assertEquals(asset.created_by_user_id, ownerId);
    assertEquals(getAssetBySlug(slug)?.id, asset.id);
  });

  it("rejects duplicate slugs, including aliases", () => {
    const slug = uniqueSlug("hero");
    createAsset(
      {
        unique_slug: slug,
        display_name: "Hero",
        asset_type: "character",
        library_scope: "global",
      },
      ownerId,
    );

    assertThrows(
      () =>
        createAsset(
          {
            unique_slug: slug,
            display_name: "Hero 2",
            asset_type: "character",
            library_scope: "global",
          },
          ownerId,
        ),
      Error,
      "already taken",
    );

    const second = createAsset(
      {
        unique_slug: uniqueSlug("room"),
        display_name: "Room",
        asset_type: "location",
        library_scope: "global",
      },
      ownerId,
    );
    assertThrows(
      () => addAlias(second.id, ownerId, slug),
      Error,
      "already taken",
    );
  });

  it("requires project write permission for project-scoped assets", () => {
    const project = createProject({ name: "Film" }, otherId);

    assertThrows(
      () =>
        createAsset(
          {
            unique_slug: uniqueSlug("prop"),
            display_name: "Prop",
            asset_type: "prop",
            library_scope: "project",
            project_id: project.id,
          },
          ownerId,
        ),
      Error,
      "Permission denied",
    );

    grantProjectPermission(project.id, ownerId, "write");
    const asset = createAsset(
      {
        unique_slug: uniqueSlug("prop"),
        display_name: "Prop",
        asset_type: "prop",
        library_scope: "project",
        project_id: project.id,
      },
      ownerId,
    );
    assertEquals(asset.project_id, project.id);
  });

  it("resolves primary slugs and aliases to the same asset", () => {
    const slug = uniqueSlug("hero");
    const alias = uniqueSlug("lead");
    const asset = createAsset(
      {
        unique_slug: slug,
        display_name: "Hero",
        asset_type: "character",
        library_scope: "global",
      },
      ownerId,
    );
    addAlias(asset.id, ownerId, alias);

    assertEquals(listAliases(asset.id), [alias]);
    assertEquals(getAssetBySlug(alias)?.id, asset.id);
    assertEquals(getAssetBySlug(slug)?.id, asset.id);
    assert(removeAlias(asset.id, ownerId, alias));
    assertEquals(getAssetBySlug(alias), undefined);
  });

  it("manages tags idempotently", () => {
    const asset = createAsset(
      {
        unique_slug: uniqueSlug("hero"),
        display_name: "Hero",
        asset_type: "character",
        library_scope: "global",
      },
      ownerId,
    );
    addTag(asset.id, ownerId, "lead");
    addTag(asset.id, ownerId, "lead");
    addTag(asset.id, ownerId, "action");

    assertEquals(listTags(asset.id), ["action", "lead"]);
    assert(removeTag(asset.id, ownerId, "lead"));
    assertEquals(listTags(asset.id), ["action"]);
  });

  it("versions assets and moves the active pointer", () => {
    const asset = createAsset(
      {
        unique_slug: uniqueSlug("hero"),
        display_name: "Hero",
        asset_type: "character",
        library_scope: "global",
      },
      ownerId,
    );

    const v1 = createAssetVersion(asset.id, ownerId, {
      content_hash: "a".repeat(64),
      file_path: "/tmp/a.png",
      format: "png",
      mime_type: "image/png",
      file_size: 10,
    });
    const v2 = createAssetVersion(asset.id, ownerId, {
      content_hash: "b".repeat(64),
      file_path: "/tmp/b.png",
      format: "png",
      mime_type: "image/png",
      file_size: 12,
      make_active: false,
    });

    assertEquals(v1.version_number, 1);
    assertEquals(v2.version_number, 2);
    assertEquals(getAssetAccessible(asset.id, ownerId)?.active_version_id, v1.id);
    assertEquals(listAssetVersions(asset.id)[0].version_number, 2);

    const restored = restoreAssetVersion(asset.id, ownerId, v2.id);
    assertEquals(restored?.id, v2.id);
    assertEquals(getAssetAccessible(asset.id, ownerId)?.active_version_id, v2.id);
    assertEquals(getAssetVersion(v2.id)?.version_number, 2);
  });

  it("denies other users access by default", () => {
    const asset = createAsset(
      {
        unique_slug: uniqueSlug("hero"),
        display_name: "Hero",
        asset_type: "character",
        library_scope: "global",
      },
      ownerId,
    );

    assertEquals(getAssetAccessible(asset.id, otherId), undefined);
    assertEquals(hasAssetPermission(otherId, asset.id, "read"), false);
    assertEquals(listAssets(otherId).length, 0);

    grantAssetPermission(asset.id, otherId, "read");
    assertEquals(getAssetAccessible(asset.id, otherId)?.unique_slug, asset.unique_slug);
    assertThrows(
      () =>
        createAssetVersion(asset.id, otherId, {
          content_hash: null,
          file_path: null,
          format: null,
          mime_type: null,
          file_size: null,
        }),
      Error,
      "Permission denied",
    );

    grantAssetPermission(asset.id, otherId, "admin");
    assertEquals(deleteAsset(asset.id, otherId)?.referenced_by, 0);
  });

  it("inherits project permissions for project-scoped assets", () => {
    const project = createProject({ name: "Film" }, ownerId);
    const asset = createAsset(
      {
        unique_slug: uniqueSlug("prop"),
        display_name: "Prop",
        asset_type: "prop",
        library_scope: "project",
        project_id: project.id,
      },
      ownerId,
    );
    grantProjectPermission(project.id, otherId, "write");

    assertEquals(hasAssetPermission(otherId, asset.id, "write"), true);
    assertEquals(
      getAssetAccessible(asset.id, otherId, "write")?.id,
      asset.id,
    );
    assertEquals(deleteAsset(asset.id, otherId), undefined);
    grantProjectPermission(project.id, otherId, "admin");
    assertEquals(deleteAsset(asset.id, otherId)?.id, asset.id);
  });

  it("lets admin-role users access any asset", () => {
    const adminId = schema.createUser(uniqueEmail("admin"), "hash789", "Admin");
    getDb().prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(adminId);

    const asset = createAsset(
      {
        unique_slug: uniqueSlug("hero"),
        display_name: "Hero",
        asset_type: "character",
        library_scope: "global",
      },
      ownerId,
    );
    assertEquals(hasAssetPermission(adminId, asset.id, "admin"), true);
  });

  it("filters and searches the asset list", () => {
    const hero = createAsset(
      {
        unique_slug: uniqueSlug("hero"),
        display_name: "Hero",
        asset_type: "character",
        library_scope: "global",
        description: "the main protagonist",
      },
      ownerId,
    );
    createAsset(
      {
        unique_slug: uniqueSlug("room"),
        display_name: "Room",
        asset_type: "location",
        library_scope: "global",
      },
      ownerId,
    );
    addTag(hero.id, ownerId, "lead");

    assertEquals(listAssets(ownerId).length, 2);
    assertEquals(listAssets(ownerId, { asset_type: "character" }).length, 1);
    assertEquals(listAssets(ownerId, { tag: "lead" }).length, 1);
    assertEquals(listAssets(ownerId, { q: "protagonist" }).length, 1);
    assertEquals(
      (listAssets(ownerId, { q: "protagonist" })[0] as { id: string }).id,
      hero.id,
    );
  });

  it("soft-deletes assets and reports dangling references", () => {
    const asset = createAsset(
      {
        unique_slug: uniqueSlug("hero"),
        display_name: "Hero",
        asset_type: "character",
        library_scope: "global",
      },
      ownerId,
    );
    insertReference(asset.id, "@hero");
    insertReference(asset.id, "@hero again");

    const result = deleteAsset(asset.id, ownerId);
    assertEquals(result?.referenced_by, 2);
    assertEquals(getAssetAccessible(asset.id, ownerId), undefined);
    assertEquals(listAssets(ownerId).length, 0);
    assertEquals(getAssetBySlug(asset.unique_slug), undefined);
  });

  it("writes audit entries for asset actions", () => {
    const asset = createAsset(
      {
        unique_slug: uniqueSlug("hero"),
        display_name: "Hero",
        asset_type: "character",
        library_scope: "global",
      },
      ownerId,
    );
    createAssetVersion(asset.id, ownerId, {
      content_hash: "c".repeat(64),
      file_path: "/tmp/c.png",
      format: "png",
      mime_type: "image/png",
      file_size: 5,
    });

    const rows = getDb()
      .prepare(
        "SELECT action FROM audit_logs WHERE entity_type = 'asset' AND entity_id = ? ORDER BY created_at",
      )
      .all(asset.id) as unknown as { action: string }[];
    assertEquals(rows.map((r) => r.action), [
      "asset.create",
      "asset.version.create",
    ]);
  });
});
