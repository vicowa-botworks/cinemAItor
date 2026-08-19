import { join } from "@std/path";
import { badRequest } from "@cinemaItor/errors.ts";
import { sha256File } from "./checksums.ts";
import { contentAddressedPath, ensureLayout, type StorageLayout } from "./paths.ts";

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
      const existingPath = findStoredPath(this.layout, hash) ??
        (fileExists(contentAddressedPath(this.layout, hash, ext))
          ? contentAddressedPath(this.layout, hash, ext)
          : undefined);
      if (existingPath) {
        return {
          hash,
          path: existingPath,
          size: stat.size,
          filename,
          reused: true,
        };
      }

      const finalPath = contentAddressedPath(this.layout, hash, ext);
      await Deno.mkdir(join(layoutMediaDir(this.layout, hash)), {
        recursive: true,
      });
      // An atomic move on the same filesystem, so no partial files can be
      // observed.
      await Deno.rename(tempPath, finalPath);
      return {
        hash,
        path: finalPath,
        size: stat.size,
        filename,
        reused: false,
      };
    } finally {
      await Deno.remove(tempPath).catch(() => {});
    }
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
