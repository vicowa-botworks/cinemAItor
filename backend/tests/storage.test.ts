import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ContentStore } from "../src/storage/content_store.ts";
import { sha256Bytes, sha256File } from "../src/storage/checksums.ts";
import { contentAddressedPath } from "../src/storage/paths.ts";

const KNOWN_SHA256 =
  // SHA-256 of the empty string
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ABC_SHA256 =
  // SHA-256 of "abc"
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("checksums", () => {
  it("matches known SHA-256 vectors", async () => {
    assertEquals(await sha256Bytes(new Uint8Array([])), KNOWN_SHA256);
    assertEquals(
      await sha256Bytes(new TextEncoder().encode("abc")),
      ABC_SHA256,
    );
    // FIPS 180-4 two-block test vector
    assertEquals(
      await sha256Bytes(
        new TextEncoder().encode(
          "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
        ),
      ),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("produces the same hash chunked", async () => {
    const data = new TextEncoder().encode(
      "The quick brown fox jumps over the lazy dog",
    );

    // Hash a file that exercises multi-chunk reads (4MiB chunks).
    const big = new Uint8Array(4 * 1024 * 1024 + 123);
    big.set(data, 0);
    const tmp = await Deno.makeTempFile();
    await Deno.writeFile(tmp, big);
    try {
      assertEquals(await sha256File(tmp), await sha256Bytes(big));
    } finally {
      await Deno.remove(tmp);
    }
  });
});

describe("content store", () => {
  let dir: string;
  let store: ContentStore;

  beforeEach(async () => {
    dir = await Deno.makeTempDir({ prefix: "cinemaitor-test-" });
    store = new ContentStore(dir);
  });

  afterEach(async () => {
    await Deno.remove(dir, { recursive: true });
  });

  it("stores files content-addressed", async () => {
    const src = join(dir, "upload", "person.png");
    await Deno.mkdir(join(dir, "upload"), { recursive: true });
    await Deno.writeTextFile(src, "person-image-bytes");

    const stored = await store.put(src, "person.png");
    const expectedHash = await sha256Bytes(
      new TextEncoder().encode("person-image-bytes"),
    );
    assertEquals(stored.hash, expectedHash);
    assertEquals(
      stored.path,
      contentAddressedPath(store.layout, stored.hash, "png"),
    );
    assertEquals(stored.reused, false);
    assert((await Deno.stat(stored.path)).isFile);
    assertEquals(await Deno.readTextFile(stored.path), "person-image-bytes");
  });

  it("dedupes identical content", async () => {
    const a = join(dir, "a.bin");
    const b = join(dir, "b.bin");
    await Deno.writeTextFile(a, "same-content");
    await Deno.writeTextFile(b, "same-content");

    const first = await store.put(a, "a.bin");
    const second = await store.put(b, "b.bin");
    assertEquals(first.hash, second.hash);
    assertEquals(second.reused, true);
    assertEquals(first.path, second.path);

    const shard = join(
      store.layout.media,
      first.hash.slice(0, 2),
      first.hash.slice(2, 4),
    );
    const entries = Array.from(Deno.readDirSync(shard));
    assertEquals(entries.length, 1, "duplicate content must be stored once");
  });

  it("resolves stored hashes", async () => {
    const a = join(dir, "c.mp4");
    await Deno.writeTextFile(a, "video-bytes");
    const stored = await store.put(a, "video.mp4");
    assertEquals(store.resolve(stored.hash), stored.path);
    assertEquals(store.resolve("zz"), undefined);
    assertEquals(
      store.resolve("0".repeat(64)),
      undefined,
      "unknown valid-length hash resolves to undefined",
    );
  });

  it("leaves no temp files behind", async () => {
    const a = join(dir, "d.txt");
    await Deno.writeTextFile(a, "temp-check");
    await store.put(a, "d.txt");
    const leftovers = Array.from(Deno.readDirSync(store.layout.media)).filter(
      (e) => e.name.startsWith(".tmp-"),
    );
    assertEquals(leftovers.length, 0);
  });

  it("rejects non-file sources", async () => {
    const dirSource = join(dir, "subdir");
    await Deno.mkdir(dirSource, { recursive: true });
    await assertRejectsPut(store, dirSource, "x.txt");
  });
});

async function assertRejectsPut(
  store: ContentStore,
  path: string,
  name: string,
) {
  let threw = false;
  try {
    await store.put(path, name);
  } catch {
    threw = true;
  }
  assert(threw, "put() should reject non-file sources");
}
