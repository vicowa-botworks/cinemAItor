import { detectHardware, parseNvidiaSmiMemory, runCommand } from "./hardware.ts";
import { getVramUnloadSettings } from "../db/vram_unload_settings.ts";

/**
 * VRAM auto-unload (local GPU services only).
 *
 * The point: when this machine's free VRAM is too low for a generation, we can
 * free VRAM by unloading models from the LOCAL services that hold it — a local
 * ComfyUI (`POST /free`) and a local llama.cpp router (`POST /models/unload`
 * for each loaded model). Only LOCAL processes are ever targeted: they're the
 * ones consuming this machine's VRAM. A configured remote LLM endpoint lives on
 * another machine, never appears in `nvidia-smi`, and is never touched.
 *
 * Detection is `nvidia-smi --query-compute-apps` (the GPU PIDs) + `ps -o
 * ppid=,args= -p <pid>` for each PID (cmdline + parent; `ps` needs only
 * --allow-run, which the backend grants — reading `/proc/<pid>/*` needs
 * --allow-all, which it does not) to classify it:
 *   - `.../ComfyUI/.../main.py`            -> ComfyUI (endpoint from --port, else 8188)
 *   - `llama-server ... --model ...`       -> a per-model child; its VRAM holder
 *   - `llama-server ... --models-preset`   -> the router (parent) that can unload
 * A child's router is found by walking its parent chain for the `--models-preset`
 * process and reading that process's `--port`.
 */

export type VramServiceKind = "comfyui" | "llama-server";

export interface VramServiceInfo {
  kind: VramServiceKind;
  /** Base URL to send unload requests to (no trailing slash). Empty if not unloadable. */
  endpoint: string;
  /** VRAM this service's GPU processes use, in MB (from nvidia-smi). */
  vram_mb: number;
  /** llama-server: model ids currently loaded (status.value === "loaded"). */
  loaded_models: string[];
  /** llama-server: the router address (host:port) managing the children, for display. */
  router: string | null;
  /** Whether this service can be unloaded over HTTP. */
  unloadable: boolean;
}

export interface VramServicesReport {
  platform: string;
  gpu: { model: string | null; total_mb: number | null; used_mb: number | null } | null;
  services: VramServiceInfo[];
  detected_at: string;
}

export interface FreeResult {
  kind: string;
  ok: boolean;
  detail: string;
}

const DETECT_TTL_MS = 30_000;
const HTTP_TIMEOUT_MS = 15_000;
const UNLOAD_TIMEOUT_MS = 20_000;

let servicesCache: { at: number; report: VramServicesReport } | null = null;

/** Force the next detectVramServices() to re-probe (tests, refresh button). */
export function invalidateVramServicesCache(): void {
  servicesCache = null;
}

/**
 * cmdline + parent PID for a process via `ps -o ppid=,args= -p <pid>`.
 * Uses `ps` (needs only --allow-run, which the backend grants) rather than
 * reading `/proc/<pid>/*`, which Deno gates behind --allow-all. Returns null
 * if `ps` is unavailable or the process has exited.
 */
async function procInfo(
  pid: number,
): Promise<{ ppid: number | null; cmdline: string } | null> {
  const out = await runCommand("ps", ["-o", "ppid=,args=", "-p", String(pid)]);
  if (!out) return null;
  const line = out.split("\n").map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  const space = line.indexOf(" ");
  if (space <= 0) return { ppid: null, cmdline: line };
  const ppid = Number(line.slice(0, space).trim());
  return {
    ppid: Number.isFinite(ppid) && ppid > 0 ? ppid : null,
    cmdline: line.slice(space + 1).trim(),
  };
}

/** Value following a `--flag` in a space-joined cmdline, or null. */
function flagValue(cmdline: string, flag: string): string | null {
  const match = cmdline.match(new RegExp(`${flag}\\s+(\\S+)`));
  return match ? match[1] : null;
}

interface GpuProc {
  pid: number;
  vram_mb: number;
  cmdline: string;
}

async function gpuProcesses(): Promise<GpuProc[]> {
  const out = await runCommand("nvidia-smi", [
    "--query-compute-apps=pid,used_memory",
    "--format=csv,noheader",
  ]);
  if (!out) return [];
  const procs: GpuProc[] = [];
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [pidStr, memStr] = trimmed.split(",").map((s) => s.trim());
    const pid = Number(pidStr);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const info = await procInfo(pid);
    if (!info || !info.cmdline) continue;
    procs.push({
      pid,
      vram_mb: parseNvidiaSmiMemory(memStr) ?? 0,
      cmdline: info.cmdline,
    });
  }
  return procs;
}

/** Find the `--models-preset` router that owns the given llama child PIDs (walk ppid, max 3). */
async function findLlamaRouter(
  childPids: number[],
): Promise<{ endpoint: string; router: string } | null> {
  for (const pid of childPids) {
    let current = pid;
    for (let depth = 0; depth < 3; depth++) {
      const info = await procInfo(current);
      if (!info || info.ppid === null || info.ppid <= 1) break;
      const parent = await procInfo(info.ppid);
      const cmdline = parent?.cmdline ?? "";
      if (cmdline.includes("llama-server") && cmdline.includes("--models-preset")) {
        const port = flagValue(cmdline, "--port") ?? "8090";
        return { endpoint: `http://127.0.0.1:${port}`, router: `127.0.0.1:${port}` };
      }
      current = info.ppid;
    }
  }
  return null;
}

/** Model ids a llama.cpp router currently has loaded (best-effort). */
export async function getLlamaLoadedModels(endpoint: string): Promise<string[]> {
  try {
    const res = await fetch(`${endpoint}/v1/models`, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: Array<{ id: string; status?: { value?: string } }>;
    };
    return (data.data ?? [])
      .filter((m) => m.status?.value === "loaded")
      .map((m) => m.id);
  } catch {
    return [];
  }
}

async function detectVramServicesFresh(): Promise<VramServicesReport> {
  const hardware = await detectHardware();
  const procs = await gpuProcesses();
  const comfyPids = procs.filter((p) =>
    p.cmdline.includes("ComfyUI") && p.cmdline.includes("main.py")
  );
  const llamaPids = procs.filter((p) => p.cmdline.includes("llama-server"));

  const services: VramServiceInfo[] = [];

  if (comfyPids.length > 0) {
    const port = flagValue(comfyPids[0].cmdline, "--port") ?? "8188";
    services.push({
      kind: "comfyui",
      endpoint: `http://127.0.0.1:${port}`,
      vram_mb: comfyPids.reduce((sum, p) => sum + p.vram_mb, 0),
      loaded_models: [],
      router: null,
      unloadable: true,
    });
  }

  if (llamaPids.length > 0) {
    const router = await findLlamaRouter(llamaPids.map((p) => p.pid));
    const loaded = router ? await getLlamaLoadedModels(router.endpoint) : [];
    services.push({
      kind: "llama-server",
      endpoint: router?.endpoint ?? "",
      vram_mb: llamaPids.reduce((sum, p) => sum + p.vram_mb, 0),
      loaded_models: loaded,
      router: router?.router ?? null,
      unloadable: router !== null,
    });
  }

  return {
    platform: Deno.build.os,
    gpu: hardware.gpu
      ? {
        model: hardware.gpu.model,
        total_mb: hardware.gpu.vram_mb,
        used_mb: hardware.gpu.vram_used_mb,
      }
      : null,
    services,
    detected_at: new Date().toISOString(),
  };
}

/**
 * Detect the local GPU services holding VRAM. Cached briefly — nvidia-smi +
 * /proc reads are cheap but the UI may poll, and the loaded-models probe is a
 * network call. Pass `force` to re-probe (free actions, refresh button).
 */
export async function detectVramServices(force = false): Promise<VramServicesReport> {
  if (!force && servicesCache && Date.now() - servicesCache.at < DETECT_TTL_MS) {
    return servicesCache.report;
  }
  const report = await detectVramServicesFresh();
  servicesCache = { at: Date.now(), report };
  return report;
}

/** Ask a local ComfyUI to unload all models (`POST /free`). */
export async function freeComfyui(endpoint: string): Promise<FreeResult> {
  try {
    const res = await fetch(`${endpoint}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) return { kind: "comfyui", ok: false, detail: `HTTP ${res.status}` };
    await res.text();
    return { kind: "comfyui", ok: true, detail: "models unloaded" };
  } catch (e) {
    return { kind: "comfyui", ok: false, detail: `unreachable: ${String(e)}` };
  }
}

/** Unload every model a llama.cpp router has loaded. */
export async function freeLlama(endpoint: string, loadedModels: string[]): Promise<FreeResult> {
  if (loadedModels.length === 0) {
    return { kind: "llama-server", ok: true, detail: "no models loaded" };
  }
  const notes: string[] = [];
  let ok = true;
  for (const id of loadedModels) {
    try {
      const res = await fetch(`${endpoint}/models/unload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: id }),
        signal: AbortSignal.timeout(UNLOAD_TIMEOUT_MS),
      });
      if (res.ok) notes.push(`${id} unloaded`);
      else {
        ok = false;
        notes.push(`${id} failed (HTTP ${res.status})`);
      }
    } catch (e) {
      ok = false;
      notes.push(`${id} failed (${String(e)})`);
    }
  }
  return { kind: "llama-server", ok, detail: notes.join("; ") };
}

/**
 * Free the detected local services. With no `targetKinds`, frees every service
 * enabled in the settings toggles (the auto-trigger path); with `targetKinds`,
 * frees exactly those (the per-row "Free" button). Always re-probes first.
 */
export async function freeVram(
  targetKinds?: VramServiceKind[],
): Promise<{ results: FreeResult[]; report: VramServicesReport }> {
  const settings = getVramUnloadSettings();
  const report = await detectVramServices(true);
  const results: FreeResult[] = [];
  for (const svc of report.services) {
    if (!svc.unloadable) continue;
    const enabled = svc.kind === "comfyui" ? settings.targets.comfyui : settings.targets.llama;
    if (targetKinds ? !targetKinds.includes(svc.kind) : !enabled) continue;
    results.push(
      svc.kind === "comfyui"
        ? await freeComfyui(svc.endpoint)
        : await freeLlama(svc.endpoint, svc.loaded_models),
    );
  }
  return { results, report };
}
