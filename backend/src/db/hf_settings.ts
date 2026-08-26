import { getSetting, setSetting } from "./settings.ts";

const PREFIX = "huggingface_";

/** The admin-stored HuggingFace token ("" when unset). */
export function getHfToken(): string {
  return getSetting(PREFIX + "token", "");
}

export interface HfSettingsView {
  tokenSet: boolean;
  /** Where the effective token comes from: the settings row, the HF_TOKEN env, or neither. */
  tokenSource: "settings" | "env" | "none";
}

export function getHfSettingsView(): HfSettingsView {
  const tokenSet = getHfToken().length > 0;
  const tokenSource: HfSettingsView["tokenSource"] = tokenSet
    ? "settings"
    : Deno.env.get("HF_TOKEN")
    ? "env"
    : "none";
  return { tokenSet, tokenSource };
}

export function updateHfToken(token: string): HfSettingsView {
  setSetting(PREFIX + "token", token);
  return getHfSettingsView();
}
