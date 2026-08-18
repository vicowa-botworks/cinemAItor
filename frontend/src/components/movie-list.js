import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import "./movie-card.js";

export class MovieList extends LitElement {
  static styles = css`
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

  static properties = {
    movies: {},
    loading: {},
    error: {},
  };

  constructor() {
    super();
    this.movies = [];
    this.loading = true;
    this.error = "";
  }

  async connectedCallback() {
    super.connectedCallback?.();
    await this._loadMovies();
  }

  async _loadMovies() {
    this.loading = true;
    this.error = "";
    try {
      this.movies = await api.getMovies();
    } catch (err) {
      this.error = err.message || "Failed to load movies";
    } finally {
      this.loading = false;
    }
  }

  _navigateToCreate() {
    window.location.hash = "#/create";
  }

  _navigateToMovie(id) {
    window.location.hash = `#/movie/${id}`;
  }

  render() {
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
                  <movie-card .movie=${movie} @navigate=${(e) =>
                    this._navigateToMovie(e.detail)}></movie-card>
                `
              )}
            </div>
          `}
      </div>
    `;
  }
}

customElements.define("movie-list", MovieList);
