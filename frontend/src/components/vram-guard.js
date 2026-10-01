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
 *
 * Hosts may set `this.vramBypass = true` (demo mode): the interactive dialog
 * is never opened. Instead `resolveVramDevice` hands the most demanding local
 * CLI candidate to `demoVramDevice`, which force-frees the local GPU services
 * (ComfyUI / llama) and re-probes, then resolves "cuda" (it fits) or null
 * (let the runner's live auto-fallback decide) and leaves a `vramNote`
 * warning on the host when the run will drop to the CPU — so an unattended
 * demo never runs silently on the CPU without making the room first.
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
      this._vramNote = null;
    }

    /**
     * A `vramNote` warning left by `resolveVramDevice` in demo (vramBypass)
     * mode — set when the run freed local GPU services or is dropping to the
     * CPU. Demo builders surface it in their narration. Null otherwise.
     * @type {string|null}
     */
    get vramNote() {
      return this._vramNote;
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
     *
     * In demo (vramBypass) mode the loop is skipped: the single most demanding
     * local CLI candidate is decided by `demoVramDevice` (which frees the local
     * GPU services and re-probes) so a run never frees several times over.
     * @param {{backend?: string, vram_requirement_mb?: number|null} | null | Array<{{backend?: string, vram_requirement_mb?: number|null} | null>} models
     * @returns {Promise<null | "cpu" | "cuda" | "cancel">}
     */
    async resolveVramDevice(models) {
      this._vramNote = null;
      const list = Array.isArray(models) ? models : [models];
      if (this.vramBypass) {
        const candidate = list
          .filter(
            (m) =>
              m && m.backend === "local_cli" &&
              typeof m.vram_requirement_mb === "number" &&
              m.vram_requirement_mb > 0,
          )
          .sort((a, b) => b.vram_requirement_mb - a.vram_requirement_mb)[0];
        const decision = await demoVramDevice(candidate);
        this._vramNote = decision.note;
        return decision.device;
      }
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
      // Queue-aware: if the deficit is held by this backend's own in-flight
      // local_cli job(s), the runner frees that VRAM as they finish and runs
      // this job behind them with full VRAM — so queue it (no device) rather
      // than alarming the user. Checked before auto-free: our own VRAM needs
      // no freeing, only patience.
      if (await this._isVramHeldByOurs(model, check)) return null;
      // If VRAM auto-unload is enabled, free the local GPU services once and
      // re-probe — if that's enough, continue on the GPU without a dialog.
      if (await this._tryAutoFreeVram(model)) return "cuda";
      if (this.vramBypass) return null; // demo: no dialog — the runner's live auto-fallback decides
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
     * Queue-aware suppression: true when the model's VRAM deficit is covered by
     * this backend's own in-flight local_cli job(s). The runner frees that VRAM
     * as each job finishes and runs the new job behind them with full VRAM, so a
     * dialog here would be a false alarm. Best-effort — any failure (endpoint
     * error, no GPU holders reported) returns false so the caller falls through
     * to the dialog, the safe default.
     * @param {{backend?: string, vram_requirement_mb?: number|null}} model
     * @param {{freeMb?: number|null, requirementMb?: number|null}} check
     * @returns {Promise<boolean>}
     */
    async _isVramHeldByOurs(model, check) {
      try {
        const held = await api.getModelsVramHeld();
        const cineMb = held?.cinemaitor_mb ?? 0;
        const freeMb = check.freeMb ?? 0;
        const requirementMb = model?.vram_requirement_mb ?? 0;
        return cineMb > 0 && freeMb + cineMb >= requirementMb;
      } catch {
        return false;
      }
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
        if (
          !Array.isArray(freed?.results) || !freed.results.some((r) => r.ok)
        ) {
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

/**
 * Demo/unattended VRAM decision — the no-dialog counterpart of the interactive
 * guard. When a local_cli model won't fit the free VRAM, force-free every
 * detected local GPU service (ComfyUI / llama) regardless of the auto-unload
 * setting, re-probe live, and report the outcome as a narration note. This is
 * what keeps a demo run from silently dropping to the CPU when a local LLM or
 * ComfyUI is hogging the GPU: it makes the room, and tells the user if it
 * still can't. Fail-open: any unknown (no local_cli model, no requirement,
 * the hardware endpoint erroring) resolves to `{device: null, note: null}`.
 *
 * @param {{backend?: string, vram_requirement_mb?: number|null} | null | undefined} model
 *   The model the run will use (for a demo step, the most demanding enabled
 *   candidate for its task type).
 * @returns {Promise<{device: string|null, note: string|null}>}
 *   device "cuda" — freeing made it fit, queue on the GPU; device null — no
 *   local_cli gate, VRAM already sufficient, or still short after freeing
 *   (the runner's own CPU auto-fallback applies); note — a warning to surface
 *   in the narration (null when there is nothing to warn about).
 */
export async function demoVramDevice(model) {
  if (!model || model.backend !== "local_cli") {
    return { device: null, note: null };
  }
  let check;
  try {
    const hw = await api.getModelsHardware({ refresh: true });
    check = vramPreCheck(model, hardwareOf(hw));
  } catch {
    return { device: null, note: null };
  }
  if (!check.needed) return { device: null, note: null };
  // Tight: force-free the local GPU services and re-probe before deciding.
  await _forceFreeVram();
  let refit = false;
  try {
    const hw = await api.getModelsHardware({ refresh: true });
    refit = vramSufficient(model, hardwareOf(hw));
  } catch {
    refit = false;
  }
  if (refit) {
    return {
      device: "cuda",
      note: `Free VRAM was tight (${formatGb(check.freeMb)} free of ` +
        `${formatGb(check.requirementMb)} needed), so I freed the local GPU ` +
        `services first — it fits now and this runs on the GPU.`,
    };
  }
  return {
    device: null,
    note: `Not enough free VRAM (${formatGb(check.freeMb)} free, ` +
      `${formatGb(check.requirementMb)} needed) even after freeing the local ` +
      `GPU services — this runs on the CPU, which is much slower.`,
  };
}

/**
 * Force-free the detected local GPU services (ComfyUI / llama) regardless of
 * the vram_unload settings toggle — the demo equivalent of the guard's
 * `_tryAutoFreeVram`, minus the settings gate. A failure (endpoint absent,
 * nothing to free) is not fatal; the re-probe simply sees no change.
 * @returns {Promise<boolean>} true when at least one service reported freed.
 */
async function _forceFreeVram() {
  try {
    const freed = await api.freeVramUnload({ targets: ["comfyui", "llama"] });
    return Array.isArray(freed?.results) && freed.results.some((r) => r.ok);
  } catch {
    return false;
  }
}
