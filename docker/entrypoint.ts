/**
 * Production supervisor for the container entrypoint (FND-013).
 *
 * Spawns the backend and frontend Deno servers as children, bootstraps a
 * stable JWT_SECRET when none is provided (persisted under the data dir so it
 * survives container restarts), forwards SIGTERM/SIGINT to both children, and
 * exits with a non-zero code if either child dies on its own.
 */

const root = new URL("..", import.meta.url);
const dataDir = Deno.env.get("APP_DATA_DIR") ?? "/data";

function resolveJwtSecret(): string {
  const provided = Deno.env.get("JWT_SECRET");
  if (provided) return provided;

  const secretPath = `${dataDir}/.jwt_secret`;
  try {
    const stored = Deno.readTextFileSync(secretPath).trim();
    if (stored.length >= 32) {
      console.log(`[entrypoint] Reusing JWT secret from ${secretPath}`);
      return stored;
    }
  } catch {
    // no stored secret yet
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  Deno.mkdirSync(dataDir, { recursive: true });
  Deno.writeTextFileSync(secretPath, secret, { mode: 0o600 });
  console.log(
    `[entrypoint] JWT_SECRET not set — generated one and stored at ${secretPath}.`,
  );
  console.log(
    "[entrypoint] Set the JWT_SECRET environment variable to control it explicitly.",
  );
  return secret;
}

const jwtSecret = resolveJwtSecret();

const childEnv: Record<string, string> = {
  ...Deno.env.toObject(),
  JWT_SECRET: jwtSecret,
  APP_DATA_DIR: dataDir,
  DB_PATH: Deno.env.get("DB_PATH") ?? `${dataDir}/cinemaItor.db`,
};

const backend = new Deno.Command(Deno.execPath(), {
  args: ["run", "-A", "src/server.ts"],
  cwd: new URL("backend", root),
  env: childEnv,
  stdout: "inherit",
  stderr: "inherit",
});
const frontend = new Deno.Command(Deno.execPath(), {
  args: ["run", "-A", "src/server.js"],
  cwd: new URL("frontend", root),
  env: childEnv,
  stdout: "inherit",
  stderr: "inherit",
});

const backendProcess = backend.spawn();
const frontendProcess = frontend.spawn();

console.log("Starting both servers... (production entrypoint)");
console.log("Backend:  http://localhost:8123");
console.log("Frontend: http://localhost:8124");

let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\nShutting down...");
  backendProcess.kill("SIGTERM");
  frontendProcess.kill("SIGTERM");
  // Give children a moment to drain, then force-kill any stragglers.
  const deadline = setTimeout(() => {
    try {
      backendProcess.kill("SIGKILL");
    } catch { /* already gone */ }
    try {
      frontendProcess.kill("SIGKILL");
    } catch { /* already gone */ }
  }, 5000);
  Promise.all([backendProcess.status, frontendProcess.status]).then(() => {
    clearTimeout(deadline);
    Deno.exit(0);
  });
}

Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);

const [backendStatus, frontendStatus] = await Promise.all([
  backendProcess.status,
  frontendProcess.status,
]);

if (shuttingDown) {
  Deno.exit(0);
}
console.error(
  `[entrypoint] A server exited unexpectedly (backend code ${backendStatus.code}, frontend code ${frontendStatus.code})`,
);
try {
  backendProcess.kill("SIGTERM");
} catch { /* already gone */ }
try {
  frontendProcess.kill("SIGTERM");
} catch { /* already gone */ }
Deno.exit(backendStatus.code !== 0 ? backendStatus.code : frontendStatus.code);
