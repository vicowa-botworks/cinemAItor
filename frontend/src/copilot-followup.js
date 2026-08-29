// Pure helpers for the model copilot's auto-continue follow-up turns.
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
