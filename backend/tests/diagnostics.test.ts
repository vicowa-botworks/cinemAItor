import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { dirname, join } from "@std/path";
import { getDb, resetDb } from "../src/db/database.ts";
import {
  addDiagnostic,
  createDiagnosticLogSink,
  diagnosticCount,
  listDiagnostics,
} from "../src/db/diagnostics.ts";
import { createLogger } from "../src/logger.ts";
import { loadConfig } from "../src/config.ts";
import { contentAddressedPath, ensureLayout } from "../src/storage/paths.ts";
import { sha256Bytes } from "../src/storage/checksums.ts";
import { cleanupStorageCache, storageReport } from "../src/services/diagnostics.ts";

describe("diagnostics db", () => {
  beforeEach(() => {
    Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
    resetDb();
    getDb(":memory:");
  });

  afterEach(() => {
    resetDb();
  });

  it("stores and lists entries newest first", () => {
    const first = addDiagnostic("job", "error", "job failed", {
      job_id: "j1",
    });
    assert(first);
    addDiagnostic("request", "warn", "slow request", { ms: 1500 });
    const all = listDiagnostics();
    assertEquals(all.length, 2);
    assertEquals(all[0].message, "slow request");
    assertEquals(all[0].severity, "warn");
    assertEquals(all[0].data, { ms: 1500 });
    assertEquals(all[1].id, first.id);
    assertEquals(all[1].data, { job_id: "j1" });
  });

  it("filters by category, severity and time window", () => {
    addDiagnostic("log", "error", "a");
    addDiagnostic("log", "warn", "b");
    addDiagnostic("render", "error", "c");
    assertEquals(listDiagnostics({ category: "log" }).length, 2);
    assertEquals(listDiagnostics({ severity: "error" }).length, 2);
    assertEquals(
      listDiagnostics({ category: "log", severity: "warn" }).map((d) => d.message),
      ["b"],
    );
    // One hour back includes everything we just created.
    assertEquals(listDiagnostics({ sinceHours: 1 }).length, 3);
  });

  it("rejects unknown category/severity and bad limits", () => {
    assertThrows(() => addDiagnostic("bogus", "info", "x"), Error, "category");
    assertThrows(() => addDiagnostic("job", "bogus", "x"), Error, "severity");
    assertThrows(() => listDiagnostics({ limit: 0 }), Error, "limit");
    assertThrows(() => listDiagnostics({ sinceHours: -5 }), Error, "sinceHours");
  });

  it("caps stored rows at the newest 2000", () => {
    for (let i = 0; i < 2005; i++) {
      addDiagnostic("system", "info", `row ${i}`);
    }
    assertEquals(diagnosticCount(), 2000);
    const newest = listDiagnostics({ limit: 1 });
    assertEquals(newest[0].message, "row 2004");
    // The newest 1000 of the surviving rows start at "row 1005".
    const top = listDiagnostics({ limit: 1000 });
    assertEquals(top.length, 1000);
    assertEquals(top[top.length - 1].message, "row 1005");
  });

  it("parses data_json defensively", () => {
    getDb()
      .prepare(
        `INSERT INTO diagnostics (id, category, severity, message, data_json, created_at)
         VALUES ('broken', 'log', 'warn', 'odd', '{not-json', datetime('now'))`,
      )
      .run();
    const entry = listDiagnostics({ limit: 10 }).find((d) => d.id === "broken");
    assertEquals(entry?.data, { raw: "{not-json" });
  });
});

describe("logger diagnostics sink", () => {
  beforeEach(() => {
    Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
    resetDb();
    getDb(":memory:");
  });

  afterEach(() => {
    resetDb();
  });

  it("captures warn/error but not info", () => {
    const log = createLogger("info", { component: "test", reqId: "r1" }, createDiagnosticLogSink());
    log.info("hello info");
    log.warn("hello warn", { code: "W1" });
    log.error("hello error", { code: "E1" });
    const entries = listDiagnostics({ category: "log" });
    assertEquals(entries.length, 2);
    assertEquals(entries[0].severity, "error");
    assertEquals(entries[1].severity, "warn");
    assertEquals(entries[1].data, { component: "test", reqId: "r1", code: "W1" });
    // The child logger inherits the sink.
    const child = log.child({ sub: 1 });
    child.error("child error");
    assertEquals(listDiagnostics({ category: "log" }).length, 3);
  });

  it("survives a throwing sink", () => {
    let called = 0;
    const log = createLogger(
      "info",
      {},
      () => {
        called++;
        throw new Error("sink exploded");
      },
    );
    // Must not throw.
    log.error("boom");
    assertEquals(called, 1);
  });
});

// ---------------------------------------------------------------------------
// STO-010/011/012: storage report (project/asset usage, integrity verify)
// and cache cleanup
// ---------------------------------------------------------------------------

function storageFixture() {
  const db = getDb();
  function insertProject(id: string, name: string) {
    db
      .prepare(
        `INSERT INTO projects (id, name, status, created_at, updated_at)
         VALUES (?, ?, 'active', datetime('now'), datetime('now'))`,
      )
      .run(id, name);
  }
  function insertAsset(id: string, projectId: string | null, name: string) {
    db
      .prepare(
        `INSERT INTO assets (
           id, library_scope, project_id, unique_slug, display_name,
           asset_type, status, source_type, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'image', 'draft', 'uploaded',
                   datetime('now'), datetime('now'))`,
      )
      .run(id, projectId ? "project" : "global", projectId, id, name);
  }
  function insertVersion(
    id: string,
    assetId: string,
    n: number,
    hash: string,
    path: string,
    bytes: number,
  ) {
    db
      .prepare(
        `INSERT INTO asset_versions (
           id, asset_id, version_number, status, content_hash, file_path,
           format, mime_type, file_size, created_at
         ) VALUES (?, ?, ?, 'ready', ?, ?, 'bin',
                   'application/octet-stream', ?, datetime('now'))`,
      )
      .run(id, assetId, n, hash, path, bytes);
  }
  async function mediaFile(content: string): Promise<{ hash: string; path: string }> {
    const hash = await sha256Bytes(new TextEncoder().encode(content));
    const layout = ensureLayout(loadConfig().appDataDir);
    const path = contentAddressedPath(layout, hash, "bin");
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, content);
    return { hash, path };
  }
  function layoutPath(...parts: string[]): string {
    return join(ensureLayout(loadConfig().appDataDir).root, ...parts);
  }
  return { insertProject, insertAsset, insertVersion, mediaFile, layoutPath };
}

describe("storage report and cleanup", () => {
  let appData: string;
  let prevAppData: string | undefined;
  let fx: ReturnType<typeof storageFixture>;

  beforeEach(async () => {
    Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
    prevAppData = Deno.env.get("APP_DATA_DIR");
    appData = await Deno.makeTempDir({ prefix: "cinemaitor-sr-" });
    Deno.env.set("APP_DATA_DIR", appData);
    resetDb();
    getDb(":memory:");
    fx = storageFixture();
  });

  afterEach(async () => {
    resetDb();
    if (prevAppData === undefined) {
      Deno.env.delete("APP_DATA_DIR");
    } else {
      Deno.env.set("APP_DATA_DIR", prevAppData);
    }
    await Deno.remove(appData, { recursive: true });
  });

  async function seedProjects() {
    const len = (s: string) => s.length;
    fx.insertProject("p1", "Proj One");
    fx.insertProject("p2", "Proj Two");
    // F1 is shared by assets in p1 and p2 (content dedupe across projects).
    const f1 = await fx.mediaFile("shared-bytes-11111");
    // F2 is only referenced from p1's asset (second version, same asset).
    const f2 = await fx.mediaFile("project-one-only");
    // F3 is referenced by a global (non-project) asset.
    const f3 = await fx.mediaFile("global-small");
    // F4 is an orphan: present in the content store, referenced by nothing.
    const f4 = await fx.mediaFile("orphan-bytes");

    fx.insertAsset("a1", "p1", "Asset One");
    fx.insertAsset("a2", "p2", "Asset Two");
    fx.insertAsset("a3", null, "Asset Global");
    fx.insertVersion("v1", "a1", 1, f1.hash, f1.path, len("shared-bytes-11111"));
    fx.insertVersion("v2", "a1", 2, f2.hash, f2.path, len("project-one-only"));
    fx.insertVersion("v3", "a2", 1, f1.hash, f1.path, len("shared-bytes-11111"));
    fx.insertVersion("v4", "a3", 1, f3.hash, f3.path, len("global-small"));
    return { f1, f2, f3, f4 };
  }

  it("groups usage by project and asset with shared-file dedupe", async () => {
    await seedProjects();
    const report = await storageReport();

    assertEquals(report.projects.length, 3);
    // Sorted by bytes desc: p1 (F1+F2), p2 (F1), global (F3).
    assertEquals(report.projects[0], {
      project_id: "p1",
      name: "Proj One",
      files: 2,
      bytes: 34,
    });
    assertEquals(report.projects[1], {
      project_id: "p2",
      name: "Proj Two",
      files: 1,
      bytes: 18,
    });
    assertEquals(report.projects[2], {
      project_id: null,
      name: null,
      files: 1,
      bytes: 12,
    });
    assertEquals(
      report.top_assets.map((a) => a.asset_id),
      ["a1", "a2", "a3"],
    );
    assertEquals(report.top_assets[0], {
      asset_id: "a1",
      display_name: "Asset One",
      project_id: "p1",
      files: 2,
      bytes: 34,
    });
    // Content store totals still include the orphan; the orphan is named.
    assertEquals(report.content_store.files, 4);
    assertEquals(report.content_store.bytes, 58);
    assertEquals(report.integrity, null);
  });

  it("verify re-hashes content and flags files whose content drifted", async () => {
    const { f1 } = await seedProjects();
    // Corrupt F1 in place: same name, different content.
    await Deno.writeTextFile(f1.path, "corrupted!");
    const report = await storageReport({ verify: true });
    assert(report.integrity);
    assertEquals(report.integrity.verified, 4);
    assertEquals(report.integrity.corrupted.length, 1);
    assertEquals(report.integrity.corrupted[0].file_path, f1.path);
    assertEquals(report.integrity.corrupted[0].content_hash, f1.hash);
  });

  it("cleanup removes regenerable caches and keeps referenced media", async () => {
    const { f1, f4 } = await seedProjects();
    const previews = fx.layoutPath("previews");
    const proxies = fx.layoutPath("proxies");
    const thumbnails = fx.layoutPath("thumbnails");
    await Deno.mkdir(previews, { recursive: true });
    await Deno.mkdir(proxies, { recursive: true });
    await Deno.mkdir(thumbnails, { recursive: true });
    await Deno.writeTextFile(join(previews, "p1.png"), "pv1");
    await Deno.writeTextFile(join(previews, "p2.png"), "pv2");
    await Deno.writeTextFile(join(proxies, "x1.mp4"), "px1");
    await Deno.writeTextFile(join(thumbnails, "t1.jpg"), "th1");

    const first = await cleanupStorageCache();
    assertEquals(
      first.directories,
      [
        { path: "previews", files: 2, bytes: 6 },
        { path: "proxies", files: 1, bytes: 3 },
        { path: "thumbnails", files: 1, bytes: 3 },
      ],
    );
    assertEquals(first.total_files, 4);
    assertEquals(first.bytes_freed, 12);
    assertEquals(first.orphaned_media, { files: 0, bytes: 0 });
    // Referenced media and (by default) orphans survive.
    await Deno.stat(f1.path);
    await Deno.stat(f4.path);

    // Idempotent on an already-clean tree.
    const second = await cleanupStorageCache();
    assertEquals(second.total_files, 0);
    assertEquals(second.bytes_freed, 0);

    // Explicitly requesting orphaned media removes only unreferenced files.
    const third = await cleanupStorageCache({ includeOrphanedMedia: true });
    assertEquals(third.orphaned_media, { files: 1, bytes: 12 });
    await Deno.stat(f1.path);
    let gone = false;
    try {
      await Deno.stat(f4.path);
    } catch {
      gone = true;
    }
    assert(gone);
  });
});
