// Smoke test for the Model Copilot's fix loop: run a model's local_cli
// command once with a minimal prompt and a short timeout, returning the
// exact error (exit code + stderr tail) the user would otherwise have to
// paste back into the chat. Catches spawn/import/argument failures in
// seconds. It is NOT a benchmark — a "started_ok" result means the process
// launched and ran the full timeout without failing, which proves startup
// health but not output quality or speed (use run_benchmark for those).
import { badRequest, notFound } from "../errors.ts";
import { getModel, type Model } from "../db/models.ts";
import { getContentStore } from "../storage/content_store.ts";
import { renderCliArgs } from "./adapters.ts";
import { hfTokenForUrl } from "./huggingface.ts";

export const SMOKE_TEST_DEFAULT_TIMEOUT_SECONDS = 60;
export const SMOKE_TEST_MAX_TIMEOUT_SECONDS = 180;
export const SMOKE_TEST_PROMPT = "smoke test: a small red circle on a white background";
const SMOKE_SEED = "smoke";
const TAIL_CHARS = 1500;
/** Grandchild processes can hold the output pipes open after SIGKILL; wait
 * a short grace period before abandoning them (same trick as runCli). */
const KILL_GRACE_MS = 2000;

export type SmokeTestStatus = "ok" | "failed" | "started_ok";

export interface SmokeTestResult {
  status: SmokeTestStatus;
  exit_code: number | null;
  duration_ms: number;
  output_written: boolean;
  /** stderr (falling back to stdout) tail on failure — the error to fix. */
  error_tail: string | null;
  note: string;
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return SMOKE_TEST_DEFAULT_TIMEOUT_SECONDS;
  if (!Number.isFinite(value) || value < 1) return SMOKE_TEST_DEFAULT_TIMEOUT_SECONDS;
  return Math.min(Math.floor(value), SMOKE_TEST_MAX_TIMEOUT_SECONDS);
}

/** settings.env (string entries) + HF hub token for gated-repo downloads —
 * same rules as the local_cli adapter: an explicit settings.env entry wins. */
function buildEnv(model: Model): Record<string, string> | undefined {
  const rawEnv = model.default_settings.env;
  const settingsEnv = rawEnv && typeof rawEnv === "object" && !Array.isArray(rawEnv)
    ? Object.fromEntries(
      Object.entries(rawEnv as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, v as string]),
    )
    : {};
  const hfToken = hfTokenForUrl(model.repository_url);
  if (hfToken) {
    if (settingsEnv.HF_TOKEN === undefined) settingsEnv.HF_TOKEN = hfToken;
    if (settingsEnv.HUGGING_FACE_HUB_TOKEN === undefined) {
      settingsEnv.HUGGING_FACE_HUB_TOKEN = hfToken;
    }
  }
  return Object.keys(settingsEnv).length > 0 ? settingsEnv : undefined;
}

function tailOf(output: Deno.CommandOutput): string {
  const stderr = new TextDecoder().decode(output.stderr).trim();
  const stdout = new TextDecoder().decode(output.stdout).trim();
  return (stderr || stdout || "(no output)").slice(-TAIL_CHARS);
}

/**
 * Run one bounded local_cli invocation for the model. `timeoutSeconds` is
 * clamped to [1, 180]; a kill at the deadline is reported as `started_ok`
 * (startup is healthy) rather than a failure.
 */
export async function runSmokeTest(
  modelId: string,
  timeoutSeconds?: number,
): Promise<SmokeTestResult> {
  const model = getModel(modelId);
  if (!model) throw notFound("Model not found");
  if (model.backend !== "local_cli") {
    throw badRequest("Smoke tests support local_cli models only");
  }
  if (!model.installed_at) throw badRequest("Model is not installed");

  const settings = model.default_settings;
  const command = settings.command;
  if (typeof command !== "string" || command.trim() === "") {
    throw badRequest("local_cli model requires a 'command' string in default_settings");
  }
  const rawArgs = Array.isArray(settings.args)
    ? (settings.args as unknown[]).filter((a): a is string => typeof a === "string")
    : [];
  if (!rawArgs.some((a) => a.includes("{output}"))) {
    throw badRequest("local_cli model args must include an '{output}' placeholder");
  }
  const timeout = normalizeTimeout(timeoutSeconds);
  const rawExt = settings.output_extension;
  const ext = typeof rawExt === "string" && rawExt.trim() !== ""
    ? rawExt.trim().replace(/^\./, "").toLowerCase()
    : "png";
  const env = buildEnv(model);

  const store = getContentStore();
  await Deno.mkdir(store.layout.cache, { recursive: true });
  const outPath = `${store.layout.cache}/.smoketest-${model.id}-${crypto.randomUUID()}.${ext}`;
  const args = renderCliArgs(rawArgs, {
    prompt: SMOKE_TEST_PROMPT,
    seed: SMOKE_SEED,
    candidate: 0,
    count: 1,
    inputPaths: [],
    output: outPath,
  });

  let child: Deno.ChildProcess;
  try {
    child = new Deno.Command(command, {
      args,
      env: env ? { ...Deno.env.toObject(), ...env } : undefined,
      stdout: "piped",
      stderr: "piped",
    }).spawn();
  } catch (err) {
    throw badRequest(
      `Failed to start CLI '${command}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const outputPromise = child.output();
  outputPromise.catch(() => {});
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch {
      // Process may have already exited.
    }
  }, timeout * 1000);
  const startedAt = Date.now();
  try {
    const hardDeadline = new Promise<"wait">((resolve) =>
      setTimeout(() => resolve("wait"), timeout * 1000 + KILL_GRACE_MS)
    );
    const done = outputPromise.then(() => "done" as const);
    const settled = await Promise.race([done, hardDeadline]);
    const duration_ms = Date.now() - startedAt;
    const output_written = (await Deno.stat(outPath).catch(() => null)) !== null;

    if (settled === "wait") {
      // The direct child is gone but a grandchild still holds the pipes.
      const status: SmokeTestStatus = timedOut || !output_written ? "started_ok" : "ok";
      return {
        status,
        exit_code: null,
        duration_ms,
        output_written,
        error_tail: null,
        note: timedOut
          ? `Ran the full ${timeout}s without failing (output pipes held by a grandchild) — startup looks healthy; use a benchmark to measure a full generation.`
          : "The process exited but a grandchild held the output pipes; treated as a startup pass.",
      };
    }

    const output = await outputPromise;
    if (output.success) {
      return {
        status: "ok",
        exit_code: output.code,
        duration_ms,
        output_written,
        error_tail: null,
        note: output_written
          ? `Completed in ${
            (duration_ms / 1000).toFixed(1)
          }s and wrote the output file — the model works.`
          : `Exited 0 in ${
            (duration_ms / 1000).toFixed(1)
          }s but wrote no output file at the {output} path.`,
      };
    }
    if (timedOut) {
      return {
        status: "started_ok",
        exit_code: output.code,
        duration_ms,
        output_written,
        error_tail: tailOf(output) || null,
        note:
          `Ran the full ${timeout}s without failing — startup looks healthy; use a benchmark to measure a full generation.`,
      };
    }
    return {
      status: "failed",
      exit_code: output.code,
      duration_ms,
      output_written,
      error_tail: tailOf(output),
      note:
        `Exited with code ${output.code} — fix the root cause in error_tail, then smoke-test again.`,
    };
  } finally {
    clearTimeout(timer);
    await Deno.remove(outPath).catch(() => {});
  }
}
