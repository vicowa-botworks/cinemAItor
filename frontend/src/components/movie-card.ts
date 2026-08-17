import { html, css } from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-html/lit-html.ts";
import { LitElement } from "https://cdn.jsdelivr.net/gh/lit/deps@0.7.1/lit-element/lit-element.ts";
import { customElement, property } from "lit/decorators.ts";

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

@customElement("movie-card")
export class MovieCard extends LitElement {
  static override styles = css`
    .card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      overflow: hidden;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.4);
      border-color: var(--color-primary);
    }

    .poster {
      width: 100%;
      height: 200px;
      background: linear-gradient(135deg, var(--color-surface-hover), var(--color-border));
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-muted);
    }

    .poster svg {
      width: 48px;
      height: 48px;
      opacity: 0.5;
    }

    .card-content {
      padding: 16px;
    }

    .card-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .card-meta {
      display: flex;
      gap: 12px;
      font-size: 13px;
      color: var(--color-text-muted);
      margin-bottom: 8px;
    }

    .card-description {
      font-size: 13px;
      color: var(--color-text-muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.4;
    }

    .rating {
      color: var(--color-warning);
    }
  `;

  @property({ type: Object }) movie!: Movie;

  override render() {
    return html`
      <div class="card" @click=${this._click}>
        <div class="poster">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"/>
          </svg>
        </div>
        <div class="card-content">
          <div class="card-title">${this.movie.title}</div>
          <div class="card-meta">
            ${this.movie.genre ? html`<span>${this.movie.genre}</span>` : ""}
            ${this.movie.year ? html`<span>${this.movie.year}</span>` : ""}
            ${this.movie.runtime_minutes ? html`<span>${this.movie.runtime_minutes} min</span>` : ""}
          </div>
          ${this.movie.description ? html`<div class="card-description">${this.movie.description}</div>` : ""}
        </div>
      </div>
    `;
  }

  private _click(): void {
    this.dispatchEvent(new CustomEvent("navigate", { detail: this.movie.id, bubbles: true }));
  }
}
