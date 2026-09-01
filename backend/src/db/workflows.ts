import { getDb } from "./database.ts";
import { badRequest, notFound } from "../errors.ts";

/**
 * Saved ComfyUI workflows, treated as DATA the Model Copilot references by
 * id rather than context it must read. A model's default_settings can carry
 * `workflow_ref` pointing at one of these rows instead of inlining the full
 * prompt graph (which routinely runs 30k-100k+ chars and would be truncated
 * by the agent's per-message cap).
 */

export const WORKFLOW_MAX_BYTES = 1024 * 1024; // 1 MB

export interface WorkflowSummary {
  id: string;
  name: string;
  filename: string | null;
  size: number;
  node_count: number;
  created_at: string;
}

export interface WorkflowRow extends WorkflowSummary {
  content: string;
  created_by: number;
  updated_at: string;
}

/** Compact per-node view so the copilot can reason about a workflow's
 *  structure (where {{prompt}}/{{seed}} belong) without the full JSON. */
export interface WorkflowNodePreview {
  id: string;
  class_type: string | null;
  inputs: Record<string, unknown>;
}

export interface WorkflowDetail extends WorkflowSummary {
  nodes: WorkflowNodePreview[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Parse + validate uploaded workflow content. Returns the canonical
 * ComfyUI API-format prompt graph (a node map of {id: {class_type, inputs}}).
 * Throws badRequest with an actionable message otherwise.
 */
export function parseWorkflowContent(content: unknown): Record<string, unknown> {
  let parsed: unknown;
  if (typeof content === "string") {
    if (content.trim() === "") throw badRequest("Workflow content is empty", "content");
    try {
      parsed = JSON.parse(content);
    } catch {
      throw badRequest("Workflow content must be valid JSON", "content");
    }
  } else {
    parsed = content;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badRequest(
      "Workflow must be a JSON object (the ComfyUI API prompt graph)",
      "content",
    );
  }
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj["nodes"])) {
    throw badRequest(
      "This looks like a ComfyUI UI-format workflow (it has a 'nodes' array). The app needs the " +
        'API-format prompt graph — a node map of {"<id>": {"class_type": ..., "inputs": {...}}}. ' +
        "In ComfyUI use 'Save (API Format)', or ask the copilot to convert it.",
      "content",
    );
  }
  const nodeIds = Object.keys(obj);
  if (nodeIds.length === 0) throw badRequest("Workflow has no nodes", "content");
  const hasClassType = nodeIds.some((key) => {
    const value = obj[key];
    return typeof value === "object" && value !== null &&
      typeof (value as Record<string, unknown>)["class_type"] === "string";
  });
  if (!hasClassType) {
    throw badRequest(
      "Workflow does not look like a ComfyUI API prompt graph (no node carries a 'class_type'). " +
        'Expected {"<node_id>": {"class_type": ..., "inputs": {...}}}.',
      "content",
    );
  }
  return obj;
}

function previewValue(value: unknown): unknown {
  if (typeof value === "string") return value.length > 100 ? `${value.slice(0, 100)}…` : value;
  if (Array.isArray(value)) return "[link]";
  if (value !== null && typeof value === "object") return "[object]";
  return value;
}

function toDetail(row: WorkflowRow): WorkflowDetail {
  const workflow = JSON.parse(row["content"]) as Record<string, unknown>;
  const nodes: WorkflowNodePreview[] = Object.entries(workflow).map(([id, value]) => {
    const node = (typeof value === "object" && value !== null ? value : {}) as Record<
      string,
      unknown
    >;
    const inputsRaw = node["inputs"];
    const inputs = (typeof inputsRaw === "object" && inputsRaw !== null ? inputsRaw : {}) as Record<
      string,
      unknown
    >;
    const preview: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(inputs)) preview[key] = previewValue(v);
    return {
      id,
      class_type: typeof node["class_type"] === "string" ? node["class_type"] : null,
      inputs: preview,
    };
  });
  return {
    id: row["id"],
    name: row["name"],
    filename: row["filename"],
    size: row["size"],
    node_count: row["node_count"],
    created_at: row["created_at"],
    nodes,
  };
}

export interface WorkflowCreateRequest {
  name?: string;
  filename?: string;
  content: unknown;
}

/** A single node-level input edit: set (create or overwrite) `input` on the
 *  node `node_id` to `value`. Values are JSON (string placeholders like
 *  "{{prompt}}", numbers, etc.). */
export interface WorkflowInputPatch {
  node_id: string;
  input: string;
  value: unknown;
}

export function createWorkflow(
  userId: number,
  input: WorkflowCreateRequest,
): WorkflowSummary {
  const workflow = parseWorkflowContent(input["content"]);
  const content = JSON.stringify(workflow);
  const size = byteLength(content);
  if (size > WORKFLOW_MAX_BYTES) {
    throw badRequest(
      `Workflow is ${size} bytes; the limit is ${WORKFLOW_MAX_BYTES}`,
      "content",
    );
  }
  const id = `wf_${crypto.randomUUID()}`;
  const now = nowIso();
  let name = (input.name ?? "").trim();
  if (!name) {
    const base = (input.filename ?? "").replace(/\.json$/i, "").trim();
    name = base || `Workflow ${id.slice(3, 11)}`;
  }
  const nodeCount = Object.keys(workflow).length;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO workflows (id, name, filename, content, size, node_count, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(
    id,
    name,
    input.filename ?? null,
    content,
    size,
    nodeCount,
    userId,
    now,
    now,
  );
  return {
    id,
    name,
    filename: input.filename ?? null,
    size,
    node_count: nodeCount,
    created_at: now,
  };
}

export function listWorkflows(): WorkflowSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT id, name, filename, size, node_count, created_at
        FROM workflows ORDER BY created_at DESC, rowid DESC`,
    )
    .all() as unknown as WorkflowSummary[];
  return rows;
}

export function getWorkflow(id: string): WorkflowRow | undefined {
  const row = getDb()
    .prepare("SELECT * FROM workflows WHERE id = ?")
    .get(id) as WorkflowRow | undefined;
  return row;
}

export function getWorkflowDetail(id: string): WorkflowDetail {
  const row = getWorkflow(id);
  if (!row) throw notFound(`Unknown workflow id '${id}'`);
  return toDetail(row);
}

export function deleteWorkflow(id: string): boolean {
  const changes = getDb().prepare(`DELETE FROM workflows WHERE id = ?`).run(
    id,
  ) as unknown as number;
  return changes > 0;
}

/** The stored workflow's raw API-format JSON (throws notFound). */
export function getWorkflowContent(id: string): string {
  const row = getWorkflow(id.trim());
  if (!row) throw notFound(`Unknown workflow id '${id.trim()}'`);
  return row["content"];
}

/**
 * Apply node-level input edits to a stored workflow (create or overwrite a
 * node's input value). This is the surgical-patch path: the caller (the Model
 * Copilot) targets a specific node + input from the compact get_workflow
 * preview, so the full graph never has to pass through the LLM. Returns the
 * updated summary.
 */
export function patchWorkflow(id: string, patches: unknown): WorkflowSummary {
  const row = getWorkflow(id.trim());
  if (!row) throw notFound(`Unknown workflow id '${id.trim()}'`);
  if (!Array.isArray(patches) || patches.length === 0) {
    throw badRequest("patches must be a non-empty array", "patches");
  }
  const workflow = JSON.parse(row["content"]) as Record<string, unknown>;
  for (const raw of patches) {
    const patch = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
      string,
      unknown
    >;
    if (typeof patch["node_id"] !== "string" || patch["node_id"] === "") {
      throw badRequest("each patch needs a non-empty string node_id", "patches");
    }
    if (typeof patch["input"] !== "string" || patch["input"] === "") {
      throw badRequest("each patch needs a non-empty string input", "patches");
    }
    const node = workflow[patch["node_id"]];
    if (typeof node !== "object" || node === null) {
      throw badRequest(`Node '${patch["node_id"]}' not found in workflow`, "patches");
    }
    const nodeObj = node as Record<string, unknown>;
    let inputs = nodeObj["inputs"];
    if (typeof inputs !== "object" || inputs === null) {
      inputs = {};
      nodeObj["inputs"] = inputs;
    }
    (inputs as Record<string, unknown>)[patch["input"]] = patch["value"];
  }
  const content = JSON.stringify(workflow);
  const size = byteLength(content);
  if (size > WORKFLOW_MAX_BYTES) {
    throw badRequest(
      `Workflow is ${size} bytes after patching; the limit is ${WORKFLOW_MAX_BYTES}`,
      "content",
    );
  }
  const nodeCount = Object.keys(workflow).length;
  const now = nowIso();
  const stmt = getDb().prepare(
    `UPDATE workflows SET content = ?, size = ?, node_count = ?, updated_at = ? WHERE id = ?`,
  );
  (stmt.run as (...params: unknown[]) => unknown)(content, size, nodeCount, now, row["id"]);
  return {
    id: row["id"],
    name: row["name"],
    filename: row["filename"],
    size,
    node_count: nodeCount,
    created_at: row["created_at"],
  };
}

/** Resolve a workflow_ref to its stored API-format node map (throws notFound). */
export function resolveWorkflowRef(ref: string): Record<string, unknown> {
  const row = getWorkflow(ref.trim());
  if (!row) throw notFound(`Unknown workflow id '${ref.trim()}'`);
  return JSON.parse(row["content"]) as Record<string, unknown>;
}

/**
 * Materialize a `workflow_ref` inside a model's default_settings: when the
 * settings carry a string `workflow_ref`, load that workflow's node map and
 * store it under `workflow` (the key the comfyui adapter reads), dropping the
 * ref. Returns the settings unchanged when no ref is present, so callers can
 * run it unconditionally before settings validation + storage.
 */
export function materializeWorkflowRef(
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!settings) return settings;
  const ref = settings["workflow_ref"];
  if (typeof ref !== "string" || ref.trim() === "") return settings;
  const workflow = resolveWorkflowRef(ref);
  const next = { ...settings };
  delete next["workflow_ref"];
  next["workflow"] = workflow;
  return next;
}
