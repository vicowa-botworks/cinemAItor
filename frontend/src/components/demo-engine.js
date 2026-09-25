// Demo engine (docs/demo.md) — a pure, deterministic step runner for demo
// modes. No DOM, no Lit, no timers by default that tests can't override —
// unit-tested in frontend/tests/demo-mode.test.js.
//
// A demo run is an ordered list of STEPS. Two modes:
//   auto   — for each step: prepare → dwell (so the user sees the filled
//            settings) → execute → poll to completion → next step
//   guided — prepare → PAUSE (the user edits the real form however they like)
//            → continue() → execute → poll → pause at the next step
//
// The engine communicates exclusively through onEvent; demo-runner.js renders
// those events. Hosts (the pages) own the run object: they create it, assign
// it to the runner, and forward the runner's continue/skip/stop events back.
//
// Step contract (host-defined plain objects):
//   {
//     id: string,                 // unique within the run
//     title: string,              // checklist label
//     stage?: string,             // optional group label (the movie demo)
//     async prepare(ctx) {},      // fill form fields / create objects
//     async describe(ctx) => string,  // narration: what was set, and why
//     async execute(ctx) => work | null,
//       // submit via the page's real handler or the API.
//       // work: null | { kind: "none" } | { kind: "asset", asset_id }
//       //      | { kind: "jobs", job_ids: string[] } | { kind: "render", render_id }
//     async poll(ctx, work) => { done, failed?, error?, progress?, note?, result? }
//       // required when execute returned a jobs/render work handle.
//   }
// ctx is the run's ctx object, passed to every step function untouched.

export const DEMO_STEP_STATUS = {
  pending: "pending",
  preparing: "preparing",
  ready: "ready",
  running: "running",
  done: "done",
  failed: "failed",
  skipped: "skipped",
};

const errText = (err) => String(err?.message ?? err);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DemoRun {
  /**
   * @param {object} opts
   * @param {Array<object>} opts.steps step objects (see file header)
   * @param {"auto"|"guided"} [opts.mode]
   * @param {object} [opts.ctx] passed to every step function
   * @param {(event: object) => void} [opts.onEvent]
   * @param {number} [opts.dwellMs] auto-mode pause between "ready" and "execute"
   * @param {number} [opts.pollMs] wait between poll() calls
   * @param {(ms: number) => Promise<void>} [opts.sleep] test hook
   */
  constructor(
    {
      steps,
      mode = "auto",
      ctx,
      onEvent,
      dwellMs = 1200,
      pollMs = 1500,
      sleep = defaultSleep,
    },
  ) {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error("DemoRun requires a non-empty steps array");
    }
    const ids = new Set();
    for (const step of steps) {
      if (typeof step?.id !== "string" || step.id === "") {
        throw new Error("every demo step needs a non-empty id");
      }
      if (ids.has(step.id)) {
        throw new Error(`duplicate demo step id: ${step.id}`);
      }
      ids.add(step.id);
    }
    this.mode = mode === "guided" ? "guided" : "auto";
    this.ctx = ctx ?? {};
    this._steps = steps.map((step) => ({
      step,
      status: DEMO_STEP_STATUS.pending,
      narration: "",
      note: "",
      progress: null,
      result: undefined,
      error: null,
    }));
    this._onEvent = onEvent ?? (() => {});
    this._dwellMs = dwellMs;
    this._pollMs = pollMs;
    this._sleep = sleep;
    this._idx = -1;
    this._stopped = false;
    this._finished = false;
    this._failedEntry = null;
    this._results = {};
  }

  /** Step view for UIs: stable shape, no internals. */
  get states() {
    return this._steps.map((e, index) => ({
      index,
      id: e.step.id,
      title: e.step.title ?? e.step.id,
      stage: e.step.stage ?? null,
      status: e.status,
      narration: e.narration,
      note: e.note,
      progress: e.progress,
      error: e.error,
    }));
  }

  get current() {
    return this._idx >= 0 && this._idx < this._steps.length ? this._steps[this._idx] : null;
  }

  get finished() {
    return this._finished;
  }

  /** True when the run ended in a step failure (not done/stopped). */
  get failed() {
    return this._failedEntry !== null;
  }

  /** The failure's error text, or null. */
  get error() {
    return this._failedEntry?.error ?? null;
  }

  /** Guided mode: the prepared step is waiting for the user to continue. */
  get paused() {
    return this.mode === "guided" && !this._finished &&
      this.current?.status === DEMO_STEP_STATUS.ready;
  }

  get results() {
    return this._results;
  }

  _meta(entry) {
    return {
      id: entry.step.id,
      title: entry.step.title ?? entry.step.id,
      stage: entry.step.stage ?? null,
    };
  }

  _emit(type, extra = {}) {
    try {
      this._onEvent({ type, index: this._idx, ...extra });
    } catch {
      // A broken listener must not kill the run.
    }
  }

  _advance() {
    this._idx += 1;
    return this._idx < this._steps.length ? this._steps[this._idx] : null;
  }

  _failStep(entry, error) {
    entry.status = DEMO_STEP_STATUS.failed;
    entry.error = error;
    this._emit("step-failed", { step: this._meta(entry), error });
  }

  _finishDone() {
    if (this._finished) return;
    this._finished = true;
    this._emit("done", { results: this._results });
  }

  _finishFailed(entry) {
    if (this._finished) return;
    this._finished = true;
    this._stopped = true;
    this._failedEntry = entry;
    this._emit("failed", { step: this._meta(entry), error: entry.error });
  }

  _finishStopped() {
    if (this._finished) return;
    this._finished = true;
    this._emit("stopped", {
      completed: this._steps.filter((e) => e.status === DEMO_STEP_STATUS.done).length,
    });
  }

  /** Prepare the current step (fill + narrate). Resolves "ok" | "failed". */
  async _prepare(entry) {
    entry.status = DEMO_STEP_STATUS.preparing;
    this._emit("step-start", { step: this._meta(entry) });
    try {
      await entry.step.prepare?.(this.ctx);
      entry.narration = String((await entry.step.describe?.(this.ctx)) ?? "");
      entry.status = DEMO_STEP_STATUS.ready;
      this._emit("step-ready", {
        step: this._meta(entry),
        narration: entry.narration,
      });
      return "ok";
    } catch (err) {
      this._failStep(entry, errText(err));
      return "failed";
    }
  }

  /** Execute + poll the prepared step. Resolves "ok" | "failed" | "stopped". */
  async _execute(entry) {
    entry.status = DEMO_STEP_STATUS.running;
    this._emit("step-running", { step: this._meta(entry) });
    let work;
    try {
      work = await entry.step.execute?.(this.ctx);
    } catch (err) {
      this._failStep(entry, errText(err));
      return "failed";
    }
    if (!work || work.kind === "none" || work.kind === "asset") {
      const result = work ?? { kind: "none" };
      entry.status = DEMO_STEP_STATUS.done;
      entry.result = result;
      this._results[entry.step.id] = result;
      this._emit("step-done", { step: this._meta(entry), result });
      return "ok";
    }
    for (;;) {
      if (this._stopped) return "stopped";
      let state;
      try {
        state = (await entry.step.poll?.(this.ctx, work)) ?? { done: true };
      } catch (err) {
        this._failStep(entry, errText(err));
        return "failed";
      }
      if (state.failed) {
        this._failStep(entry, state.error ?? "step failed");
        return "failed";
      }
      if (state.note) entry.note = String(state.note);
      if (typeof state.progress === "number") entry.progress = state.progress;
      this._emit("step-progress", {
        step: this._meta(entry),
        progress: typeof state.progress === "number" ? state.progress : null,
        note: state.note ? String(state.note) : null,
      });
      if (state.done) {
        const result = state.result ?? work;
        entry.status = DEMO_STEP_STATUS.done;
        entry.result = result;
        this._results[entry.step.id] = result;
        this._emit("step-done", { step: this._meta(entry), result });
        return "ok";
      }
      await this._sleep(this._pollMs);
    }
  }

  /** Start the run. auto: runs to the end; guided: pauses after step 1's prepare. */
  async start() {
    if (this._finished || this._idx >= 0) return;
    this._emit("start", { total: this._steps.length, mode: this.mode });
    for (;;) {
      if (this._stopped) return this._finishStopped();
      const entry = this._advance();
      if (!entry) return this._finishDone();
      const prepared = await this._prepare(entry);
      if (prepared === "failed") return this._finishFailed(entry);
      if (this._stopped) return this._finishStopped();
      if (entry.status === DEMO_STEP_STATUS.skipped) continue;
      if (this.mode === "guided") {
        this._emit("pause", { step: this._meta(entry) });
        return;
      }
      await this._sleep(this._dwellMs);
      if (this._stopped) return this._finishStopped();
      if (entry.status === DEMO_STEP_STATUS.skipped) continue;
      const outcome = await this._execute(entry);
      if (outcome === "failed") return this._finishFailed(entry);
      if (outcome === "stopped") return this._finishStopped();
    }
  }

  /** Guided mode: run the prepared (ready) step, then pause at the next one. */
  async continue() {
    const entry = this.current;
    if (
      this._stopped || this.mode !== "guided" || !entry ||
      entry.status !== DEMO_STEP_STATUS.ready
    ) return;
    const outcome = await this._execute(entry);
    if (outcome === "failed") return this._finishFailed(entry);
    if (outcome === "stopped") return this._finishStopped();
    for (;;) {
      if (this._stopped) return this._finishStopped();
      const next = this._advance();
      if (!next) return this._finishDone();
      const prepared = await this._prepare(next);
      if (prepared === "failed") return this._finishFailed(next);
      if (next.status === DEMO_STEP_STATUS.skipped) continue;
      this._emit("pause", { step: this._meta(next) });
      return;
    }
  }

  /** Skip the prepared step (no execute). auto: only meaningful during the dwell. */
  async skip() {
    const entry = this.current;
    if (!entry || entry.status !== DEMO_STEP_STATUS.ready) return;
    entry.status = DEMO_STEP_STATUS.skipped;
    this._emit("step-skipped", { step: this._meta(entry) });
    if (this.mode === "guided") {
      for (;;) {
        if (this._stopped) return this._finishStopped();
        const next = this._advance();
        if (!next) return this._finishDone();
        const prepared = await this._prepare(next);
        if (prepared === "failed") return this._finishFailed(next);
        if (next.status === DEMO_STEP_STATUS.skipped) continue;
        this._emit("pause", { step: this._meta(next) });
        return;
      }
    }
  }

  /** Stop the run. A running poll loop notices on its next iteration. */
  stop() {
    if (this._finished) return;
    this._stopped = true;
    // If nothing is mid-poll (paused, dwelling, between steps), settle now so
    // callers always observe a terminal state.
    if (!this.current || this.current.status !== DEMO_STEP_STATUS.running) {
      this._finishStopped();
    }
  }
}
