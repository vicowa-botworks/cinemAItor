import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb, getDb } from "../src/db/database.ts";
import {
  getLlmSettings,
  getLlmSettingsView,
  isLlmConfigured,
  updateLlmSettings,
} from "../src/db/llm_settings.ts";

describe("llm settings store", () => {
  beforeEach(() => {
    closeDb();
    getDb(":memory:");
  });
  afterEach(() => {
    closeDb();
  });

  it("defaults to disabled and empty", () => {
    const s = getLlmSettings();
    assertEquals(s, {
      enabled: false,
      baseUrl: "",
      apiKey: "",
      model: "",
      temperature: "",
      maxTokens: "",
      timeoutSeconds: 60,
    });
    assertEquals(isLlmConfigured(), false);
  });

  it("round-trips a full update and masks the key in the view", () => {
    const view = updateLlmSettings({
      enabled: true,
      baseUrl: "http://127.0.0.1:11434/v1/",
      apiKey: "secret-key",
      model: "qwen2.5:14b",
      temperature: "0.7",
      maxTokens: "2048",
      timeoutSeconds: 90,
    });
    assertEquals(view, {
      enabled: true,
      baseUrl: "http://127.0.0.1:11434/v1/",
      apiKeySet: true,
      model: "qwen2.5:14b",
      temperature: "0.7",
      maxTokens: "2048",
      timeoutSeconds: 90,
    });
    // The raw key is only reachable through the full (internal) getter.
    assertEquals(getLlmSettings().apiKey, "secret-key");
    assert(!("apiKey" in view));
    assertEquals(isLlmConfigured(), true);
  });

  it("partial updates keep the other fields", () => {
    updateLlmSettings({
      enabled: true,
      baseUrl: "http://llama.local/v1",
      model: "mistral",
    });
    const view = updateLlmSettings({ temperature: "0.2" });
    assertEquals(view.model, "mistral");
    assertEquals(view.temperature, "0.2");
    assertEquals(view.enabled, true);
    assertEquals(view.baseUrl, "http://llama.local/v1");
  });

  it("null clears the API key", () => {
    updateLlmSettings({ apiKey: "abc" });
    assertEquals(getLlmSettingsView().apiKeySet, true);
    const view = updateLlmSettings({ apiKey: null });
    assertEquals(view.apiKeySet, false);
    assertEquals(getLlmSettings().apiKey, "");
  });

  it("configured requires enabled + base url + model name", () => {
    updateLlmSettings({ baseUrl: "http://x", model: "m" });
    assertEquals(isLlmConfigured(), false);
    updateLlmSettings({ enabled: true });
    assertEquals(isLlmConfigured(), true);
    updateLlmSettings({ model: "" });
    assertEquals(isLlmConfigured(), false);
    updateLlmSettings({ model: "m" });
    assertEquals(isLlmConfigured(), true);
    updateLlmSettings({ baseUrl: "" });
    assertEquals(isLlmConfigured(), false);
  });

  it("trims url and model values", () => {
    const view = updateLlmSettings({
      baseUrl: "  http://a.b  ",
      model: "  my-model  ",
    });
    assertEquals(view.baseUrl, "http://a.b");
    assertEquals(view.model, "my-model");
  });
});
