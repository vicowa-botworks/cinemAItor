const V1_BASE = "/api/v1";
const LEGACY_BASE = "/api";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

class ApiClient {
  #token = null;

  setToken(token) {
    this.#token = token;
  }

  clearToken() {
    this.#token = null;
  }

  getToken() {
    return this.#token;
  }

  async request(path, options = {}, base = V1_BASE) {
    const headers = { ...options.headers };
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    if (this.#token) {
      headers["Authorization"] = `Bearer ${this.#token}`;
    }

    const response = await fetch(`${base}${path}`, {
      ...options,
      headers,
    });

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw new ApiError(error.error || "Request failed", response.status);
    }

    return response.json();
  }

  _query(filter = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  /**
   * Fetch a media endpoint (preview/proxy streams) and resolve it to a
   * blob: object URL plus the blob's MIME type. The caller owns the URL
   * and must call URL.revokeObjectURL() when done.
   */
  async fetchMediaUrl(v1Path) {
    const headers = {};
    if (this.#token) {
      headers["Authorization"] = `Bearer ${this.#token}`;
    }

    const response = await fetch(`${V1_BASE}${v1Path}`, { headers });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw new ApiError(error.error || "Request failed", response.status);
    }

    const blob = await response.blob();
    return { url: URL.createObjectURL(blob), type: blob.type };
  }

  // --- v1 auth ---

  bootstrap(email, password, displayName) {
    return this.request("/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name: displayName }),
    });
  }

  login(email, password) {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  logout() {
    return this.request("/auth/logout", { method: "POST" });
  }

  getMe() {
    return this.request("/auth/me");
  }

  // --- v1 projects ---

  listProjects() {
    return this.request("/projects");
  }

  getProject(id) {
    return this.request(`/projects/${encodeURIComponent(id)}`);
  }

  createProject(data) {
    return this.request("/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  updateProject(id, data) {
    return this.request(`/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteProject(id) {
    return this.request(`/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  // --- v1 assets ---

  listAssets(filter = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return this.request(`/assets${query ? `?${query}` : ""}`);
  }

  getAsset(id) {
    return this.request(`/assets/${encodeURIComponent(id)}`);
  }

  createAsset(data) {
    return this.request("/assets", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  updateAsset(id, data) {
    return this.request(`/assets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteAsset(id) {
    return this.request(`/assets/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async uploadAsset(id, file, notes) {
    const form = new FormData();
    form.append("file", file);
    if (notes) {
      form.append("notes", notes);
    }
    return this.request(`/assets/${encodeURIComponent(id)}/upload`, {
      method: "POST",
      body: form,
    });
  }

  listAssetVersions(id) {
    return this.request(`/assets/${encodeURIComponent(id)}/versions`);
  }

  restoreAssetVersion(id, versionId) {
    return this.request(
      `/assets/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: "POST" },
    );
  }

  addAssetAlias(id, aliasSlug) {
    return this.request(`/assets/${encodeURIComponent(id)}/aliases`, {
      method: "POST",
      body: JSON.stringify({ alias_slug: aliasSlug }),
    });
  }

  removeAssetAlias(id, aliasSlug) {
    return this.request(
      `/assets/${encodeURIComponent(id)}/aliases/${encodeURIComponent(aliasSlug)}`,
      { method: "DELETE" },
    );
  }

  addAssetTag(id, tag) {
    return this.request(`/assets/${encodeURIComponent(id)}/tags`, {
      method: "POST",
      body: JSON.stringify({ tag }),
    });
  }

  removeAssetTag(id, tag) {
    return this.request(`/assets/${encodeURIComponent(id)}/tags/${encodeURIComponent(tag)}`, {
      method: "DELETE",
    });
  }

  getAssetPreviewUrl(id) {
    return this.fetchMediaUrl(`/assets/${encodeURIComponent(id)}/preview`);
  }

  getAssetProxyUrl(id, versionId) {
    return this.fetchMediaUrl(
      `/assets/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/proxy`,
    );
  }

  regenerateAssetProxy(id, versionId) {
    return this.request(
      `/assets/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/proxy`,
      { method: "POST" },
    );
  }

  // --- v1 prompts ---

  savePrompt({ scope_type, scope_id, content, roles }) {
    const body = { scope_type, scope_id, content };
    if (roles) {
      body.roles = roles;
    }
    return this.request("/prompts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  listPromptVersions(scopeType, scopeId) {
    return this.request(
      `/prompts/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}`,
    );
  }

  getLatestPrompt(scopeType, scopeId) {
    return this.request(
      `/prompts/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/latest`,
    );
  }

  getPromptVersion(id) {
    return this.request(`/prompts/${encodeURIComponent(id)}`);
  }

  restorePrompt(id) {
    return this.request(`/prompts/${encodeURIComponent(id)}/restore`, {
      method: "POST",
    });
  }

  // --- v1 references ---

  parseReferences({ text, roles, persist }) {
    const body = { text };
    if (roles) {
      body.roles = roles;
    }
    if (persist) {
      body.persist = persist;
    }
    return this.request("/references/parse", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  auditReferences(filter = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return this.request(`/references/audit${query ? `?${query}` : ""}`);
  }

  replaceReference(id, { slug, version }) {
    const body = { slug };
    if (version !== undefined) {
      body.version = version;
    }
    return this.request(`/references/${encodeURIComponent(id)}/replace`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // --- v1 models ---

  listModels(filter = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return this.request(`/models${query ? `?${query}` : ""}`);
  }

  getModel(id) {
    return this.request(`/models/${encodeURIComponent(id)}`);
  }

  registerModel(data) {
    return this.request("/models", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  updateModel(id, data) {
    return this.request(`/models/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteModel(id) {
    return this.request(`/models/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  installModel(id, { consent } = {}) {
    const body = {};
    if (consent !== undefined) {
      body.consent = consent;
    }
    return this.request(`/models/${encodeURIComponent(id)}/install`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  verifyModel(id) {
    return this.request(`/models/${encodeURIComponent(id)}/verify`, {
      method: "POST",
    });
  }

  healthCheckModel(id) {
    return this.request(`/models/${encodeURIComponent(id)}/health-check`, {
      method: "POST",
    });
  }

  getModelsHardware() {
    return this.request("/models/hardware");
  }

  // --- v1 jobs ---

  listJobs(filter = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && value !== null && value !== "") {
        params.set(key, value);
      }
    }
    const query = params.toString();
    return this.request(`/jobs${query ? `?${query}` : ""}`);
  }

  getJob(id) {
    return this.request(`/jobs/${encodeURIComponent(id)}`);
  }

  cancelJob(id) {
    return this.request(`/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
  }

  retryJob(id) {
    return this.request(`/jobs/${encodeURIComponent(id)}/retry`, {
      method: "POST",
    });
  }

  listJobEvents(id) {
    return this.request(`/jobs/${encodeURIComponent(id)}/events`);
  }

  // --- v1 storyboards, panels, scenes, shots ---

  listStoryboards(filter = {}) {
    return this.request(
      `/storyboards${this._query(filter)}`,
    );
  }

  createStoryboard(data) {
    return this.request("/storyboards", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  getStoryboard(id) {
    return this.request(`/storyboards/${encodeURIComponent(id)}`);
  }

  updateStoryboard(id, data) {
    return this.request(`/storyboards/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteStoryboard(id) {
    return this.request(`/storyboards/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  listPanels(storyboardId) {
    return this.request(
      `/storyboards/${encodeURIComponent(storyboardId)}/panels`,
    );
  }

  createPanel(storyboardId, data) {
    return this.request(`/storyboards/${encodeURIComponent(storyboardId)}/panels`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  updatePanel(storyboardId, panelId, data) {
    return this.request(
      `/storyboards/${encodeURIComponent(storyboardId)}/panels/${encodeURIComponent(panelId)}`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
  }

  deletePanel(storyboardId, panelId) {
    return this.request(
      `/storyboards/${encodeURIComponent(storyboardId)}/panels/${encodeURIComponent(panelId)}`,
      { method: "DELETE" },
    );
  }

  generatePanelPreview(storyboardId, panelId, options = {}) {
    return this.request(
      `/storyboards/${encodeURIComponent(storyboardId)}/panels/${
        encodeURIComponent(panelId)
      }/generate-preview`,
      { method: "POST", body: JSON.stringify(options) },
    );
  }

  listScenes(filter = {}) {
    return this.request(`/scenes${this._query(filter)}`);
  }

  createScene(data) {
    return this.request("/scenes", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  getScene(id) {
    return this.request(`/scenes/${encodeURIComponent(id)}`);
  }

  updateScene(id, data) {
    return this.request(`/scenes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteScene(id) {
    return this.request(`/scenes/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  listShots(sceneId) {
    return this.request(`/scenes/${encodeURIComponent(sceneId)}/shots`);
  }

  createShot(sceneId, data) {
    return this.request(`/scenes/${encodeURIComponent(sceneId)}/shots`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  updateShot(sceneId, shotId, data) {
    return this.request(
      `/scenes/${encodeURIComponent(sceneId)}/shots/${encodeURIComponent(shotId)}`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
  }

  deleteShot(sceneId, shotId) {
    return this.request(
      `/scenes/${encodeURIComponent(sceneId)}/shots/${encodeURIComponent(shotId)}`,
      { method: "DELETE" },
    );
  }

  generateScene(id, options = {}) {
    return this.request(`/scenes/${encodeURIComponent(id)}/generate`, {
      method: "POST",
      body: JSON.stringify(options),
    });
  }

  batchGenerateScene(id, options = {}) {
    return this.request(`/scenes/${encodeURIComponent(id)}/batch-generate`, {
      method: "POST",
      body: JSON.stringify(options),
    });
  }

  // --- v1 review ---

  listJobCandidates(jobId) {
    return this.request(`/review/jobs/${encodeURIComponent(jobId)}/candidates`);
  }

  reviewDecision(versionId, action, notes) {
    return this.request(
      `/review/candidates/${encodeURIComponent(versionId)}/${action}`,
      { method: "POST", body: JSON.stringify(notes ? { notes } : {}) },
    );
  }

  // --- legacy demo API (kept until the legacy surface is removed) ---

  getMovies() {
    return this.request("/movies", {}, LEGACY_BASE);
  }

  getMovie(id) {
    return this.request(`/movies/${id}`, {}, LEGACY_BASE);
  }

  createMovie(data) {
    return this.request("/movies", {
      method: "POST",
      body: JSON.stringify(data),
    }, LEGACY_BASE);
  }

  updateMovie(id, data) {
    return this.request(`/movies/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }, LEGACY_BASE);
  }

  deleteMovie(id) {
    return this.request(`/movies/${id}`, {
      method: "DELETE",
    }, LEGACY_BASE);
  }

  getMovieScenes(movieId) {
    return this.request(`/movies/${movieId}/scenes`, {}, LEGACY_BASE);
  }

  createMovieScene(movieId, data) {
    return this.request(`/movies/${movieId}/scenes`, {
      method: "POST",
      body: JSON.stringify(data),
    }, LEGACY_BASE);
  }
}

export const api = new ApiClient();
export { ApiError };
