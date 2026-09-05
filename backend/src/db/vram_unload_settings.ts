import { getSetting, setSetting } from "./settings.ts";

/**
 * VRAM auto-unload settings (settings rows, prefix `vram_unload.`).
 *
 * The master `enabled` flag is what the pre-generation VRAM guard consults:
 * when a local_cli generation's live probe finds too little free VRAM and this
 * is on, the backend frees the configured local services and re-probes before
 * falling back to the CPU/GPU choice dialog. Default is OFF — enabling is an
 * explicit admin choice.
 *
 * The per-target toggles say which detected local services to free (used by
 * both the auto-trigger and the manual "Free now" action). They default on:
 * when you enable the feature, you want the known local VRAM hogs gone.
 */
const PREFIX = "vram_unload.";

function readBool(key: string, fallback: boolean): boolean {
  return getSetting(key, fallback ? "1" : "0") === "1";
}

export interface VramUnloadSettings {
  /** Master switch: auto-free local services in the pre-generation VRAM guard. */
  enabled: boolean;
  /** Which detected local services to free. */
  targets: {
    comfyui: boolean;
    llama: boolean;
  };
}

export function getVramUnloadSettings(): VramUnloadSettings {
  return {
    enabled: readBool(PREFIX + "enabled", false),
    targets: {
      comfyui: readBool(PREFIX + "comfyui", true),
      llama: readBool(PREFIX + "llama", true),
    },
  };
}

/** Partial update; returns the new full view. */
export function updateVramUnloadSettings(
  patch: { enabled?: boolean; comfyui?: boolean; llama?: boolean },
): VramUnloadSettings {
  if (patch.enabled !== undefined) setSetting(PREFIX + "enabled", patch.enabled ? "1" : "0");
  if (patch.comfyui !== undefined) setSetting(PREFIX + "comfyui", patch.comfyui ? "1" : "0");
  if (patch.llama !== undefined) setSetting(PREFIX + "llama", patch.llama ? "1" : "0");
  return getVramUnloadSettings();
}
