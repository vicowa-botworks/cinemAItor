import { describe, it } from "jsr:@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { parseScript } from "../src/script-parse.js";
import { DemoRun } from "../src/components/demo-engine.js";
import {
  DEMO_FILM,
  DEMO_TASKS,
  demoFilmSummary,
  demoPreflight,
} from "../src/components/demo-content.js";

// ---- demo-content -----------------------------------------------------------

describe("DEMO_FILM", () => {
  it("script text parses into exactly three scenes (fountain-lite)", () => {
    const { scenes, warnings } = parseScript(DEMO_FILM.script.text);
    assertEquals(
      warnings.length,
      0,
      `unexpected parse warnings: ${JSON.stringify(warnings)}`,
    );
    assertEquals(scenes.length, 3);
    assert(
      scenes[0].heading.toUpperCase().startsWith("EXT."),
      "first scene should be an EXT heading",
    );
    assertEquals(
      scenes[0].dialogue.length,
      0,
      "scene 1 is pure action (no dialogue)",
    );
    assertEquals(
      scenes[1].dialogue.length,
      2,
      "scene 2 carries the keeper's dialogue",
    );
    assertEquals(scenes[1].dialogue[0].name, "EAMONN");
    assert(
      scenes[2].action.includes("beached"),
      "scene 3 action mentions the beached boat",
    );
  });

  it("panel @reference tokens resolve to declared demo assets", () => {
    const declared = new Set(DEMO_FILM.assets.map((a) => a.slug));
    const tokens = new Set();
    for (const panel of DEMO_FILM.panels) {
      for (const match of panel.prompt.matchAll(/@(\w+)/g)) {
        tokens.add(match[1]);
      }
    }
    for (const token of tokens) {
      assert(
        declared.has(token),
        `panel prompt references undeclared asset @${token}`,
      );
    }
    assert(
      tokens.size > 0,
      "expected at least one @reference in panel prompts",
    );
  });

  it("assets, panels and shots all carry the fields the page steps need", () => {
    for (const asset of DEMO_FILM.assets) {
      assert(typeof asset.slug === "string" && asset.slug.length > 0);
      assert(
        typeof asset.display_name === "string" && asset.display_name.length > 0,
      );
      assert(typeof asset.prompt === "string" && asset.prompt.length > 0);
    }
    for (const panel of DEMO_FILM.panels) {
      assert(typeof panel.name === "string" && panel.name.length > 0);
      assert(Number.isInteger(panel.scene_index) && panel.scene_index >= 1);
      assert(typeof panel.prompt === "string" && panel.prompt.length > 0);
    }
    for (const shot of DEMO_FILM.shots) {
      assert(Number.isInteger(shot.scene_index) && shot.scene_index >= 1);
      assert(typeof shot.name === "string" && shot.name.length > 0);
      assert(typeof shot.prompt === "string" && shot.prompt.length > 0);
    }
    assertEquals(
      DEMO_FILM.scenes.length,
      3,
      "one film scene per script scene",
    );
    for (const scene of DEMO_FILM.scenes) {
      assert(typeof scene.name === "string" && scene.name.length > 0);
      assert(
        typeof scene.description === "string" && scene.description.length > 0,
      );
      assert(
        Number.isInteger(scene.target_duration) && scene.target_duration > 0,
      );
      assert(typeof scene.prompt === "string" && scene.prompt.length > 0);
    }
    assertEquals(DEMO_FILM.panels.map((p) => p.scene_index).sort(), [
      1,
      1,
      2,
      3,
    ]);
    assertEquals(DEMO_FILM.shots.map((s) => s.scene_index).sort(), [1, 2, 3]);
    assert(
      typeof DEMO_FILM.music.prompt === "string" &&
        DEMO_FILM.music.prompt.length > 0,
    );
  });
});

// ---- demoPreflight ----------------------------------------------------------

function fakePreflight({ modelsByTask, llmStatus, listError } = {}) {
  return {
    listModels: async (params = {}) => {
      if (listError) throw listError;
      return modelsByTask[params.task_type] ?? [];
    },
    getLlmStatus: async () => {
      if (llmStatus instanceof Error) throw llmStatus;
      return llmStatus ?? { configured: true };
    },
  };
}

describe("demoPreflight", () => {
  it("reports ok when every part has a model", async () => {
    const api = fakePreflight({
      modelsByTask: {
        text_to_image: [{ id: "t2i" }],
        image_to_video: [{ id: "i2v" }],
        text_to_video: [{ id: "t2v" }],
        music: [{ id: "music" }],
      },
    });
    const rep = await demoPreflight(api);
    assertEquals(rep.ok, true);
    assertEquals(rep.llm_configured, true);
    assertEquals(rep.tasks.length, DEMO_TASKS.length);
    for (const row of rep.tasks) {
      assertEquals(row.ok, true);
      assertEquals(row.error, null);
      assert(
        typeof row.model_id === "string",
        `model_id expected for ${row.key}`,
      );
    }
  });

  it("skips the i2v clips variant when only the t2v fallback has a model", async () => {
    const api = fakePreflight({
      modelsByTask: {
        text_to_image: [{ id: "t2i" }],
        image_to_video: [],
        text_to_video: [{ id: "t2v" }],
        music: [{ id: "music" }],
      },
    });
    const rep = await demoPreflight(api);
    assertEquals(rep.ok, true);
    const clips = rep.tasks.find((t) => t.key === "clips");
    const clipsText = rep.tasks.find((t) => t.key === "clips_text");
    assertEquals(clips.ok, false, "no i2v model: the i2v variant is skipped");
    assertEquals(clipsText.ok, true, "the t2v fallback covers the clips");
  });

  it("reports not-ok when a required part has no model", async () => {
    const api = fakePreflight({
      modelsByTask: {
        text_to_image: [{ id: "t2i" }],
        image_to_video: [{ id: "i2v" }],
        text_to_video: [],
        music: [],
      },
    });
    const rep = await demoPreflight(api);
    assertEquals(rep.ok, false);
    const music = rep.tasks.find((t) => t.key === "music");
    assertEquals(music.ok, false);
    assertEquals(music.model_id, null);
  });

  it("treats LLM status as optional — a missing LLM never gates the demo", async () => {
    const api = fakePreflight({
      modelsByTask: {
        text_to_image: [{ id: "t2i" }],
        image_to_video: [{ id: "i2v" }],
        text_to_video: [],
        music: [{ id: "music" }],
      },
      llmStatus: new Error("no llm"),
    });
    const rep = await demoPreflight(api);
    assertEquals(rep.ok, true);
    assertEquals(rep.llm_configured, false);
  });

  it("surfaces a listModels failure on the affected task row", async () => {
    const api = fakePreflight({ listError: new Error("boom") });
    const rep = await demoPreflight(api);
    assertEquals(rep.ok, false);
    for (const row of rep.tasks) {
      assertEquals(row.ok, false);
      assertEquals(row.error, "boom");
    }
  });
});

describe("demoFilmSummary", () => {
  it("tallies the film in one line", () => {
    const line = demoFilmSummary();
    assert(line.includes("3 image assets"));
    assert(line.includes("4 storyboard panels"));
    assert(line.includes("3 scene clips"));
    assert(line.includes("1 music score"));
    assert(line.includes("1 timeline render"));
  });
});

// ---- demo-engine ------------------------------------------------------------

describe("DemoRun", () => {
  const nowait = async () => {};
  const tick = () => new Promise((r) => setTimeout(r, 0));

  function makeStep(overrides = {}) {
    return {
      id: overrides.id ?? "step",
      title: overrides.title ?? "Step",
      stage: overrides.stage,
      prepare: overrides.prepare ?? (async () => {}),
      execute: overrides.execute ?? (async () => null),
      poll: overrides.poll,
      ...overrides,
    };
  }

  it("rejects empty or invalid step lists", () => {
    assertThrows(() => new DemoRun({ steps: [] }), Error, "empty");
    assertThrows(
      () => new DemoRun({ steps: [{ title: "no id" }] }),
      Error,
      "id",
    );
    assertThrows(
      () =>
        new DemoRun({
          steps: [{ id: "a", title: "A" }, { id: "a", title: "A2" }],
        }),
      Error,
      "duplicate",
    );
  });

  it("auto mode runs every step start to finish and reports per-step results", async () => {
    const events = [];
    const executed = [];
    const run = new DemoRun({
      steps: [
        makeStep({
          id: "a",
          title: "A",
          execute: async () => {
            executed.push("a");
            return { kind: "asset", asset_id: "a1" };
          },
        }),
        makeStep({
          id: "b",
          title: "B",
          execute: async () => {
            executed.push("b");
            return { kind: "jobs", job_ids: ["j1"] };
          },
          poll: async (ctx, work) => {
            assertEquals(work, { kind: "jobs", job_ids: ["j1"] });
            return { done: true, progress: 100, note: "finished" };
          },
        }),
      ],
      mode: "auto",
      dwellMs: 0,
      pollMs: 0,
      sleep: nowait,
      onEvent: (e) => events.push(e.type),
    });

    await run.start();

    assertEquals(executed, ["a", "b"]);
    assertEquals(run.results, {
      a: { kind: "asset", asset_id: "a1" },
      b: { kind: "jobs", job_ids: ["j1"] },
    });
    assertEquals(run.states.map((s) => s.status), ["done", "done"]);
    assertEquals(events, [
      "start",
      "step-start",
      "step-ready",
      "step-running",
      "step-done",
      "step-start",
      "step-ready",
      "step-running",
      "step-progress",
      "step-done",
      "done",
    ]);
    // start() once finished is a no-op.
    await run.start();
    assertEquals(executed, ["a", "b"]);
  });

  it("stops the run when a poll reports a failure, keeping later steps pending", async () => {
    const events = [];
    let polls = 0;
    const run = new DemoRun({
      steps: [
        makeStep({
          id: "bad",
          title: "Bad",
          execute: async () => ({ kind: "jobs", job_ids: ["j"] }),
          poll: async () => {
            polls += 1;
            return polls < 2
              ? { done: false, progress: 50 }
              : { done: false, failed: true, error: "out of VRAM" };
          },
        }),
        makeStep({
          id: "never",
          title: "Never",
          execute: async () => ({ kind: "asset", asset_id: "n" }),
        }),
      ],
      mode: "auto",
      dwellMs: 0,
      pollMs: 0,
      sleep: nowait,
      onEvent: (e) => events.push(e.type),
    });

    await run.start();

    assertEquals(polls, 2);
    assertEquals(run.failed, true);
    assertEquals(run.error, "out of VRAM");
    assertEquals(run.results, {});
    assertEquals(run.states[0].status, "failed");
    assertEquals(run.states[1].status, "pending");
    assert(events.includes("failed"), "expected a failed event");
  });

  it("stop() ends a running poll loop and reports what completed", async () => {
    let polls = 0;
    const gates = [];
    const sleep = () => new Promise((r) => gates.push(r));
    const run = new DemoRun({
      steps: [
        makeStep({
          id: "long",
          title: "Long",
          execute: async () => ({ kind: "jobs", job_ids: ["j"] }),
          poll: async () => {
            polls += 1;
            return { done: false, progress: 10 };
          },
        }),
        makeStep({
          id: "after",
          title: "After",
          execute: async () => ({ kind: "asset", asset_id: "a" }),
        }),
      ],
      mode: "auto",
      dwellMs: 0,
      pollMs: 0,
      sleep,
    });

    const started = run.start();
    await tick(); // parked in the dwell gate
    assert(gates.length === 1, "expected to be parked in the dwell gate");
    gates.shift()(); // dwell -> execute -> poll #1 -> parked in the poll gate
    await tick();
    assertEquals(polls, 1);
    run.stop();
    gates.shift()(); // the loop's next iteration notices _stopped
    await started;

    assertEquals(run.results, {});
    assertEquals(
      run.states[0].status,
      "running",
      "the interrupted step keeps its running state",
    );
    assertEquals(run.states[1].status, "pending");
  });

  it("skip() in auto mode skips the current step's execute and continues", async () => {
    const executed = [];
    let release;
    let sleepCalls = 0;
    const sleep = async () => {
      sleepCalls += 1;
      if (sleepCalls > 1) return; // only gate the first dwell (step a's)
      await new Promise((r) => (release = r));
    };
    const run = new DemoRun({
      steps: [
        makeStep({
          id: "a",
          title: "A",
          execute: async () => {
            executed.push("a");
            return { kind: "asset", asset_id: "a1" };
          },
        }),
        makeStep({
          id: "b",
          title: "B",
          execute: async () => {
            executed.push("b");
            return { kind: "asset", asset_id: "b1" };
          },
        }),
      ],
      mode: "auto",
      dwellMs: 0,
      pollMs: 0,
      sleep,
    });

    const started = run.start();
    await tick(); // now parked in a's dwell gate
    assertEquals(executed, []);
    await run.skip();
    assertEquals(run.states[0].status, "skipped");
    release(); // the loop then skips a and runs b
    await started;

    assertEquals(executed, ["b"]);
    assertEquals(run.results, { b: { kind: "asset", asset_id: "b1" } });
  });

  it("guided mode pauses at each prepared step until continue() runs it", async () => {
    const events = [];
    const executed = [];
    const run = new DemoRun({
      steps: [
        makeStep({
          id: "a",
          title: "A",
          execute: async () => {
            executed.push("a");
            return { kind: "asset", asset_id: "a1" };
          },
        }),
        makeStep({
          id: "b",
          title: "B",
          execute: async () => {
            executed.push("b");
            return { kind: "asset", asset_id: "b1" };
          },
        }),
      ],
      mode: "guided",
      dwellMs: 0,
      pollMs: 0,
      sleep: nowait,
      onEvent: (e) => events.push(e.type),
    });

    await run.start();
    assertEquals(run.states[0].status, "ready");
    assertEquals(run.paused, true);
    assertEquals(executed, []);

    await run.continue();
    assertEquals(executed, ["a"]);
    assertEquals(run.states[0].status, "done");
    assertEquals(run.states[1].status, "ready");

    await run.continue();
    assertEquals(executed, ["a", "b"]);
    assertEquals(run.paused, false);
    assertEquals(events.at(-1), "done");
  });

  it("continue() does not re-prepare the step the user was editing", async () => {
    const preps = {};
    const run = new DemoRun({
      steps: [
        makeStep({
          id: "a",
          title: "A",
          prepare: async () => {
            preps.a = (preps.a ?? 0) + 1;
          },
          execute: async () => ({ kind: "asset", asset_id: "a1" }),
        }),
        makeStep({
          id: "b",
          title: "B",
          prepare: async () => {
            preps.b = (preps.b ?? 0) + 1;
          },
          execute: async () => ({ kind: "asset", asset_id: "b1" }),
        }),
      ],
      mode: "guided",
      dwellMs: 0,
      pollMs: 0,
      sleep: nowait,
    });

    await run.start();
    assertEquals(preps.a, 1);
    await run.continue();
    assertEquals(
      preps.a,
      1,
      "step a must not be prepared again when the user continues",
    );
    assertEquals(preps.b, 1);
    await run.continue();
    assertEquals(preps.a, 1);
    assertEquals(preps.b, 1);
  });

  it("guided mode: skip() advances without executing the prepared step", async () => {
    const executed = [];
    const run = new DemoRun({
      steps: [
        makeStep({
          id: "a",
          title: "A",
          execute: async () => {
            executed.push("a");
            return { kind: "asset", asset_id: "a1" };
          },
        }),
        makeStep({
          id: "b",
          title: "B",
          execute: async () => {
            executed.push("b");
            return { kind: "asset", asset_id: "b1" };
          },
        }),
      ],
      mode: "guided",
      dwellMs: 0,
      pollMs: 0,
      sleep: nowait,
    });

    await run.start();
    await run.skip();
    assertEquals(executed, []);
    assertEquals(run.states[0].status, "skipped");
    assertEquals(run.states[1].status, "ready");
    await run.skip();
    assertEquals(executed, []);
    assertEquals(run.results, {});
    // The run finished by skipping everything — continue() is now a no-op.
    await run.continue();
    assertEquals(executed, []);
  });

  it("exposes per-step state rows (status, progress, note, stage) while polling", async () => {
    let polls = 0;
    const gates = [];
    const sleep = async () => {
      await new Promise((r) => gates.push(r));
    };
    const run = new DemoRun({
      steps: [
        makeStep({
          id: "job",
          title: "Job step",
          stage: "Assemble",
          execute: async () => ({ kind: "jobs", job_ids: ["j"] }),
          poll: async () => {
            polls += 1;
            return polls < 2
              ? { done: false, progress: 40, note: "concat" }
              : { done: true, progress: 100 };
          },
        }),
      ],
      mode: "auto",
      dwellMs: 0,
      pollMs: 0,
      sleep,
    });

    const started = run.start();
    await tick(); // parked in the dwell gate
    gates.shift()(); // dwell -> execute -> poll #1 -> parked in poll gate
    await tick();
    assertEquals(run.states[0].status, "running");
    assertEquals(run.states[0].progress, 40);
    assertEquals(run.states[0].note, "concat");
    assertEquals(run.states[0].stage, "Assemble");
    gates.shift()(); // poll #2 -> done
    await started;
    assertEquals(run.states[0].status, "done");
    assertEquals(run.states[0].progress, 100);
  });

  it("continue() is a no-op when nothing is paused", async () => {
    const executed = [];
    const run = new DemoRun({
      steps: [
        makeStep({
          id: "a",
          title: "A",
          execute: async () => {
            executed.push("a");
            return { kind: "asset", asset_id: "a1" };
          },
        }),
        makeStep({
          id: "b",
          title: "B",
          execute: async () => {
            executed.push("b");
            return { kind: "asset", asset_id: "b1" };
          },
        }),
      ],
      mode: "auto",
      dwellMs: 0,
      pollMs: 0,
      sleep: nowait,
    });
    // In auto mode nothing is ever "ready", so continue() must not run anything.
    await run.start();
    assertEquals(executed, ["a", "b"]);
    await run.continue();
    assertEquals(executed, ["a", "b"]);
  });
});
