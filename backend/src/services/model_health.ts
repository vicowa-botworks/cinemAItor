import type { StorageLayout } from "../storage/paths.ts";
import type { Model } from "../db/models.ts";
import { fileExists, readVerificationRecord, verifyModelFile } from "./model_files.ts";
import { modelFile } from "./model_files.ts";

export interface HealthResult {
  status: "ok" | "error";
  message: string;
}

interface CommandProbe {
  exists: (name: string) => Promise<boolean>;
}

const defaultCommandProbe: CommandProbe = {
  async exists(name: string): Promise<boolean> {
    try {
      const proc = new Deno.Command("which", {
        args: [name],
        stdout: "null",
        stderr: "null",
      });
      const outcome = await proc.output();
      return outcome.success;
    } catch {
      return false;
    }
  },
};

interface EndpointProbe {
  reachable: (url: string) => Promise<boolean>;
}

const defaultEndpointProbe: EndpointProbe = {
  async reachable(url: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      await fetch(url, { signal: controller.signal });
      // Any HTTP response means the backend answered.
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  },
};

export interface HealthCheckOptions {
  commandProbe?: CommandProbe;
  endpointProbe?: EndpointProbe;
}

/**
 * Model health check (MOD-007): install state, file integrity, backend
 * runtime availability (CLI deps or HTTP endpoint). The mock backend is a
 * simulated runtime and is healthy without files. Remote backends (comfyui,
 * local_http) do not require a local model file — the endpoint probe is the
 * runtime check; a local file is verified when one is present.
 *
 * File integrity: a full SHA-256 over a multi-GB model takes minutes, so the
 * check consults the verification sidecar (size + mtime + hash of the file at
 * last successful full verification) and skips the re-hash when the file is
 * unchanged. The explicit verify endpoint (POST /:id/verify) always re-hashes.
 */
export async function checkModelHealth(
  layout: StorageLayout,
  model: Model,
  options: HealthCheckOptions = {},
): Promise<HealthResult> {
  const commandProbe = options.commandProbe ?? defaultCommandProbe;
  const endpointProbe = options.endpointProbe ?? defaultEndpointProbe;

  if (model.backend === "mock") {
    return { status: "ok", message: "Mock backend: simulated runtime, no local checks" };
  }

  // Remote backends run on a server; no local model file is expected (the
  // checkpoint lives on the remote). A local file is still verified when one
  // is present.
  const remoteBackend = model.backend === "comfyui" || model.backend === "local_http";
  const file = modelFile(layout, model.id);
  const filePresent = await fileExists(file);
  if (!filePresent && !remoteBackend) {
    return { status: "error", message: "Model is not installed (file missing)" };
  }

  // "File verified" (full hash ran now) or "File unchanged since last
  // verification" (sidecar fast path); null when no file/hash to check.
  let fileNote: string | null = null;
  if (filePresent && model.file_hash) {
    const record = await readVerificationRecord(layout, model.id);
    let unchanged = false;
    if (record && record.hash === model.file_hash) {
      try {
        const stat = await Deno.stat(file);
        unchanged = record.size === stat.size &&
          record.mtimeMs === (stat.mtime?.getTime() ?? 0);
      } catch {
        unchanged = false;
      }
    }
    if (unchanged) {
      fileNote = "File unchanged since last verification";
    } else {
      const verify = await verifyModelFile(layout, model.id, model.file_hash);
      if (!verify.valid) {
        return { status: "error", message: verify.message };
      }
      fileNote = "File verified";
    }
  }

  if (model.backend === "local_cli") {
    for (const dep of model.dependencies) {
      if (!(await commandProbe.exists(dep))) {
        return { status: "error", message: `Missing runtime dependency: ${dep}` };
      }
    }
    return { status: "ok", message: `${fileNote ?? "Model installed"} and CLI runtime available` };
  }

  if (remoteBackend) {
    const endpoint = model.default_settings?.endpoint;
    if (typeof endpoint === "string" && endpoint) {
      if (!(await endpointProbe.reachable(endpoint))) {
        return {
          status: "error",
          message: `Backend unreachable at ${endpoint}`,
        };
      }
      return {
        status: "ok",
        message: filePresent
          ? `${fileNote ?? "File present"} and backend reachable at ${endpoint}`
          : `Backend reachable at ${endpoint} (remote runtime, no local file required)`,
      };
    }
    return {
      status: "ok",
      message: filePresent
        ? `${fileNote ?? "Model installed"} (no HTTP endpoint configured for probe)`
        : "No local file and no HTTP endpoint configured for probe",
    };
  }

  return { status: "ok", message: fileNote ?? "Model installed" };
}
