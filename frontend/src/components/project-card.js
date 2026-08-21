import { css, html, LitElement } from "lit";

export class ProjectCard extends LitElement {
  static styles = css`
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

    .thumb {
      width: 100%;
      height: 120px;
      background: linear-gradient(135deg, var(--color-surface-hover),
        var(--color-border));
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-muted);
    }

    .thumb svg {
      width: 40px;
      height: 40px;
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
      flex-wrap: wrap;
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
  `;

  static properties = {
    project: { type: Object },
  };

  constructor() {
    super();
    this.project = null;
  }

  _formatUpdated() {
    if (!this.project?.updated_at) return "";
    const date = new Date(this.project.updated_at);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString();
  }

  render() {
    const p = this.project;
    if (!p) return null;

    return html`
      <div class="card" @click=${this._click}>
        <div class="thumb">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.5">
            <path
              d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm4-1v3m8-3v3M4 9h16M9 21v-3m6 3v-3" />
          </svg>
        </div>
        <div class="card-content">
          <div class="card-title">${p.name}</div>
          <div class="card-meta">
            <span>${p.aspect_ratio}</span>
            <span>${p.resolution_width}x${p.resolution_height}</span>
            <span>${p.frame_rate} fps</span>
          </div>
          ${p.description ? html`<div class="card-description">${p.description}</div>` : ""}
          ${this._formatUpdated()
            ? html`
              <div class="card-meta" style="margin-top: 8px; margin-bottom: 0;">
                <span>Updated ${this._formatUpdated()}</span>
              </div>
            `
            : ""}
        </div>
      </div>
    `;
  }

  _click() {
    this.dispatchEvent(
      new CustomEvent("navigate", { detail: this.project.id, bubbles: true }),
    );
  }
}

customElements.define("project-card", ProjectCard);
