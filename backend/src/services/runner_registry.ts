/**
 * In-memory registry of the local_cli runner child PIDs this backend currently
 * has in flight.
 *
 * The job runner spawns one child process per local_cli job (adapters.ts
 * `runCli`). While that child is alive it is the process that actually holds
 * the GPU VRAM (it is what `nvidia-smi --query-compute-apps` reports). By
 * recording each child pid here, `vram_free.ts` can attribute the VRAM a
 * compute-app pid is using back to *our own* running/queued generation job —
 * so the pre-submit VRAM guard can tell "VRAM is held by one of our own jobs"
 * (safe to queue behind) apart from "held by an unrelated app" (not safe).
 *
 * The set is per-process memory only: it is empty after a backend restart
 * (and any orphaned runner children of a dead backend are gone too, or will be
 * reaped by the job lease recovery). Entries are added on spawn and removed
 * when the child exits, on every exit path.
 */

const runnerPids = new Set<number>();

/** Record a freshly spawned local_cli runner child pid. */
export function registerRunnerPid(pid: number): void {
  if (Number.isInteger(pid) && pid > 0) runnerPids.add(pid);
}

/** Drop a runner child pid (safe to call more than once). */
export function unregisterRunnerPid(pid: number): void {
  runnerPids.delete(pid);
}

/** True if `pid` is (still) a live local_cli runner child of this backend. */
export function isRunnerPid(pid: number): boolean {
  return runnerPids.has(pid);
}

/** Snapshot of the live runner pids (for the services report / diagnostics). */
export function runnerPidList(): number[] {
  return [...runnerPids];
}
