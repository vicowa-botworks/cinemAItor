import { api } from "./api.js";

const cache = new Map();

/**
 * Maps the deterministic creative-object asset slugs (panel_*, scene_*, shot_*)
 * to asset ids. Slugs are stable and the API has no by-slug lookup, so the
 * library is filtered by the slug prefix and matched exactly.
 */
export async function creativeAssetIds(prefix, { force = false } = {}) {
  let pending = cache.get(prefix);
  if (!pending || force) {
    pending = (async () => {
      const assets = await api.listAssets({ q: `${prefix}_` }).catch(() => []);
      return new Map(assets.map((a) => [a.unique_slug, a.id]));
    })();
    cache.set(prefix, pending);
  }
  return pending;
}

export function forgetCreativeAssetIds(prefix) {
  cache.delete(prefix);
}
