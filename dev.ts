const backend = new Deno.Command(Deno.execPath(), {
  args: ["run", "--watch", "-A", "src/server.ts"],
  cwd: new URL("backend", import.meta.url),
  stdout: "inherit",
  stderr: "inherit",
});

const frontend = new Deno.Command(Deno.execPath(), {
  args: ["run", "-A", "src/server.js"],
  cwd: new URL("frontend", import.meta.url),
  stdout: "inherit",
  stderr: "inherit",
});

const backendProcess = backend.spawn();
const frontendProcess = frontend.spawn();

console.log("Starting both servers...");
console.log("Backend:  http://localhost:8123");
console.log("Frontend: http://localhost:8124");

const sig = Deno.addSignalListener("SIGINT", () => {
  console.log("\nShutting down...");
  backendProcess.kill("SIGINT");
  frontendProcess.kill("SIGINT");
  Deno.exit(0);
});

await Promise.all([backendProcess.status, frontendProcess.status]);
