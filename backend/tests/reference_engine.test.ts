import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { getDb, resetDb } from "../src/db/database.ts";
import * as schema from "../src/db/schema.ts";
import { createAsset, createAssetVersion, deleteAsset, getAssetBySlug } from "../src/db/assets.ts";
import {
  auditReferences,
  getReference,
  listReferencesForSource,
  replaceReference,
  resolveReferenceText,
  resolveReferenceToken,
  saveResolvedReferences,
} from "../src/db/references.ts";
import { parseReferenceTokens } from "../src/services/reference_parser.ts";

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
}

function uniqueSlug(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

let ownerId: number;
let otherId: number;
let heroSlug: string;
let roomSlug: string;
let heroId: string;

function createHeroAsset(): void {
  const asset = createAsset(
    {
      unique_slug: heroSlug,
      display_name: "Hero",
      asset_type: "character",
      library_scope: "global",
    },
    ownerId,
  );
  heroId = asset.id;
  createAssetVersion(heroId, ownerId, {
    content_hash: "a".repeat(64),
    file_path: "/tmp/hero.png",
    format: "png",
    mime_type: "image/png",
    file_size: 10,
  });
}

describe("reference engine", () => {
  beforeEach(() => {
    getDb(":memory:");
    ownerId = schema.createUser(uniqueEmail("owner"), "hash123", "Owner");
    otherId = schema.createUser(uniqueEmail("other"), "hash456", "Other");
    heroSlug = uniqueSlug("hero");
    roomSlug = uniqueSlug("room");
    createAsset(
      {
        unique_slug: roomSlug,
        display_name: "Room",
        asset_type: "location",
        library_scope: "global",
      },
      ownerId,
    );
    createHeroAsset();
  });

  afterEach(() => {
    resetDb();
  });

  it("resolves known slugs to assets and active versions", () => {
    const resolved = resolveReferenceText(
      ownerId,
      `@${heroSlug} walks into @${roomSlug}`,
    );
    assertEquals(resolved.length, 2);
    assertEquals(resolved[0].status, "resolved");
    assertEquals(resolved[0].asset?.unique_slug, heroSlug);
    assert(resolved[0].asset_version);
    assertEquals(resolved[1].asset?.unique_slug, roomSlug);
  });

  it("marks unknown slugs missing with a helpful note", () => {
    const resolved = resolveReferenceText(ownerId, "@ghost is here");
    assertEquals(resolved.length, 1);
    assertEquals(resolved[0].status, "missing");
    assertEquals(resolved[0].asset, null);
    assert(resolved[0].notes?.includes("@ghost"));
  });

  it("resolves versioned references and detects missing versions", () => {
    const v1 = getAssetBySlug(heroSlug);
    assert(v1);
    createAssetVersion(v1.id, ownerId, {
      content_hash: "b".repeat(64),
      file_path: "/tmp/hero2.png",
      format: "png",
      mime_type: "image/png",
      file_size: 12,
    });

    const resolved = resolveReferenceText(
      ownerId,
      `@${heroSlug}:v1 and @${heroSlug}:v2 and @${heroSlug}:v9`,
    );
    assertEquals(resolved[0].status, "resolved");
    assertEquals(resolved[0].asset_version?.version_number, 1);
    assertEquals(resolved[1].asset_version?.version_number, 2);
    assertEquals(resolved[2].status, "missing");
  });

  it("hides assets the user cannot read", () => {
    const resolved = resolveReferenceToken(otherId, parseReferenceTokens(`@${heroSlug}`)[0]);
    assertEquals(resolved.status, "missing");
    assertEquals(resolved.asset, null);
    assert(resolved.notes?.includes("access"));
  });

  it("saves references for a source replacing the old set", () => {
    const tokens = parseReferenceTokens(`@${heroSlug} and @missing_slug`);
    const resolved = resolveReferenceText(ownerId, `@${heroSlug} and @missing_slug`);
    const rows = saveResolvedReferences(ownerId, "prompt", "scope-1", resolved);
    assertEquals(rows.length, 2);

    const saved = getReference(rows[1].id);
    assert(saved);
    assertEquals(saved.status, "missing");
    assertEquals(saved.asset_id, null);
    assertEquals(saved.raw_text, "@missing_slug");

    // Re-saving the same source replaces its rows.
    const second = saveResolvedReferences(ownerId, "prompt", "scope-1", resolved);
    assertEquals(listReferencesForSource("prompt", "scope-1").length, 2);
    assertEquals(second.length, 2);
    assertEquals(tokens.length, 2);
  });

  it("audit lists references with asset context and broken flags", () => {
    saveResolvedReferences(
      ownerId,
      "prompt",
      "scope-1",
      resolveReferenceText(ownerId, `@${heroSlug} and @ghost`),
    );

    const entries = auditReferences();
    assertEquals(entries.length, 2);
    const heroEntry = entries.find((e) => e.reference.raw_text === `@${heroSlug}`);
    assert(heroEntry);
    assertEquals(heroEntry.asset_slug, heroSlug);
    assertEquals(heroEntry.asset_status, "draft");
    assertEquals(heroEntry.broken, false);
    const ghostEntry = entries.find((e) => e.reference.raw_text === "@ghost");
    assert(ghostEntry);
    assertEquals(ghostEntry.broken, true);

    const filtered = auditReferences({ status: "missing" });
    assertEquals(filtered.length, 1);
    assertEquals(filtered[0].reference.raw_text, "@ghost");
  });

  it("flags references as broken when their asset is soft-deleted", () => {
    saveResolvedReferences(
      ownerId,
      "prompt",
      "scope-1",
      resolveReferenceText(ownerId, `@${heroSlug}`),
    );
    assertEquals(auditReferences({ source_id: "scope-1" })[0].broken, false);

    deleteAsset(heroId, ownerId);
    const entries = auditReferences({ source_id: "scope-1" });
    assertEquals(entries.length, 1);
    assertEquals(entries[0].broken, true);
    assertEquals(entries[0].asset_status, "deleted");
  });

  it("replaces a broken reference with a working asset", () => {
    const rows = saveResolvedReferences(
      ownerId,
      "prompt",
      "scope-1",
      resolveReferenceText(ownerId, `@ghost stands in @${roomSlug}`),
    );
    const ghostRow = rows.find((r) => r.raw_text === "@ghost");
    assert(ghostRow);

    const updated = replaceReference(ownerId, ghostRow.id, { slug: heroSlug });
    assert(updated);
    assertEquals(updated.status, "resolved");
    assertEquals(updated.asset_id, heroId);
    assert(updated.asset_version_id);

    const entries = auditReferences({ source_id: "scope-1" });
    assertEquals(entries.filter((e) => e.broken).length, 0);
  });

  it("replace re-resolves the active version and validates versions", () => {
    const room = getAssetBySlug(roomSlug);
    assert(room);
    createAssetVersion(room.id, ownerId, {
      content_hash: "c".repeat(64),
      file_path: "/tmp/room.png",
      format: "png",
      mime_type: "image/png",
      file_size: 20,
    });
    const roomAfterVersion = getAssetBySlug(roomSlug);
    assert(roomAfterVersion);
    const rows = saveResolvedReferences(
      ownerId,
      "prompt",
      "scope-1",
      resolveReferenceText(ownerId, "@ghost"),
    );
    const ghostRow = rows[0];

    const bySlug = replaceReference(ownerId, ghostRow.id, { slug: roomSlug });
    assertEquals(bySlug?.asset_version_id, roomAfterVersion.active_version_id);

    const byV1 = replaceReference(ownerId, ghostRow.id, { slug: roomSlug, version: 1 });
    assertEquals(byV1?.status, "resolved");
    assert(byV1);

    assertThrows(
      () => replaceReference(ownerId, ghostRow.id, { slug: roomSlug, version: 99 }),
      Error,
      "version does not exist",
    );
    assertThrows(
      () => replaceReference(ownerId, ghostRow.id, { slug: uniqueSlug("nope") }),
      Error,
      "does not exist",
    );
  });

  it("writes audit entries for save and replace", () => {
    const rows = saveResolvedReferences(
      ownerId,
      "prompt",
      "scope-1",
      resolveReferenceText(ownerId, `@${heroSlug}`),
    );
    replaceReference(ownerId, rows[0].id, { slug: heroSlug });

    const db = getDb();
    const actions = (
      db.prepare(
        "SELECT action FROM audit_logs WHERE entity_type = 'reference' ORDER BY rowid",
      ).all() as unknown as { action: string }[]
    ).map((r) => r.action);
    assertEquals(actions, ["reference.save", "reference.replace"]);
  });
});
