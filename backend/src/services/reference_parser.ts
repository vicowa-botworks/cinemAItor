export interface ReferenceToken {
  raw: string;
  slug: string;
  version: number | null;
  start: number;
  end: number;
}

// A token is '@slug' optionally followed by ':v<N>' (versioned reference).
// The lookbehind rejects matches embedded in a word or after another '@'
// (so "foo@hero" and "@@hero" do not match, and emails are left alone).
const REFERENCE_RE = /(?<![a-z0-9_@])@([a-z0-9][a-z0-9_]{0,63})(?::v(\d+))?/g;

/** Extract every @reference token from prompt text, with char offsets. */
export function parseReferenceTokens(text: string): ReferenceToken[] {
  const tokens: ReferenceToken[] = [];
  REFERENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REFERENCE_RE.exec(text)) !== null) {
    const slug = match[1];
    const versionRaw = match[2];
    const start = match.index;
    const full = match[0];
    tokens.push({
      raw: full,
      slug,
      version: versionRaw !== undefined ? Number(versionRaw) : null,
      start,
      end: start + full.length,
    });
  }
  return tokens;
}
