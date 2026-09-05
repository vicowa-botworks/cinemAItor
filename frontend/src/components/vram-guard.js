import { html } from "lit";
import { api } from "../api.js";
import { formatGb, hardwareOf, vramPreCheck, vramSufficient } from "./asset-generation.js";
import "./vram-choice-dialog.js";

/**
 * Shared pre-submit VRAM guard for generation forms (local_cli models).
 *
 * Hosts extend it (VramGuard(LitElement)), call `await this.resolveVramDevice(model)`
 * right before queueing a generation job, and embed `${this.vramDialog}` in their
 * template. The gate is fail-open: any unknown (no model, not local_cli, no
 * declared requirement, no GPU, VRAM numbers missing, or the hardware endpoint
 * erroring) resolves to `null` and lets the runner's own auto fallback decide.
 *
 * `resolveVramDevice` resolves to:
 *   null     — no check applied → queue without a device
 *   "cpu"    — the user accepted the slow path → queue with device=cpu
 *   "cuda"   — "free up VRAM" + recheck confirmed enough VRAM → queue with device=cuda
 *   "cancel" — the user dismissed the dialog → the host must abort the submit
 */
export const VramGuard = (superClass) =>
  class extends superClass {
    constructor() {
      super();
      this._vram = {
        open: false,
        requirementGb: "",
        freeGb: "",
        gpuModel: "",
        rechecking: false,
      };
      this._vramModel = null;
      this._vramResolve = null;
    }

    /**
     * Run the pre-submit VRAM check for the model(s) the job will run on. Pass
     * a single model when the host knows exactly which one the backend will
     * use, or an array of candidates when the backend picks among them (e.g.
     * scene generation falls back to i2v or t2v by link state). With an array,
     * the dialog opens for the first candidate that is short on VRAM — a safe
     * superset, so a model that can't fit is never silently left to the
     * runner's fallback. The chosen device still applies to whatever model the
     * backend ultimately picks.
     * @param {{backend?: string, vram_requirement_mb?: number|null} | null | Array<{{backend?: string, vram_requirement_mb?: number|null} | null>} models
     * @returns {Promise<null | "cpu" | "cuda" | "cancel">}
     */
    async resolveVramDevice(models) {
      const list = Array.isArray(models) ? models : [models];
      for (const model of list) {
        const result = await this._resolveVramDeviceOne(model);
        if (result !== null) return result;
      }
      return null;
    }

    /** @param {{backend?: string, vram_requirement_mb?: number|null} | null | undefined} model */
    async _resolveVramDeviceOne(model) {
      if (!model || model.backend !== "local_cli") return null;
      if (
        !(
          typeof model.vram_requirement_mb === "number" &&
          model.vram_requirement_mb > 0
        )
      ) return null;
      let hw;
      try {
        // Probe live, never the 60s cache: the runner's own auto-fallback reads
        // real free VRAM at run time, so a stale "enough" here would stay silent
        // while the job quietly drops to CPU. A ~100ms nvidia-smi beat is cheap
        // next to a GPU run the user could have had.
        hw = await api.getModelsHardware({ refresh: true });
      } catch {
        return null; // VRAM indeterminate — let the runner decide.
      }
      const check = vramPreCheck(model, hardwareOf(hw));
      if (!check.needed) return null;
      // If VRAM auto-unload is enabled, free the local GPU services once and
      // re-probe — if that's enough, continue on the GPU without a dialog.
      if (await this._tryAutoFreeVram(model)) return "cuda";
      this._vram = {
        open: true,
        requirementGb: formatGb(check.requirementMb),
        freeGb: formatGb(check.freeMb),
        gpuModel: check.gpuModel ?? "",
        rechecking: false,
      };
      this._vramModel = model;
      this.requestUpdate();
      return new Promise((resolve) => {
        this._vramResolve = resolve;
      });
    }

    /**
     * When VRAM auto-unload is enabled, ask the backend to free the detected
     * local GPU services (ComfyUI / llama router) once, then re-probe live.
     * Best-effort: any failure (settings read, free call, re-probe) returns
     * false so the caller falls through to the dialog.
     * @param {{backend?: string, vram_requirement_mb?: number|null}} model
     * @returns {Promise<boolean>} true if VRAM is now sufficient after freeing
     */
    async _tryAutoFreeVram(model) {
      try {
        const settings = await api.getVramUnloadSettings();
        if (!settings?.enabled) return false;
        const freed = await api.freeVramUnload();
        if (!Array.isArray(freed?.results) || !freed.results.some((r) => r.ok)) {
          return false; // nothing was actually freed — no point re-probing
        }
        const hw = await api.getModelsHardware({ refresh: true });
        return vramSufficient(model, hardwareOf(hw));
      } catch {
        return false;
      }
    }

    settleVram(value) {
      if (!this._vramResolve) return;
      const resolve = this._vramResolve;
      this._vramResolve = null;
      this._vram = { ...this._vram, open: false, rechecking: false };
      this.requestUpdate();
      resolve(value);
    }

    onVramChoose(e) {
      this.settleVram(e.detail?.device ?? "cpu");
    }

    onVramCancel() {
      this.settleVram("cancel");
    }

    onVramRecheck() {
      if (!this._vramResolve || this._vram.rechecking) return;
      const model = this._vramModel;
      this._vram = { ...this._vram, rechecking: true };
      this.requestUpdate();
      api
        .getModelsHardware({ refresh: true })
        .then((hw) => {
          if (vramSufficient(model, hardwareOf(hw))) {
            this.settleVram("cuda"); // enough now — continue on the GPU
            return;
          }
          const check = vramPreCheck(model, hardwareOf(hw));
          this._vram = {
            ...this._vram,
            rechecking: false,
            requirementGb: formatGb(check.requirementMb),
            freeGb: formatGb(check.freeMb),
            gpuModel: check.gpuModel ?? "",
          };
          this.requestUpdate();
        })
        .catch(() => {
          this._vram = { ...this._vram, rechecking: false };
          this.requestUpdate();
        });
    }

    get vramDialog() {
      return html`
        <vram-choice-dialog
          .open=${this._vram.open}
          .requirementGb=${this._vram.requirementGb}
          .freeGb=${this._vram.freeGb}
          .gpuModel=${this._vram.gpuModel}
          .rechecking=${this._vram.rechecking}
          @choose=${this.onVramChoose}
          @recheck=${this.onVramRecheck}
          @cancel=${this.onVramCancel}></vram-choice-dialog>
      `;
    }
  };
