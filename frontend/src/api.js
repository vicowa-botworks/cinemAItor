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

  getScenes(movieId) {
    return this.request(`/movies/${movieId}/scenes`, {}, LEGACY_BASE);
  }

  createScene(movieId, data) {
    return this.request(`/movies/${movieId}/scenes`, {
      method: "POST",
      body: JSON.stringify(data),
    }, LEGACY_BASE);
  }
}

export const api = new ApiClient();
export { ApiError };
