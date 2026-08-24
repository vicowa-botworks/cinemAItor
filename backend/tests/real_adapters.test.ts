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
echo "PROMPT=$prompt SEED=$seed CAND=$cand FROM=$from" > "$out"
`;

const fakeSleepScript = `#!/bin/sh
sleep 30
`;

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

  it("throws when an input index is out of range", () => {
    assertThrows(
      () =>
        renderCliArgs(["{input:2}"], {
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
    assertStringIncludes(c0, "PROMPT=a lighthouse SEED=42 CAND=0");
    assertStringIncludes(c1, "PROMPT=a lighthouse SEED=42 CAND=1");
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
