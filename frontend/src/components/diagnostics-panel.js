import { css, html, LitElement, nothing } from "lit";
import { api } from "../api.js";

const SEVERITIES = ["debug", "info", "warn", "error"];
const CATEGORIES = [
  "log",
  "request",
  "job",
  "render",
  "storage",
  "model",
  "audio",
  "backup",
];

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export class DiagnosticsPanel extends LitElement {
  static styles = css`
    :host {
      display: block;
      max-width: 1000px;
      margin: 0 auto;
      padding: 24px 20px;
    }

    .title {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 16px;
    }

    .card {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: calc(var(--radius) + 4px);
      padding: 16px 18px;
      margin-bottom: 16px;
    }

    .card-title {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
      font-size: 13px;
    }

    .grid .k {
      color: var(--color-text-muted);
      font-size: 11px;
      display: block;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    th,
    td {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid var(--color-border);
      vertical-align: top;
    }

    th {
      color: var(--color-text-muted);
      font-weight: 500;
      font-size: 12px;
    }

    .chip {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      border: 1px solid var(--color-border);
      color: var(--color-text-muted);
    }

    .chip.ok {
      color: #16a34a;
      border-color: #16a34a;
    }

    .chip.bad {
      color: var(--color-error);
      border-color: var(--color-error);
    }

    .btn {
      padding: 6px 14px;
      border: none;
      border-radius: var(--radius);
      font-size: 13px;
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

    .btn-danger {
      background-color: transparent;
      color: var(--color-error);
      border: 1px solid var(--color-error);
    }

    .btn-small {
      padding: 3px 10px;
      font-size: 12px;
    }

    .filters {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: flex-end;
      margin-bottom: 10px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    label {
      font-size: 11px;
      color: var(--color-text-muted);
    }

    select,
    input {
      padding: 6px 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background-color: var(--color-surface);
      color: var(--color-text);
      font-size: 13px;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
      margin-top: 8px;
    }

    .notice {
      color: var(--color-text-muted);
      font-size: 13px;
      margin-top: 8px;
      word-break: break-all;
    }

    .count {
      color: var(--color-text-muted);
      font-size: 12px;
      font-weight: 400;
    }

    .log-msg {
      max-width: 420px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sev-debug {
      color: var(--color-text-muted);
    }

    .sev-info {
      color: #2563eb;
    }

    .sev-warn {
      color: #d97706;
    }

    .sev-error {
      color: var(--color-error);
    }

    .issues {
      margin-top: 8px;
      font-size: 12px;
      color: #d97706;
    }
  `;

  static properties = {
    loading: { state: true },
    error: { state: true },
    hardware: { state: true },
    models: { state: true },
    storage: { state: true },
    logs: { state: true },
    logCategory: { state: true },
    logSeverity: { state: true },
    logSince: { state: true },
    logLimit: { state: true },
    exporting: { state: true },
    exportInfo: { state: true },
    exportError: { state: true },
    projects: { state: true },
    backupProjectId: { state: true },
    backupBusy: { state: true },
    backupMsg: { state: true },
    backups: { state: true },
    restoreTarget: { state: true },
    restoreName: { state: true },
    restoreMsg: { state: true },
  };

  constructor() {
    super();
    this.loading = true;
    this.error = "";
    this.hardware = null;
    this.models = null;
    this.storage = null;
    this.logs = null;
    this.logCategory = "";
    this.logSeverity = "";
    this.logSince = "";
    this.logLimit = "200";
    this.exporting = false;
    this.exportInfo = null;
    this.exportError = "";
    this.projects = [];
    this.backupProjectId = "";
    this.backupBusy = false;
    this.backupMsg = "";
    this.backups = [];
    this.restoreTarget = null;
    this.restoreName = "";
    this.restoreMsg = null;
  }

  async connectedCallback() {
    super.connectedCallback?.();
    await this._loadAll();
  }

  async _loadAll() {
    this.loading = true;
    this.error = "";
    const [hardware, models, storage, logs, projects, backups] = await Promise.allSettled([
      api.getDiagnosticsHardware(),
      api.getDiagnosticsModels(),
      api.getDiagnosticsStorage(),
      this._fetchLogs(),
      api.listProjects(),
      api.listBackups(),
    ]);
    this.hardware = hardware.status === "fulfilled" ? hardware.value : null;
    this.models = models.status === "fulfilled" ? models.value : null;
    this.storage = storage.status === "fulfilled" ? storage.value : null;
    this.logs = logs.status === "fulfilled" ? logs.value : null;
    this.projects = projects.status === "fulfilled" ? projects.value : [];
    this.backups = backups.status === "fulfilled" ? backups.value?.backups ?? [] : [];
    const failed = [hardware, models, storage, logs, projects, backups].filter(
      (r) => r.status === "rejected",
    );
    if (failed.length === 6) {
      this.error = failed[0].reason?.message ?? "Diagnostics unavailable.";
    }
    this.loading = false;
  }

  _logParams() {
    return {
      category: this.logCategory || undefined,
      severity: this.logSeverity || undefined,
      since_hours: this.logSince === "" ? undefined : Number(this.logSince),
      limit: this.logLimit === "" ? undefined : Number(this.logLimit),
    };
  }

  async _fetchLogs() {
    try {
      return await api.getDiagnosticsLogs(this._logParams());
    } catch {
      return null;
    }
  }

  async _applyLogFilters() {
    this.logs = await this._fetchLogs();
  }

  async _refreshSection(kind) {
    if (kind === "hardware") {
      this.hardware = await api.getDiagnosticsHardware().catch(() => null);
    } else if (kind === "models") {
      this.models = await api.getDiagnosticsModels().catch(() => null);
    } else if (kind === "storage") {
      this.storage = await api.getDiagnosticsStorage().catch(() => null);
    }
  }

  async _export() {
    this.exporting = true;
    this.exportInfo = null;
    this.exportError = "";
    try {
      this.exportInfo = await api.exportDiagnostics();
    } catch (e) {
      this.exportError = e.message ?? "Export failed.";
    } finally {
      this.exporting = false;
    }
  }

  async _createBackup() {
    if (!this.backupProjectId) return;
    this.backupBusy = true;
    this.backupMsg = "";
    try {
      const result = await api.createProjectBackup(this.backupProjectId);
      const c = result.counts ?? {};
      this.backupMsg = `Backup created — ${
        Object.entries(c)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      }`;
      this.backups = (await api.listBackups().catch(() => ({ backups: [] })))
        .backups ?? [];
    } catch (e) {
      this.backupMsg = e.message ?? "Backup failed.";
    } finally {
      this.backupBusy = false;
    }
  }

  async _restore(backup) {
    const name = this.restoreName.trim();
    this.restoreMsg = null;
    try {
      const result = await api.restoreBackup(backup.id, name || undefined);
      this.restoreMsg = {
        ok: true,
        text: `Restored as “${result.project_name}” (id ${String(result.project_id).slice(0, 8)})`,
        issues: result.issues ?? [],
        link: `#/project/${result.project_id}`,
      };
      this.restoreTarget = null;
      this.restoreName = "";
    } catch (e) {
      this.restoreMsg = { ok: false, text: e.message ?? "Restore failed." };
      this.restoreTarget = null;
    }
  }

  async _deleteBackup(backup) {
    this.backups = this.backups.filter((b) => b.id !== backup.id);
    await api.deleteBackup(backup.id).catch(() => {});
  }

  render() {
    if (this.loading) {
      return html`
        <div class="title">Diagnostics</div>
        <div class="notice">Loading reports…</div>
      `;
    }
    return html`
      <div class="title">Diagnostics</div>
      ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
      ${this._renderHardwareCard()}
      ${this._renderModelsCard()}
      ${this._renderStorageCard()}
      ${this._renderLogsCard()}
      ${this._renderExportCard()}
      ${this._renderBackupsCard()}
    `;
  }

  _sectionHead(title, kind) {
    return html`
      <div class="card-title">
        <span>${title}</span>
        <button
          class="btn btn-secondary btn-small"
          @click=${() => this._refreshSection(kind)}>
          Refresh
        </button>
      </div>
    `;
  }

  _renderHardwareCard() {
    const h = this.hardware;
    const hw = h?.hardware;
    return html`
      <div class="card">
        ${this._sectionHead("Hardware", "hardware")}
        ${h
          ? html`
            <div class="grid">
              <div><span class="k">Platform</span>${h.platform} / ${h.arch}</div>
              <div><span class="k">Deno</span>${h.deno}</div>
              <div><span class="k">Uptime</span>${formatUptime(h.uptime_sec)}</div>
              <div><span class="k">CPU cores</span>${hw?.cpu_count ?? "—"}</div>
              <div><span class="k">Memory</span>${hw?.mem_total_mb !== null &&
                  hw?.mem_total_mb !== undefined
                ? `${formatBytes(hw.mem_total_mb * 1024 * 1024)}`
                : "—"}</div>
              <div><span class="k">GPU</span>${hw?.gpu?.name ?? "none detected"}</div>
            </div>
            ${hw?.gpu
              ? html`<div class="notice" style="margin-top:8px;">
                ${
                hw.gpu.vram_bytes !== null && hw.gpu.vram_bytes !== undefined
                  ? `VRAM ${formatBytes(hw.gpu.vram_bytes)} · `
                  : nothing
              }${hw.gpu.driver ?? "driver unknown"}
              </div>`
              : nothing}
          `
          : html`<div class="error">Hardware report unavailable.</div>`}
      </div>
    `;
  }

  _renderModelsCard() {
    const m = this.models;
    return html`
      <div class="card">
        ${this._sectionHead("Model health", "models")}
        ${m
          ? html`
            <div class="grid" style="margin-bottom:10px;">
              <div><span class="k">Total</span>${m.total}</div>
              <div><span class="k">Enabled</span>${m.enabled}</div>
              <div><span class="k">Unhealthy</span>${m.unhealthy}</div>
            </div>
            ${m.models.length > 0
              ? html`
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Backend</th>
                      <th>Enabled</th>
                      <th>Status</th>
                      <th>Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${m.models.map(
                      (row) =>
                        html`
                          <tr>
                            <td>${row.name}</td>
                            <td>${row.backend}</td>
                            <td>${row.enabled ? "yes" : "no"}</td>
                            <td>
                              <span
                                class="chip ${row.health_status === "healthy"
                                  ? "ok"
                                  : row.health_status
                                  ? "bad"
                                  : ""}">
                                ${row.health_status ?? "unchecked"}
                              </span>
                            </td>
                            <td>${row.health_error ?? ""}</td>
                          </tr>
                        `,
                    )}
                  </tbody>
                </table>
              `
              : html`<div class="notice">No models registered.</div>`}
          `
          : html`<div class="error">Models report unavailable.</div>`}
      </div>
    `;
  }

  _renderStorageCard() {
    const s = this.storage;
    return html`
      <div class="card">
        ${this._sectionHead("Storage", "storage")}
        ${s
          ? html`
            <div class="grid" style="margin-bottom:10px;">
              <div>
                <span class="k">App data dir</span>${s.app_data_dir}
              </div>
              <div><span class="k">Database</span>${formatBytes(s.database_bytes)}</div>
              <div><span class="k">Content store</span>${s.content_store
                .files} files · ${formatBytes(s.content_store.bytes)}</div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Directory</th>
                  <th>Files</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                ${s.directories.map(
                  (d) =>
                    html`
                      <tr>
                        <td>${d.path}</td>
                        <td>${d.files}</td>
                        <td>${formatBytes(d.bytes)}</td>
                      </tr>
                    `,
                )}
              </tbody>
            </table>
            ${s.content_store.orphaned.length > 0
              ? html`<div class="issues">
                Orphaned content files (${s.content_store.orphaned.length}):
                ${s.content_store.orphaned.slice(0, 5).join(", ")}${
                s.content_store.orphaned.length > 5 ? "…" : ""
              }
              </div>`
              : nothing}
            ${s.missing_versions.length > 0
              ? html`<div class="issues">
                Missing media on disk: ${s.missing_versions.length} version(s)
              </div>`
              : nothing}
          `
          : html`<div class="error">Storage report unavailable.</div>`}
      </div>
    `;
  }

  _renderLogsCard() {
    const logs = this.logs;
    return html`
      <div class="card">
        <div class="card-title">
          <span>Recent diagnostics log <span class="count">
            (${logs ? `${logs.count} total` : ""})
          </span></span>
          <button class="btn btn-secondary btn-small" @click=${this._applyLogFilters}>
            Apply filters
          </button>
        </div>
        <div class="filters">
          <div class="field">
            <label>Category</label>
            <select
              .value=${this.logCategory}
              @change=${(e) => (this.logCategory = e.target.value)}>
              <option value="">all</option>
              ${CATEGORIES.map(
                (c) => html`<option value=${c}>${c}</option>`,
              )}
            </select>
          </div>
          <div class="field">
            <label>Severity</label>
            <select
              .value=${this.logSeverity}
              @change=${(e) => (this.logSeverity = e.target.value)}>
              <option value="">all</option>
              ${SEVERITIES.map(
                (s) => html`<option value=${s}>${s}</option>`,
              )}
            </select>
          </div>
          <div class="field">
            <label>Since (hours)</label>
            <input
              type="number"
              min="0"
              .value=${this.logSince}
              @change=${(e) => (this.logSince = e.target.value)}
              placeholder="all"
              style="width:90px;">
          </div>
          <div class="field">
            <label>Limit</label>
            <input
              type="number"
              min="1"
              max="1000"
              .value=${this.logLimit}
              @change=${(e) => (this.logLimit = e.target.value)}
              style="width:90px;">
          </div>
        </div>
        ${logs
          ? html`
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Severity</th>
                  <th>Category</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                ${logs.entries.length === 0
                  ? html`
                    <tr>
                      <td colspan="4" class="notice">No entries.</td>
                    </tr>
                  `
                  : logs.entries.map(
                    (e) =>
                      html`
                        <tr>
                          <td style="white-space:nowrap;">
                            ${new Date(e.created_at).toLocaleString()}
                          </td>
                          <td class="sev-${e.severity}">${e.severity}</td>
                          <td>${e.category}</td>
                          <td class="log-msg" title=${e.message}>${e.message}</td>
                        </tr>
                      `,
                  )}
              </tbody>
            </table>
          `
          : html`<div class="error">Log report unavailable.</div>`}
      </div>
    `;
  }

  _renderExportCard() {
    return html`
      <div class="card">
        <div class="card-title"><span>Export diagnostics bundle</span></div>
        <div class="notice" style="margin-top:0;margin-bottom:10px;">
          Writes a redacted JSON bundle (hardware, models, storage, recent
          logs) to the server. Admin only — safe to share with support.
        </div>
        <button class="btn" ?disabled=${this.exporting} @click=${this._export}>
          ${this.exporting ? "Exporting…" : "Export"}
        </button>
        ${this.exportError ? html`<div class="error">${this.exportError}</div>` : nothing}
        ${this.exportInfo
          ? html`<div class="notice">
            Wrote ${formatBytes(this.exportInfo.size)} to ${this.exportInfo.path}
            (${this.exportInfo.generated_at})
          </div>`
          : nothing}
      </div>
    `;
  }

  _renderBackupsCard() {
    return html`
      <div class="card">
        <div class="card-title">
          <span>Project backups <span class="count">
            (${this.backups.length})
          </span></span>
        </div>
        <div class="filters">
          <div class="field">
            <label>Project</label>
            <select
              .value=${this.backupProjectId}
              ?disabled=${this.backupBusy}
              @change=${(e) => (this.backupProjectId = e.target.value)}>
              <option value="">select a project…</option>
              ${this.projects.map(
                (p) => html`<option value=${p.id}>${p.name}</option>`,
              )}
            </select>
          </div>
          <button
            class="btn"
            ?disabled=${this.backupBusy || !this.backupProjectId}
            @click=${this._createBackup}>
            ${this.backupBusy ? "Backing up…" : "Create backup"}
          </button>
        </div>
        ${this.backupMsg ? html`<div class="notice">${this.backupMsg}</div>` : nothing}
        ${this.restoreMsg
          ? html`
            <div class="notice ${this.restoreMsg.ok ? "" : "error"}">
              ${this.restoreMsg.text}
            </div>
            ${this.restoreMsg.issues?.length
              ? html`<div class="issues">
                ${
                this.restoreMsg.issues.map(
                  (i) => html`<div>· ${i}</div>`,
                )
              }
              </div>`
              : nothing}
            ${this.restoreMsg.link
              ? html`
                <div class="notice">
                  <a
                    href=${this.restoreMsg.link}
                    style="color:var(--color-primary);text-decoration:none;">
                                  Open the restored project ↗
                                </a>
                </div>
              `
              : nothing}
          `
          : nothing}
        ${this.backups.length === 0 ? html`<div class="notice">No backups yet.</div>` : html`
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Created</th>
                <th>Recorded by</th>
                <th>Contents</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${this.backups.map((b) =>
                html`
                  <tr>
                    <td>${b.project_name}</td>
                    <td style="white-space:nowrap;">
                      ${new Date(b.created_at).toLocaleString()}
                    </td>
                    <td>${String(b.created_by_user_id ?? "")}</td>
                    <td style="white-space:nowrap; font-size:12px;">
                      ${Object.entries(b.counts ?? {})
                        .map(([k, v]) => `${k}:${v}`)
                        .join(" ")}
                    </td>
                    <td style="white-space:nowrap;">
                      <button
                        class="btn btn-secondary btn-small"
                        @click=${() => {
                          this.restoreTarget = b;
                          this.restoreName = "";
                        }}>
                        Restore…
                      </button>
                      <button
                        class="btn btn-danger btn-small"
                        style="margin-left:6px;"
                        @click=${() => this._deleteBackup(b)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                  ${this.restoreTarget?.id === b.id
                    ? html`
                      <tr>
                        <td colspan="5">
                          <div class="filters" style="margin:6px 0;">
                            <div class="field">
                              <label
                              >Restore as (blank = “${b.project_name} (restored)”)
                                                  </label>
                              <input
                                type="text"
                                .value=${this.restoreName}
                                @keyup=${(e) => {
                                  if (e.key === "Enter") this._restore(b);
                                }}>
                            </div>
                            <button class="btn btn-small" @click=${() => this._restore(b)}>
                                                  Confirm restore
                                                </button>
                            <button
                              class="btn btn-secondary btn-small"
                              @click=${() => (this.restoreTarget = null)}>
                                                  Cancel
                                                </button>
                          </div>
                        </td>
                      </tr>
                    `
                    : nothing}
                `
              )}
            </tbody>
          </table>
        `}
      </div>
    `;
  }
}

customElements.define("diagnostics-panel", DiagnosticsPanel);
