import { api } from "./api.js";

// The dev backend listens on a fixed port and the browser cannot ride the
// fetch-based dev proxy for a WebSocket upgrade, so the socket connects
// straight to the backend origin. Polling stays as a fallback, so a failed
// connection (wrong port, backend down) silently degrades to the old behavior.
const BACKEND_WS_PORT = 8123;
const RECONNECT_MAX_DELAY = 30000;

class JobEventClient {
  #ws = null;
  #listeners = new Set();
  #intentionalClose = false;
  #reconnectTimer = null;
  #reconnectDelay;
  #reconnectBase;

  constructor(options = {}) {
    this.#reconnectBase = options.reconnectBaseMs ?? 1000;
    this.#reconnectDelay = this.#reconnectBase;
  }

  get connected() {
    return (
      this.#ws !== null &&
      (this.#ws.readyState === WebSocket.OPEN ||
        this.#ws.readyState === WebSocket.CONNECTING)
    );
  }

  /**
   * Registers a listener for live job events and ensures the socket is
   * connected. Returns an unsubscribe function; the socket closes when the
   * last listener is removed.
   *
   * Messages are `{ kind: "progress" | "status" }` plus exactly one of
   * `jobId` (generation jobs) or `renderId` (render jobs), with `progress`
   * (0-100) on progress messages and `status` on status messages.
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    this.#intentionalClose = false;
    this._ensureConnection();
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) this.close();
    };
  }

  close() {
    this.#intentionalClose = true;
    this._clearReconnectTimer();
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  _ensureConnection() {
    if (this.#intentionalClose || this.#listeners.size === 0) return;
    if (this.connected) return;
    const token = api.getToken();
    if (!token) return;
    this._clearReconnectTimer();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.hostname}:${BACKEND_WS_PORT}` +
      `/ws/v1/jobs?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.#ws = ws;
    ws.onopen = () => {
      this.#reconnectDelay = this.#reconnectBase;
    };
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message !== "object") return;
      for (const listener of this.#listeners) {
        try {
          listener(message);
        } catch {
          // A broken listener must not take down the socket.
        }
      }
    };
    const onDown = () => {
      if (this.#ws !== ws) return; // superseded by a newer connection
      this.#ws = null;
      if (this.#intentionalClose || this.#listeners.size === 0) return;
      this._clearReconnectTimer();
      this.#reconnectTimer = setTimeout(() => {
        this.#reconnectTimer = null;
        this._ensureConnection();
      }, this.#reconnectDelay);
      this.#reconnectDelay = Math.min(
        this.#reconnectDelay * 2,
        RECONNECT_MAX_DELAY,
      );
    };
    ws.onclose = onDown;
    ws.onerror = () => {
      ws.close();
    };
  }

  _clearReconnectTimer() {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }
}

export const jobEvents = new JobEventClient();
export { JobEventClient };
