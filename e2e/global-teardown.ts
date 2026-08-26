// Kills the servers started by global-setup and removes the temp data dir.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const statePath = join(import.meta.dirname, ".state.json");

interface State {
  pids: number[];
  tmpDir: string;
}

export default async function teardown(): Promise<void> {
  if (!existsSync(statePath)) return;
  const state = JSON.parse(readFileSync(statePath, "utf8")) as State;
  for (const pid of state.pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  await new Promise((r) => setTimeout(r, 2000));
  for (const pid of state.pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  rmSync(state.tmpDir, { recursive: true, force: true });
}
