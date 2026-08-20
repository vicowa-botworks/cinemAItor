import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { getDb, resetDb } from "../src/db/database.ts";
import {
  addDiagnostic,
  createDiagnosticLogSink,
  diagnosticCount,
  listDiagnostics,
} from "../src/db/diagnostics.ts";
import { createLogger } from "../src/logger.ts";

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
