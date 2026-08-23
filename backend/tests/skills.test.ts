import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import { getDb, resetDb } from "../src/db/database.ts";
import { createUser } from "../src/db/schema.ts";
import { createProject } from "../src/db/projects.ts";
import { registerModel } from "../src/db/models.ts";
import { finishJob, getJob, listJobs } from "../src/db/jobs.ts";
import {
  createSkill,
  deleteSkill,
  getRun,
  getRunOrThrow,
  getSkill,
  getSkillOrThrow,
  interpolateText,
  listRuns,
  listSkills,
  listSkillVersions,
  parseSkillDefinition,
  resolveSkillInputs,
  seedSystemSkills,
  setSkillEnabled,
  type SkillDefinition,
  updateSkill,
  validateSkillId,
} from "../src/db/skills.ts";
import { runSkill } from "../src/services/skill_engine.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
}

const TENSE_DEF: SkillDefinition = {
  name: "Tense Score",
  version: "1.0.0",
  author: "tester",
  license: "MIT",
  description: "A test music skill.",
  inputs: {
    mood: { type: "string", default: "tense" },
    duration: { type: "number", default: 30 },
  },
  steps: [{ type: "music", prompt: "Cinematic {{ mood }} score, {{ duration }} s" }],
};

function defOverrides(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...JSON.parse(JSON.stringify(TENSE_DEF)), ...overrides };
}

describe("skills (db)", () => {
  let adminId: number;
  let ownerId: number;
  let otherId: number;

  beforeEach(() => {
    getDb(":memory:");
    // Shared in-process DB: resetDb() wipes the skills table, so (re)seed the
    // system starter set — the server does the same at bootstrap.
    seedSystemSkills();
    adminId = createUser(uniqueEmail("admin"), "hash123", "Admin", "admin");
    ownerId = createUser(uniqueEmail("owner"), "hash123", "Owner");
    otherId = createUser(uniqueEmail("other"), "hash123", "Other");
  });

  afterEach(() => {
    resetDb();
  });

  it("seeds the system skill set", () => {
    const all = listSkills();
    const ids = all.map((s) => s.id);
    assert(ids.includes("sys-tense-score"), "system music skill is seeded");
    assert(ids.includes("sys-foley-pass"), "system sfx skill is seeded");
    const tense = getSkill("sys-tense-score");
    assert(tense);
    assertEquals(tense.is_system, true);
    assertEquals(tense.enabled, true);
    assertEquals(tense.definition.steps.length, 1);
    assertEquals(tense.definition.steps[0].type, "music");

    // Re-seeding is idempotent.
    seedSystemSkills();
    assertEquals(listSkills().length, all.length);
  });

  it("creates a user skill and records an initial version snapshot", () => {
    const skill = createSkill("my-score", TENSE_DEF, ownerId);
    assertEquals(skill.id, "my-score");
    assertEquals(skill.is_system, false);
    assertEquals(skill.created_by_user_id, ownerId);
    const versions = listSkillVersions("my-score");
    assertEquals(versions.length, 1);
    assertEquals(versions[0].version, "1.0.0");
  });

  it("rejects reserved system ids and duplicates on create", () => {
    assertThrows(
      () => createSkill("sys-hacked", TENSE_DEF, ownerId),
      Error,
      "reserved",
    );
    createSkill("my-score", TENSE_DEF, ownerId);
    assertThrows(() => createSkill("my-score", TENSE_DEF, otherId), Error, "already exists");
  });

  it("validates skill ids", () => {
    assertEquals(validateSkillId("abc-123_x"), "abc-123_x");
    assertThrows(() => validateSkillId("Has-Uppercase"), Error);
    assertThrows(() => validateSkillId("-starts-with-dash"), Error);
    assertThrows(() => validateSkillId("a".repeat(65)), Error);
    assertThrows(() => validateSkillId(""), Error);
  });

  it("parses and validates definitions", () => {
    const def = parseSkillDefinition(TENSE_DEF);
    assertEquals(def.name, "Tense Score");
    assertEquals(def.license, "MIT");
    assertEquals(parseSkillDefinition(defOverrides({ license: undefined })).license, null);
    assertEquals(def.inputs.mood?.default, "tense");

    const bad: unknown[] = [
      "not-an-object",
      { name: "X", version: "1", steps: [] },
      {
        name: "X",
        version: "1",
        inputs: { mood: { type: "float" } },
        steps: [{ type: "music", prompt: "{{ mood }}" }],
      },
      {
        name: "X",
        version: "1",
        inputs: { mood: { type: "string", required: true, default: "a" } },
        steps: [{ type: "music", prompt: "p" }],
      },
      { name: "X", version: "1", steps: [{ type: "dance", prompt: "p" }] },
      { name: "X", version: "1", steps: [{ type: "music", prompt: "{{ missing }}" }] },
      {
        name: "X",
        version: "1",
        steps: Array.from({ length: 17 }, () => ({ type: "sfx", prompt: "p" })),
      },
      {
        name: "X",
        version: "1",
        inputs: { mood: { type: "string", default: 7 } },
        steps: [{ type: "music", prompt: "{{ mood }}" }],
      },
    ];
    for (const raw of bad) {
      assertThrows(() => parseSkillDefinition(raw), Error);
    }
  });

  it("resolves inputs with defaults, required checks and type checks", () => {
    const def = parseSkillDefinition(TENSE_DEF);
    assertEquals(resolveSkillInputs(def, undefined), { mood: "tense", duration: 30 });
    assertEquals(resolveSkillInputs(def, { mood: "calm" }), { mood: "calm", duration: 30 });

    const requiredDef = parseSkillDefinition(
      defOverrides({
        inputs: { action: { type: "string", required: true } },
        steps: [{ type: "sfx", prompt: "FX: {{ action }}" }],
      }),
    );
    assertThrows(() => resolveSkillInputs(requiredDef, {}), Error, "required");
    assertEquals(resolveSkillInputs(requiredDef, { action: "door slam" }), { action: "door slam" });
    assertThrows(() => resolveSkillInputs(requiredDef, { action: 42 }), Error, "must be a string");
    assertThrows(
      () => resolveSkillInputs(requiredDef, { action: null }),
      Error,
      "must be a string",
    );
    assertThrows(() => resolveSkillInputs(def, { bogus: 1 }), Error, "unknown input");
    assertThrows(() => resolveSkillInputs(def, ["nope"]), Error, "must be an object");
  });

  it("interpolates placeholders and rejects unknown refs", () => {
    assertEquals(interpolateText("Hi {{ name }}!", { name: "Ada" }, "test"), "Hi Ada!");
    assertThrows(() => interpolateText("{{ nope }}", {}, "test"), Error, "unknown input");
  });

  it("updates a skill and appends version history", () => {
    createSkill("my-score", TENSE_DEF, ownerId);
    const v2: SkillDefinition = {
      ...TENSE_DEF,
      version: "2.0.0",
      steps: [{ type: "music", prompt: "Cinematic {{ mood }} score (v2), {{ duration }} s" }],
    };
    const updated = updateSkill("my-score", v2, ownerId);
    assertEquals(updated.version, "2.0.0");
    const versions = listSkillVersions("my-score");
    assertEquals(
      versions.map((v) => v.version),
      ["2.0.0", "1.0.0"],
    );
    assertEquals(getSkill("my-score")?.definition.steps[0].prompt, v2.steps[0].prompt);
  });

  it("restricts mutations to the creator or an admin", () => {
    createSkill("my-score", TENSE_DEF, ownerId);
    assertThrows(
      () => updateSkill("my-score", { ...TENSE_DEF, version: "9.9.9" }, otherId),
      Error,
      "creator or an admin",
    );
    assertThrows(
      () => setSkillEnabled("my-score", false, otherId),
      Error,
      "creator or an admin",
    );
    assertThrows(() => deleteSkill("my-score", otherId), Error, "creator or an admin");
    // Admin may modify other users' skills.
    assertEquals(
      updateSkill("my-score", { ...TENSE_DEF, version: "9.9.9" }, adminId).version,
      "9.9.9",
    );
  });

  it("restricts system skills to admins", () => {
    assertThrows(
      () => updateSkill("sys-tense-score", { ...TENSE_DEF }, ownerId),
      Error,
      "admin",
    );
    assertThrows(() => deleteSkill("sys-tense-score", ownerId), Error, "admin");
    assertThrows(
      () => deleteSkill("sys-tense-score", adminId),
      Error,
      "cannot be deleted",
    );
    const def = getSkillOrThrow("sys-tense-score").definition;
    assertEquals(
      updateSkill("sys-tense-score", { ...def, version: "1.0.1" }, adminId).version,
      "1.0.1",
    );
    assertEquals(setSkillEnabled("sys-tense-score", false, adminId).enabled, false);
  });

  it("deletes skills and cascades versions and runs", () => {
    createSkill("my-score", TENSE_DEF, ownerId);
    const project = createProject({ name: "P" }, ownerId);
    const model = registerModel(ownerId, {
      name: "Mock Music",
      version: "0",
      backend: "mock",
      task_types: ["music"],
      enabled: true,
    });
    const { run } = runSkill(ownerId, "my-score", { project_id: project.id });
    deleteSkill("my-score", ownerId);
    assertEquals(getSkill("my-score"), undefined);
    const db = getDb();
    assertEquals(
      (db.prepare("SELECT COUNT(*) AS n FROM skill_versions WHERE skill_id = 'my-score'").get() as {
        n: number;
      }).n,
      0,
      "versions cascade",
    );
    assertEquals(
      (db.prepare("SELECT COUNT(*) AS n FROM skill_runs WHERE skill_id = 'my-score'").get() as {
        n: number;
      }).n,
      0,
      "runs cascade",
    );
    void run;
    void model;
  });
});

describe("skill engine", () => {
  let ownerId: number;
  let projectId: string;

  beforeEach(() => {
    getDb(":memory:");
    ownerId = createUser(uniqueEmail("owner"), "hash123", "Owner");
    registerModel(ownerId, {
      name: "Mock Music",
      version: "0",
      backend: "mock",
      task_types: ["music", "voice", "audio"],
      enabled: true,
    });
    projectId = createProject({ name: "P" }, ownerId).id;
    createSkill(
      "two-step",
      {
        name: "Two Step",
        version: "1.0.0",
        inputs: { mood: { type: "string", default: "tense" } },
        steps: [
          { type: "music", prompt: "{{ mood }} score" },
          { type: "sfx", prompt: "impact for the {{ mood }} score" },
        ],
      },
      ownerId,
    );
    createSkill(
      "pinned-model",
      {
        name: "Pinned",
        version: "1.0.0",
        inputs: {},
        steps: [{ type: "music", prompt: "p", model_id: "no-such-model" }],
      },
      ownerId,
    );
  });

  afterEach(() => {
    resetDb();
  });

  it("runs a skill and queues one job per step", () => {
    const { run, jobs } = runSkill(ownerId, "two-step", {
      project_id: projectId,
      inputs: { mood: "calm" },
    });
    assertEquals(run.status, "running");
    assertEquals(run.inputs, { mood: "calm" });
    assertEquals(jobs.length, 2);
    assertEquals(run.steps.map((s) => s.kind), ["music", "sfx"]);
    for (const step of run.steps) {
      const job = getJob(step.job_id);
      assert(job, `job ${step.job_id} exists`);
      assertEquals(job.asset_id, step.asset_id);
      assertEquals(job.project_id, projectId);
      assert(step.asset_id, "job targets a fresh asset");
    }
    // The interpolated prompt landed on the audio job.
    const musicJob = getJob(run.steps[0].job_id);
    assert(musicJob);
    assertEquals(musicJob.prompt_text, "calm score");
  });

  it("settles the run once all jobs finish (success)", () => {
    const { run } = runSkill(ownerId, "two-step", { project_id: projectId });
    for (const step of run.steps) finishJob(step.job_id, "succeeded", {});
    const settled = getRunOrThrow(run.id);
    assertEquals(settled.status, "succeeded");
    assertEquals(settled.error_text, null);
    // Settled rows are stable across further reads.
    assertEquals(getRun(run.id)?.status, "succeeded");
  });

  it("settles the run as failed when any job fails", () => {
    const { run } = runSkill(ownerId, "two-step", { project_id: projectId });
    const okStep = run.steps[0];
    const badStep = run.steps[1];
    finishJob(badStep.job_id, "failed", {
      errorText: "mock: step 2 exploded",
      progress: 40,
    });
    const stillRunning = getRun(run.id);
    assertEquals(stillRunning?.status, "running", "waits for the remaining job");
    finishJob(okStep.job_id, "succeeded", {});
    const settled = getRunOrThrow(run.id);
    assertEquals(settled.status, "failed");
    assert(settled.error_text?.includes("step 2 exploded"));
  });

  it("pre-flights model availability before enqueuing", () => {
    assertThrows(
      () => runSkill(ownerId, "pinned-model", { project_id: projectId }),
      Error,
      "unknown model",
    );
    assertEquals(listJobs().length, 0, "no partial jobs on a pre-flight failure");
  });

  it("refuses to run a disabled skill", () => {
    setSkillEnabled("two-step", false, ownerId);
    assertThrows(() => runSkill(ownerId, "two-step", { project_id: projectId }), Error, "disabled");
  });

  it("refuses to run without an available model for the task type", () => {
    getDb().prepare("DELETE FROM models").run();
    assertThrows(
      () => runSkill(ownerId, "two-step", { project_id: projectId }),
      Error,
      "no enabled model",
    );
  });

  it("enforces write permission on the project", () => {
    const strangerId = createUser(uniqueEmail("stranger"), "hash123", "Stranger");
    assertThrows(
      () => runSkill(strangerId, "two-step", { project_id: projectId }),
      Error,
    );
  });

  it("lists runs newest first, scoped to the skill", () => {
    const first = runSkill(ownerId, "two-step", { project_id: projectId });
    const second = runSkill(ownerId, "two-step", { project_id: projectId });
    const runs = listRuns("two-step");
    assertEquals(runs.length, 2);
    assertEquals(runs[0].id, second.run.id);
    assertEquals(runs[1].id, first.run.id);
    assertEquals(
      listRuns("two-step", { project_id: "nope" }).length,
      0,
      "project filter scopes runs",
    );
  });
});

describe("skills api", () => {
  let baseUrl = "";
  let adminToken = "";
  let ownerToken = "";
  let otherToken = "";

  function headers(token?: string): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  function req(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: headers(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function bootstrap(email: string, name: string): Promise<string> {
    const boot = await req("POST", "/api/v1/auth/bootstrap", {
      email,
      password: "secret123",
      display_name: name,
    });
    assertEquals(boot.status, 201);
    return ((await boot.json()) as { token: string }).token;
  }

  async function registerUser(email: string, name: string): Promise<string> {
    const res = await req("POST", "/api/auth/register", {
      email,
      password: "secret123",
      display_name: name,
    }, adminToken);
    assertEquals(res.status, 201);
    return ((await res.json()) as { token: string }).token;
  }

  function registerMockModel(token: string, taskTypes: string[]): Promise<void> {
    return (async () => {
      const res = await req("POST", "/api/v1/models", {
        name: "Mock All",
        version: "0",
        backend: "mock",
        task_types: taskTypes,
        enabled: true,
      }, token);
      assertEquals(res.status, 201);
    })();
  }

  beforeEach(() => {
    freshMemoryDb();
  });

  afterEach(() => {
    resetDb();
  });

  it("lists skills and rejects unauthenticated calls", () =>
    withServer(async (base) => {
      baseUrl = base;
      await fetchWithRetry(`${baseUrl}/api/v1/health`);
      adminToken = await bootstrap("sk-admin@example.com", "Admin");

      assertEquals((await req("GET", "/api/v1/skills")).status, 401);
      const res = await req("GET", "/api/v1/skills", undefined, adminToken);
      assertEquals(res.status, 200);
      const body = (await res.json()) as { id: string }[];
      assert(body.some((s) => s.id === "sys-tense-score"));
      assert(body.some((s) => s.id === "sys-foley-pass"));
    }));

  it("creates, updates, toggles and deletes a skill through the API", () =>
    withServer(async (base) => {
      baseUrl = base;
      await fetchWithRetry(`${baseUrl}/api/v1/health`);
      adminToken = await bootstrap("sk-a2@example.com", "Admin");
      ownerToken = await registerUser("sk-owner@example.com", "Owner");
      otherToken = await registerUser("sk-other@example.com", "Other");

      const created = await req("POST", "/api/v1/skills", {
        id: "my-score",
        definition: TENSE_DEF,
      }, ownerToken);
      assertEquals(created.status, 201);

      // Duplicate create is rejected.
      assertEquals(
        (await req("POST", "/api/v1/skills", { id: "my-score", definition: TENSE_DEF }, ownerToken))
          .status,
        400,
      );

      const v2 = { ...TENSE_DEF, version: "2.0.0" };
      const updated = await req("PUT", "/api/v1/skills/my-score", { definition: v2 }, ownerToken);
      assertEquals(updated.status, 200);
      assertEquals(((await updated.json()) as { version: string }).version, "2.0.0");

      const versions = await req("GET", "/api/v1/skills/my-score/versions", undefined, ownerToken);
      assertEquals(versions.status, 200);
      assertEquals(
        ((await versions.json()) as { version: string }[]).map((v) => v.version),
        ["2.0.0", "1.0.0"],
      );

      // A non-creator cannot mutate.
      assertEquals(
        (await req("PUT", "/api/v1/skills/my-score", { definition: v2 }, otherToken)).status,
        403,
      );

      const toggled = await req(
        "POST",
        "/api/v1/skills/my-score/toggle",
        { enabled: false },
        ownerToken,
      );
      assertEquals(toggled.status, 200);
      assertEquals(((await toggled.json()) as { enabled: boolean }).enabled, false);

      const detail = await req("GET", "/api/v1/skills/my-score", undefined, ownerToken);
      assertEquals(detail.status, 200);
      const deleted = await req("DELETE", "/api/v1/skills/my-score", undefined, ownerToken);
      assertEquals(deleted.status, 204);
      assertEquals(
        (await req("GET", "/api/v1/skills/my-score", undefined, ownerToken)).status,
        404,
      );
      void adminToken;
      void otherToken;
    }));

  it("runs a skill end-to-end over live routes", () =>
    withServer(async (base) => {
      baseUrl = base;
      await fetchWithRetry(`${baseUrl}/api/v1/health`);
      adminToken = await bootstrap("sk-a3@example.com", "Admin");
      await registerMockModel(adminToken, ["music", "voice", "audio"]);
      await req("POST", "/api/v1/projects", { name: "Sk Project" }, adminToken);

      const projectRes = await req("GET", "/api/v1/projects", undefined, adminToken);
      const project = ((await projectRes.json()) as { id: string }[])[0];
      const res = await req("POST", "/api/v1/skills/sys-tense-score/run", {
        project_id: project.id,
        inputs: { mood: "ominous" },
      }, adminToken);
      assertEquals(res.status, 202);
      const body = (await res.json()) as {
        run: { id: string; status: string; steps: { job_id: string; asset_id: string }[] };
        jobs: { job_id: string; asset_id: string }[];
      };
      assertEquals(body.run.status, "running");
      assertEquals(body.jobs.length, 1);
      assertEquals(body.run.steps.length, 1);

      const runsRes = await req(
        "GET",
        "/api/v1/skills/sys-tense-score/runs",
        undefined,
        adminToken,
      );
      assertEquals(runsRes.status, 200);
      const runs = (await runsRes.json()) as { id: string }[];
      assertEquals(runs.length, 1);

      // The in-process runner (mock adapter) finishes the job; poll the run
      // until the lazy settle flips it.
      let last: { status: string; error_text: string | null } | undefined;
      const deadline = Date.now() + 15000;
      for (;;) {
        const runRes = await req(
          "GET",
          `/api/v1/skills/sys-tense-score/runs/${body.run.id}`,
          undefined,
          adminToken,
        );
        assertEquals(runRes.status, 200);
        const poll = (await runRes.json()) as {
          status: string;
          error_text: string | null;
        };
        last = poll;
        if (poll.status !== "running") break;
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      assertEquals(last?.status, "succeeded", `run settled, got ${JSON.stringify(last)}`);
      assertEquals(last?.error_text, null);
    }));

  it("reports skill run validation errors", () =>
    withServer(async (base) => {
      baseUrl = base;
      await fetchWithRetry(`${baseUrl}/api/v1/health`);
      adminToken = await bootstrap("sk-a4@example.com", "Admin");
      await registerMockModel(adminToken, ["music"]);
      const projectRes = await req("POST", "/api/v1/projects", { name: "P4" }, adminToken);
      const project = (await projectRes.json()) as { id: string };

      // The foley skill requires an sfx-capable model: pre-flight 400.
      assertEquals(
        (
          await req("POST", "/api/v1/skills/sys-foley-pass/run", {
            project_id: project.id,
            inputs: { action: "door slam" },
          }, adminToken)
        ).status,
        400,
      );

      // Disabled skill: 400.
      await req("POST", "/api/v1/skills/sys-tense-score/toggle", { enabled: false }, adminToken);
      assertEquals(
        (
          await req("POST", "/api/v1/skills/sys-tense-score/run", {
            project_id: project.id,
          }, adminToken)
        ).status,
        400,
      );

      // Unknown input: 400.
      await req("POST", "/api/v1/skills/sys-tense-score/toggle", { enabled: true }, adminToken);
      assertEquals(
        (
          await req("POST", "/api/v1/skills/sys-tense-score/run", {
            project_id: project.id,
            inputs: { mood: "ok", bogus: 1 },
          }, adminToken)
        ).status,
        400,
      );
    }));
});
