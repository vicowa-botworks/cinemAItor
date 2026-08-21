import { css, html, LitElement } from "lit";
import { api } from "../api.js";

const JOB_STATUSES = [
  "queued",
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
];

const JOB_TYPES = [
  "text_to_image",
  "image_to_image",
  "image_to_video",
  "text_to_video",
  "audio",
  "music",
  "voice",
  "proxy",
];

const ACTIVE_STATUSES = new Set(["queued", "running", "cancelling"]);
const CREATIVE_JOB_TYPES = new Set([
  "text_to_image",
  "image_to_video",
  "text_to_video",
]);

export class JobMonitor extends LitElement {
  static styles = css`
    .job-monitor {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .list-title {
      font-size: 22px;
      font-weight: 600;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--color-text-muted);
      cursor: pointer;
      user-select: none;
    }

    .btn {
      padding: 9px 18px;
      border: none;
      border-radius: var(--radius);
      font-size: 14px;
      cursor: pointer;
      font-weight: 500;
      background-color: var(--color-primary);
      color: white;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-secondary {
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-small {
      padding: 4px 10px;
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

    .btn-small.danger:hover {
      color: var(--color-error);
      border-color: var(--color-error);
    }

    .btn-small:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
    }

    .notice {
      font-size: 13px;
      padding: 8px 12px;
      border-radius: var(--radius);
    }

    .notice.ok {
      background-color: rgba(34, 197, 94, 0.12);
      color: #15803d;
    }

    .notice.err {
      background-color: rgba(239, 68, 68, 0.12);
      color: #b91c1c;
    }

    .filters {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: flex-end;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 16px;
    }

    .filter-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .filter-field label {
      font-size: 11px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .filters select {
      padding: 7px 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
      min-width: 140px;
    }

    .job-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .job-row {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .job-main {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      cursor: pointer;
    }

    .job-main:hover {
      background-color: var(--color-surface-hover);
    }

    .job-main .prompt {
      flex: 1;
      min-width: 0;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .job-main .meta {
      font-size: 12px;
      color: var(--color-text-muted);
      white-space: nowrap;
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

    .chip.queued {
      background-color: rgba(107, 114, 128, 0.15);
      color: #374151;
      border-color: transparent;
    }

    .chip.running {
      background-color: rgba(59, 130, 246, 0.15);
      color: #1d4ed8;
      border-color: transparent;
    }

    .chip.cancelling {
      background-color: rgba(245, 158, 11, 0.18);
      color: #92400e;
      border-color: transparent;
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

    .chip.cancelled {
      background-color: rgba(107, 114, 128, 0.15);
      color: #6b7280;
      border-color: transparent;
      text-decoration: line-through;
    }

    .progress-wrap {
      width: 140px;
      flex-shrink: 0;
    }

    .progress-label {
      font-size: 11px;
      color: var(--color-text-muted);
      margin-bottom: 3px;
    }

    .progress {
      height: 6px;
      background-color: var(--color-surface-hover);
      border-radius: 999px;
      overflow: hidden;
    }

    .progress > span {
      display: block;
      height: 100%;
      background-color: var(--color-primary);
      border-radius: 999px;
      transition: width 0.4s ease;
    }

    .job-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .job-detail {
      border-top: 1px solid var(--color-border);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      font-size: 13px;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 10px 20px;
    }

    .detail-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .detail-item .k {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
    }

    .detail-item .v {
      word-break: break-word;
    }

    .error-text {
      padding: 10px 12px;
      border-radius: var(--radius);
      background-color: rgba(239, 68, 68, 0.1);
      color: #b91c1c;
      font-family: monospace;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .events {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .event {
      display: flex;
      gap: 12px;
      font-family: monospace;
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .event .time {
      flex-shrink: 0;
    }

    .event .type {
      font-weight: 600;
      color: var(--color-text);
      min-width: 140px;
      flex-shrink: 0;
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

    a {
      color: var(--color-primary);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }
  `;

  static properties = {
    jobs: { state: true },
    projects: { state: true },
    modelNames: { state: true },
    statusFilter: { state: true },
    typeFilter: { state: true },
    projectFilter: { state: true },
    expandedId: { state: true },
    events: { state: true },
    eventsLoading: { state: true },
    autoRefresh: { state: true },
    lastUpdated: { state: true },
    loading: { state: true },
    busyId: { state: true },
    error: { state: true },
    notice: { state: true },
  };

  constructor() {
    super();
    this.jobs = [];
    this.projects = [];
    this.modelNames = new Map();
    this.statusFilter = "";
    this.typeFilter = "";
    this.projectFilter = "";
    this.expandedId = null;
    this.events = [];
    this.eventsLoading = false;
    this.autoRefresh = true;
    this.lastUpdated = null;
    this.loading = false;
    this.busyId = null;
    this.error = "";
    this.notice = null;
    this._timer = null;
  }

  async connectedCallback() {
    super.connectedCallback?.();
    await this._loadReferenceData();
    await this._refresh();
    this._startTimer();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._stopTimer();
  }

  render() {
    const activeCount = this.jobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length;
    return html`
      <div class="job-monitor">
        <div class="list-header">
          <div class="list-title">
            Jobs
            ${activeCount > 0
              ? html`<span class="chip running">${activeCount} active</span>`
              : html`<span class="chip">${this.jobs.length} total</span>`}
          </div>
          <div class="header-controls">
            <span class="meta" style="font-size:12px; color:var(--color-text-muted);">
              ${this.lastUpdated
                ? `updated ${this.lastUpdated.toLocaleTimeString()}`
                : "loading..."}
            </span>
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${this.autoRefresh}
                @change=${(e) => this._setAutoRefresh(e.target.checked)}>
              auto-refresh
            </label>
            <button
              class="btn btn-secondary"
              ?disabled=${this.loading}
              @click=${this._refresh}>
              ${this.loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        ${this.error ? html`<div class="error">${this.error}</div>` : null}
        ${this.notice
          ? html`<div class="notice ${this.notice.kind}">${this.notice.text}</div>`
          : null}

        <div class="filters">
          <div class="filter-field">
            <label for="filter-status">Status</label>
            <select
              id="filter-status"
              .value=${this.statusFilter}
              @change=${(e) => {
                this.statusFilter = e.target.value;
                this._refresh();
              }}>
              <option value="">all</option>
              ${JOB_STATUSES.map(
                (s) => html`<option value=${s}>${s}</option>`,
              )}
            </select>
          </div>
          <div class="filter-field">
            <label for="filter-type">Job type</label>
            <select
              id="filter-type"
              .value=${this.typeFilter}
              @change=${(e) => {
                this.typeFilter = e.target.value;
                this._refresh();
              }}>
              <option value="">all</option>
              ${JOB_TYPES.map((t) => html`<option value=${t}>${t}</option>`)}
            </select>
          </div>
          <div class="filter-field">
            <label for="filter-project">Project</label>
            <select
              id="filter-project"
              .value=${this.projectFilter}
              @change=${(e) => {
                this.projectFilter = e.target.value;
                this._refresh();
              }}>
              <option value="">all</option>
              ${this.projects.map(
                (p) => html`<option value=${p.id}>${p.name}</option>`,
              )}
            </select>
          </div>
        </div>

        ${this.jobs.length === 0
          ? html`<div class="empty">
              ${this.loading ? "Loading jobs..." : "No jobs match the filters."}
            </div>`
          : html`
            <div class="job-list">
              ${this.jobs.map((job) => this._renderJob(job))}
            </div>
          `}
      </div>
    `;
  }

  _renderJob(job) {
    const expanded = this.expandedId === job.id;
    const busy = this.busyId === job.id;
    const modelName = job.model_id ? this.modelNames.get(job.model_id) ?? job.model_id : "—";
    return html`
      <div class="job-row">
        <div class="job-main" @click=${() => this._toggleExpand(job.id)}>
          <span class="chip ${job.status}">${job.status}</span>
          <span class="chip">${job.job_type}</span>
          <span class="prompt">${job.prompt_text || "(no prompt)"}</span>
          ${ACTIVE_STATUSES.has(job.status) && job.status === "running"
            ? html`
              <div class="progress-wrap">
                <div class="progress-label">${Math.round(job.progress)}%</div>
                <div class="progress">
                  <span style="width: ${job.progress}%"></span>
                </div>
              </div>
            `
            : null}
          <span class="meta">${this._modelName(job)}</span>
          <span class="meta">${this._fmtWhen(job.created_at)}</span>
          <div class="job-actions" @click=${(e) => e.stopPropagation()}>
            ${ACTIVE_STATUSES.has(job.status)
              ? html`
                <button
                  class="btn-small danger"
                  ?disabled=${busy}
                  @click=${() => this._cancel(job.id)}>
                  Cancel
                </button>
              `
              : null}
            ${CREATIVE_JOB_TYPES.has(job.job_type) && job.status === "succeeded"
              ? html`
                <button
                  class="btn-small"
                  @click=${() => {
                    window.location.hash = `#/review/${encodeURIComponent(job.id)}`;
                  }}>
                  Review
                </button>
              `
              : null}
            ${!ACTIVE_STATUSES.has(job.status)
              ? html`
                <button
                  class="btn-small"
                  ?disabled=${busy}
                  @click=${() => this._retry(job.id)}>
                  Retry
                </button>
              `
              : null}
          </div>
        </div>

        ${expanded
          ? html`
            <div class="job-detail">
              ${job.error_text ? html`<div class="error-text">${job.error_text}</div>` : null}
              <div class="detail-grid">
                ${this._detailRow("Job id", job.id)}
                ${this._detailRow(
                  "Model",
                  `${modelName}${job.model_version ? ` @ ${job.model_version}` : ""}`,
                )}
                ${this._detailRow("Seed", job.seed ?? "random")}
                ${this._detailRow(
                  "Created",
                  this._fmtWhen(job.created_at),
                )}
                ${job.started_at ? this._detailRow("Started", this._fmtWhen(job.started_at)) : null}
                ${job.finished_at
                  ? this._detailRow("Finished", this._fmtWhen(job.finished_at))
                  : null}
                ${job.asset_id
                  ? html`
                    <div class="detail-item">
                      <span class="k">Output asset</span>
                      <span class="v">
                        <a href="#/asset/${encodeURIComponent(job.asset_id)}">
                          ${job.asset_id}
                        </a>
                        ${job.candidate_count ? `(${job.candidate_count} candidates)` : ""}
                      </span>
                    </div>
                  `
                  : null}
                ${job.project_id ? this._detailRow("Project", job.project_id) : null}
                ${job.negative_prompt
                  ? this._detailRow("Negative prompt", job.negative_prompt)
                  : null}
                ${job.input_asset_versions.length > 0
                  ? this._detailRow(
                    "Inputs",
                    job.input_asset_versions
                      .map((i) => `${i.asset_id}:v${i.version_number}`)
                      .join(", "),
                  )
                  : null}
              </div>
              ${Object.keys(job.settings).length > 0
                ? html`
                  <div class="detail-item">
                    <span class="k">Settings</span>
                    <span class="v" style="font-family:monospace; font-size:12px;">
                      ${JSON.stringify(job.settings)}
                    </span>
                  </div>
                `
                : null}
              <div class="detail-item">
                <span class="k">Events
                  ${this.eventsLoading ? "(loading...)" : ""}
                </span>
                <div class="events" style="margin-top:4px;">
                  ${this.events.length === 0 && !this.eventsLoading
                    ? html`<span style="color:var(--color-text-muted);">No events recorded.</span>`
                    : this.events.map((ev) =>
                      html`
                        <div class="event">
                          <span class="time">${this._fmtWhen(ev.created_at)}</span>
                          <span class="type">${ev.event_type}</span>
                          <span>${ev.message ?? ""}</span>
                        </div>
                      `
                    )}
                </div>
              </div>
            </div>
          `
          : null}
      </div>
    `;
  }

  _detailRow(label, value) {
    if (value === null || value === undefined || value === "") return null;
    return html`
      <div class="detail-item">
        <span class="k">${label}</span>
        <span class="v">${value}</span>
      </div>
    `;
  }

  _modelName(job) {
    return job.model_id ? this.modelNames.get(job.model_id) ?? job.model_id : "no model";
  }

  _fmtWhen(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString();
  }

  async _loadReferenceData() {
    try {
      const [projects, models] = await Promise.all([
        api.listProjects().catch(() => []),
        api.listModels().catch(() => []),
      ]);
      this.projects = projects;
      this.modelNames = new Map(models.map((m) => [m.id, m.name]));
    } catch {
      // Reference data is best-effort; the job list is the critical path.
    }
  }

  async _refresh() {
    this.loading = true;
    this.error = "";
    try {
      this.jobs = await api.listJobs({
        status: this.statusFilter,
        job_type: this.typeFilter,
        project_id: this.projectFilter,
        limit: 200,
      });
      this.lastUpdated = new Date();
    } catch (err) {
      this.error = err.message || "Failed to load jobs.";
    } finally {
      this.loading = false;
    }
  }

  async _toggleExpand(id) {
    if (this.expandedId === id) {
      this.expandedId = null;
      this.events = [];
      return;
    }
    this.expandedId = id;
    this.events = [];
    this.eventsLoading = true;
    try {
      this.events = await api.listJobEvents(id);
    } catch {
      this.events = [];
    } finally {
      this.eventsLoading = false;
    }
  }

  async _cancel(id) {
    if (!window.confirm("Cancel this job?")) return;
    this.busyId = id;
    this.notice = null;
    this.error = "";
    try {
      await api.cancelJob(id);
      this.notice = { kind: "ok", text: "Cancel requested." };
      await this._refresh();
    } catch (err) {
      this.error = err.message || "Failed to cancel job.";
    } finally {
      this.busyId = null;
    }
  }

  async _retry(id) {
    this.busyId = id;
    this.notice = null;
    this.error = "";
    try {
      await api.retryJob(id);
      this.notice = { kind: "ok", text: "Job re-queued." };
      await this._refresh();
    } catch (err) {
      this.error = err.message || "Failed to retry job.";
    } finally {
      this.busyId = null;
    }
  }

  _setAutoRefresh(on) {
    this.autoRefresh = on;
    if (on) {
      this._startTimer();
    } else {
      this._stopTimer();
    }
  }

  _startTimer() {
    this._stopTimer();
    if (!this.autoRefresh) return;
    this._timer = setInterval(() => {
      // Skip polling while a manual refresh or an event fetch is in flight.
      if (!this.loading) this._refresh();
    }, 3000);
  }

  _stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

customElements.define("job-monitor", JobMonitor);
