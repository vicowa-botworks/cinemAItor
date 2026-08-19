import { join } from "@std/path";

export interface StorageLayout {
  root: string;
  media: string;
  previews: string;
  proxies: string;
  thumbnails: string;
  models: string;
  renders: string;
  logs: string;
  cache: string;
}

export function storageLayout(root: string): StorageLayout {
  return {
    root,
    media: join(root, "media"),
    previews: join(root, "previews"),
    proxies: join(root, "proxies"),
    thumbnails: join(root, "thumbnails"),
    models: join(root, "models"),
    renders: join(root, "renders"),
    logs: join(root, "logs"),
    cache: join(root, "cache"),
  };
}

export function ensureLayout(root: string): StorageLayout {
  const layout = storageLayout(root);
  for (
    const dir of [
      layout.root,
      layout.media,
      layout.previews,
      layout.proxies,
      layout.thumbnails,
      layout.models,
      layout.renders,
      layout.logs,
      layout.cache,
    ]
  ) {
    Deno.mkdirSync(dir, { recursive: true });
  }
  return layout;
}

/**
 * Content-addressed path for a file: media/<sha256:0:2>/<sha256:2:4>/<sha256>.<ext>
 */
export function contentAddressedPath(
  layout: StorageLayout,
  hash: string,
  ext: string,
): string {
  const cleanExt = ext.replace(/^\./, "");
  const fileBase = cleanExt ? `${hash}.${cleanExt}` : hash;
  return join(layout.media, hash.slice(0, 2), hash.slice(2, 4), fileBase);
}
