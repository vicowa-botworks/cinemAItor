// Pure helpers for the model copilot's auto-continue follow-up turns and for
// telling the page when the copilot has changed something it renders.
//
// A copilot turn ends after it creates its proposals; approving a proposal
// only executes the tool and does NOT resume the conversation. After each
// approval/rejection the UI sends one follow-up turn with the outcome so a
// multi-step plan (runner script -> venv -> adapter update) chains without
// the user having to type "continue".

/**
 * Collect the tool names of proposals that are still pending across chat
 * turns, in first-appearance order (duplicates collapsed).
 *
 * @param {Array<{proposals?: Array<{tool: string, status: string}>}>} turns
 * @returns {string[]}
 */
export function collectPendingTools(turns) {
  const tools = [];
  for (const turn of turns ?? []) {
    for (const p of turn?.proposals ?? []) {
      if (p && p.status === "pending" && p.tool && !tools.includes(p.tool)) {
        tools.push(p.tool);
      }
    }
  }
  return tools;
}

/**
 * Map in-memory chat turns to the agent request's `history` array.
 *
 * Empty turns (the in-flight assistant placeholder) are dropped. The
 * `synthetic` flag survives the mapping: the backend logs it on the stored
 * conversation row so auto-continue follow-ups stay distinguishable from
 * real user input in the conversation log (the LLM itself never sees the
 * flag — `validateAgentHistory` reads only role/content).
 *
 * @param {Array<{role: string, content: string, synthetic?: boolean}>} turns
 * @returns {Array<{role: string, content: string, synthetic?: boolean}>}
 */
export function agentHistory(turns) {
  return (turns ?? [])
    .filter((t) => t && t.content)
    .map((t) =>
      t.synthetic
        ? { role: t.role, content: t.content, synthetic: true }
        : { role: t.role, content: t.content }
    );
}

/**
 * Build the synthetic user message that follows a resolved proposal so the
 * copilot can continue (or close out) the plan.
 *
 * @param {string} tool Tool name of the proposal that just resolved.
 * @param {"approved"|"rejected"|"failed"} verb How the user resolved it ("failed" =
 *   approved, but the tool execution errored and the proposal is still pending).
 * @param {string} [summary] Short human-readable result summary (approved) or the
 *   error message (failed).
 * @param {string[]} [pendingTools] Tools still pending from earlier turns.
 * @returns {string}
 */
export function followUpMessage(tool, verb, summary = "", pendingTools = []) {
  if (typeof tool !== "string" || !tool) {
    throw new Error("tool must be a non-empty string");
  }
  if (verb !== "approved" && verb !== "rejected" && verb !== "failed") {
    throw new Error("verb must be 'approved', 'rejected', or 'failed'");
  }
  const pending = Array.isArray(pendingTools)
    ? [...new Set(pendingTools.filter((t) => typeof t === "string" && t))]
    : [];
  const outcome = verb === "approved"
    ? `approved your \`${tool}\` proposal and it completed${summary ? ` (${summary})` : ""}`
    : verb === "rejected"
    ? `rejected your \`${tool}\` proposal`
    : `approved your \`${tool}\` proposal, but execution failed: ${
      summary || "unknown error"
    } — the proposal is still pending on the server`;
  const pendingNote = pending.length
    ? ` Still pending from earlier: ${
      pending.map((t) => `\`${t}\``).join(", ")
    } — do not re-propose them with the same arguments; propose a corrected replacement if one of them is wrong or failed.`
    : " No other proposals are pending.";
  const next = verb === "approved"
    ? " Continue with the remaining steps of the plan if there are any — propose the next mutating action(s) for approval. If the plan is complete, briefly confirm the final state."
    : verb === "rejected"
    ? " Adjust the plan accordingly: propose a replacement if the goal still makes sense, or confirm the final state if the plan is complete."
    : " Diagnose the failure: if the step's arguments are wrong, propose the CORRECTED version as a new proposal (and tell the user the old pending one can be rejected), or explain the fix if no new proposal is needed.";
  return `The user just ${outcome}.${pendingNote}${next}`;
}

/**
 * Detect the "promise without a proposal" dead end: an assistant reply that
 * asks the user to approve/confirm an action — or claims a proposal was
 * already made ("I've proposed running a smoke test") — even though the turn
 * created no proposals (so there is nothing to approve). The UI offers a
 * nudge button that sends the copilot back to create the missing proposal.
 *
 * Only consulted for turns with zero proposals, so replies that DO carry
 * proposal cards never match.
 *
 * @param {unknown} content Assistant turn text.
 * @returns {boolean}
 */
export function needsProposalNudge(content) {
  if (typeof content !== "string" || content.trim() === "") return false;
  const c = content.toLowerCase();
  return [
    "please approve",
    "approve this",
    "approve the",
    "awaiting approval",
    "awaiting your approval",
    "waiting for approval",
    "waiting for your approval",
    "needs approval",
    "needs your approval",
    "requires approval",
    "requires your approval",
    "your approval",
    "your consent",
    "go ahead",
    "i've proposed",
    "i have proposed",
    "i proposed",
    "i've created a proposal",
    "i've created the proposal",
    "proposed running",
    "proposed installing",
    "proposed writing",
    "proposed updating",
    "the proposal is",
    "approval request",
  ].some((phrase) => c.includes(phrase));
}

// ---------------------------------------------------------------------------
// "What did this change on the page?" — the refresh the UI owes the user once
// the copilot is done.
//
// Two paths mutate state: the user approves a proposal (the tool executes at
// that moment), and a turn whose tools auto-execute in-loop under a model's
// `agent_auto_approve` flag (or an auto-approve MCP server) — there is no
// card to click, so the turn's own steps are the only signal the page has.
// ---------------------------------------------------------------------------

/**
 * The copilot tools whose EXECUTION changes something the Models page renders.
 * Mirrors `MUTATING_AGENT_TOOLS` in `backend/src/services/llm_agent.ts`.
 */
export const REGISTRY_TOOLS = Object.freeze([
  "register_model",
  "register_model_from_huggingface",
  "update_model",
  "update_workflow",
  "write_model_file",
  "install_model_deps",
  "install_model",
  "remove_model",
  "run_smoke_test",
  "run_benchmark",
  "add_mcp_server",
]);

/** Qualified-name prefix of an MCP server's tool: `mcp__<server>__<tool>`. */
const MCP_PREFIX = "mcp__";

/** Nothing happened: no re-read needed. */
const NO_CHANGE = Object.freeze({
  changed: false,
  modelId: null,
  added: false,
  addedModelId: null,
  mcp: false,
  benchmarks: false,
  workflows: false,
});

/**
 * What running `tool` means for the page, from the arguments it was called
 * with and (when the caller has it) the tool's result.
 *
 * An MCP tool's side effects are unknown HERE: the read-only hint lives on the
 * server's registry row, which this layer never sees, and a read-only MCP tool
 * executes inline and reports `status: "ok"` exactly like a mutating one
 * (`llm_agent.ts` runToolInline). So any executed qualified tool counts as a
 * change — a turn that only reads through an MCP server costs a few GETs. If
 * that ever matters, filter on the step's gating in the backend, where the
 * hint actually is, rather than guessing here.
 *
 * @param {string} tool Built-in tool name, or a qualified `mcp__…` name.
 * @param {{model_id?: string}|null} [args] Arguments the tool was called with.
 * @param {{model?: {id?: string}}|null} [result] Tool result, when available.
 * @returns {{changed: boolean, modelId: string|null, added: boolean, addedModelId: string|null, mcp: boolean, benchmarks: boolean, workflows: boolean}}
 */
export function registryChangeForTool(tool, args = null, result = null) {
  const isMcp = typeof tool === "string" && tool.startsWith(MCP_PREFIX);
  const isBuiltIn = typeof tool === "string" && REGISTRY_TOOLS.includes(tool);
  if (!isMcp && !isBuiltIn) return { ...NO_CHANGE };

  const fromResult = result?.model?.id;
  const fromArgs = args?.model_id;
  const modelId = typeof fromResult === "string" && fromResult
    ? fromResult
    : (typeof fromArgs === "string" && fromArgs ? fromArgs : null);

  // Only a brand-new row is expected to appear on the page. An update that
  // takes a model out of the current filter (disabled, retasked) is the
  // filter working as asked, not a change the user cannot see. The new row's
  // id gets its own slot so that merging this with an update to some OTHER
  // model can never leave the page looking for the wrong row.
  const added = tool === "register_model" || tool === "register_model_from_huggingface";

  return {
    changed: true,
    modelId,
    added,
    addedModelId: added ? modelId : null,
    mcp: isMcp || tool === "add_mcp_server",
    benchmarks: tool === "run_benchmark",
    workflows: tool === "update_workflow",
  };
}

/** Union of two change descriptors (the last known model id wins). */
export function mergeRegistryChanges(a, b) {
  const first = a ?? NO_CHANGE;
  const second = b ?? NO_CHANGE;
  return {
    changed: Boolean(first.changed || second.changed),
    modelId: second.modelId ?? first.modelId ?? null,
    added: Boolean(first.added || second.added),
    addedModelId: second.addedModelId ?? first.addedModelId ?? null,
    mcp: Boolean(first.mcp || second.mcp),
    benchmarks: Boolean(first.benchmarks || second.benchmarks),
    workflows: Boolean(first.workflows || second.workflows),
  };
}

/**
 * What a finished copilot turn changed. Only steps with status "ok" count:
 * that is how the backend reports a mutating tool that EXECUTED in-loop
 * (auto-approved). A "proposal" step only queued work — the page refreshes
 * when the user resolves it — and an "error" step changed nothing.
 *
 * @param {Array<{tool: string, args?: object, status: string}>} [steps]
 * @returns {{changed: boolean, modelId: string|null, added: boolean, addedModelId: string|null, mcp: boolean, benchmarks: boolean, workflows: boolean}}
 */
export function registryChangeForTurn(steps = []) {
  return (steps ?? []).reduce(
    (acc, step) =>
      step?.status === "ok"
        ? mergeRegistryChanges(acc, registryChangeForTool(step.tool, step.args))
        : acc,
    { ...NO_CHANGE },
  );
}
