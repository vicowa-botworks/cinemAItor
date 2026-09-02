// Pure reconciliation of loaded preview object-URLs against the panels that
// currently carry a preview version. DOM-free and unit-tested (see
// frontend/tests/preview-reconcile.test.js). The storyboard component applies
// the returned plan: revoke the stale URLs, keep the matching entries, and
// fetch the missing/changed ones.

/**
 * @param {Array<{id: string, preview_asset_version_id: string|null}>} panels
 * @param {Map<string, {versionId: string|null, url: string|null}>} previous
 * @returns {{keep: Map<string, object>, fetch: string[], revoke: string[]}}
 *   keep   — panelId -> previous entry to retain (same version already loaded)
 *   fetch  — panelIds whose preview must (re)load
 *   revoke — object URLs to release (panel lost its preview, or version changed)
 */
export function reconcilePreviews(panels, previous) {
  const wanted = new Map();
  for (const panel of panels) {
    if (panel?.preview_asset_version_id) {
      wanted.set(panel.id, panel.preview_asset_version_id);
    }
  }

  const keep = new Map();
  const fetch = [];
  const revoke = [];

  for (const [panelId, entry] of previous) {
    const version = wanted.get(panelId);
    if (version === undefined) {
      // Panel no longer has a preview — release its object URL.
      if (entry.url) revoke.push(entry.url);
    } else if (entry.versionId === version) {
      // Same version is already loaded — keep it (stable <img> src, no re-fetch).
      keep.set(panelId, entry);
    } else {
      // Still previewing but a newer version — the stale URL is replaced.
      if (entry.url) revoke.push(entry.url);
    }
  }

  for (const panelId of wanted.keys()) {
    if (!keep.has(panelId)) fetch.push(panelId);
  }

  return { keep, fetch, revoke };
}
