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
    const headers = {
      "Content-Type": "application/json",
      ...options.headers,
    };

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
