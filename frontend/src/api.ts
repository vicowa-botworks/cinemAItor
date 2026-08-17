const API_BASE = "/api";

class ApiClient {
  private token: string | null = null;

  setToken(token: string): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = null;
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      const err = new Error(error.error || "Request failed");
      (err as any).status = response.status;
      throw err;
    }

    return response.json();
  }

  async register(email: string, password: string, displayName: string) {
    return this.request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, display_name: displayName }),
    });
  }

  async login(email: string, password: string) {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async getMe() {
    return this.request("/auth/me");
  }

  async getMovies() {
    return this.request("/movies");
  }

  async getMovie(id: number) {
    return this.request(`/movies/${id}`);
  }

  async createMovie(
    data: {
      title: string;
      description?: string;
      genre?: string;
      year?: number;
      runtime_minutes?: number;
    },
  ) {
    return this.request("/movies", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateMovie(id: number, data: Record<string, unknown>) {
    return this.request(`/movies/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteMovie(id: number) {
    return this.request(`/movies/${id}`, {
      method: "DELETE",
    });
  }

  async getScenes(movieId: number) {
    return this.request(`/movies/${movieId}/scenes`);
  }

  async createScene(
    movieId: number,
    data: {
      scene_number: number;
      description: string;
      dialogue?: string;
      visual_description?: string;
      duration_seconds?: number;
    },
  ) {
    return this.request(`/movies/${movieId}/scenes`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}

export const api = new ApiClient();
