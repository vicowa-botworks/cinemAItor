// Minimal in-browser smoke test: boots the real backend + frontend (see
// global-setup.ts) and verifies the app's ES module graph loads, the UI
// login works, and the assets page renders. Catches browser-only breakage
// that the Deno-side checks cannot see (e.g. a syntax error in a component
// that fails module parsing in the browser).
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface State {
  email: string;
  password: string;
  token: string;
}

function state(): State {
  return JSON.parse(readFileSync(join(import.meta.dirname, "..", ".state.json"), "utf8")) as State;
}

// Every component the app graph registers on boot; if any module in the
// graph fails to parse, none of these get defined and this test fails.
const BOOT_COMPONENTS = [
  "app-root",
  "login-form",
  "project-list",
  "asset-list",
  "asset-generate",
  "asset-reference-picker",
  "timeline-detail",
  "job-monitor",
];

function collectFatalErrors(page: Page): string[] {
  const fatal: string[] = [];
  page.on("pageerror", (err) => fatal.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/SyntaxError|Failed to load (module )?script|Uncaught/i.test(text)) {
      fatal.push(`console: ${text}`);
    }
  });
  return fatal;
}

test.describe("smoke", () => {
  test("app boots with a fully loaded module graph", async ({ page }) => {
    const fatal = collectFatalErrors(page);
    await page.goto("/");
    await page.waitForSelector("login-form", { timeout: 30_000 });
    await page.waitForFunction(
      (names) => names.every((n) => customElements.get(n) !== undefined),
      BOOT_COMPONENTS,
      { timeout: 30_000 },
    );
    expect(fatal).toEqual([]);
  });

  test("login via the UI, then the assets page renders", async ({ page }) => {
    const s = state();
    const fatal = collectFatalErrors(page);
    await page.goto("/");
    const login = page.locator("login-form");
    await login.waitFor({ timeout: 30_000 });
    await login.locator("#email").fill(s.email);
    await login.locator("#password").fill(s.password);
    await login.locator("form").evaluate((el) => el.requestSubmit());
    await page.waitForFunction(
      () =>
        localStorage.getItem("token") !== null &&
        window.location.hash === "#/projects",
      undefined,
      { timeout: 30_000 },
    );

    await page.evaluate(() => {
      window.location.hash = "#/assets";
    });
    const list = page.locator("asset-list");
    await list.waitFor({ timeout: 30_000 });
    // asset-list lives inside app-root's shadow root, so document.querySelector
    // cannot see it — evaluate against the resolved element instead.
    await expect
      .poll(
        async () => list.evaluate((el) => (el as HTMLElement).shadowRoot !== null),
        { timeout: 30_000 },
      )
      .toBe(true);
    expect(fatal).toEqual([]);
  });
});
