import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { replaceReferenceToken } from "../src/reference-repair.js";

describe("replaceReferenceToken", () => {
  it("replaces a plain token mid-text", () => {
    const text = "cut to @deadslug and hold";
    const token = { start: text.indexOf("@deadslug"), end: text.indexOf("@deadslug") + 9 };
    const result = replaceReferenceToken(text, token, "hero");
    assertEquals(result.text, "cut to @hero and hold");
    assertEquals(result.oldText, "@deadslug");
    assertEquals(result.newText, "@hero");
  });

  it("drops the version suffix, targeting the replacement's active version", () => {
    const text = "open on @deadslug:v3 at dawn";
    const token = { start: text.indexOf("@deadslug"), end: text.length - 8 };
    const result = replaceReferenceToken(text, token, "hero_take2");
    assertEquals(result.text, "open on @hero_take2 at dawn");
    assertEquals(result.oldText, "@deadslug:v3");
  });

  it("handles a token at the very start of the text", () => {
    const result = replaceReferenceToken("@gone walks", { start: 0, end: 5 }, "hero");
    assertEquals(result.text, "@hero walks");
  });

  it("handles a token at the very end of the text", () => {
    const text = "fade out on @gone";
    const result = replaceReferenceToken(text, { start: 12, end: 17 }, "hero");
    assertEquals(result.text, "fade out on @hero");
  });

  it("leaves other occurrences of the same slug untouched", () => {
    const text = "@deadslug opens; @deadslug closes";
    const first = { start: 0, end: 9 };
    const result = replaceReferenceToken(text, first, "a");
    assertEquals(result.text, "@a opens; @deadslug closes");
    // Repairing the second occurrence uses its own span.
    const secondText = result.text;
    const second = {
      start: secondText.indexOf("@deadslug"),
      end: secondText.indexOf("@deadslug") + 9,
    };
    assertEquals(replaceReferenceToken(secondText, second, "b").text, "@a opens; @b closes");
  });

  it("never mutates unrelated text around the span", () => {
    const text = "keep @dead and @fine intact";
    const token = { start: 5, end: 10 };
    const result = replaceReferenceToken(text, token, "replacement");
    assertEquals(result.text, "keep @replacement and @fine intact");
  });

  it("rejects a token span out of range", () => {
    assertThrows(
      () => replaceReferenceToken("abc", { start: 1, end: 99 }, "x"),
      Error,
      "out of range",
    );
    assertThrows(
      () => replaceReferenceToken("abc", { start: -1, end: 2 }, "x"),
      Error,
      "out of range",
    );
    assertThrows(
      () => replaceReferenceToken("abc", { start: 2, end: 2 }, "x"),
      Error,
      "out of range",
    );
  });

  it("rejects malformed tokens and slugs", () => {
    assertThrows(() => replaceReferenceToken("abc", null, "x"), Error, "start/end");
    assertThrows(
      () => replaceReferenceToken("abc", { start: 0.5, end: 2 }, "x"),
      Error,
      "start/end",
    );
    assertThrows(() => replaceReferenceToken("abc", { start: 0, end: 1 }, ""), Error, "newSlug");
    assertThrows(
      () => replaceReferenceToken("abc", { start: 0, end: 1 }, undefined),
      Error,
      "newSlug",
    );
    assertThrows(() => replaceReferenceToken(null, { start: 0, end: 1 }, "x"), Error, "text");
  });

  it("never mutates the input text string", () => {
    const text = "@gone @fine";
    replaceReferenceToken(text, { start: 0, end: 5 }, "hero");
    assertEquals(text, "@gone @fine");
  });
});
