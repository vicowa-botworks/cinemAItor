import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { DemoHost } from "../src/components/demo-host.js";

// Apply the mixin to a bare base class so the keep-alive lifecycle can be
// exercised without Lit/DOM. Only the connect/disconnect/stop paths are under
// test; the Lit render getters (which need a DOM) are never invoked here.
class Base {}
const Host = DemoHost(Base);

function mockWindow() {
  globalThis.window = {
    location: { hash: "" },
    addEventListener() {},
    removeEventListener() {},
  };
}

// A stand-in for a live DemoRun exposing just the surface the mixin touches:
// finished/stopped flags, a ctx, and stop().
function fakeRun({ finished = false, stopped = false } = {}) {
  return {
    finished,
    stopped,
    ctx: { host: null },
    stop() {
      this.stopped = true;
    },
  };
}

let keySeq = 0;
function makeHost(key) {
  mockWindow();
  const h = new Host();
  h.requestUpdate = () => {};
  if (key !== undefined) {
    Object.defineProperty(h, "demoKeepAliveKey", {
      value: key,
      configurable: true,
    });
  }
  return h;
}

describe("DemoHost keep-alive across navigation (issue #197)", () => {
  it("a keep-alive host parks a live run on disconnect without stopping it", () => {
    const key = `k-park-${keySeq++}`;
    const host = makeHost(key);
    const run = fakeRun();
    host._demoRun = run;

    host.disconnectedCallback();

    assertEquals(run.stopped, false, "a keep-alive run must not be stopped");
    assertEquals(host._demoRun, null, "the field is cleared on disconnect");
  });

  it("the next mount of the same page reattaches the parked run", () => {
    const key = `k-reattach-${keySeq++}`;
    const first = makeHost(key);
    const run = fakeRun();
    first._demoRun = run;
    first.disconnectedCallback();

    const second = makeHost(key);
    second.connectedCallback();

    assertEquals(second._demoRun, run, "the live run is readopted");
    assertEquals(run.ctx.host, second, "the run's ctx points at the live page");
  });

  it("a default host (no key) stops its run on disconnect", () => {
    const host = makeHost(undefined); // demoKeepAliveKey defaults to ""
    const run = fakeRun();
    host._demoRun = run;

    host.disconnectedCallback();

    assertEquals(run.stopped, true, "a page-bound run is stopped");
    assertEquals(host._demoRun, null);
  });

  it("a finished run is not parked, so a remount shows nothing", () => {
    const key = `k-finished-${keySeq++}`;
    const first = makeHost(key);
    const run = fakeRun({ finished: true });
    first._demoRun = run;
    first.disconnectedCallback();

    const second = makeHost(key);
    second.connectedCallback();

    assertEquals(second._demoRun, null, "a finished run is dropped, not shown");
  });

  it("a stopped run is not parked, so a remount shows nothing", () => {
    const key = `k-stopped-${keySeq++}`;
    const first = makeHost(key);
    const run = fakeRun({ stopped: true });
    first._demoRun = run;
    first.disconnectedCallback();

    const second = makeHost(key);
    second.connectedCallback();

    assertEquals(second._demoRun, null);
  });

  it("stopping a keep-alive run clears it so a remount shows nothing", () => {
    const key = `k-stop-${keySeq++}`;
    const first = makeHost(key);
    const run = fakeRun();
    first._demoRun = run;
    first.disconnectedCallback(); // parked

    // A fresh mount reattaches, then the user stops it from the card.
    const second = makeHost(key);
    second.connectedCallback();
    assertEquals(second._demoRun, run);
    second._demoStop();

    assertEquals(run.stopped, true);

    const third = makeHost(key);
    third.connectedCallback();
    assertEquals(
      third._demoRun,
      null,
      "after an explicit stop the parked run is gone",
    );
  });

  it("a navigation does not stop a keep-alive run", () => {
    const key = `k-nav-${keySeq++}`;
    const host = makeHost(key);
    const run = fakeRun();
    host._demoRun = run;

    host._onDemoNavigate();

    assertEquals(run.stopped, false, "keep-alive hosts defer to disconnect");
    assertEquals(host._demoRun, run, "the run stays attached through nav");
  });

  it("a navigation stops a default (page-bound) run", () => {
    const host = makeHost(undefined);
    const run = fakeRun();
    host._demoRun = run;

    host._onDemoNavigate();

    assertEquals(run.stopped, true);
  });

  it("reattach does not clobber a run already in progress on this page", () => {
    const key = `k-noclobber-${keySeq++}`;
    const parked = fakeRun();
    const stasher = makeHost(key);
    stasher._demoRun = parked;
    stasher.disconnectedCallback();

    const host = makeHost(key);
    const current = fakeRun();
    host._demoRun = current; // a run already started on this page
    host.connectedCallback();

    assertEquals(host._demoRun, current, "the live run wins over the parked one");
  });
});
