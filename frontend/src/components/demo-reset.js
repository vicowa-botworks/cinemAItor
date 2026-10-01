import { DEMO_FILM } from "./demo-content.js";

/**
 * demo-reset — remove everything the full-movie demo created so a fresh demo
 * run starts clean (docs/demo.md).
 *
 * The demo's objects are a mix of project-scoped rows and GLOBAL assets with
 * no project_id (scene clips, the score, panel previews). Project deletion is
 * a soft delete that cascades nothing, so a second demo run would collide with
 * the first run's still-present global slugs. resetDemoData finds the demo
 * project by name, discovers every asset it produced (project-scoped via
 * listAssets, global via the project's generation jobs, which record their
 * asset_id), and deletes all of it in a foreign-key-safe order.
 *
 * @param {object} api - the ApiClient (the asset/timeline/creative list and delete methods).
 * @returns {Promise<{found: boolean, project_id: string|null, deleted: object, errors: string[]}>}
 */
export async function resetDemoData(api) {
  const deleted = {
    assets: 0,
    timelines: 0,
    scenes: 0,
    storyboards: 0,
    panels: 0,
    project: false,
  };
  const errors = [];
  const push = (label, err) => errors.push(`${label}: ${err?.message || err}`);

  const projects = await api.listProjects();
  const project = projects.find(
    (p) => p.display_name === DEMO_FILM.project.name,
  );
  if (!project) return { found: false, project_id: null, deleted, errors };
  const pid = project.id;

  // Discover every asset the demo created. Project-scoped assets (images, the
  // render export) come from listAssets; GLOBAL assets (clips, score, panel
  // previews) carry no project_id, so they are reached through the project's
  // generation jobs — each records the asset it produced in asset_id.
  const assetIds = new Set();
  try {
    for (const a of await api.listAssets({ project_id: pid })) {
      assetIds.add(a.id);
    }
  } catch (e) {
    push("listAssets", e);
  }
  try {
    for (const j of await api.listJobs({ project_id: pid })) {
      if (j.asset_id) assetIds.add(j.asset_id);
    }
  } catch (e) {
    push("listJobs", e);
  }

  // Delete referencing rows first (timelines, scenes, panels), then the assets
  // (a soft delete frees their slugs for the next run), then the project last.
  // The hard deletes (timeline/scene/panel) cascade their children; the asset
  // soft delete has no 409, so its order relative to the rest is free.
  const bulk = async (label, pairs) => {
    const results = await Promise.allSettled(pairs);
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") deleted[label] += 1;
      else push(`${label}[${pairs[i][0]}]`, r.reason);
    }
  };

  let timelines = [];
  try {
    timelines = await api.listTimelines({ project_id: pid });
  } catch (e) {
    push("listTimelines", e);
  }
  await bulk(
    "timelines",
    timelines.map((t) => [t.id, api.deleteTimeline(t.id)]),
  );

  let scenes = [];
  try {
    scenes = await api.listScenes({ project_id: pid });
  } catch (e) {
    push("listScenes", e);
  }
  await bulk("scenes", scenes.map((s) => [s.id, api.deleteScene(s.id)]));

  let storyboards = [];
  try {
    storyboards = await api.listStoryboards({ project_id: pid });
  } catch (e) {
    push("listStoryboards", e);
  }
  for (const sb of storyboards) {
    let panels = [];
    try {
      panels = await api.listPanels(sb.id);
    } catch (e) {
      push(`listPanels(${sb.id})`, e);
    }
    await bulk(
      "panels",
      panels.map((p) => [p.id, api.deletePanel(sb.id, p.id)]),
    );
    try {
      await api.deleteStoryboard(sb.id);
      deleted.storyboards += 1;
    } catch (e) {
      push(`deleteStoryboard(${sb.id})`, e);
    }
  }

  await bulk(
    "assets",
    [...assetIds].map((id) => [id, api.deleteAsset(id)]),
  );

  try {
    await api.deleteProject(pid);
    deleted.project = true;
  } catch (e) {
    push("deleteProject", e);
  }

  return { found: true, project_id: pid, deleted, errors };
}
