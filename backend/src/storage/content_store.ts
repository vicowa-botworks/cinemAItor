import { join } from "@std/path";
import { badRequest } from "@cinemaItor/errors.ts";
import { loadConfig } from "@cinemaItor/config.ts";
import { Sha256, sha256File } from "./checksums.ts";
import { contentAddressedPath, ensureLayout, type StorageLayout } from "./paths.ts";

let sharedStore: ContentStore | undefined;

/** Process-wide store rooted at the configured app data directory. */
export function getContentStore(): ContentStore {
  if (!sharedStore) {
    sharedStore = new ContentStore(loadConfig().appDataDir);
  }
  return sharedStore;
}

/** Tests only: drop the shared store so the next use picks up new config. */
export function resetContentStore(): void {
  sharedStore = undefined;
}

export interface StoredFile {
  hash: string;
  path: string;
  size: number;
  filename: string;
  reused: boolean;
}

export class ContentStore {
  #layout: StorageLayout;

  constructor(appDataDir: string) {
    this.#layout = ensureLayout(appDataDir);
  }

  get layout(): StorageLayout {
    return this.#layout;
  }

  /** Absolute path for a stored content hash, or undefined if absent. */
  resolve(hash: string): string | undefined {
    if (!/^[0-9a-f]{64}$/.test(hash)) return undefined;
    return findStoredPath(this.#layout, hash);
  }

  /**
   * Like resolve(), but also verifies the file is actually on disk. Returns
   * the stored path, or undefined when the content is missing.
   */
  resolveExisting(hash: string): string | undefined {
    const path = this.resolve(hash);
    if (!path) return undefined;
    try {
      return Deno.statSync(path).isFile ? path : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Store a file by content. The file is streamed to a temp location within
   * the media root, hashed, then atomically renamed into the content tree.
   * If the content is already stored, the existing file is reused.
   */
  async put(sourcePath: string, filename: string): Promise<StoredFile> {
    const stat = await Deno.stat(sourcePath);
    if (!stat.isFile) {
      throw badRequest("Source is not a file");
    }

    const ext = extensionOf(filename);
    const tempPath = join(
      this.#layout.media,
      `.tmp-${crypto.randomUUID()}`,
    );
    try {
      await copyFileSafe(sourcePath, tempPath);
      const hash = await sha256File(tempPath);
      return this.#finalize(tempPath, hash, stat.size, filename, ext);
    } finally {
      await Deno.remove(tempPath).catch(() => {});
    }
  }

  /**
   * Store a file streamed from a request body (chunked, constant memory).
   * Bytes are written to a temp file in the media root while the SHA-256 is
   * updated incrementally; nothing larger than a single chunk is ever held
   * in memory. Enforces maxBytes on the streamed size (independent of any
   * declared Content-Length) and rejects empty uploads.
   */
  async putStream(
    source: ReadableStream<Uint8Array>,
    filename: string,
    maxBytes: number,
  ): Promise<StoredFile> {
    const ext = extensionOf(filename);
    const tempPath = join(
      this.#layout.media,
      `.tmp-upload-${crypto.randomUUID()}`,
    );
    const stream = new Sha256();
    let total = 0;
    try {
      const file = await Deno.open(tempPath, { write: true, create: true });
      const reader = source.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.length === 0) continue;
          total += value.length;
          if (total > maxBytes) {
            throw badRequest(
              `Upload exceeds the maximum size of ${maxBytes} bytes`,
            );
          }
          stream.update(value);
          await file.write(value);
        }
      } finally {
        reader.releaseLock();
        file.close();
      }
      if (total === 0) throw badRequest("file is required");
      return this.#finalize(tempPath, stream.digestHex(), total, filename, ext);
    } finally {
      await Deno.remove(tempPath).catch(() => {});
    }
  }

  #finalize(
    tempPath: string,
    hash: string,
    size: number,
    filename: string,
    ext: string,
  ): StoredFile {
    const existingPath = findStoredPath(this.layout, hash) ??
      (fileExists(contentAddressedPath(this.layout, hash, ext))
        ? contentAddressedPath(this.layout, hash, ext)
        : undefined);
    if (existingPath) {
      return {
        hash,
        path: existingPath,
        size,
        filename,
        reused: true,
      };
    }

    const finalPath = contentAddressedPath(this.layout, hash, ext);
    Deno.mkdirSync(join(layoutMediaDir(this.layout, hash)), { recursive: true });
    // An atomic move on the same filesystem, so no partial files can be
    // observed.
    Deno.renameSync(tempPath, finalPath);
    return {
      hash,
      path: finalPath,
      size,
      filename,
      reused: false,
    };
  }
}

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0 || idx === filename.length - 1) return "";
  return filename.slice(idx + 1).toLowerCase();
}

function fileExists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

function copyFileSafe(sourcePath: string, destinationPath: string): Promise<void> {
  return Deno.copyFile(sourcePath, destinationPath);
}

function layoutMediaDir(layout: StorageLayout, hash: string): string {
  return join(layout.media, hash.slice(0, 2), hash.slice(2, 4));
}

function findStoredPath(
  layout: StorageLayout,
  hash: string,
): string | undefined {
  try {
    const entries = Array.from(Deno.readDirSync(layoutMediaDir(layout, hash)));
    const match = entries.find((e) => e.isFile && e.name.startsWith(hash));
    return match ? join(layoutMediaDir(layout, hash), match.name) : undefined;
  } catch {
    return undefined;
  }
}
