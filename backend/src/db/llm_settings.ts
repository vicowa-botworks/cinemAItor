import { getSetting, setSetting } from "./settings.ts";

export interface LlmSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: string;
  maxTokens: string;
  timeoutSeconds: number;
}

export type LlmSettingsView = Omit<LlmSettings, "apiKey"> & {
  apiKeySet: boolean;
};

const PREFIX = "llm_";

export function getLlmSettings(): LlmSettings {
  return {
    enabled: getSetting(PREFIX + "enabled", "0") === "1",
    baseUrl: getSetting(PREFIX + "base_url", ""),
    apiKey: getSetting(PREFIX + "api_key", ""),
    model: getSetting(PREFIX + "model", ""),
    temperature: getSetting(PREFIX + "temperature", ""),
    maxTokens: getSetting(PREFIX + "max_tokens", ""),
    timeoutSeconds: Number(getSetting(PREFIX + "timeout_seconds", "60")),
  };
}

export function getLlmSettingsView(): LlmSettingsView {
  const s = getLlmSettings();
  return {
    enabled: s.enabled,
    baseUrl: s.baseUrl,
    apiKeySet: s.apiKey.length > 0,
    model: s.model,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    timeoutSeconds: s.timeoutSeconds,
  };
}

/** The LLM is usable when it is enabled and both the URL and model name are set. */
export function isLlmConfigured(): boolean {
  const s = getLlmSettings();
  return s.enabled && s.baseUrl.trim().length > 0 && s.model.trim().length > 0;
}

export interface LlmSettingsUpdate {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string | null;
  model?: string;
  temperature?: string;
  maxTokens?: string;
  timeoutSeconds?: number;
}

export function updateLlmSettings(
  update: LlmSettingsUpdate,
): LlmSettingsView {
  const current = getLlmSettings();
  const next: LlmSettings = { ...current };

  if (update.enabled !== undefined) next.enabled = update.enabled;
  if (update.baseUrl !== undefined) next.baseUrl = update.baseUrl.trim();
  if (update.apiKey !== undefined) {
    next.apiKey = update.apiKey === null ? "" : update.apiKey;
  }
  if (update.model !== undefined) next.model = update.model.trim();
  if (update.temperature !== undefined) next.temperature = update.temperature.trim();
  if (update.maxTokens !== undefined) next.maxTokens = update.maxTokens.trim();
  if (update.timeoutSeconds !== undefined) next.timeoutSeconds = update.timeoutSeconds;

  setSetting(PREFIX + "enabled", next.enabled ? "1" : "0");
  setSetting(PREFIX + "base_url", next.baseUrl);
  setSetting(PREFIX + "api_key", next.apiKey);
  setSetting(PREFIX + "model", next.model);
  setSetting(PREFIX + "temperature", next.temperature);
  setSetting(PREFIX + "max_tokens", next.maxTokens);
  setSetting(PREFIX + "timeout_seconds", String(next.timeoutSeconds));
  return getLlmSettingsView();
}
