import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { parseReferenceTokens } from "../src/services/reference_parser.ts";

function slugs(text: string): string[] {
  return parseReferenceTokens(text).map((t) => t.slug);
}

describe("reference parser", () => {
  it("finds a single reference", () => {
    const tokens = parseReferenceTokens("the @hero walks alone");
    assertEquals(tokens.length, 1);
    assertEquals(tokens[0].slug, "hero");
    assertEquals(tokens[0].version, null);
    assertEquals(tokens[0].raw, "@hero");
    assertEquals(tokens[0].start, 4);
    assertEquals(tokens[0].end, 9);
  });

  it("finds multiple references in order", () => {
    assertEquals(slugs("@hero enters @room and grabs @table"), [
      "hero",
      "room",
      "table",
    ]);
  });

  it("supports versioned syntax", () => {
    const tokens = parseReferenceTokens("@hero:v2 and @room:v10");
    assertEquals(tokens.length, 2);
    assertEquals(tokens[0].slug, "hero");
    assertEquals(tokens[0].version, 2);
    assertEquals(tokens[0].raw, "@hero:v2");
    assertEquals(tokens[1].version, 10);
  });

  it("does not match tokens embedded in words or emails", () => {
    assertEquals(slugs("foo@hero is not a token"), []);
    assertEquals(slugs("email bob@example.com here"), []);
    assertEquals(slugs("@@hero double at"), []);
  });

  it("does not match upper-case slugs", () => {
    assertEquals(slugs("@HERO no"), []);
    assertEquals(slugs("@hero-x hyphens are not allowed"), ["hero"]);
  });

  it("keeps surrounding punctuation intact", () => {
    assertEquals(slugs("@hero) [room]"), ["hero"]);
    const inParens = parseReferenceTokens("(@hero)");
    assertEquals(inParens[0].slug, "hero");
    assertEquals(inParens[0].start, 1);
    assertEquals(inParens[0].end, 6);
  });

  it("returns no tokens for plain text", () => {
    assertEquals(parseReferenceTokens("hello world, no tokens"), []);
    assertEquals(parseReferenceTokens("@"), []);
    assertEquals(parseReferenceTokens(""), []);
  });

  it("handles slugs with digits and underscores", () => {
    assertEquals(slugs("@a_1 and @b2_c3"), ["a_1", "b2_c3"]);
  });
});
