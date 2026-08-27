import { join } from "@std/path";
import { loadConfig } from "../config.ts";
import { getModel } from "../db/models.ts";
import { AppError, badRequest, ERROR_CODES, notFound } from "../errors.ts";
import { storageLayout } from "../storage/paths.ts";
import { fileExists, modelDir } from "./model_files.ts";

/**
 * Model runtime files: runner scripts, Python virtualenvs, and dependency
 * installs for local_cli models. Everything lives inside the model's own
 * storage directory, so removing the model removes its runtime too.
 */

/** Runner-script basenames the copilot may write into a model directory. */
const MODEL_FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** App-owned files the copilot must never overwrite. */
const RESERVED_FILE_PREFIXES = ["model.bin", ".venv"];

export const MODEL_FILE_MAX_BYTES = 256 * 1024;

/**
 * pip requirements are spawned as a single argv entry (never through a
 * shell), so the validation only has to keep out option injection
 * (`--...`), URLs (`@`, `/`), and anything pip would parse oddly.
 */
const PIP_REQUIREMENT_RE =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(\[[A-Za-z0-9,._-]+\])?((==|!=|<=|>=|~=|<|>|=)[0-9][A-Za-z0-9.!+*-]*)*$/;

export function validateModelFileName(name: string): void {
  if (!MODEL_FILE_NAME_RE.test(name)) {
    throw badRequest(
      "filename must be a plain basename of 1-64 chars (letters, digits, '.', '_', '-'), " +
        "starting with a letter or digit",
      "filename",
    );
  }
  const lower = name.toLowerCase();
  for (const prefix of RESERVED_FILE_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}.`) || lower.startsWith(`.${prefix}`)) {
      throw badRequest(`filename '${name}' is reserved`, "filename");
    }
  }
}

export function validatePipRequirement(spec: string): void {
  if (!PIP_REQUIREMENT_RE.test(spec)) {
    throw badRequest(
      `invalid pip requirement '${spec}' (expected a package name, optional [extras], " op version")`,
      "packages",
    );
  }
}

export interface ModelFileEntry {
  name: string;
  bytes: number;
}

export interface ModelFilesReport {
  dir: string;
  files: ModelFileEntry[];
  has_weights: boolean;
  has_venv: boolean;
  total_bytes: number;
}

export function listModelFiles(modelId: string): ModelFilesReport {
  if (!getModel(modelId)) throw notFound(`Unknown model id '${modelId}'`);
  const dir = modelDir(storageLayoutFor(), modelId);
  const files: ModelFileEntry[] = [];
  let hasWeights = false;
  let hasVenv = false;
  let total = 0;
  let entries: Deno.DirEntry[] = [];
  try {
    entries = [...Deno.readDirSync(dir)];
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
  }
  for (const entry of entries) {
    if (entry.name === ".venv") hasVenv = true;
    const stat = Deno.statSync(join(dir, entry.name));
    const bytes = stat.size ?? 0;
    total += bytes;
    if (entry.name === "model.bin") hasWeights = true;
    files.push({ name: entry.name, bytes });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { dir, files, has_weights: hasWeights, has_venv: hasVenv, total_bytes: total };
}

export async function writeModelFile(
  modelId: string,
  filename: string,
  content: string,
): Promise<{ path: string; bytes: number }> {
  if (!getModel(modelId)) throw notFound(`Unknown model id '${modelId}'`);
  validateModelFileName(filename);
  if (content.length > MODEL_FILE_MAX_BYTES) {
    throw badRequest(`content is limited to ${MODEL_FILE_MAX_BYTES} characters`, "content");
  }
  const dir = modelDir(storageLayoutFor(), modelId);
  await Deno.mkdir(dir, { recursive: true });
  const target = join(dir, filename);
  const tmp = join(dir, `.${filename}.tmp-${crypto.randomUUID()}`);
  await Deno.writeTextFile(tmp, content);
  await Deno.rename(tmp, target);
  return { path: target, bytes: content.length };
}

export function venvPythonPath(modelId: string): string {
  return join(modelDir(storageLayoutFor(), modelId), ".venv", "bin", "python");
}

/** Keeps only the tail of a command's output (bounded memory). */
class TailBuffer {
  private chunks: string[] = [];
  private total = 0;
  constructor(private maxChars: number) {}
  push(text: string): void {
    this.total += text.length;
    this.chunks.push(text);
    while (this.total > this.maxChars * 2 && this.chunks.length > 1) {
      this.total -= this.chunks[0].length;
      this.chunks.shift();
    }
  }
  tail(): string {
    return this.chunks.join("").slice(-this.maxChars);
  }
}

const OUTPUT_TAIL_MAX = 4000;

/**
 * Spawn a process, capture stdout+stderr into a bounded tail, and await
 * exit. Throws on non-zero exit with the output tail as details. No
 * timeout: dependency installs can legitimately run for many minutes
 * (the user's approval of the proposal is the consent).
 */
async function runCaptured(cmd: string, args: string[]): Promise<string> {
  const child = new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const tail = new TailBuffer(OUTPUT_TAIL_MAX);
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      tail.push(decoder.decode(value, { stream: true }));
    }
  };
  const [status] = await Promise.all([
    child.status,
    drain(child.stdout).catch(() => {}),
    drain(child.stderr).catch(() => {}),
  ]);
  if (!status.success) {
    throw new AppError(
      ERROR_CODES.NETWORK_ERROR,
      `'${cmd} ${args.join(" ")}' exited with code ${status.code ?? "unknown"}`,
      { status: 502, details: tail.tail() },
    );
  }
  return tail.tail();
}

export interface VenvSetupResult {
  venv_python: string;
  packages: string[];
  created_venv: boolean;
  output_tail: string;
}

/**
 * Create `<modelDir>/.venv` (when missing) and pip-install the given
 * requirements into it. The base interpreter is `python3` (overridable via
 * the MODEL_VENV_PYTHON env var, used by tests).
 */
export async function setupModelVenv(
  modelId: string,
  packages: string[],
): Promise<VenvSetupResult> {
  if (!getModel(modelId)) throw notFound(`Unknown model id '${modelId}'`);
  if (packages.length === 0) {
    throw badRequest("packages must contain at least one requirement", "packages");
  }
  for (const spec of packages) validatePipRequirement(spec);
  const dir = modelDir(storageLayoutFor(), modelId);
  await Deno.mkdir(dir, { recursive: true });
  const venvDir = join(dir, ".venv");
  const venvPython = join(venvDir, "bin", "python");
  const basePython = Deno.env.get("MODEL_VENV_PYTHON") ?? "python3";
  const createdVenv = !(await fileExists(venvPython));
  if (createdVenv) {
    await runCaptured(basePython, ["-m", "venv", venvDir]);
  }
  const tail = await runCaptured(
    venvPython,
    ["-m", "pip", "install", "--disable-pip-version-check", ...packages],
  );
  return { venv_python: venvPython, packages, created_venv: createdVenv, output_tail: tail };
}

/** The storage layout for the current process's app data directory. */
function storageLayoutFor(): ReturnType<typeof storageLayout> {
  return storageLayout(loadConfig().appDataDir);
}
