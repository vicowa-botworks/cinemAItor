const API_BASE = "/api";

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

  async request(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (this.#token) {
      headers["Authorization"] = `Bearer ${this.#token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new ApiError(error.error || "Request failed", response.status);
    }

    return response.json();
  }

  register(email, password, displayName) {
    return this.request("/auth/register", {
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

  getMe() {
    return this.request("/auth/me");
  }

  getMovies() {
    return this.request("/movies");
  }

  getMovie(id) {
    return this.request(`/movies/${id}`);
  }

  createMovie(data) {
    return this.request("/movies", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  updateMovie(id, data) {
    return this.request(`/movies/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  deleteMovie(id) {
    return this.request(`/movies/${id}`, {
      method: "DELETE",
    });
  }

  getScenes(movieId) {
    return this.request(`/movies/${movieId}/scenes`);
  }

  createScene(movieId, data) {
    return this.request(`/movies/${movieId}/scenes`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}

export const api = new ApiClient();
