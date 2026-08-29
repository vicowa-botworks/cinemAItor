import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { collectPendingTools, followUpMessage } from "../src/copilot-followup.js";

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
