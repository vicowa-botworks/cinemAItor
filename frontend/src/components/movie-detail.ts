import { html, css } from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-html/lit-html.ts";
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

@customElement("movie-detail")
export class MovieDetail extends LitElement {
  static override styles = css`
    .detail-container {
      max-width: 900px;
      margin: 0 auto;
      padding: 30px 20px;
    }

    .back-btn {
      background: transparent;
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
      padding: 8px 16px;
      margin-bottom: 20px;
      border-radius: var(--radius);
      font-size: 13px;
    }

    .back-btn:hover {
      color: var(--color-text);
      border-color: var(--color-text);
    }

    .movie-header {
      display: flex;
      gap: 24px;
      margin-bottom: 30px;
    }

    .movie-poster {
      width: 200px;
      height: 300px;
      background: linear-gradient(135deg, var(--color-surface-hover), var(--color-border));
      border-radius: var(--radius);
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .movie-info {
      flex: 1;
    }

    .movie-info h2 {
      font-size: 28px;
      margin-bottom: 12px;
    }

    .meta-tags {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    .meta-tag {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .description {
      color: var(--color-text-muted);
      line-height: 1.6;
      margin-bottom: 20px;
    }

    .actions {
      display: flex;
      gap: 12px;
    }

    .btn-edit {
      background-color: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-delete {
      background-color: transparent;
      color: var(--color-error);
      border: 1px solid var(--color-error);
    }

    .scenes-section {
      margin-top: 30px;
    }

    .scenes-section h3 {
      font-size: 20px;
      margin-bottom: 16px;
    }

    .scene-item {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 16px;
      margin-bottom: 12px;
    }

    .scene-number {
      font-size: 12px;
      color: var(--color-primary);
      font-weight: 600;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .scene-desc {
      color: var(--color-text-muted);
      font-size: 14px;
    }

    .loading, .error {
      text-align: center;
      padding: 40px;
      color: var(--color-text-muted);
    }

    .error {
      color: var(--color-error);
    }
  `;

  @state() private movie: Movie | null = null;
  @state() private loading = true;
  @state() private error = "";
  @state() private movieId: number | null = null;

  async connectedCallback(): Promise<void> {
    super.connectedCallback?.();
    const hash = window.location.hash;
    const match = hash.match(/\/movie\/(\d+)/);
    if (match) {
      this.movieId = Number(match[1]);
      await this._loadMovie();
    } else {
      this.error = "No movie ID found";
      this.loading = false;
    }
  }

  private async _loadMovie(): Promise<void> {
    if (!this.movieId) return;
    this.loading = true;
    this.error = "";
    try {
      this.movie = await api.getMovie(this.movieId);
    } catch (err: unknown) {
      this.error = (err as Error).message || "Failed to load movie";
    } finally {
      this.loading = false;
    }
  }

  private _goBack(): void {
    window.location.hash = "#/movies";
  }

  private _deleteMovie(): void {
    if (!confirm("Are you sure you want to delete this movie?")) return;
    if (!this.movieId) return;

    api.deleteMovie(this.movieId).then(() => {
      window.location.hash = "#/movies";
    }).catch((err: unknown) => {
      this.error = (err as Error).message || "Failed to delete movie";
    });
  }

  override render() {
    if (this.loading) {
      return html`<div class="detail-container"><div class="loading">Loading...</div></div>`;
    }

    if (this.error && !this.movie) {
      return html`<div class="detail-container"><div class="error">${this.error}</div></div>`;
    }

    if (!this.movie) return null;

    return html`
      <div class="detail-container">
        <button class="back-btn" @click=${this._goBack}>← Back to Movies</button>

        <div class="movie-header">
          <div class="movie-poster">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5">
              <path d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"/>
            </svg>
          </div>
          <div class="movie-info">
            <h2>${this.movie.title}</h2>
            <div class="meta-tags">
              ${this.movie.genre ? html`<span class="meta-tag">${this.movie.genre}</span>` : ""}
              ${this.movie.year ? html`<span class="meta-tag">${this.movie.year}</span>` : ""}
              ${this.movie.runtime_minutes ? html`<span class="meta-tag">${this.movie.runtime_minutes} min</span>` : ""}
              ${this.movie.rating > 0 ? html`<span class="meta-tag rating">★ ${this.movie.rating}</span>` : ""}
            </div>
            ${this.movie.description ? html`<p class="description">${this.movie.description}</p>` : ""}
            <div class="actions">
              <button class="btn-edit" @click=${() => window.location.hash = `#/movie/${this.movieId}/edit`}>Edit</button>
              <button class="btn-delete" @click=${this._deleteMovie}>Delete</button>
            </div>
          </div>
        </div>

        <div class="scenes-section">
          <h3>Scenes</h3>
          <p style="color: var(--color-text-muted);">No scenes added yet.</p>
        </div>
      </div>
    `;
  }
}
