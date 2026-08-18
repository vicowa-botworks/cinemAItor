import { css, html } from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-html/lit-html.ts";
import { LitElement } from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-element/lit-element.ts";
import { customElement, state } from "lit/decorators.ts";
import { api } from "../api.ts";

interface Movie {
  id: number;
  title: string;
  description: string | null;
  genre: string | null;
  year: number | null;
  runtime_minutes: number | null;
  poster_url: string | null;
  backdrop_url: string | null;
  rating: number;
}

@customElement("movie-list")
export class MovieList extends LitElement {
  static override styles = css`
    .movie-list-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 30px 20px;
    }

    .list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .list-header h2 {
      font-size: 24px;
    }

    .btn-create {
      background-color: var(--color-primary);
      color: white;
      padding: 10px 20px;
      border-radius: var(--radius);
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      display: inline-block;
    }

    .btn-create:hover {
      background-color: var(--color-primary-hover);
      color: white;
    }

    .movies-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--color-text-muted);
    }

    .empty-state p {
      margin-top: 12px;
      font-size: 15px;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: var(--color-text-muted);
    }
  `;

  @state()
  private movies: Movie[] = [];
  @state()
  private loading = true;
  @state()
  private error = "";

  async connectedCallback(): Promise<void> {
    super.connectedCallback?.();
    await this._loadMovies();
  }

  override updated(): void {
    // Re-fetch when component becomes visible
  }

  private async _loadMovies(): Promise<void> {
    this.loading = true;
    this.error = "";
    try {
      this.movies = await api.getMovies();
    } catch (err: unknown) {
      this.error = (err as Error).message || "Failed to load movies";
    } finally {
      this.loading = false;
    }
  }

  private _navigateToCreate(): void {
    window.location.hash = "#/create";
  }

  private _navigateToMovie(id: number): void {
    window.location.hash = `#/movie/${id}`;
  }

  override render() {
    if (this.loading) {
      return html`
        <div class="movie-list-container">
          <div class="loading">Loading movies...</div>
        </div>
      `;
    }

    return html`
      <div class="movie-list-container">
        <div class="list-header">
          <h2>My Movies</h2>
          <button class="btn-create" @click=${this._navigateToCreate}>+ New Movie</button>
        </div>

        ${this.error
          ? html`<p style="color: var(--color-error); text-align: center;">${this.error}</p>`
          : ""}

        ${this.movies.length === 0
          ? html`
            <div class="empty-state">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="1.5">
                <path
                  d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
              </svg>
              <p>No movies yet. Create your first movie!</p>
            </div>
          `
          : html`
            <div class="movies-grid">
              ${this.movies.map((movie) =>
                html`
                  <movie-card .movie=${movie} @navigate=${(e: Event) =>
                    this._navigateToMovie((e as CustomEvent).detail)}></movie-card>
                `
              )}
            </div>
          `}
      </div>
    `;
  }
}
