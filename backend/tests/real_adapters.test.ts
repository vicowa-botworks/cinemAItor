// Real model adapters (local_cli + comfyui): unit tests for the CLI arg
// renderer plus end-to-end runs against a fake CLI script and an in-process
// fake ComfyUI server.
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  type AdapterHooks,
  candidateSeed,
  cliExtraEnv,
  comfySeedToInt,
  ComfyUIAdapter,
  LocalCliAdapter,
  renderCliArgs,
} from "../src/services/adapters.ts";

const noopHooks: AdapterHooks = {
  onProgress: () => {},
  isCancelled: () => false,
};

function writeScript(dir: string, name: string, body: string): string {
  const path = `${dir}/${name}`;
  Deno.writeTextFileSync(path, body);
  Deno.chmodSync(path, 0o755);
  return path;
}

const fakeGenScript = `#!/bin/sh
prompt=""; seed=""; cand=""; out=""; from=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prompt) prompt="$2"; shift 2;;
    --seed) seed="$2"; shift 2;;
    --candidate) cand="$2"; shift 2;;
    --output) out="$2"; shift 2;;
    --from) from="$2"; shift 2;;
    *) shift;;
  esac
done
if [ -z "$out" ]; then
  echo "missing output" >&2
  exit 1
fi
if [ "$prompt" = "FAIL" ]; then
  echo "boom: $prompt" >&2
  exit 3
fi
echo "PROMPT=$prompt SEED=$seed CAND=$cand FROM=$from HFTOKEN=\${HF_TOKEN:-} DEVICE=\${RUNNER_DEVICE:-} MINFREE=\${RUNNER_MIN_FREE_VRAM_MB:-}" > "$out"
`;

const fakeSleepScript = `#!/bin/sh
sleep 30
`;

// ---------------------------------------------------------------------------
// candidateSeed
// ---------------------------------------------------------------------------

describe("candidateSeed", () => {
  it("keeps candidate 0 on the exact job seed", () => {
    assertEquals(candidateSeed("42", 0), "42");
    assertEquals(candidateSeed("abc", 0), "abc");
  });

  it("offsets numeric seeds numerically per candidate", () => {
    assertEquals(candidateSeed("42", 1), "43");
    assertEquals(candidateSeed("42", 7), "49");
    assertEquals(candidateSeed("0", 1), "1");
  });

  it("suffixes the index for non-numeric seeds", () => {
    assertEquals(candidateSeed("abc", 1), "abc:1");
    assertEquals(candidateSeed("bench-flux_2_dev", 2), "bench-flux_2_dev:2");
  });

  it("derives 8 distinct seeds for the max candidate count", () => {
    for (const seed of ["1", "42", "0", "abc", "bench-flux_2_dev", "0x10"]) {
      const derivedAll = Array.from({ length: 8 }, (_, i) => candidateSeed(seed, i));
      assertEquals(new Set(derivedAll).size, 8);
    }
  });
});

// ---------------------------------------------------------------------------
// comfySeedToInt
// ---------------------------------------------------------------------------

describe("comfySeedToInt", () => {
  it("passes numeric seeds through verbatim", () => {
    assertEquals(comfySeedToInt("1234"), 1234);
    assertEquals(comfySeedToInt("0"), 0);
    assertEquals(comfySeedToInt("  42 "), 42);
  });

  it("hashes non-numeric seeds to a stable in-range INT", () => {
    const a = comfySeedToInt("bench-minimax_h3");
    const b = comfySeedToInt("bench-minimax_h3");
    assertEquals(a, b);
    assert(Number.isInteger(a));
    assert(a >= 0 && a <= 0xffffffff);
  });

  it("keeps per-candidate derived benchmark seeds distinct", () => {
    const base = "bench-minimax_h3";
    const derived = Array.from(
      { length: 8 },
      (_, i) => comfySeedToInt(candidateSeed(base, i)),
    );
    assertEquals(new Set(derived).size, 8);
  });

  it("still yields a valid INT for negative and oversized numeric strings", () => {
    for (const seed of ["-5", "9007199254740993", "1e40"]) {
      const asInt = comfySeedToInt(seed);
      assert(Number.isInteger(asInt));
      assert(asInt >= 0 && asInt <= 0xffffffff);
    }
  });
});

// ---------------------------------------------------------------------------
// renderCliArgs
// ---------------------------------------------------------------------------

describe("renderCliArgs", () => {
  it("substitutes all simple placeholders", () => {
    const out = renderCliArgs(
      [
        "--p",
        "{prompt}",
        "--s",
        "{seed}",
        "--c",
        "{candidate}",
        "--n",
        "{count}",
        "--o",
        "{output}",
      ],
      {
        prompt: "a lighthouse",
        seed: "42",
        candidate: 1,
        count: 2,
        inputPaths: ["/tmp/in0.png"],
        output: "/tmp/out.png",
      },
    );
    assertEquals(out, [
      "--p",
      "a lighthouse",
      "--s",
      "42",
      "--c",
      "1",
      "--n",
      "2",
      "--o",
      "/tmp/out.png",
    ]);
  });

  it("substitutes input placeholders by index", () => {
    const out = renderCliArgs(["--in0", "{input:0}", "--in1", "{input:1}"], {
      prompt: "",
      seed: "1",
      candidate: 0,
      count: 1,
      inputPaths: ["/tmp/a.png", "/tmp/b.mp4"],
      output: "/tmp/out.png",
    });
    assertEquals(out, ["--in0", "/tmp/a.png", "--in1", "/tmp/b.mp4"]);
  });

  it("throws when an embedded input reference is out of range", () => {
    assertThrows(
      () =>
        renderCliArgs(["--image={input:2}"], {
          prompt: "",
          seed: "1",
          candidate: 0,
          count: 1,
          inputPaths: ["/tmp/a.png"],
          output: "/tmp/out.png",
        }),
      Error,
      "references input 2",
    );
  });

  it("drops a bare input token with its flag when the input is absent", () => {
    const out = renderCliArgs(
      ["--p", "{prompt}", "--image", "{input:0}", "--out", "{output}"],
      {
        prompt: "a lighthouse",
        seed: "1",
        candidate: 0,
        count: 1,
        inputPaths: [],
        output: "/tmp/out.png",
      },
    );
    assertEquals(out, ["--p", "a lighthouse", "--out", "/tmp/out.png"]);
  });

  it("keeps present inputs and drops only the absent ones", () => {
    const out = renderCliArgs(
      ["--img0", "{input:0}", "--img1", "{input:1}", "--out", "{output}"],
      {
        prompt: "",
        seed: "1",
        candidate: 0,
        count: 1,
        inputPaths: ["/tmp/a.png"],
        output: "/tmp/out.png",
      },
    );
    assertEquals(out, ["--img0", "/tmp/a.png", "--out", "/tmp/out.png"]);
  });

  it("drops a bare input token without a preceding flag", () => {
    const out = renderCliArgs(
      ["{prompt}", "{input:0}", "{output}"],
      {
        prompt: "a lighthouse",
        seed: "1",
        candidate: 0,
        count: 1,
        inputPaths: [],
        output: "/tmp/out.png",
      },
    );
    assertEquals(out, ["a lighthouse", "/tmp/out.png"]);
  });

  it("leaves unknown placeholders untouched", () => {
    const out = renderCliArgs(["{unknown}"], {
      prompt: "",
      seed: "1",
      candidate: 0,
      count: 1,
      inputPaths: [],
      output: "/tmp/out.png",
    });
    assertEquals(out, ["{unknown}"]);
  });
});

// ---------------------------------------------------------------------------
// cliExtraEnv
// ---------------------------------------------------------------------------

describe("cliExtraEnv", () => {
  it("returns undefined when nothing is added", () => {
    assertEquals(cliExtraEnv(undefined, "", undefined, undefined), undefined);
  });

  it("injects RUNNER_DEVICE for a user-chosen device", () => {
    assertEquals(cliExtraEnv(undefined, "", "cuda", undefined), {
      RUNNER_DEVICE: "cuda",
    });
  });

  it("injects RUNNER_MIN_FREE_VRAM_MB (rounded) for a VRAM requirement", () => {
    assertEquals(cliExtraEnv(undefined, "", undefined, 25600), {
      RUNNER_MIN_FREE_VRAM_MB: "25600",
    });
  });

  it("combines token, device, and VRAM requirement", () => {
    assertEquals(cliExtraEnv(undefined, "hf_tok", "cpu", 51200), {
      HF_TOKEN: "hf_tok",
      HUGGING_FACE_HUB_TOKEN: "hf_tok",
      RUNNER_DEVICE: "cpu",
      RUNNER_MIN_FREE_VRAM_MB: "51200",
    });
  });

  it("lets explicit settings.env entries win for every key", () => {
    assertEquals(
      cliExtraEnv(
        {
          HF_TOKEN: "u",
          HUGGING_FACE_HUB_TOKEN: "u",
          RUNNER_DEVICE: "cpu",
          RUNNER_MIN_FREE_VRAM_MB: "1",
        },
        "hf_tok",
        "cuda",
        51200,
      ),
      {
        HF_TOKEN: "u",
        HUGGING_FACE_HUB_TOKEN: "u",
        RUNNER_DEVICE: "cpu",
        RUNNER_MIN_FREE_VRAM_MB: "1",
      },
    );
  });

  it("ignores non-positive VRAM requirements", () => {
    assertEquals(cliExtraEnv(undefined, "", undefined, 0), undefined);
    assertEquals(cliExtraEnv(undefined, "", undefined, -5), undefined);
  });
});

// ---------------------------------------------------------------------------
// LocalCliAdapter
// ---------------------------------------------------------------------------

describe("LocalCliAdapter", () => {
  let dir: string;

  beforeEach(() => {
    dir = Deno.makeTempDirSync({ prefix: "cinemaitor_cli_adapter_" });
  });

  afterEach(() => {
    try {
      Deno.removeSync(dir, { recursive: true });
    } catch {
      // best effort
    }
  });

  function cliSettings(
    command: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      command,
      args: [
        "--prompt",
        "{prompt}",
        "--seed",
        "{seed}",
        "--candidate",
        "{candidate}",
        "--output",
        "{output}",
      ],
      timeout_seconds: 30,
      output_extension: "png",
      ...overrides,
    };
  }

  it("runs one process per candidate and collects outputs", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const adapter = new LocalCliAdapter();
    const result = await adapter.generate(
      {
        jobType: "text_to_image",
        seed: "42",
        settings: cliSettings(script, { candidates: 2 }),
        inputs: [],
        promptText: "a lighthouse",
        workDir: dir,
      },
      noopHooks,
    );
    assertEquals(result.seedUsed, "42");
    assertEquals(result.candidates.length, 2);
    assertEquals(result.candidates[0].extension, "png");
    assertEquals(result.candidates[0].mime_type, "image/png");
    const c0 = new TextDecoder().decode(result.candidates[0].content);
    const c1 = new TextDecoder().decode(result.candidates[1].content);
    // Per-candidate seed: candidate 0 gets the job seed, candidate 1 derives.
    assertStringIncludes(c0, "PROMPT=a lighthouse SEED=42 CAND=0");
    assertStringIncludes(c1, "PROMPT=a lighthouse SEED=43 CAND=1");
    assertEquals(result.candidates[0].seed, "42");
    assertEquals(result.candidates[1].seed, "43");
  });

  it("derives distinct per-candidate seeds so deterministic CLIs differ", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const adapter = new LocalCliAdapter();
    const result = await adapter.generate(
      {
        jobType: "text_to_image",
        seed: "1",
        settings: cliSettings(script, { candidates: 3 }),
        inputs: [],
        promptText: "a lighthouse",
        workDir: dir,
      },
      noopHooks,
    );
    assertEquals(result.candidates.length, 3);
    const outputs = result.candidates.map(
      (c) => new TextDecoder().decode(c.content),
    );
    assertEquals(outputs[0], outputs[1].replace("SEED=2", "SEED=1").replace("CAND=1", "CAND=0"));
    assertStringIncludes(outputs[1], "SEED=2 CAND=1");
    assertStringIncludes(outputs[2], "SEED=3 CAND=2");
    assertEquals(new Set(outputs).size, 3);
    assertEquals(result.candidates.map((c) => c.seed), ["1", "2", "3"]);
  });

  it("suffixes the candidate index for non-numeric seeds", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const adapter = new LocalCliAdapter();
    const result = await adapter.generate(
      {
        jobType: "text_to_image",
        seed: "abc",
        settings: cliSettings(script, { candidates: 2 }),
        inputs: [],
        promptText: "a lighthouse",
        workDir: dir,
      },
      noopHooks,
    );
    const c0 = new TextDecoder().decode(result.candidates[0].content);
    const c1 = new TextDecoder().decode(result.candidates[1].content);
    assertStringIncludes(c0, "SEED=abc CAND=0");
    assertStringIncludes(c1, "SEED=abc:1 CAND=1");
  });

  it("injects the HF token into the CLI env for gated-repo hub access", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const adapter = new LocalCliAdapter();
    const result = await adapter.generate(
      {
        jobType: "text_to_image",
        seed: "42",
        settings: cliSettings(script),
        inputs: [],
        promptText: "a lighthouse",
        workDir: dir,
        hfToken: "hf_fake_token_123",
      },
      noopHooks,
    );
    const out = new TextDecoder().decode(result.candidates[0].content);
    assertStringIncludes(out, "HFTOKEN=hf_fake_token_123");
  });

  it("sets no HF token env when the model is not HF-origin", async () => {
    const prevToken = Deno.env.get("HF_TOKEN");
    Deno.env.delete("HF_TOKEN");
    try {
      const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
      const adapter = new LocalCliAdapter();
      const result = await adapter.generate(
        {
          jobType: "text_to_image",
          seed: "42",
          settings: cliSettings(script),
          inputs: [],
          promptText: "a lighthouse",
          workDir: dir,
        },
        noopHooks,
      );
      const out = new TextDecoder().decode(result.candidates[0].content);
      assertStringIncludes(out, "HFTOKEN= DEVICE= MINFREE=");
    } finally {
      if (prevToken !== undefined) Deno.env.set("HF_TOKEN", prevToken);
    }
  });

  it("lets an explicit settings.env HF_TOKEN override the injected one", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const adapter = new LocalCliAdapter();
    const result = await adapter.generate(
      {
        jobType: "text_to_image",
        seed: "42",
        settings: cliSettings(script, { env: { HF_TOKEN: "user_token" } }),
        inputs: [],
        promptText: "a lighthouse",
        workDir: dir,
        hfToken: "hf_fake_token_123",
      },
      noopHooks,
    );
    const out = new TextDecoder().decode(result.candidates[0].content);
    assertStringIncludes(out, "HFTOKEN=user_token");
  });

  it("injects RUNNER_DEVICE and RUNNER_MIN_FREE_VRAM_MB from settings", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const adapter = new LocalCliAdapter();
    const result = await adapter.generate(
      {
        jobType: "text_to_image",
        seed: "42",
        settings: cliSettings(script, {
          device: "cuda",
          min_free_vram_mb: 51200,
        }),
        inputs: [],
        promptText: "a lighthouse",
        workDir: dir,
      },
      noopHooks,
    );
    const out = new TextDecoder().decode(result.candidates[0].content);
    assertStringIncludes(out, "DEVICE=cuda");
    assertStringIncludes(out, "MINFREE=51200");
  });

  it("injects no device env when settings carry none", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const adapter = new LocalCliAdapter();
    const result = await adapter.generate(
      {
        jobType: "text_to_image",
        seed: "42",
        settings: cliSettings(script),
        inputs: [],
        promptText: "a lighthouse",
        workDir: dir,
      },
      noopHooks,
    );
    const out = new TextDecoder().decode(result.candidates[0].content).trimEnd();
    // The trailing env fields are empty (no RUNNER_DEVICE / RUNNER_MIN_FREE_VRAM_MB).
    assertMatch(out, /DEVICE= MINFREE=$/);
  });

  it("uses a random numeric seed when none is given", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const adapter = new LocalCliAdapter();
    const result = await adapter.generate(
      {
        jobType: "text_to_image",
        seed: "random",
        settings: cliSettings(script, { candidates: 1 }),
        inputs: [],
        promptText: "a lighthouse",
        workDir: dir,
      },
      noopHooks,
    );
    assertMatch(result.seedUsed, /^\d+$/);
  });

  it("passes input file paths to the CLI", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const input0 = `${dir}/input0.png`;
    Deno.writeTextFileSync(input0, "input");
    const adapter = new LocalCliAdapter();
    const result = await adapter.generate(
      {
        jobType: "image_to_video",
        seed: "7",
        settings: cliSettings(script, {
          candidates: 1,
          args: ["--prompt", "{prompt}", "--from", "{input:0}", "--output", "{output}"],
        }),
        inputs: [{
          asset_id: "a1",
          version_number: 1,
          file_path: input0,
          format: "png",
          mime_type: "image/png",
        }],
        promptText: "make it move",
        workDir: dir,
      },
      noopHooks,
    );
    const out = new TextDecoder().decode(result.candidates[0].content);
    assertStringIncludes(out, `FROM=${input0}`);
  });

  it("surfaces a non-zero exit with the stderr tail", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const adapter = new LocalCliAdapter();
    await assertRejects(
      () =>
        adapter.generate(
          {
            jobType: "text_to_image",
            seed: "1",
            settings: cliSettings(script, { candidates: 1 }),
            inputs: [],
            promptText: "FAIL",
            workDir: dir,
          },
          noopHooks,
        ),
      Error,
      "exited with code 3",
    );
  });

  it("times out and kills a stuck CLI", async () => {
    const script = writeScript(dir, "fake-sleep.sh", fakeSleepScript);
    const adapter = new LocalCliAdapter();
    await assertRejects(
      () =>
        adapter.generate(
          {
            jobType: "text_to_image",
            seed: "1",
            settings: cliSettings(script, { candidates: 1, timeout_seconds: 1 }),
            inputs: [],
            promptText: "a lighthouse",
            workDir: dir,
          },
          noopHooks,
        ),
      Error,
      "timed out after 1s",
    );
  });

  it("requires a command", async () => {
    const adapter = new LocalCliAdapter();
    await assertRejects(
      () =>
        adapter.generate(
          {
            jobType: "text_to_image",
            seed: "1",
            settings: {},
            inputs: [],
            promptText: "x",
            workDir: dir,
          },
          noopHooks,
        ),
      Error,
      "requires a 'command'",
    );
  });

  it("requires an {output} placeholder in args", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const adapter = new LocalCliAdapter();
    await assertRejects(
      () =>
        adapter.generate(
          {
            jobType: "text_to_image",
            seed: "1",
            settings: cliSettings(script, { args: ["--prompt", "{prompt}"] }),
            inputs: [],
            promptText: "x",
            workDir: dir,
          },
          noopHooks,
        ),
      Error,
      "{output}",
    );
  });

  it("rejects before spawning when the job is already cancelled", async () => {
    const script = writeScript(dir, "fake-gen.sh", fakeGenScript);
    const adapter = new LocalCliAdapter();
    await assertRejects(
      () =>
        adapter.generate(
          {
            jobType: "text_to_image",
            seed: "1",
            settings: cliSettings(script, { candidates: 1 }),
            inputs: [],
            promptText: "x",
            workDir: dir,
          },
          { onProgress: () => {}, isCancelled: () => true },
        ),
      Error,
      "cancelled",
    );
  });
});

// ---------------------------------------------------------------------------
// ComfyUIAdapter (in-process fake server)
// ---------------------------------------------------------------------------

interface FakeComfyState {
  uploaded: string[];
  lastWorkflow: string | null;
  historyCalls: number;
}

function startFakeComfyUi(state: FakeComfyState): { url: string; shutdown: () => void } {
  let promptSeq = 0;
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1" },
    async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/upload/image") {
        const body = await req.text();
        const match = body.match(/filename="([^"]+)"/);
        const name = match ? match[1] : "upload.bin";
        state.uploaded.push(name);
        return Response.json({ name });
      }
      if (req.method === "POST" && url.pathname === "/prompt") {
        const payload = (await req.json()) as {
          prompt?: unknown;
          client_id?: string;
        };
        if (!payload.prompt || !payload.client_id) {
          return Response.json({ error: "bad request" }, { status: 400 });
        }
        const rendered = JSON.stringify(payload.prompt);
        state.lastWorkflow = rendered;
        const id = rendered.includes("FAIL") ? "p-err" : `p-ok-${promptSeq++}`;
        return Response.json({ prompt_id: id });
      }
      if (req.method === "GET" && url.pathname.startsWith("/history/")) {
        const id = url.pathname.slice("/history/".length);
        if (id === "p-err") {
          return Response.json({
            "p-err": {
              status: {
                status_str: "error",
                messages: [{
                  type: "execution_error",
                  data: { exception_message: "kaboom: node 3 blew up" },
                }],
              },
              outputs: {},
            },
          });
        }
        state.historyCalls += 1;
        if (state.historyCalls === 1) return Response.json({});
        return Response.json({
          [id]: {
            status: { status_str: "success" },
            outputs: {
              "9": {
                images: [
                  { filename: "out1.png", subfolder: "", type: "output" },
                  { filename: "out2.png" },
                ],
              },
            },
          },
        });
      }
      if (req.method === "GET" && url.pathname === "/view") {
        const filename = url.searchParams.get("filename") ?? "";
        const bytes = filename.startsWith("out1")
          ? new TextEncoder().encode("PNG-ONE")
          : new TextEncoder().encode("PNG-TWO");
        return new Response(bytes, {
          headers: { "Content-Type": "image/png" },
        });
      }
      if (req.method === "POST" && url.pathname === "/interrupt") {
        return Response.json({ status: "ok" });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  );
  const addr = server.addr;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    shutdown: () => {
      server.shutdown();
    },
  };
}

describe("ComfyUIAdapter", () => {
  let dir: string;
  let state: FakeComfyState;
  let fake: { url: string; shutdown: () => void };

  beforeEach(() => {
    dir = Deno.makeTempDirSync({ prefix: "cinemaitor_comfyui_adapter_" });
    state = { uploaded: [], lastWorkflow: null, historyCalls: 0 };
    fake = startFakeComfyUi(state);
  });

  afterEach(() => {
    fake.shutdown();
    try {
      Deno.removeSync(dir, { recursive: true });
    } catch {
      // best effort
    }
  });

  function comfySettings(
    endpoint: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      endpoint,
      workflow: {
        "3": {
          class_type: "KSampler",
          inputs: {
            seed: "{{seed}}",
            text: "{{prompt}}",
          },
        },
        "7": {
          class_type: "LoadImage",
          inputs: { image: "{{input:0}}" },
        },
      },
      timeout_seconds: 20,
      ...overrides,
    };
  }

  it("uploads inputs, substitutes the workflow, and collects outputs", async () => {
    const input0 = `${dir}/source.png`;
    Deno.writeTextFileSync(input0, "source-bytes");
    const adapter = new ComfyUIAdapter();
    const result = await adapter.generate(
      {
        jobType: "image_to_video",
        seed: "1234",
        settings: comfySettings(fake.url),
        inputs: [{
          asset_id: "a1",
          version_number: 1,
          file_path: input0,
          format: "png",
          mime_type: "image/png",
        }],
        promptText: "a lighthouse waving",
        workDir: dir,
      },
      noopHooks,
    );
    assertEquals(result.seedUsed, "1234");
    assertEquals(result.candidates.length, 2);
    assertEquals(new TextDecoder().decode(result.candidates[0].content), "PNG-ONE");
    assertEquals(new TextDecoder().decode(result.candidates[1].content), "PNG-TWO");
    assertEquals(result.candidates[0].extension, "png");
    assertEquals(result.candidates[0].mime_type, "image/png");

    // Upload path: the input file name reached the server.
    assertEquals(state.uploaded.length, 1);
    assertMatch(state.uploaded[0], /^cinemaitor-.+\.png$/);

    // Workflow substitution: prompt text, seed as a number, uploaded file name.
    assert(state.lastWorkflow !== null);
    assertStringIncludes(state.lastWorkflow!, "a lighthouse waving");
    assertStringIncludes(state.lastWorkflow!, `"seed":1234`);
    assertStringIncludes(state.lastWorkflow!, state.uploaded[0]);
    // The first /history call returns empty, proving the adapter polls.
    assert(state.historyCalls >= 2);
  });

  const t2iWorkflow = {
    "3": { class_type: "KSampler", inputs: { text: "{{prompt}}", seed: "{{seed}}" } },
  };

  it("submits non-numeric (benchmark) seeds as INTs", async () => {
    const adapter = new ComfyUIAdapter();
    const result = await adapter.generate(
      {
        jobType: "text_to_image",
        seed: "bench-minimax_h3",
        settings: comfySettings(fake.url, { workflow: t2iWorkflow }),
        inputs: [],
        promptText: "x",
        workDir: dir,
      },
      noopHooks,
    );
    assertEquals(result.seedUsed, "bench-minimax_h3");
    assert(state.lastWorkflow !== null);
    const submitted = JSON.parse(state.lastWorkflow!) as Record<string, {
      inputs: Record<string, unknown>;
    }>;
    const seedValue = submitted["3"].inputs.seed;
    assertEquals(typeof seedValue, "number");
    const seedAsNumber = seedValue as number;
    assert(Number.isInteger(seedAsNumber) && seedAsNumber >= 0);
    assertEquals(seedAsNumber, comfySeedToInt("bench-minimax_h3"));
  });

  it("surfaces ComfyUI execution errors", async () => {
    const adapter = new ComfyUIAdapter();
    await assertRejects(
      () =>
        adapter.generate(
          {
            jobType: "text_to_image",
            seed: "1",
            settings: comfySettings(fake.url, { workflow: t2iWorkflow }),
            inputs: [],
            promptText: "FAIL",
            workDir: dir,
          },
          noopHooks,
        ),
      Error,
      "kaboom: node 3 blew up",
    );
  });

  it("rejects when the server is unreachable", async () => {
    const adapter = new ComfyUIAdapter();
    await assertRejects(
      () =>
        adapter.generate(
          {
            jobType: "text_to_image",
            seed: "1",
            settings: comfySettings("http://127.0.0.1:9", { workflow: t2iWorkflow }),
            inputs: [],
            promptText: "x",
            workDir: dir,
          },
          noopHooks,
        ),
      Error,
      "ComfyUI unreachable",
    );
  });

  it("requires an endpoint and a workflow", async () => {
    const adapter = new ComfyUIAdapter();
    await assertRejects(
      () =>
        adapter.generate(
          {
            jobType: "text_to_image",
            seed: "1",
            settings: { workflow: { "3": { class_type: "KSampler" } } },
            inputs: [],
            promptText: "x",
            workDir: dir,
          },
          noopHooks,
        ),
      Error,
      "endpoint",
    );
    await assertRejects(
      () =>
        adapter.generate(
          {
            jobType: "text_to_image",
            seed: "1",
            settings: { endpoint: fake.url },
            inputs: [],
            promptText: "x",
            workDir: dir,
          },
          noopHooks,
        ),
      Error,
      "workflow",
    );
  });

  it("rejects workflows that reference missing inputs", async () => {
    const adapter = new ComfyUIAdapter();
    await assertRejects(
      () =>
        adapter.generate(
          {
            jobType: "text_to_image",
            seed: "1",
            settings: comfySettings(fake.url, {
              workflow: { "7": { class_type: "LoadImage", inputs: { image: "{{input:1}}" } } },
            }),
            inputs: [],
            promptText: "x",
            workDir: dir,
          },
          noopHooks,
        ),
      Error,
      "references input 1",
    );
  });
});
