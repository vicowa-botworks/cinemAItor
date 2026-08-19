export interface GpuInfo {
  vendor: string;
  model: string;
  vram_mb: number | null;
}

export interface HardwareInfo {
  platform: string;
  arch: string;
  cpu_count: number;
  mem_total_mb: number | null;
  gpu: GpuInfo | null;
  detected_at: string;
}

export interface RequirementWarning {
  model_id: string;
  model_name: string;
  warning: string;
}

const MB = 1024 * 1024;

async function countCpuInfo(): Promise<number | null> {
  const content = await readFull("/proc/cpuinfo");
  if (content === null) return null;
  const count = content.split("\n").filter((l) => l.startsWith("processor")).length;
  return count > 0 ? count : null;
}

async function readFull(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

async function runCommand(cmd: string, args: string[]): Promise<string | null> {
  try {
    const child = new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already exited
      }
    }, 3000);
    try {
      const text = await new Response(child.stdout).text();
      const status = await child.status;
      if (!status.success) return null;
      return text.trim();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Best-effort hardware detection (MOD-009). Every field degrades gracefully:
 * unknown values are null/1 rather than throwing, so the API never fails on
 * exotic platforms.
 */
export async function detectHardware(): Promise<HardwareInfo> {
  let cpu_count = 1;
  let mem_total_mb: number | null = null;

  if (Deno.build.os === "linux") {
    cpu_count = (await countCpuInfo()) ?? 1;
    const meminfo = await readFull("/proc/meminfo");
    if (meminfo) {
      const match = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
      if (match) mem_total_mb = Math.round(Number(match[1]) * 1024 / MB);
    }
  } else if (Deno.build.os === "darwin") {
    const cpus = await runCommand("sysctl", ["-n", "hw.ncpu"]);
    if (cpus && /^\d+$/.test(cpus)) cpu_count = Number(cpus);
    const mem = await runCommand("sysctl", ["-n", "hw.memsize"]);
    if (mem && /^\d+$/.test(mem)) mem_total_mb = Math.round(Number(mem) / MB);
  }

  let gpu: GpuInfo | null = null;
  const nvidia = await runCommand("nvidia-smi", [
    "--query-gpu=name,memory.total",
    "--format=csv,noheader",
  ]);
  if (nvidia) {
    const [name, vram] = nvidia.split("\n")[0].split(",").map((s) => s.trim());
    const vramMatch = vram?.match(/[\d.]+/);
    gpu = {
      vendor: "nvidia",
      model: name ?? "unknown",
      vram_mb: vramMatch ? Math.round(Number(vramMatch[0]) / MB) : null,
    };
  }

  return {
    platform: Deno.build.os,
    arch: Deno.build.arch,
    cpu_count,
    mem_total_mb,
    gpu,
    detected_at: new Date().toISOString(),
  };
}

/**
 * Requirement warnings (MOD-010): compare a model's declared requirements
 * against detected hardware and locally available dependencies.
 */
export async function modelRequirementWarnings(
  model: {
    id: string;
    name: string;
    vram_requirement_mb: number | null;
    ram_requirement_mb: number | null;
    dependencies: string[];
  },
  hardware: HardwareInfo,
): Promise<RequirementWarning[]> {
  const warnings: RequirementWarning[] = [];
  const warn = (message: string) =>
    warnings.push({ model_id: model.id, model_name: model.name, warning: message });

  if (model.vram_requirement_mb !== null) {
    if (!hardware.gpu) {
      warn(
        `Requires ${model.vram_requirement_mb} MB VRAM but no GPU was detected`,
      );
    } else if (
      hardware.gpu.vram_mb !== null &&
      hardware.gpu.vram_mb < model.vram_requirement_mb
    ) {
      warn(
        `Requires ${model.vram_requirement_mb} MB VRAM but only ` +
          `${hardware.gpu.vram_mb} MB detected on ${hardware.gpu.model}`,
      );
    }
  }

  if (model.ram_requirement_mb !== null && hardware.mem_total_mb !== null) {
    if (hardware.mem_total_mb < model.ram_requirement_mb) {
      warn(
        `Requires ${model.ram_requirement_mb} MB RAM but only ` +
          `${hardware.mem_total_mb} MB detected`,
      );
    }
  }

  for (const dep of model.dependencies) {
    const found = await runCommand("which", [dep]);
    if (found === null) {
      warn(`Missing dependency: ${dep}`);
    }
  }

  return warnings;
}
