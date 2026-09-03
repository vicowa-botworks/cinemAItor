import { css, html, LitElement } from "lit";
import { api } from "../api.js";
import { CompareSync, isTimeMedia, resolveComparePair, toggleComparePair } from "../compare.js";

export class ReviewBoard extends LitElement {
  static styles = css`
    .review {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .back-link {
      align-self: flex-start;
      color: var(--color-text-muted);
      text-decoration: none;
      font-size: 13px;
    }

    .back-link:hover {
      color: var(--color-primary);
    }

    .job-bar {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 13px;
    }

    .job-bar .row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }

    .job-bar .label {
      color: var(--color-text-muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .chip {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
      white-space: nowrap;
    }

    .chip.succeeded {
      background-color: rgba(34, 197, 94, 0.15);
      color: #15803d;
      border-color: transparent;
    }

    .chip.failed {
      background-color: rgba(239, 68, 68, 0.15);
      color: #b91c1c;
      border-color: transparent;
    }

    .chip.approved {
      background-color: rgba(34, 197, 94, 0.15);
      color: #15803d;
      border-color: transparent;
    }

    .chip.rejected {
      background-color: rgba(239, 68, 68, 0.15);
      color: #b91c1c;
      border-color: transparent;
    }

    .chip.shortlisted {
      background-color: rgba(245, 158, 11, 0.15);
      color: #b45309;
      border-color: transparent;
    }

    .candidate-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }

    .ab-pane {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .ab-header {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 13px;
    }

    .ab-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .ab-col {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .ab-col-top {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .ab-label {
      font-size: 16px;
      font-weight: 800;
      color: var(--color-primary);
    }

    .ab-col .media-slot {
      min-height: 180px;
    }

    .ab-col .media-slot img {
      max-height: 360px;
    }

    .ab-col .media-slot video {
      max-height: 360px;
    }

    .ab-toggle[aria-pressed="true"] {
      background-color: var(--color-primary);
      color: white;
      border-color: var(--color-primary);
    }

    .candidate-card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .candidate-top {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .candidate-index {
      font-weight: 700;
      font-size: 14px;
    }

    .media-slot {
      width: 100%;
      min-height: 140px;
      border-radius: var(--radius);
      border: 1px dashed var(--color-border);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-muted);
      font-size: 12px;
      background-color: var(--color-bg);
      overflow: hidden;
    }

    .media-slot img {
      width: 100%;
      max-height: 260px;
      object-fit: contain;
      background-color: black;
    }

    .media-slot video {
      width: 100%;
      max-height: 260px;
      background-color: black;
    }

    .media-slot audio {
      width: 100%;
      padding: 24px 8px;
    }

    .decision-notes {
      font-size: 12px;
      color: var(--color-text-muted);
      background-color: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 6px 10px;
    }

    .candidate-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn-small {
      padding: 5px 12px;
      font-size: 12px;
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      cursor: pointer;
    }

    .btn-small:hover {
      color: var(--color-primary);
      border-color: var(--color-primary);
    }

    .btn-small:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-approve {
      background-color: #16a34a;
      color: white;
      border-color: #16a34a;
    }

    .btn-approve:hover {
      color: white;
    }

    .btn-reject {
      background-color: transparent;
      color: var(--color-error);
      border-color: var(--color-error);
    }

    .btn-reject:hover {
      color: var(--color-error);
    }

    input[type="text"],
    textarea {
      padding: 8px 10px;
      background-color: var(--color-bg);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
      font-family: inherit;
      width: 100%;
      box-sizing: border-box;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
    }

    .notice {
      font-size: 13px;
      padding: 8px 12px;
      border-radius: var(--radius);
      background-color: rgba(34, 197, 94, 0.12);
      color: #15803d;
    }

    .asset-link {
      font-size: 11px;
      color: var(--color-text-muted);
    }

    .empty {
      background-color: var(--color-surface);
      border: 1px dashed var(--color-border);
      border-radius: var(--radius);
      padding: 48px 24px;
      text-align: center;
      color: var(--color-text-muted);
      font-size: 14px;
    }
  `;

  static properties = {
    jobId: {},
    job: { state: true },
    candidates: { state: true },
    media: { state: true },
    loading: { state: true },
    error: { state: true },
    notice: { state: true },
    busyVersionId: { state: true },
    noteDrafts: { state: true },
    compareIds: { state: true },
  };

  constructor() {
    super();
    this.job = null;
    this.candidates = [];
    this.media = new Map();
    this.loading = false;
    this.error = "";
    this.notice = null;
    this.busyVersionId = null;
    this.noteDrafts = new Map();
    this.compareIds = [];
    this._jobId = null;
    this._loadedJobId = null;
    this._compareSync = new CompareSync();
  }

  async connectedCallback() {
    super.connectedCallback?.();
    this._jobId = this.jobId ??
      decodeURIComponent(
        (window.location.hash.match(/#\/review\/([^/?]+)/) ?? [])[1] ?? "",
      );
    await this._load();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    for (const entry of this.media.values()) {
      if (entry.url) URL.revokeObjectURL(entry.url);
    }
    this.media = new Map();
    this._compareSync.clear();
  }

  render() {
    if (this.loading && !this.job) {
      return html`<div class="empty">Loading candidates...</div>`;
    }
    if (!this.job) {
      return html`<div class="empty">
          ${this.error || "No candidates for this job."}</div>`;
    }
    return html`
      <div class="review">
        <a class="back-link" href="#/jobs">&larr; Job monitor</a>

        <div class="job-bar">
          <div class="row">
            <span class="label">Job</span>
            <span class="chip ${this.job.status}">${this.job.status}</span>
            <span class="chip">${this.job.job_type}</span>
            <span class="label" style="margin-left:auto;">${this.job.id}</span>
            <a class="btn-small" href="#/jobs/${encodeURIComponent(this.job.id)}"
              style="text-decoration:none; display:inline-block;">
              Details
            </a>
          </div>
          ${this.job.prompt_text
            ? html`
              <div class="row">
                <span class="label">Prompt</span>
                <span style="flex:1; min-width:200px;">
                                ${this.job.prompt_text}
                              </span>
              </div>
            `
            : null}
          ${this.job.seed
            ? html`
              <div class="row">
                <span class="label">Seed</span>
                <span>${this.job.seed}</span>
              </div>
            `
            : null}
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : null}
        ${this.notice ? html`<div class="notice">${this.notice}</div>` : null}

        ${this._renderAbPane()}

        <div class="candidate-grid">
          ${this.candidates.map((c) => this._renderCandidate(c))}
        </div>
      </div>
    `;
  }

  _renderCandidate(candidate) {
    const versionId = candidate.asset_version.id;
    const media = this.media.get(versionId);
    const decision = candidate.decision;
    const noteDraft = this.noteDrafts.get(versionId) ?? decision?.notes ?? "";
    const busy = this.busyVersionId === versionId;
    const type = candidate.asset.asset_type;
    let player = html`<div class="media-slot">
        no preview
      </div>`;
    if (media) {
      player = type === "audio"
        ? html`
          <div class="media-slot">
            <audio controls src=${media.url}></audio>
          </div>
        `
        : html`<div class="media-slot">
            ${
          type === "video"
            ? html`<video controls preload="metadata" src=${media.url}></video>`
            : html`
              <img src=${media.url}
                alt="Candidate ${candidate.candidate_index}" />
            `
        }
          </div>`;
    } else if (media === null) {
      player = html`<div class="media-slot">
          preview unavailable
        </div>`;
    } else {
      player = html`<div class="media-slot">
          loading...
        </div>`;
    }
    return html`
      <div class="candidate-card">
        <div class="candidate-top">
          <span class="candidate-index">Candidate ${candidate.candidate_index}/
            ${candidate.candidate_count}</span>
          ${decision
            ? html`<span class="chip ${decision.decision}">
                ${decision.decision}
              </span>`
            : null}
          <a class="asset-link"
            href="#/asset/${encodeURIComponent(candidate.asset.id)}">
            ${candidate.asset.display_name || candidate.asset.unique_slug}
          </a>
          ${this._abToggle(versionId)}
        </div>
        ${player}
        ${decision?.notes ? html`<div class="decision-notes">${decision.notes}</div>` : null}
        <input
          type="text"
          placeholder="Review notes (optional)"
          .value=${noteDraft}
          @input=${(e) =>
            this.noteDrafts = new Map(
              this.noteDrafts.set(versionId, e.target.value),
            )}>
        <div class="candidate-actions">
          <button
            class="btn-small btn-approve"
            ?disabled=${busy || decision?.decision === "approved"}
            @click=${() => this._decide(candidate, "approve")}>
            ${decision?.decision === "approved" ? "Approved" : "Approve"}
          </button>
          <button
            class="btn-small btn-reject"
            ?disabled=${busy || decision?.decision === "rejected"}
            @click=${() => this._decide(candidate, "reject")}>
            ${decision?.decision === "rejected" ? "Rejected" : "Reject"}
          </button>
          <button
            class="btn-small"
            ?disabled=${busy}
            @click=${() => this._decide(candidate, "shortlist")}>
            ${decision?.decision === "shortlisted" ? "Unshortlist" : "Shortlist"}
          </button>
        </div>
      </div>
    `;
  }

  _abToggle(versionId) {
    const selected = this.compareIds.includes(versionId);
    return html`
      <button class="btn-small ab-toggle" aria-pressed=${selected ? "true" : "false"}
        ?disabled=${this.busyVersionId !== null}
        @click=${() => this._toggleCompare(versionId)}>
        ${selected ? "In A/B" : "A/B"}
      </button>
    `;
  }

  _toggleCompare(versionId) {
    this.compareIds = toggleComparePair(this.compareIds, versionId);
  }

  _renderAbPane() {
    if (!this.job) return null;
    const pair = resolveComparePair(
      this.candidates,
      (c) => c.asset_version.id,
      this.compareIds,
    );
    if (!pair) return null;
    const timeMedia = isTimeMedia(pair.a.asset?.asset_type);
    return html`
      <div class="ab-pane">
        <div class="ab-header">
          <span>
            <strong>A/B comparison</strong>
            — pick two candidates to place them side by side
          </span>
          ${timeMedia
            ? html`
              <button class="btn-small" @click=${() => this._compareSync.play()}>Play both</button>
              <button class="btn-small" @click=${() =>
                this._compareSync.pause()}>Pause both</button>
              <button class="btn-small" @click=${() => this._compareSync.stop()}>Stop both</button>
            `
            : null}
          <button class="btn-small" style="margin-left:auto"
            @click=${() => (this.compareIds = [])}>
            Close
          </button>
        </div>
        <div class="ab-grid">
          ${this._renderAbCol("a", pair.a, true)}
          ${this._renderAbCol("b", pair.b, false)}
        </div>
      </div>
    `;
  }

  _renderAbCol(key, candidate, isA) {
    const media = this.media.get(candidate.asset_version.id);
    const type = candidate.asset?.asset_type;
    let player = html`<div class="media-slot">no preview</div>`;
    if (media && type === "audio") {
      player = html`
        <div class="media-slot">
          <audio controls preload="auto" src=${media.url}
            ref=${(el) => this._compareSync.setPlayer(key, el)}
            @seeked=${(e) => this._compareSync.handleSeeked(e)}></audio>
        </div>
      `;
    } else if (media && type === "video") {
      player = html`
        <div class="media-slot">
          <video controls preload="metadata" src=${media.url}
            ref=${(el) => this._compareSync.setPlayer(key, el)}
            @seeked=${(e) => this._compareSync.handleSeeked(e)}></video>
        </div>
      `;
    } else if (media) {
      player = html`
        <div class="media-slot">
          <img src=${media.url} alt=${candidate.asset.display_name} />
        </div>
      `;
    } else if (media === null) {
      player = html`<div class="media-slot">preview unavailable</div>`;
    }
    const decision = candidate.decision;
    return html`
      <div class="ab-col">
        <div class="ab-col-top">
          <span class="ab-label">${isA ? "A" : "B"}</span>
          <span class="candidate-index">
            Candidate ${candidate.candidate_index}/${candidate.candidate_count}
          </span>
          ${decision
            ? html`
              <span class="chip ${decision.decision}">${decision.decision}</span>
              <button class="btn-small"
                ?disabled=${this.busyVersionId !== null}
                @click=${() =>
                  this._decide(candidate, decision.decision === "approved" ? "reject" : "approve")}>
                ${decision.decision === "approved" ? "Unapprove" : "Approve"}
              </button>
            `
            : null}
        </div>
        ${player}
        ${decision?.notes ? html`<div class="decision-notes">${decision.notes}</div>` : null}
      </div>
    `;
  }

  async _load() {
    if (!this._jobId) return;
    if (this._jobId !== this._loadedJobId) {
      this.compareIds = [];
      this._compareSync.clear();
    }
    this.loading = true;
    this.error = "";
    try {
      const { job, candidates } = await api.listJobCandidates(this._jobId);
      this.job = job;
      this.candidates = candidates;
      this._loadedJobId = this._jobId;
      this._loadMedia();
    } catch (err) {
      this.error = err.message || "Failed to load candidates.";
    } finally {
      this.loading = false;
    }
  }

  _loadMedia() {
    for (const candidate of this.candidates) {
      this._fetchMedia(candidate).catch(() => {
        this.media = new Map(this.media.set(
          candidate.asset_version.id,
          null,
        ));
      });
    }
  }

  async _fetchMedia(candidate) {
    const versionId = candidate.asset_version.id;
    const assetId = candidate.asset.id;
    let media;
    try {
      media = await api.getAssetProxyUrl(assetId, versionId);
    } catch {
      try {
        media = await api.getAssetVersionPreviewUrl(assetId, versionId);
      } catch {
        media = null;
      }
    }
    if (!media) {
      this.media = new Map(this.media.set(versionId, null));
      return;
    }
    const prev = this.media.get(versionId);
    if (prev?.url) URL.revokeObjectURL(prev.url);
    this.media = new Map(this.media.set(versionId, {
      url: media.url,
      type: media.type,
    }));
  }

  async _decide(candidate, action) {
    const versionId = candidate.asset_version.id;
    const notes = (this.noteDrafts.get(versionId) ?? "").trim();
    this.busyVersionId = versionId;
    this.error = "";
    this.notice = null;
    try {
      const decision = await api.reviewDecision(
        versionId,
        action,
        notes || undefined,
      );
      this.candidates = this.candidates.map((c) =>
        c.asset_version.id === versionId ? { ...c, decision } : c
      );
      this.notice = action === "approve"
        ? "Approved and promoted to active version."
        : action === "reject"
        ? "Candidate rejected."
        : decision.decision === "shortlisted"
        ? "Shortlisted."
        : "Shortlist removed.";
    } catch (err) {
      this.error = err.message || "Failed to record decision.";
    } finally {
      this.busyVersionId = null;
    }
  }
}

customElements.define("review-board", ReviewBoard);
