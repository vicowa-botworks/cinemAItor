import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  agentHistory,
  collectPendingTools,
  followUpMessage,
  mergeRegistryChanges,
  needsProposalNudge,
  registryChangeForTool,
  registryChangeForTurn,
} from "../src/copilot-followup.js";

describe("collectPendingTools", () => {
  it("collects pending tools in first-appearance order", () => {
    const turns = [
      {
        proposals: [
          { tool: "write_model_file", status: "pending" },
          { tool: "install_model_deps", status: "pending" },
        ],
      },
      { proposals: [{ tool: "update_model", status: "pending" }] },
    ];
    assertEquals(collectPendingTools(turns), [
      "write_model_file",
      "install_model_deps",
      "update_model",
    ]);
  });

  it("ignores resolved proposals and collapses duplicates", () => {
    const turns = [
      {
        proposals: [
          { tool: "write_model_file", status: "approved" },
          { tool: "install_model_deps", status: "pending" },
          { tool: "install_model_deps", status: "pending" },
          { tool: "update_model", status: "rejected" },
        ],
      },
    ];
    assertEquals(collectPendingTools(turns), ["install_model_deps"]);
  });

  it("handles missing proposals and empty input", () => {
    assertEquals(collectPendingTools([]), []);
    assertEquals(collectPendingTools(undefined), []);
    assertEquals(collectPendingTools([{ role: "user", content: "hi" }, null, {}]), []);
  });
});

describe("agentHistory", () => {
  it("carries the synthetic flag for auto-continue turns", () => {
    const turns = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "a reply" },
      { role: "user", content: "The user just approved your `x` proposal...", synthetic: true },
    ];
    assertEquals(agentHistory(turns), [
      { role: "user", content: "first question" },
      { role: "assistant", content: "a reply" },
      { role: "user", content: "The user just approved your `x` proposal...", synthetic: true },
    ]);
  });

  it("omits the flag on non-synthetic turns", () => {
    assertEquals(
      agentHistory([{ role: "user", content: "hi" }, { role: "assistant", content: "there" }]),
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "there" },
      ],
    );
  });

  it("drops empty turns (the in-flight assistant placeholder)", () => {
    assertEquals(
      agentHistory([
        { role: "assistant", content: "", steps: [], proposals: [] },
        { role: "user", content: "hi" },
      ]),
      [{ role: "user", content: "hi" }],
    );
  });

  it("handles malformed and empty input", () => {
    assertEquals(agentHistory([]), []);
    assertEquals(agentHistory(undefined), []);
    assertEquals(agentHistory([null, {}, { role: "user" }]), []);
  });
});

describe("followUpMessage", () => {
  it("describes an approval with result summary and no pending steps", () => {
    const msg = followUpMessage("install_model_deps", "approved", "venv ready (7 package(s))", []);
    assertEquals(
      msg,
      "The user just approved your `install_model_deps` proposal and it completed (venv ready (7 package(s)))." +
        " No other proposals are pending." +
        " Continue with the remaining steps of the plan if there are any — propose the next mutating action(s) for approval. If the plan is complete, briefly confirm the final state.",
    );
  });

  it("lists still-pending steps and forbids identical re-proposals", () => {
    const msg = followUpMessage(
      "write_model_file",
      "approved",
      "wrote runner.py",
      ["install_model_deps", "install_model_deps"],
    );
    assertEquals(
      msg,
      "The user just approved your `write_model_file` proposal and it completed (wrote runner.py)." +
        " Still pending from earlier: `install_model_deps` — do not re-propose them with the same arguments; propose a corrected replacement if one of them is wrong or failed." +
        " Continue with the remaining steps of the plan if there are any — propose the next mutating action(s) for approval. If the plan is complete, briefly confirm the final state.",
    );
  });

  it("describes a rejection with adjustment guidance", () => {
    const msg = followUpMessage("install_model_deps", "rejected", "", ["update_model"]);
    assertEquals(
      msg,
      "The user just rejected your `install_model_deps` proposal." +
        " Still pending from earlier: `update_model` — do not re-propose them with the same arguments; propose a corrected replacement if one of them is wrong or failed." +
        " Adjust the plan accordingly: propose a replacement if the goal still makes sense, or confirm the final state if the plan is complete.",
    );
  });

  it("describes a failed approval with diagnose-and-replace guidance", () => {
    const msg = followUpMessage(
      "install_model_deps",
      "failed",
      "pip install timed out",
      ["write_model_file", "install_model_deps"],
    );
    assertEquals(
      msg,
      "The user just approved your `install_model_deps` proposal, but execution failed: pip install timed out — the proposal is still pending on the server." +
        " Still pending from earlier: `write_model_file`, `install_model_deps` — do not re-propose them with the same arguments; propose a corrected replacement if one of them is wrong or failed." +
        " Diagnose the failure: if the step's arguments are wrong, propose the CORRECTED version as a new proposal (and tell the user the old pending one can be rejected), or explain the fix if no new proposal is needed.",
    );
  });

  it("validates its arguments", () => {
    assertThrows(() => followUpMessage("", "approved"));
    assertThrows(() => followUpMessage("x", "maybe"));
  });
});

describe("needsProposalNudge", () => {
  it("detects approval asks in the reply text", () => {
    assertEquals(needsProposalNudge("Please approve this runner.py update."), true);
    assertEquals(needsProposalNudge("Awaiting your approval for the venv install."), true);
    assertEquals(needsProposalNudge("The fix is ready \u2014 waiting for approval."), true);
    assertEquals(needsProposalNudge("PLEASE APPROVE THIS"), true);
  });

  it("detects proposal-claim phrasing ('I've proposed X' with no card)", () => {
    assertEquals(
      needsProposalNudge("I've proposed running a smoke test to validate the fix."),
      true,
    );
    assertEquals(needsProposalNudge("I proposed updating the runner script."), true);
    assertEquals(needsProposalNudge("I have proposed the next step."), true);
    assertEquals(needsProposalNudge("I've created a proposal for the venv install."), true);
    assertEquals(needsProposalNudge("The proposal is pending \u2014 you can approve it."), true);
  });

  it("does not nudge ordinary replies", () => {
    assertEquals(needsProposalNudge("The model is registered and installed."), false);
    assertEquals(needsProposalNudge("I ran the smoke test; it passed."), false);
    assertEquals(needsProposalNudge("There are no pending proposals."), false);
    assertEquals(
      needsProposalNudge("I did not propose anything \u2014 I need the repo ID first."),
      false,
    );
  });

  it("ignores empty and non-string content", () => {
    assertEquals(needsProposalNudge(""), false);
    assertEquals(needsProposalNudge("   "), false);
    assertEquals(needsProposalNudge(null), false);
    assertEquals(needsProposalNudge(undefined), false);
    assertEquals(needsProposalNudge(42), false);
  });
});

describe("registryChangeForTool", () => {
  it("reports no change for read-only tools", () => {
    assertEquals(registryChangeForTool("list_models"), {
      changed: false,
      modelId: null,
      added: false,
      addedModelId: null,
      mcp: false,
      benchmarks: false,
      workflows: false,
    });
    assertEquals(registryChangeForTool(null), {
      changed: false,
      modelId: null,
      added: false,
      addedModelId: null,
      mcp: false,
      benchmarks: false,
      workflows: false,
    });
  });

  it("takes the model id from the result, falling back to the args", () => {
    assertEquals(
      registryChangeForTool("register_model", { name: "Qwen" }, { model: { id: "qwen" } })
        .modelId,
      "qwen",
    );
    assertEquals(
      registryChangeForTool("register_model", { name: "Qwen" }).added,
      true,
    );
    assertEquals(
      registryChangeForTool("update_model", { model_id: "qwen" }).modelId,
      "qwen",
    );
    assertEquals(registryChangeForTool("update_model", { model_id: "qwen" }).added, false);
    assertEquals(registryChangeForTool("install_model", { model_id: "qwen" }).modelId, "qwen");
  });

  it("keeps the added row's id separate from the touched model", () => {
    // The page reveals `addedModelId`; an update to some other model must never
    // take its place, or the new row stays hidden behind the filter.
    assertEquals(
      registryChangeForTool("register_model", { name: "Qwen" }, { model: { id: "qwen" } })
        .addedModelId,
      "qwen",
    );
    assertEquals(registryChangeForTool("update_model", { model_id: "qwen" }).addedModelId, null);
    assertEquals(registryChangeForTool("install_model", { model_id: "qwen" }).addedModelId, null);
  });

  it("flags the panels beyond the model list", () => {
    assertEquals(registryChangeForTool("add_mcp_server").mcp, true);
    assertEquals(registryChangeForTool("run_benchmark", { model_id: "qwen" }).benchmarks, true);
    assertEquals(registryChangeForTool("update_workflow").workflows, true);
    assertEquals(registryChangeForTool("install_model").mcp, false);
  });

  it("treats an executed MCP tool as a change (its effects are unknown)", () => {
    const change = registryChangeForTool("mcp__comfy__restart", null, null);
    assertEquals(change.changed, true);
    assertEquals(change.mcp, true);
    assertEquals(change.modelId, null);
  });
});

describe("mergeRegistryChanges", () => {
  it("unions two changes", () => {
    assertEquals(
      mergeRegistryChanges(
        registryChangeForTool("run_benchmark", { model_id: "qwen" }),
        registryChangeForTool("add_mcp_server"),
      ),
      {
        changed: true,
        modelId: "qwen",
        added: false,
        addedModelId: null,
        mcp: true,
        benchmarks: true,
        workflows: false,
      },
    );
  });

  it("treats a missing side as no change", () => {
    const one = registryChangeForTool("update_model", { model_id: "qwen" });
    assertEquals(mergeRegistryChanges(null, one), one);
    assertEquals(mergeRegistryChanges(one, undefined), one);
    assertEquals(mergeRegistryChanges(null, null).changed, false);
  });

  it("keeps the added row when a later step touched another model", () => {
    // The shape the reveal path is judged on: register A, then update B.
    const merged = mergeRegistryChanges(
      registryChangeForTool("register_model", { name: "A" }, { model: { id: "a" } }),
      registryChangeForTool("update_model", { model_id: "b" }),
    );
    assertEquals(merged.added, true);
    assertEquals(merged.addedModelId, "a");
    assertEquals(merged.modelId, "b");
  });

  it("lets the last known model id win", () => {
    assertEquals(
      mergeRegistryChanges(
        registryChangeForTool("update_model", { model_id: "a" }),
        registryChangeForTool("update_model", { model_id: "b" }),
      ).modelId,
      "b",
    );
    assertEquals(
      mergeRegistryChanges(
        registryChangeForTool("update_model", { model_id: "a" }),
        registryChangeForTool("add_mcp_server"),
      ).modelId,
      "a",
    );
  });
});

describe("registryChangeForTurn", () => {
  it("counts only steps that executed", () => {
    // A proposal step has not run yet; the page refreshes when it is approved.
    assertEquals(
      registryChangeForTurn([
        { tool: "register_model", args: {}, status: "proposal" },
        { tool: "list_models", args: {}, status: "ok" },
        { tool: "update_model", args: { model_id: "qwen" }, status: "error" },
      ]),
      {
        changed: false,
        modelId: null,
        added: false,
        addedModelId: null,
        mcp: false,
        benchmarks: false,
        workflows: false,
      },
    );
  });

  it("detects the auto-approved in-loop execution the page must reflect", () => {
    const change = registryChangeForTurn([
      { tool: "list_models", args: {}, status: "ok" },
      { tool: "write_model_file", args: { model_id: "qwen" }, status: "ok" },
      { tool: "install_model_deps", args: { model_id: "qwen" }, status: "ok" },
      { tool: "update_model", args: { model_id: "qwen" }, status: "ok" },
    ]);
    assertEquals(change.changed, true);
    assertEquals(change.modelId, "qwen");
    assertEquals(change.added, false);
  });

  it("merges every executed step of the turn", () => {
    const change = registryChangeForTurn([
      { tool: "run_benchmark", args: { model_id: "qwen" }, status: "ok" },
      { tool: "mcp__comfy__free", args: {}, status: "ok" },
      { tool: "update_workflow", args: {}, status: "ok" },
    ]);
    assertEquals(change, {
      changed: true,
      modelId: "qwen",
      added: false,
      addedModelId: null,
      mcp: true,
      benchmarks: true,
      workflows: true,
    });
  });

  it("does not let a later update shadow a registered model", () => {
    // A turn that registers one model and updates another: the reveal has to
    // look for the new row, not the model that was already on the page.
    const change = registryChangeForTurn([
      { tool: "register_model", args: { name: "A" }, status: "ok" },
      { tool: "update_model", args: { model_id: "b" }, status: "ok" },
    ]);
    assertEquals(change.added, true);
    assertEquals(change.addedModelId, null); // a step carries no result, so no id
    assertEquals(change.modelId, "b");
  });

  it("tolerates a turn with no steps", () => {
    assertEquals(registryChangeForTurn().changed, false);
    assertEquals(registryChangeForTurn(null).changed, false);
    assertEquals(registryChangeForTurn([null]).changed, false);
  });
});
