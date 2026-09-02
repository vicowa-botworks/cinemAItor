import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { reconcilePreviews } from "../src/components/preview-reconcile.js";

const panel = (id, versionId) => ({ id, preview_asset_version_id: versionId });
const entry = (versionId, url) => ({ versionId, url });

describe("reconcilePreviews", () => {
  it("does nothing when there are no panels or loaded previews", () => {
    const { keep, fetch, revoke } = reconcilePreviews([], new Map());
    assertEquals(keep.size, 0);
    assertEquals(fetch, []);
    assertEquals(revoke, []);
  });

  it("fetches a panel that just gained a preview (no prior entry)", () => {
    const { keep, fetch, revoke } = reconcilePreviews([panel("p1", "v1")], new Map());
    assertEquals(fetch, ["p1"]);
    assertEquals(keep.size, 0);
    assertEquals(revoke, []);
  });

  it("ignores panels that have no preview", () => {
    const { keep, fetch, revoke } = reconcilePreviews(
      [panel("p1", null), panel("p2", undefined)],
      new Map(),
    );
    assertEquals(fetch, []);
    assertEquals(keep.size, 0);
    assertEquals(revoke, []);
  });

  it("keeps an unchanged preview (same version already loaded) — no re-fetch", () => {
    const prev = new Map([["p1", entry("v1", "blob:p1v1")]]);
    const { keep, fetch, revoke } = reconcilePreviews([panel("p1", "v1")], prev);
    assertEquals(fetch, []);
    assertEquals(revoke, []);
    assertEquals(keep.size, 1);
    assertEquals(keep.get("p1"), prev.get("p1"));
  });

  it("re-fetches and releases the stale URL when the version changes", () => {
    const prev = new Map([["p1", entry("v1", "blob:p1v1")]]);
    const { keep, fetch, revoke } = reconcilePreviews([panel("p1", "v2")], prev);
    assertEquals(fetch, ["p1"]);
    assertEquals(keep.size, 0);
    assertEquals(revoke, ["blob:p1v1"]);
  });

  it("releases the object URL when a panel loses its preview", () => {
    const prev = new Map([["p1", entry("v1", "blob:p1v1")]]);
    const { keep, fetch, revoke } = reconcilePreviews([panel("p1", null)], prev);
    assertEquals(fetch, []);
    assertEquals(keep.size, 0);
    assertEquals(revoke, ["blob:p1v1"]);
  });

  it("does not revoke an entry that still has no URL (still loading)", () => {
    const prev = new Map([["p1", entry("v1", null)]]);
    const { fetch, revoke } = reconcilePreviews([panel("p1", "v2")], prev);
    assertEquals(fetch, ["p1"]);
    assertEquals(revoke, []);
  });

  it("handles a mix of new, unchanged, changed, and dropped panels", () => {
    const prev = new Map([
      ["p1", entry("v1", "blob:p1v1")], // unchanged -> keep
      ["p2", entry("v1", "blob:p2v1")], // changed to v2 -> refetch + revoke old
      ["p3", entry("v1", "blob:p3v1")], // dropped -> revoke
    ]);
    const panels = [
      panel("p1", "v1"),
      panel("p2", "v2"),
      panel("p3", null),
      panel("p4", "v9"), // new -> fetch
    ];
    const { keep, fetch, revoke } = reconcilePreviews(panels, prev);
    assertEquals(fetch, ["p2", "p4"]);
    assertEquals(revoke, ["blob:p2v1", "blob:p3v1"]);
    assertEquals(keep.size, 1);
    assertEquals(keep.get("p1"), prev.get("p1"));
  });
});
