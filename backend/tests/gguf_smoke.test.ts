import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";

// Smoke test for the GGUF-via-diffusers loading recipe that the model
// copilot's system prompt teaches (backbone-only `from_single_file` +
// GGUFQuantizationConfig, the rest of the pipeline from plain safetensors).
//
// Availability-gated like the ffmpeg tests: it only runs when a Python env
// with torch + diffusers + gguf + transformers and the (multi-GB) smoke
// weights are present, so CI and bare dev machines skip it.
//
// Env:
//   GGUF_SMOKE_PYTHON  - python with torch, diffusers>=0.40, gguf, transformers
//                        (default: python3)
//   GGUF_SMOKE_WEIGHTS - weights dir (default: backend/tests/gguf_smoke/weights)
//                        layout: *.gguf + base/{transformer/config.json,
//                        text_encoder (CLIP-L), text_encoder_2 (CLIP-G),
//                        text_encoder_3 (T5), vae, tokenizer, tokenizer_2,
//                        tokenizer_3, scheduler} — the SD3.5-medium
//                        3-encoder layout (see runner.py header)
//
// The weights are downloaded on demand (backend/tests/gguf_smoke/
// download-weights.sh); they are git-ignored.
//
// Both gates (weights present, Python env with the required packages) are
// decided at module load and registered with it.skip — Deno 2.9's
// TestContext has no runtime skip. The env probe (a one-shot
// `python -c "import ..."`) only runs when the weights are present, so CI
// and bare machines pay nothing.

const TESTS_DIR = new URL(".", import.meta.url).pathname;
const GENERATION_TIMEOUT_MS = 20 * 60 * 1000; // CPU generation can take minutes
const PYTHON = Deno.env.get("GGUF_SMOKE_PYTHON") ?? "python3";
const WEIGHTS_DIR = Deno.env.get("GGUF_SMOKE_WEIGHTS") ??
  join(TESTS_DIR, "gguf_smoke", "weights");

function requiredFiles(weightsDir: string): string[] {
  return [
    join(weightsDir, "base", "transformer", "config.json"),
    join(weightsDir, "base", "text_encoder"),
    join(weightsDir, "base", "text_encoder_2"),
    join(weightsDir, "base", "text_encoder_3"),
    join(weightsDir, "base", "vae"),
    join(weightsDir, "base", "tokenizer"),
    join(weightsDir, "base", "tokenizer_2"),
    join(weightsDir, "base", "tokenizer_3"),
    join(weightsDir, "base", "scheduler"),
  ];
}

function hasGgufFile(weightsDir: string): boolean {
  for (const entry of Deno.readDirSync(weightsDir)) {
    if (entry.isFile && entry.name.endsWith(".gguf")) return true;
  }
  return false;
}

function weightsPresent(): boolean {
  try {
    return hasGgufFile(WEIGHTS_DIR) &&
      requiredFiles(WEIGHTS_DIR).every((f) => {
        const stat = Deno.statSync(f);
        return stat.isFile || stat.isDirectory;
      });
  } catch {
    return false;
  }
}

async function pythonEnvOk(python: string): Promise<boolean> {
  try {
    const probe = new Deno.Command(python, {
      args: ["-c", "import torch, diffusers, gguf, transformers"],
      stdout: "null",
      stderr: "null",
      signal: AbortSignal.timeout(60_000),
    });
    return (await probe.output()).success;
  } catch {
    return false;
  }
}

const weightsOk = weightsPresent();
const envOk = weightsOk ? await pythonEnvOk(PYTHON) : false;

describe("GGUF smoke (diffusers GGUF recipe, availability-gated)", () => {
  if (!weightsOk || !envOk) {
    const reason = !weightsOk
      ? `smoke weights not present under ${WEIGHTS_DIR}; run ` +
        "backend/tests/gguf_smoke/download-weights.sh"
      : `no Python env with torch+diffusers+gguf+transformers at '${PYTHON}'; ` +
        "create one (see runner.py header) and set GGUF_SMOKE_PYTHON";
    it.skip(
      `loads a GGUF backbone through diffusers and generates an image (skipped: ${reason})`,
      () => {},
    );
    return;
  }

  it("loads a GGUF backbone through diffusers and generates an image", async () => {
    const outDir = await Deno.makeTempDir({ prefix: "gguf-smoke-" });
    const output = join(outDir, "smoke.png");
    const runner = join(TESTS_DIR, "gguf_smoke", "runner.py");

    const cmd = new Deno.Command(PYTHON, {
      args: [
        runner,
        "--prompt",
        "a lighthouse at dawn, cinematic",
        "--seed",
        "7",
        "--output",
        output,
        "--weights-dir",
        WEIGHTS_DIR,
        "--steps",
        "4",
        "--width",
        "512",
        "--height",
        "512",
      ],
      stdout: "piped",
      stderr: "inherit",
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
    const proc = await cmd.output();
    const stdout = new TextDecoder().decode(proc.stdout);

    if (!proc.success) {
      // Re-throw with the runner's stderr already streamed to the test output.
      throw new Error(`GGUF smoke run failed (exit ${proc.code}); stdout: ${stdout}`);
    }
    assert(stdout.includes("GGUF_SMOKE_OK"), `expected GGUF_SMOKE_OK in stdout, got: ${stdout}`);
    const png = await Deno.stat(output);
    assert(png.size > 1024, `output PNG suspiciously small: ${png.size} bytes`);
    assertEquals(proc.code, 0);
  });
});
