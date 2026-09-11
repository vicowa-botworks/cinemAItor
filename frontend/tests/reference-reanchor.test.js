import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { editRegion, reanchorTokens } from "../src/reference-reanchor.js";

const T = (raw, start) => ({ raw, start, end: start + raw.length });
const spans = (tokens) => tokens.map((t) => [t.start, t.end]);

describe("editRegion", () => {
  it("finds a single-character insertion", () => {
    assertEquals(editRegion("hello world", "hXello world"), {
      oldStart: 1,
      oldEnd: 1,
      newStart: 1,
      newEnd: 2,
    });
  });

  it("finds a deletion at the start", () => {
    assertEquals(editRegion("@hero @dog", "hero @dog"), {
      oldStart: 0,
      oldEnd: 1,
      newStart: 0,
      newEnd: 0,
    });
  });

  it("finds a middle replacement", () => {
    assertEquals(editRegion("hello", "heyo"), {
      oldStart: 2,
      oldEnd: 4,
      newStart: 2,
      newEnd: 3,
    });
  });

  it("finds an insertion at the end", () => {
    assertEquals(editRegion("ab", "abc"), {
      oldStart: 2,
      oldEnd: 2,
      newStart: 2,
      newEnd: 3,
    });
  });

  it("reports an empty region for identical strings", () => {
    assertEquals(editRegion("same", "same"), {
      oldStart: 4,
      oldEnd: 4,
      newStart: 4,
      newEnd: 4,
    });
  });

  it("handles a full replacement and empty sides", () => {
    assertEquals(editRegion("ab", "cd"), {
      oldStart: 0,
      oldEnd: 2,
      newStart: 0,
      newEnd: 2,
    });
    assertEquals(editRegion("", "abc"), {
      oldStart: 0,
      oldEnd: 0,
      newStart: 0,
      newEnd: 3,
    });
    assertEquals(editRegion("abc", ""), {
      oldStart: 0,
      oldEnd: 3,
      newStart: 0,
      newEnd: 0,
    });
  });
});

describe("reanchorTokens", () => {
  // "@hero walks past @dog": @hero 0-5, @dog 17-21
  const base = "@hero walks past @dog";
  const tokens = [T("@hero", 0), T("@dog", 17)];

  it("keeps tokens when the edit lands after the last one", () => {
    const { tokens: kept, newEnd } = reanchorTokens(base, base + "!", tokens);
    assertEquals(spans(kept), [[0, 5], [17, 21]]);
    assertEquals(newEnd, 22);
  });

  it("shifts every token for an edit before all of them", () => {
    const { tokens: kept, newEnd } = reanchorTokens(base, "X" + base, tokens);
    assertEquals(spans(kept), [[1, 6], [18, 22]]);
    assertEquals(newEnd, 1);
  });

  it("shifts only the tokens after an edit between them", () => {
    const next = base.slice(0, 5) + "X" + base.slice(5);
    const { tokens: kept, newEnd } = reanchorTokens(base, next, tokens);
    assertEquals(spans(kept), [[0, 5], [18, 22]]);
    assertEquals(newEnd, 6);
  });

  it("drops a token the edit typed inside, shifts the rest", () => {
    const next = base.slice(0, 1) + base.slice(3); // delete "he" from @hero
    const { tokens: kept, newEnd } = reanchorTokens(base, next, tokens);
    assertEquals(spans(kept), [[15, 19]]);
    assertEquals(newEnd, 1);
  });

  it("shifts tokens left across a deletion between them", () => {
    const prev = "@a xx @b"; // @a 0-2, @b 6-8
    const next = "@a @b"; // delete "xx"
    const { tokens: kept, newEnd } = reanchorTokens(prev, next, [
      T("@a", 0),
      T("@b", 6),
    ]);
    assertEquals(spans(kept), [[0, 2], [3, 5]]);
    assertEquals(newEnd, 3);
  });

  it("drops only the token a selection-replacement rewrote", () => {
    const prev = "@a xyz @b"; // @a 0-2, @b 7-9
    const next = "@a q @b"; // replace "xyz" with "q"
    const { tokens: kept, newEnd } = reanchorTokens(prev, next, [
      T("@a", 0),
      T("@b", 7),
    ]);
    assertEquals(spans(kept), [[0, 2], [5, 7]]);
    assertEquals(newEnd, 4);
  });

  it("drops a duplicated occurrence that was deleted, keeps the survivor", () => {
    const { tokens: kept } = reanchorTokens("@a @a", "@a", [
      T("@a", 0),
      T("@a", 3),
    ]);
    assertEquals(spans(kept), [[0, 2]]);
  });

  it("reuses the token object when its span did not move", () => {
    const next = base.slice(0, 5) + "X" + base.slice(5);
    const { tokens: kept } = reanchorTokens(base, next, tokens);
    assertEquals(kept[0], tokens[0]); // before the edit: same object reused
    assertEquals(kept[1].start, 18); // after the edit: shifted span
    assertEquals(kept[1].end, 22);
  });

  it("falls back to the token's span text when raw is absent", () => {
    const { tokens: kept, newEnd } = reanchorTokens("@a", "X@a", [{
      start: 0,
      end: 2,
    }]);
    assertEquals(spans(kept), [[1, 3]]);
    assertEquals(newEnd, 1);
  });

  it("tolerates an empty token list", () => {
    const { tokens: kept, newEnd } = reanchorTokens("abc", "abd", []);
    assertEquals(kept, []);
    assertEquals(newEnd, 3);
  });

  it("returns unchanged tokens for an unchanged string", () => {
    const { tokens: kept, newEnd } = reanchorTokens(base, base, tokens);
    assertEquals(kept, tokens);
    assertEquals(newEnd, base.length);
  });
});
