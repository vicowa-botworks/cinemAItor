// Boots a throwaway backend + frontend pair on dedicated ports, creates the
// first (admin) user, and writes .state.json for the tests + teardown.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8223);
const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 8224);
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const ADMIN_EMAIL = "e2e-admin@cinemaitor.local";
const ADMIN_PASSWORD = "e2e-admin-password-123";

const root = resolve(import.meta.dirname, "..");
const statePath = join(import.meta.dirname, ".state.json");

interface State {
  backendUrl: string;
  frontendUrl: string;
  email: string;
  password: string;
  token: string;
  pids: number[];
  tmpDir: string;
}

export default async function setup(): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "cinemaitor-e2e-"));
  const children: ChildProcess[] = [];
  const logs: string[] = [];

  const spawnServer = (
    name: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
  ): void => {
    const child = spawn("deno", ["run", "--no-check", ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = (data: Buffer): void => {
      logs.push(`[${name}] ${data.toString()}`);
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", (err) => logs.push(`[${name}] spawn error: ${err.message}`));
    children.push(child);
  };

  try {
    spawnServer(
      "backend",
      [
        "--allow-net",
        "--allow-env",
        "--allow-read",
        "--allow-write",
        "--allow-ffi",
        "--allow-run",
        "src/server.ts",
      ],
      join(root, "backend"),
      {
        PORT: String(BACKEND_PORT),
        JWT_SECRET: "e2e-test-secret",
        DB_PATH: join(tmpDir, "e2e.db"),
        APP_DATA_DIR: join(tmpDir, "app_data"),
        LOG_LEVEL: "warn",
      },
    );
    spawnServer(
      "frontend",
      ["--allow-net", "--allow-env", "--allow-read", "src/server.js"],
      join(root, "frontend"),
      {
        FRONTEND_PORT: String(FRONTEND_PORT),
        BACKEND_URL,
      },
    );

    await waitForHttp(`${BACKEND_URL}/api/v1/health`, 60_000, logs);
    await waitForHttp(`${FRONTEND_URL}/`, 30_000, logs);

    const boot = await fetch(`${BACKEND_URL}/api/v1/auth/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        display_name: "E2E Admin",
      }),
    });
    if (boot.status !== 201) {
      throw new Error(`bootstrap failed: ${boot.status} ${await boot.text()}`);
    }
    const bootBody = (await boot.json()) as { token: string };

    const state: State = {
      backendUrl: BACKEND_URL,
      frontendUrl: FRONTEND_URL,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      token: bootBody.token,
      pids: children.map((c) => c.pid).filter((pid): pid is number => pid !== undefined),
      tmpDir,
    };
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (err) {
    for (const child of children) {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
    if (logs.length > 0) console.error(logs.slice(-40).join("\n"));
    throw err;
  }
}

async function waitForHttp(
  url: string,
  timeoutMs: number,
  logs: string[],
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    if (Date.now() > deadline) {
      if (logs.length > 0) console.error(logs.slice(-40).join("\n"));
      throw new Error(`Timed out waiting for ${url}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
