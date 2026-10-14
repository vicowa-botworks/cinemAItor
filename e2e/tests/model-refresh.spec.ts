// The Models page must show what the Model Copilot just did, without the user
// reloading it. The copilot's LLM round-trip and proposal approval are stubbed
// in the page (the api singleton is the same module instance the component
// imported), so everything else is real: the turn handler, the refresh it
// triggers, the backend, and the rendered cards.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface State {
  backendUrl: string;
  email: string;
  password: string;
  token: string;
}

/** The model-manager custom element, seen from outside its shadow root. */
type ModelManagerEl = HTMLElement & {
  copilotBusy: boolean;
  models: Array<{ id: string }>;
};

function state(): State {
  return JSON.parse(readFileSync(join(import.meta.dirname, "..", ".state.json"), "utf8")) as State;
}

/** An LLM has to be configured or the copilot panel does not render. */
async function configureLlm(s: State): Promise<void> {
  const res = await fetch(`${s.backendUrl}/api/v1/llm/settings`, {
    method: "PUT",
    headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, base_url: "http://127.0.0.1:9/v1", model: "stub" }),
  });
  expect(res.status).toBe(200);
}

/** Registers a model straight through the API, behind the page's back. */
async function registerModel(s: State, name: string): Promise<string> {
  const res = await fetch(`${s.backendUrl}/api/v1/models`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      name,
      version: "1.0",
      backend: "mock",
      task_types: ["text_to_image"],
      enabled: true,
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Changes a model's settings through the API while the page is looking at it. */
async function patchModel(
  s: State,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${s.backendUrl}/api/v1/models/${id}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
}

async function openModelsPage(page: Page, s: State): Promise<Locator> {
  await page.goto("/");
  const login = page.locator("login-form");
  await login.waitFor({ timeout: 30_000 });
  await login.locator("#email").fill(s.email);
  await login.locator("#password").fill(s.password);
  await login.locator("form").evaluate((el) => el.requestSubmit());
  await page.waitForFunction(
    () => localStorage.getItem("token") !== null && window.location.hash === "#/projects",
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() => {
    window.location.hash = "#/models";
  });
  const manager = page.locator("model-manager");
  await manager.waitFor({ timeout: 30_000 });
  // The copilot panel is on screen once the page has loaded its state.
  await expect
    .poll(() => manager.evaluate((el) => (el as ModelManagerEl).shadowRoot !== null), {
      timeout: 30_000,
    })
    .toBe(true);
  return manager;
}

/** Replaces the copilot's network calls with canned turns. */
async function stubCopilot(
  page: Page,
  replies: Array<Record<string, unknown>>,
  approval: { tool: string; model: { id: string; name: string } },
): Promise<void> {
  await page.evaluate(
    async ({ replies, approval }) => {
      const mod = (await import("/src/api.js")) as { api: Record<string, unknown> };
      let turn = 0;
      mod.api.llmAgent = async () => replies[Math.min(turn++, replies.length - 1)];
      mod.api.llmApproveProposal = async (id: string) => ({
        proposal: { id, tool: approval.tool, args: {}, status: "approved" },
        result: { model: approval.model },
      });
    },
    { replies, approval },
  );
}

function renderedNames(manager: Locator): () => Promise<string[]> {
  return () =>
    manager.evaluate((el) =>
      [...(el as ModelManagerEl).shadowRoot.querySelectorAll(".model-name")]
        .map((n) => n.textContent?.trim() ?? "")
    );
}

async function ask(manager: Locator, text: string): Promise<void> {
  await manager.locator("form.copilot-input textarea").fill(text);
  await manager.locator("form.copilot-input button[type='submit']").click();
  await expect
    .poll(() => manager.evaluate((el) => (el as ModelManagerEl).copilotBusy === false), {
      timeout: 30_000,
    })
    .toBe(true);
}

test.describe("model registry refresh", () => {
  test("a copilot turn that changed a model re-renders the list", async ({ page }) => {
    const s = state();
    await configureLlm(s);
    const manager = await openModelsPage(page, s);

    // The page has already loaded its list, so this model can only appear if
    // the page re-reads the registry.
    const name = "E2E Copilot Updated";
    const modelId = await registerModel(s, name);

    // An auto-approved tool executes inside the turn: there is no proposal
    // card whose click could carry the refresh, so the turn's steps are it.
    await stubCopilot(
      page,
      [{
        reply: "Updated it.",
        steps: [{ tool: "update_model", args: { model_id: modelId }, status: "ok" }],
        proposals: [],
      }],
      { tool: "update_model", model: { id: modelId, name } },
    );
    await ask(manager, "update the model settings");

    await expect
      .poll(renderedNames(manager), { timeout: 15_000, message: `${name} should be on the page` })
      .toContain(name);
  });

  test("an approved registration is revealed even when a filter hides it", async ({ page }) => {
    const s = state();
    await configureLlm(s);
    const manager = await openModelsPage(page, s);

    const name = "E2E Copilot Registered";
    const modelId = await registerModel(s, name);

    // A leftover search that matches nothing: the new row is filtered out.
    await manager.locator("#filter-query").fill("zzz-no-match");
    await expect
      .poll(() => manager.evaluate((el) => (el as ModelManagerEl).models.length), {
        timeout: 15_000,
      })
      .toBe(0);

    await stubCopilot(
      page,
      [
        {
          reply: "I've created a proposal for it.",
          steps: [{ tool: "register_model", args: { name }, status: "proposal" }],
          proposals: [{ id: "prop-1", tool: "register_model", args: { name }, status: "pending" }],
        },
        { reply: "Done — it is registered.", steps: [], proposals: [] },
      ],
      { tool: "register_model", model: { id: modelId, name } },
    );
    await ask(manager, "register that model");

    await manager.locator(".copilot-proposal button").first().click();
    await expect
      .poll(() => manager.evaluate((el) => (el as ModelManagerEl).copilotBusy === false), {
        timeout: 30_000,
      })
      .toBe(true);

    await expect.poll(renderedNames(manager), { timeout: 15_000 }).toContain(name);
    await expect(manager.locator(".notice")).toContainText("Filters were hiding");
  });

  test("an open settings editor follows a change made underneath it", async ({ page }) => {
    const s = state();
    await configureLlm(s);

    const name = "E2E Copilot Settings";
    const modelId = await registerModel(s, name);
    await patchModel(s, modelId, { default_settings: { note: "before" } });
    const manager = await openModelsPage(page, s);

    const row = manager.locator(".model-row").filter({
      has: page.locator(".model-name", { hasText: name }),
    });
    await row.getByRole("button", { name: "Settings", exact: true }).click();
    const editor = row.locator(".settings-editor-input");
    await expect(editor).toHaveValue(/before/);

    // The copilot edits the same row while the box is open and untouched.
    await patchModel(s, modelId, { default_settings: { note: "after" } });
    await stubCopilot(
      page,
      [{
        reply: "Fixed the settings.",
        steps: [{ tool: "update_model", args: { model_id: modelId }, status: "ok" }],
        proposals: [],
      }],
      { tool: "update_model", model: { id: modelId, name } },
    );
    await ask(manager, "fix that model's settings");

    await expect(editor).toHaveValue(/after/);
  });
});
