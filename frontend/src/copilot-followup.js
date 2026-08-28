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
 * @param {"approved"|"rejected"} verb How the user resolved it.
 * @param {string} [summary] Short human-readable result summary (approved only).
 * @param {string[]} [pendingTools] Tools still pending from earlier turns.
 * @returns {string}
 */
export function followUpMessage(tool, verb, summary = "", pendingTools = []) {
  if (typeof tool !== "string" || !tool) throw new Error("tool must be a non-empty string");
  if (verb !== "approved" && verb !== "rejected") {
    throw new Error("verb must be 'approved' or 'rejected'");
  }
  const pending = Array.isArray(pendingTools)
    ? [...new Set(pendingTools.filter((t) => typeof t === "string" && t))]
    : [];
  const outcome = verb === "approved"
    ? `approved your \`${tool}\` proposal and it completed${summary ? ` (${summary})` : ""}`
    : `rejected your \`${tool}\` proposal`;
  const pendingNote = pending.length
    ? ` Still pending from earlier: ${
      pending.map((t) => `\`${t}\``).join(", ")
    } — do not re-propose those steps.`
    : " No other proposals are pending.";
  const next = verb === "approved"
    ? " Continue with the remaining steps of the plan if there are any — propose the next mutating action(s) for approval. If the plan is complete, briefly confirm the final state."
    : " Adjust the plan accordingly: propose a replacement if the goal still makes sense, or confirm the final state if the plan is complete.";
  return `The user just ${outcome}.${pendingNote}${next}`;
}
