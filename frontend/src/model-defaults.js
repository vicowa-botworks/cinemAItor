/**
 * model-defaults — shared support for the default model per task type
 * (docs/model_defaults.md). DOM-free; unit-tested.
 *
 * The server resolves an omitted `model_id` as
 * project override > registry task-type default > first enabled model. These
 * helpers let a picker show (and pre-check for the VRAM guard) the model the
 * server will actually run, while still sending no `model_id` — so the server
 * stays the single authority, including for the project override.
 */

/**
 * The model an auto-picked request gets from a picker's candidate list: the
 * task type's default when that list contains it, otherwise the first entry
 * (the server's own fallback). `models` is expected to be the enabled models
 * supporting the task, in the server's order.
 */
export function autoModelFor(models, defaults, taskType) {
  const list = Array.isArray(models) ? models : [];
  const defaultId = typeof defaults === "object" && defaults !== null
    ? defaults[taskType]
    : undefined;
  if (typeof defaultId === "string" && defaultId !== "") {
    const match = list.find((m) => m && m.id === defaultId);
    if (match) return match;
  }
  return list[0] ?? null;
}

/** Label for the "let the server decide" option of a model picker. */
export function autoOptionLabel(model, { projectScoped = false } = {}) {
  const source = projectScoped ? "project default" : "default";
  if (model && model.name) return `Auto (${source}: ${model.name})`;
  return "Auto (first enabled)";
}

/** The task types a given model is the default for (model-manager badge). */
export function defaultTaskTypesFor(defaults, modelId) {
  if (typeof defaults !== "object" || defaults === null || !modelId) return [];
  return Object.entries(defaults)
    .filter(([, id]) => id === modelId)
    .map(([taskType]) => taskType)
    .sort();
}

/**
 * Parse a project's stored `default_model_preferences_json` into a map.
 * Anything malformed or of the wrong shape reads as no preferences — the
 * column is free-form JSON written by older clients and restore bundles.
 */
export function parseProjectPreferences(json) {
  if (!json) return {};
  let parsed;
  try {
    parsed = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out = {};
  for (const [taskType, modelId] of Object.entries(parsed)) {
    if (typeof modelId === "string" && modelId !== "") out[taskType] = modelId;
  }
  return out;
}

/**
 * The write payload for the same map: empty selections dropped (an entry set
 * to "" means "no project override"), so an all-empty form clears the column.
 */
export function projectPreferencesPayload(prefs) {
  return Object.fromEntries(
    Object.entries(prefs ?? {}).filter(([, id]) => typeof id === "string" && id !== ""),
  );
}

let cache = null;
let pending = null;

async function fetchDefaults(api) {
  try {
    const res = await api.listModelDefaults();
    const view = {
      defaults: (res && res.defaults) || {},
      models: (res && res.models) || {},
      taskTypes: Array.isArray(res && res.task_types) ? res.task_types : [],
    };
    cache = view;
    return view;
  } catch {
    // A picker with no defaults just labels its auto option "first enabled".
    return { defaults: {}, models: {}, taskTypes: [] };
  }
}

/**
 * Load the registry defaults once per page and share them across pickers.
 * A failed load is not cached (the next call retries) and never throws.
 *
 * `refresh: true` re-reads after an admin changed a default. Concurrent
 * callers share one request.
 */
export async function loadModelDefaults(api, { refresh = false } = {}) {
  if (!refresh && cache) return cache;
  if (!refresh && pending) return pending;
  const request = fetchDefaults(api);
  pending = request;
  try {
    return await request;
  } finally {
    if (pending === request) pending = null;
  }
}

/** Forget the cached defaults (a model was removed or renamed). */
export function invalidateModelDefaults() {
  cache = null;
  pending = null;
}
