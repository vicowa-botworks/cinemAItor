/**
 * install-progress — pure formatting helpers for model install progress
 * reports (GET /api/v1/models/install-progress and
 * GET /api/v1/models/:id/install-progress). DOM-free; unit-tested.
 */

/**
 * Format a byte count for display ("42.5 GiB"). Non-finite or negative
 * input renders as an em dash.
 */
export function formatInstallBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes / 1024;
  let i = 0;
  while (i < units.length - 1 && value >= 1024) {
    value /= 1024;
    i += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/**
 * Percentage (0–100, one decimal) of an install progress entry, or null
 * when the total size is unknown (indeterminate).
 */
export function installProgressPercent(state) {
  const received = state?.received_bytes;
  const total = state?.total_bytes;
  if (typeof received !== "number" || !Number.isFinite(received)) return null;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return null;
  const pct = (received / total) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
}

/**
 * Human-readable caption for an install progress entry, e.g.
 * "1.4 GiB of 18.2 GiB (8%) · 12.3 MiB/s". Degrades gracefully when the
 * total or speed is unknown.
 */
export function installProgressLabel(state) {
  const received = state?.received_bytes;
  const total = state?.total_bytes;
  const hasReceived = typeof received === "number" && Number.isFinite(received);
  let label;
  if (hasReceived && typeof total === "number" && Number.isFinite(total) && total > 0) {
    const pct = Math.floor(installProgressPercent(state));
    label = `${formatInstallBytes(received)} of ${formatInstallBytes(total)} (${pct}%)`;
  } else if (hasReceived) {
    label = `${formatInstallBytes(received)} downloaded`;
  } else {
    label = "Connecting…";
  }
  const speed = state?.speed_bytes_per_sec;
  if (typeof speed === "number" && Number.isFinite(speed) && speed > 0) {
    label += ` · ${formatInstallBytes(speed)}/s`;
  }
  return label;
}
