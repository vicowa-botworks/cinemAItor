import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { getDb, resetDb } from "../src/db/database.ts";
import * as schema from "../src/db/schema.ts";
import { registerModel, updateModel } from "../src/db/models.ts";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  getWorkflowContent,
  getWorkflowDetail,
  listWorkflows,
  materializeWorkflowRef,
  parseWorkflowContent,
  patchWorkflow,
  resolveWorkflowRef,
  WORKFLOW_MAX_BYTES,
} from "../src/db/workflows.ts";

// A minimal ComfyUI API-format prompt graph (node map, not UI format).
const GRAPH = {
  "3": { class_type: "KSampler", inputs: { seed: 42, steps: 20, model: ["4", 0] } },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sd.x.safetensors" } },
  "5": { class_type: "CLIPTextEncode", inputs: { text: "{{prompt}}", clip: ["4", 1] } },
};

let userId: number;

function freshUser() {
  return schema.createUser(
    `owner.${Math.random().toString(36).slice(2)}@example.com`,
    "hash123",
    "Owner",
  );
}

describe("parseWorkflowContent", () => {
  beforeEach(() => {
    getDb(":memory:");
    userId = freshUser();
  });
  afterEach(() => {
    resetDb();
  });

  it("accepts an API-format node map (object or JSON string)", () => {
    assertEquals(parseWorkflowContent(GRAPH), GRAPH);
    assertEquals(parseWorkflowContent(JSON.stringify(GRAPH)), GRAPH);
  });

  it("rejects empty, non-JSON, and non-object content", () => {
    assertThrows(() => parseWorkflowContent("   "), Error, "empty");
    assertThrows(() => parseWorkflowContent("{not json"), Error, "valid JSON");
    assertThrows(() => parseWorkflowContent([1, 2, 3]), Error, "JSON object");
    assertThrows(() => parseWorkflowContent("42"), Error, "JSON object");
  });

  it("rejects UI-format workflows (nodes array) with an actionable hint", () => {
    assertThrows(() => parseWorkflowContent({ nodes: [], links: [] }), Error, "API Format");
  });

  it("rejects graphs with no nodes or no class_type", () => {
    assertThrows(() => parseWorkflowContent({}), Error, "no nodes");
    assertThrows(() => parseWorkflowContent({ "1": { inputs: {} } }), Error, "class_type");
  });
});

describe("saved workflows", () => {
  beforeEach(() => {
    getDb(":memory:");
    userId = freshUser();
  });
  afterEach(() => {
    resetDb();
  });

  it("creates, lists, reads and deletes a workflow", () => {
    const a = createWorkflow(userId, { content: GRAPH, filename: "a.json" });
    const b = createWorkflow(userId, { name: "Second", content: JSON.stringify(GRAPH) });

    assert(a.id.startsWith("wf_"));
    assertEquals(a.node_count, 3);
    assertEquals(a.size, new TextEncoder().encode(JSON.stringify(GRAPH)).length);
    assertEquals(a.filename, "a.json");
    // A name is derived from the filename when none is given.
    assertEquals(a.name, "a");
    assertEquals(b.name, "Second");

    // listWorkflows is newest-first.
    const listed = listWorkflows();
    assertEquals(listed.length, 2);
    assertEquals(listed[0].id, b.id);
    assertEquals(listed[1].id, a.id);

    // Raw content round-trips.
    const row = getWorkflow(a.id);
    assertEquals(JSON.parse(row!.content), GRAPH);

    // Detail carries a compact per-node preview.
    const detail = getWorkflowDetail(a.id);
    assertEquals(detail.node_count, 3);
    const sampler = detail.nodes.find((n) => n.id === "3");
    assertEquals(sampler!.class_type, "KSampler");
    assertEquals(sampler!.inputs["model"], "[link]"); // array link -> [link]
    assertEquals(sampler!.inputs["seed"], 42);
    const encoder = detail.nodes.find((n) => n.id === "5");
    assertEquals(encoder!.inputs["text"], "{{prompt}}");

    // Delete (second call is a no-op).
    assertEquals(deleteWorkflow(a.id), true);
    assertEquals(deleteWorkflow(a.id), false);
    assertEquals(listWorkflows().length, 1);
    assertThrows(() => getWorkflowDetail("wf_missing"), Error, "Unknown workflow");
  });

  it("caps workflow size at the byte limit", () => {
    const pad = "x".repeat(WORKFLOW_MAX_BYTES + 1024);
    const huge = { "1": { class_type: "CLIPTextEncode", inputs: { text: pad } } };
    assertThrows(() => createWorkflow(userId, { content: huge }), Error, "limit is");
  });
});

describe("workflow_ref resolution", () => {
  beforeEach(() => {
    getDb(":memory:");
    userId = freshUser();
  });
  afterEach(() => {
    resetDb();
  });

  it("resolveWorkflowRef loads the stored node map", () => {
    const wf = createWorkflow(userId, { content: GRAPH });
    assertEquals(resolveWorkflowRef(wf.id), GRAPH);
    assertThrows(() => resolveWorkflowRef("wf_missing"), Error, "Unknown workflow");
  });

  it("materializeWorkflowRef swaps the ref for the stored graph", () => {
    const wf = createWorkflow(userId, { content: GRAPH });
    const out = materializeWorkflowRef({ endpoint: "http://x", workflow_ref: wf.id })!;
    assertEquals(out["workflow_ref"], undefined);
    assertEquals(out["workflow"], GRAPH);
    assertEquals(out["endpoint"], "http://x");
  });

  it("materializeWorkflowRef is a no-op without a usable ref", () => {
    const settings = { endpoint: "http://x", workflow: { "1": { class_type: "A" } } };
    assertEquals(materializeWorkflowRef(settings), settings);
    assertEquals(materializeWorkflowRef({ workflow_ref: "" }), { workflow_ref: "" });
    assertEquals(materializeWorkflowRef(null), null);
    assertEquals(materializeWorkflowRef(undefined), undefined);
  });

  it("registerModel resolves workflow_ref into default_settings.workflow", () => {
    const wf = createWorkflow(userId, { content: GRAPH });
    const m = registerModel(userId, {
      name: "flux-comfy",
      version: "1.0",
      backend: "comfyui",
      task_types: ["text_to_image"],
      default_settings: { endpoint: "http://127.0.0.1:8188", workflow_ref: wf.id },
    });
    assertEquals(m.default_settings["workflow"], GRAPH);
    assertEquals(m.default_settings["workflow_ref"], undefined);
    assertEquals(m.default_settings["endpoint"], "http://127.0.0.1:8188");
  });

  it("registerModel rejects an unknown workflow_ref", () => {
    assertThrows(
      () =>
        registerModel(userId, {
          name: "bad-ref",
          version: "1.0",
          backend: "comfyui",
          task_types: ["text_to_image"],
          default_settings: { endpoint: "http://127.0.0.1:8188", workflow_ref: "wf_missing" },
        }),
      Error,
      "Unknown workflow",
    );
  });

  it("updateModel can swap in a saved workflow by ref", () => {
    const wf = createWorkflow(userId, { content: GRAPH });
    const m = registerModel(userId, {
      name: "flux-comfy",
      version: "1.0",
      backend: "comfyui",
      task_types: ["text_to_image"],
      default_settings: {
        endpoint: "http://127.0.0.1:8188",
        workflow: { "9": { class_type: "OldNode", inputs: {} } },
      },
    });
    const updated = updateModel(userId, m.id, {
      default_settings: { endpoint: "http://127.0.0.1:8188", workflow_ref: wf.id },
    });
    assertEquals(updated!.default_settings["workflow"], GRAPH);
    assertEquals(updated!.default_settings["workflow_ref"], undefined);
  });
});

describe("patchWorkflow", () => {
  beforeEach(() => {
    getDb(":memory:");
    userId = freshUser();
  });
  afterEach(() => {
    resetDb();
  });

  it("creates or overwrites node inputs and returns the updated summary", () => {
    const wf = createWorkflow(userId, { content: GRAPH });
    const out = patchWorkflow(wf.id, [
      { node_id: "3", input: "seed", value: 7 }, // overwrite an existing input
      { node_id: "5", input: "text", value: "{{prompt}}" }, // overwrite with a placeholder
      { node_id: "4", input: "custom", value: "x" }, // create a new input
    ]);
    assertEquals(out.node_count, 3);
    const parsed = JSON.parse(getWorkflowContent(wf.id)) as Record<
      string,
      { inputs: Record<string, unknown> }
    >;
    assertEquals(parsed["3"].inputs["seed"], 7);
    assertEquals(parsed["5"].inputs["text"], "{{prompt}}");
    assertEquals(parsed["4"].inputs["custom"], "x");
    // Unpatched inputs survive.
    assertEquals(parsed["3"].inputs["steps"], 20);
  });

  it("rejects unknown workflow, empty patches, and missing nodes/fields", () => {
    assertThrows(
      () => patchWorkflow("wf_missing", [{ node_id: "1", input: "a", value: 1 }]),
      Error,
      "Unknown workflow",
    );
    const wf = createWorkflow(userId, { content: GRAPH });
    assertThrows(() => patchWorkflow(wf.id, []), Error, "non-empty");
    assertThrows(() => patchWorkflow(wf.id, [{}]), Error, "node_id");
    assertThrows(() => patchWorkflow(wf.id, [{ node_id: "3" }]), Error, "input");
    assertThrows(
      () => patchWorkflow(wf.id, [{ node_id: "99", input: "a", value: 1 }]),
      Error,
      "not found",
    );
  });

  it("enforces the byte cap after patching", () => {
    const wf = createWorkflow(userId, { content: GRAPH });
    const pad = "x".repeat(WORKFLOW_MAX_BYTES + 1024);
    assertThrows(
      () => patchWorkflow(wf.id, [{ node_id: "5", input: "text", value: pad }]),
      Error,
      "limit is",
    );
  });
});
