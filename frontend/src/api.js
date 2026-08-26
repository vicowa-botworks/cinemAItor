const V1_BASE = "/api/v1";

// A dead or restarting server must never hang the UI forever: requests
// abort when no response arrives in time. Endpoints that are legitimately
// long (synchronous model downloads, raw uploads, LLM loops, backups,
// media streams) override this via `timeoutMs`; `timeoutMs: 0` disables
// the timeout entirely.
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const UPLOAD_TIMEOUT_MS = 30 * 60_000;
const MEDIA_TIMEOUT_MS = 5 * 60_000;
const LONG_TASK_TIMEOUT_MS = 15 * 60_000;

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code || null;
  }
}

// The backend sends `{error: {code, message, details?, traceId}}`; older
// shapes carry a plain string. Extract both the human message and the code.
function extractApiError(body, fallbackMessage) {
  const detail = body && body.error !== undefined ? body.error : body;
  const message = typeof detail === "string"
    ? detail
    : (detail && detail.message) || fallbackMessage;
  const code = detail && typeof detail === "object" && detail.code ? detail.code : null;
  return { message, code };
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
    const { timeoutMs, ...fetchOptions } = options;
    if (
      fetchOptions.body !== undefined &&
      !(fetchOptions.body instanceof FormData) &&
      !(fetchOptions.body instanceof Blob)
    ) {
      headers["Content-Type"] = "application/json";
    }

    if (this.#token) {
      headers["Authorization"] = `Bearer ${this.#token}`;
    }

    const response = await this.#fetchWithTimeout(
      `${base}${path}`,
      { ...fetchOptions, headers },
      timeoutMs,
    );

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      const { message, code } = extractApiError(
        error,
        response.statusText || "Request failed",
      );
      throw new ApiError(message, response.status, code);
    }

    return response.json();
  }

  #fetchWithTimeout(url, options, timeoutMs) {
    const timeout = timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!timeout || options.signal) {
      return fetch(url, options);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer))
      .catch((error) => {
        if (error && error.name === "AbortError") {
          throw new ApiError(
            `Request timed out after ${Math.round(timeout / 1000)}s without a response. ` +
              "The server may be restarting — refresh and try again.",
            0,
            "TIMEOUT",
          );
        }
        throw error;
      });
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

    const response = await this.#fetchWithTimeout(
      `${V1_BASE}${v1Path}`,
      { headers },
      MEDIA_TIMEOUT_MS,
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      const { message, code } = extractApiError(
        error,
        response.statusText || "Request failed",
      );
      throw new ApiError(message, response.status, code);
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

  getAuthSetupStatus() {
    return this.request("/auth/setup-status");
  }

  changePassword(currentPassword, newPassword) {
    return this.request("/auth/password", {
      method: "PUT",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
  }

  // Self-registration (legacy base path: /api, not /api/v1)
  register(email, password, displayName) {
    return this.request(
      "/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ email, password, display_name: displayName }),
      },
      "/api",
    );
  }

  requestPasswordReset(email) {
    return this.request("/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  confirmPasswordReset(token, newPassword) {
    return this.request("/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, new_password: newPassword }),
    });
  }

  confirmEmail(token) {
    return this.request("/auth/email-confirmation/confirm", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  resendEmailConfirmation(email) {
    return this.request("/auth/email-confirmation/resend", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  // --- v1 invitations (admin) ---

  listInvitations() {
    return this.request("/invitations");
  }

  createInvitation(data) {
    return this.request("/invitations", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  revokeInvitation(id) {
    return this.request(`/invitations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  acceptInvitation(token, password, displayName) {
    return this.request("/invitations/accept", {
      method: "POST",
      body: JSON.stringify({ token, password, display_name: displayName }),
    });
  }

  // --- v1 email/SMTP settings (admin) ---

  getEmailSettings() {
    return this.request("/users/settings/email");
  }

  updateEmailSettings(data) {
    return this.request("/users/settings/email", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  sendEmailTest(to) {
    return this.request("/users/settings/email/test", {
      method: "POST",
      body: JSON.stringify({ to: to || null }),
    });
  }

  // --- v1 user management (admin) ---

  listUsers() {
    return this.request("/users");
  }

  createUser(data) {
    return this.request("/users", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  updateUser(id, data) {
    return this.request(`/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  deleteUser(id) {
    return this.request(`/users/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  getUserSettings() {
    return this.request("/users/settings");
  }

  updateUserSettings(data) {
    return this.request("/users/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
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

  /**
   * Queue prompt-based generation of a NEW asset (image or video).
   * `references` is an optional array of { asset_id, version_number? }
   * image/video versions that upgrade the task to image_to_image /
   * image_to_video.
   * @param {object} data
   * @param {"image"|"video"} data.kind
   * @param {string} data.prompt
   * @param {string} data.unique_slug
   * @param {object} [data.references]
   * @returns {Promise<{job_id: string, job_type: string, asset_id: string, model_id: string}>}
   */
  generateAsset(data) {
    return this.request("/assets/generate", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /**
   * Queue prompt-based generation/edit of an EXISTING asset. Candidates are
   * stored as new versions of the asset.
   * @param {string} id
   * @param {object} data
   * @param {"image"|"video"} data.kind
   * @param {string} data.prompt
   * @param {boolean} [data.include_current]
   * @param {object} [data.references]
   * @returns {Promise<{job_id: string, job_type: string, asset_id: string, model_id: string}>}
   */
  editAssetGeneration(id, data) {
    return this.request(`/assets/${encodeURIComponent(id)}/generate`, {
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

  async uploadAsset(id, file, notes, metadata) {
    // Raw-bytes streaming upload: the file IS the request body (nothing is
    // buffered server-side). Metadata travels percent-encoded in headers.
    const headers = {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name ?? "upload.bin"),
    };
    if (notes) {
      headers["X-Upload-Notes"] = encodeURIComponent(notes);
    }
    if (metadata !== undefined) {
      headers["X-Technical-Metadata"] = encodeURIComponent(
        JSON.stringify(metadata),
      );
    }
    return this.request(`/assets/${encodeURIComponent(id)}/upload`, {
      method: "POST",
      body: file,
      headers,
      timeoutMs: UPLOAD_TIMEOUT_MS,
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
    // Synchronous download — can run for hours on big weights; no timeout.
    return this.request(`/models/${encodeURIComponent(id)}/install`, {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: 0,
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

  // --- v1 llm ---

  getLlmSettings() {
    return this.request("/llm/settings");
  }

  updateLlmSettings(update) {
    return this.request("/llm/settings", {
      method: "PUT",
      body: JSON.stringify(update),
    });
  }

  getLlmStatus() {
    return this.request("/llm/status");
  }

  testLlm() {
    return this.request("/llm/test", {
      method: "POST",
      body: JSON.stringify({}),
      timeoutMs: LONG_TASK_TIMEOUT_MS,
    });
  }

  llmChat(messages, extra = {}) {
    return this.request("/llm/chat", {
      method: "POST",
      body: JSON.stringify({ messages, ...extra }),
      timeoutMs: LONG_TASK_TIMEOUT_MS,
    });
  }

  assistLlm({ purpose, context, model_id: modelId, skill_id: skillId, max_tokens: maxTokens }) {
    const body = { purpose, context };
    if (modelId) body.model_id = modelId;
    if (skillId) body.skill_id = skillId;
    if (maxTokens !== undefined && maxTokens !== null) body.max_tokens = maxTokens;
    return this.request("/llm/assist", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: LONG_TASK_TIMEOUT_MS,
    });
  }

  llmAgent(history, model) {
    const body = { history };
    if (model) body.model = model;
    return this.request("/llm/agent", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: LONG_TASK_TIMEOUT_MS,
    });
  }

  llmApproveProposal(id) {
    return this.request(`/llm/proposals/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  llmRejectProposal(id) {
    return this.request(`/llm/proposals/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  searchHuggingFace({ q = "", filter = "", limit = 12 } = {}) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (filter) params.set("filter", filter);
    if (limit) params.set("limit", String(limit));
    const query = params.toString();
    return this.request(`/models/huggingface/search${query ? `?${query}` : ""}`);
  }

  getHuggingFaceRepo(repoId) {
    return this.request(`/models/huggingface/${encodeURIComponent(repoId)}`);
  }

  registerModelFromHuggingFace(payload) {
    return this.request("/models/from-huggingface", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  getHuggingFaceSettings() {
    return this.request("/models/huggingface/settings");
  }

  updateHuggingFaceToken(token) {
    return this.request("/models/huggingface/settings", {
      method: "PATCH",
      body: JSON.stringify({ token }),
    });
  }

  testHuggingFaceToken() {
    return this.request("/models/huggingface/settings/test", {
      method: "POST",
      body: JSON.stringify({}),
    });
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

  importScriptScenes(projectId, scenes) {
    return this.request(
      `/projects/${encodeURIComponent(projectId)}/scenes/from-script`,
      {
        method: "POST",
        body: JSON.stringify({ scenes }),
      },
    );
  }

  checkContinuity(projectId) {
    return this.request(`/projects/${encodeURIComponent(projectId)}/continuity`);
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

  getScoreSuggestion(timelineId) {
    return this.request(
      `/timelines/${encodeURIComponent(timelineId)}/score-suggestion`,
    );
  }

  generateScore(timelineId, options = {}) {
    return this.request(`/timelines/${encodeURIComponent(timelineId)}/score`, {
      method: "POST",
      body: JSON.stringify(options),
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
      timeoutMs: LONG_TASK_TIMEOUT_MS,
    });
  }

  // --- Skills ---------------------------------------------------------------

  listSkills(filter = {}) {
    return this.request(`/skills${this._query(filter)}`);
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
        timeoutMs: LONG_TASK_TIMEOUT_MS,
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
