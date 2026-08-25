import type { StorageLayout } from "../storage/paths.ts";
import type { Model } from "../db/models.ts";
import { fileExists, verifyModelFile } from "./model_files.ts";
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

  if (filePresent && model.file_hash) {
    const verify = await verifyModelFile(layout, model.id, model.file_hash);
    if (!verify.valid) {
      return { status: "error", message: verify.message };
    }
  }

  if (model.backend === "local_cli") {
    for (const dep of model.dependencies) {
      if (!(await commandProbe.exists(dep))) {
        return { status: "error", message: `Missing runtime dependency: ${dep}` };
      }
    }
    return { status: "ok", message: "File verified and CLI runtime available" };
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
          ? `File verified and backend reachable at ${endpoint}`
          : `Backend reachable at ${endpoint} (remote runtime, no local file required)`,
      };
    }
    return {
      status: "ok",
      message: filePresent
        ? "File verified (no HTTP endpoint configured for probe)"
        : "No local file and no HTTP endpoint configured for probe",
    };
  }

  return { status: "ok", message: "Model installed" };
}
