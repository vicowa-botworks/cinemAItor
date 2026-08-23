const V1_BASE = "/api/v1";

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
    if (
      options.body !== undefined &&
      !(options.body instanceof FormData) &&
      !(options.body instanceof Blob)
    ) {
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

  listTemplates() {
    return this.request("/templates");
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

  getAssetDependencies(id) {
    return this.request(`/assets/${encodeURIComponent(id)}/dependencies`);
  }

  async uploadAsset(id, file, notes) {
    // Raw-bytes streaming upload: the file IS the request body (nothing is
    // buffered server-side). Metadata travels percent-encoded in headers.
    const headers = {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name ?? "upload.bin"),
    };
    if (notes) {
      headers["X-Upload-Notes"] = encodeURIComponent(notes);
    }
    return this.request(`/assets/${encodeURIComponent(id)}/upload`, {
      method: "POST",
      body: file,
      headers,
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

  getAssetVersionPreviewUrl(id, versionId) {
    return this.fetchMediaUrl(
      `/assets/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/preview`,
    );
  }

  /**
   * Fetch a version thumbnail (server-generated JPEG: one frame at `at`
   * seconds, scaled to `width` px) and resolve it to a blob: URL. `at` is
   * quantized to 100 ms to match the server cache key. The caller owns the
   * URL and must revoke it when done.
   */
  getAssetThumbnailUrl(id, versionId, at = 0, width = 320) {
    const safeAt = Math.max(0, Number(at) || 0);
    const params = new URLSearchParams({
      at: safeAt.toFixed(1),
      w: String(Math.round(width)),
    });
    return this.fetchMediaUrl(
      `/assets/${encodeURIComponent(id)}/versions/${
        encodeURIComponent(versionId)
      }/thumbnail?${params}`,
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

  requestModelBenchmark(id) {
    return this.request(`/models/${encodeURIComponent(id)}/benchmark`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  getModelBenchmarks(id) {
    return this.request(`/models/${encodeURIComponent(id)}/benchmarks`);
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

  // --- v1 timelines ---

  listTimelines(filter = {}) {
    return this.request(`/timelines${this._query(filter)}`);
  }

  createTimeline(data) {
    return this.request("/timelines", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  getTimeline(id) {
    return this.request(`/timelines/${encodeURIComponent(id)}`);
  }

  updateTimeline(id, data) {
    return this.request(`/timelines/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteTimeline(id) {
    return this.request(`/timelines/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  createTimelineTrack(timelineId, data) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/tracks`,
      { method: "POST", body: JSON.stringify(data) },
    );
  }

  updateTimelineTrack(timelineId, trackId, data) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/tracks/${
        encodeURIComponent(
          trackId,
        )
      }`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
  }

  deleteTimelineTrack(timelineId, trackId) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/tracks/${
        encodeURIComponent(
          trackId,
        )
      }`,
      { method: "DELETE" },
    );
  }

  createTimelineItem(timelineId, data) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/items`,
      { method: "POST", body: JSON.stringify(data) },
    );
  }

  updateTimelineItem(timelineId, itemId, data) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/items/${
        encodeURIComponent(
          itemId,
        )
      }`,
      { method: "PATCH", body: JSON.stringify(data) },
    );
  }

  duplicateTimelineItem(timelineId, itemId, atTime) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/items/${
        encodeURIComponent(
          itemId,
        )
      }/duplicate`,
      {
        method: "POST",
        body: JSON.stringify(atTime !== undefined ? { at_time: atTime } : {}),
      },
    );
  }

  deleteTimelineItem(timelineId, itemId) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/items/${
        encodeURIComponent(
          itemId,
        )
      }`,
      { method: "DELETE" },
    );
  }

  createTimelineMarker(timelineId, data) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/markers`,
      { method: "POST", body: JSON.stringify(data) },
    );
  }

  listTimelineMarkers(timelineId) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/markers`,
    );
  }

  deleteTimelineMarker(timelineId, markerId) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/markers/${
        encodeURIComponent(
          markerId,
        )
      }`,
      { method: "DELETE" },
    );
  }

  createTimelineSnapshot(timelineId, data) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/snapshots`,
      { method: "POST", body: JSON.stringify(data) },
    );
  }

  listTimelineSnapshots(timelineId) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/snapshots`,
    );
  }

  restoreTimelineState(timelineId, state) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/state`,
      { method: "POST", body: JSON.stringify(state) },
    );
  }

  restoreTimelineSnapshot(timelineId, snapshotId) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/snapshots/${
        encodeURIComponent(
          snapshotId,
        )
      }/restore`,
      { method: "POST" },
    );
  }

  // --- v1 renders / exports ---

  listRenderPresets() {
    return this.request("/render-presets");
  }

  createRenderPreset(data) {
    return this.request("/render-presets", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  queueRender({ project_id, timeline_id, preset_id }) {
    return this.request("/renders", {
      method: "POST",
      body: JSON.stringify({ project_id, timeline_id, preset_id }),
    });
  }

  getRenderJob(id) {
    return this.request(`/renders/${encodeURIComponent(id)}`);
  }

  getRenderJobLog(id) {
    return this.request(`/renders/${encodeURIComponent(id)}/log`);
  }

  cancelRenderJob(id) {
    return this.request(`/renders/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
  }

  listExports(filter = {}) {
    return this.request(`/exports${this._query(filter)}`);
  }

  // --- audio (generation, waveform) ---

  generateAudio(options) {
    return this.request("/audio/generate", {
      method: "POST",
      body: JSON.stringify(options),
    });
  }

  listAudioAssets(filter = {}) {
    return this.request(`/audio/assets${this._query(filter)}`);
  }

  getAudioWaveform(assetId, versionId) {
    return this.request(
      `/audio/assets/${encodeURIComponent(assetId)}/versions/${
        encodeURIComponent(versionId)
      }/waveform`,
    );
  }

  updateAudioAdjustments(assetId, versionId, adjustments) {
    return this.request(
      `/audio/assets/${encodeURIComponent(assetId)}/versions/${
        encodeURIComponent(versionId)
      }/adjustments`,
      {
        method: "PATCH",
        body: JSON.stringify(adjustments),
      },
    );
  }

  cleanupAudioVersion(assetId, versionId, operations) {
    return this.request(
      `/audio/assets/${encodeURIComponent(assetId)}/versions/${
        encodeURIComponent(versionId)
      }/cleanup`,
      {
        method: "POST",
        body: JSON.stringify(operations),
      },
    );
  }

  generateSubtitles(assetId, versionId, options = {}) {
    return this.request(
      `/audio/assets/${encodeURIComponent(assetId)}/versions/${
        encodeURIComponent(versionId)
      }/subtitles`,
      {
        method: "POST",
        body: JSON.stringify(options),
      },
    );
  }

  // --- diagnostics / ops ---

  getDiagnosticsHardware() {
    return this.request("/diagnostics/hardware");
  }

  getDiagnosticsModels() {
    return this.request("/diagnostics/models");
  }

  getDiagnosticsStorage({ verify = false } = {}) {
    return this.request(`/diagnostics/storage${this._query({ verify: verify ? 1 : undefined })}`);
  }

  cleanupStorageCache({ includeOrphanedMedia = false } = {}) {
    return this.request("/diagnostics/storage/cleanup", {
      method: "POST",
      body: JSON.stringify({ include_orphaned_media: includeOrphanedMedia }),
    });
  }

  getDiagnosticsLogs(filter = {}) {
    return this.request(`/diagnostics/logs${this._query(filter)}`);
  }

  exportDiagnostics() {
    return this.request("/diagnostics/export", { method: "POST" });
  }

  createProjectBackup(projectId) {
    return this.request("/diagnostics/backups", {
      method: "POST",
      body: JSON.stringify({ project_id: projectId }),
    });
  }

  // --- Skills ---------------------------------------------------------------

  listSkills() {
    return this.request("/skills");
  }

  getSkill(id) {
    return this.request(`/skills/${encodeURIComponent(id)}`);
  }

  createSkill(id, definition) {
    return this.request("/skills", {
      method: "POST",
      body: JSON.stringify({ id, definition }),
    });
  }

  updateSkill(id, definition) {
    return this.request(`/skills/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ definition }),
    });
  }

  toggleSkill(id, enabled) {
    return this.request(`/skills/${encodeURIComponent(id)}/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
  }

  deleteSkill(id) {
    return this.request(`/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  listSkillVersions(id) {
    return this.request(`/skills/${encodeURIComponent(id)}/versions`);
  }

  runSkill(id, { projectId, inputs } = {}) {
    return this.request(`/skills/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: JSON.stringify({
        project_id: projectId,
        inputs: inputs ?? {},
      }),
    });
  }

  listSkillRuns(id, { projectId } = {}) {
    return this.request(
      `/skills/${encodeURIComponent(id)}/runs${
        this._query(projectId ? { project_id: projectId } : {})
      }`,
    );
  }

  getSkillRun(id, runId) {
    return this.request(
      `/skills/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}`,
    );
  }

  listBackups() {
    return this.request("/diagnostics/backups");
  }

  restoreBackup(backupId, projectName) {
    return this.request(
      `/diagnostics/backups/${encodeURIComponent(backupId)}/restore`,
      {
        method: "POST",
        body: JSON.stringify(projectName ? { project_name: projectName } : {}),
      },
    );
  }

  deleteBackup(backupId) {
    return this.request(
      `/diagnostics/backups/${encodeURIComponent(backupId)}`,
      { method: "DELETE" },
    );
  }
}

export const api = new ApiClient();
export { ApiError };
