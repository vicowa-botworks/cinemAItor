import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals } from "@std/assert";
import { closeDb, getDb } from "../src/db/database.ts";
import { createAsset } from "../src/db/assets.ts";
import { registerModel } from "../src/db/models.ts";
import { fetchWithRetry, freshMemoryDb, withServer } from "./helpers/http.ts";
import { resetContentStore } from "../src/storage/content_store.ts";

let baseUrl = "";
let ownerToken: string;
let otherToken: string | undefined;
let ownerId: number;
let modelId: string;
let assetId: string;
let appDataDir = "";

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as unknown;
  return { status: res.status, json };
}

interface CandidateBody {
  asset_version: { id: string; version_number: number };
  asset: { id: string; unique_slug: string };
  candidate_index: number;
  candidate_count: number;
  decision: { decision: string; notes: string | null } | null;
}

async function createSucceededJob(): Promise<string> {
  const res = await req(
    "POST",
    "/api/v1/jobs",
    {
      job_type: "text_to_image",
      model_id: modelId,
      asset_id: assetId,
      prompt_text: "review flow",
      seed: "11",
      settings: { candidates: 2 },
    },
    ownerToken,
  );
  assertEquals(res.status, 201);
  const jobId = (res.json as { job: { id: string } }).job.id;
  const start = Date.now();
  for (;;) {
    const { status, json } = await req("GET", `/api/v1/jobs/${jobId}`, undefined, ownerToken);
    assertEquals(status, 200);
    const job = json as { status: string };
    if (job.status === "succeeded" || job.status === "failed") {
      assertEquals(job.status, "succeeded");
      return jobId;
    }
    if (Date.now() - start > 8000) throw new Error("job stuck");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("review api", () => {
  beforeEach(async () => {
    appDataDir = Deno.makeTempDirSync({ prefix: "cinemaitor_review_api_" });
    Deno.env.set("APP_DATA_DIR", appDataDir);
    resetContentStore();

    freshMemoryDb();
    await withServer(async (base) => {
      baseUrl = base;
      const health = await fetchWithRetry(`${baseUrl}/api/v1/health`);
      assertEquals(health.status, 200);

      const res = await req(
        "POST",
        "/api/v1/auth/bootstrap",
        {
          email: `admin.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Studio Admin",
        },
      );
      assertEquals(res.status, 201);
      const user = res.json as { token: string; user: { id: number } };
      ownerToken = user.token;
      ownerId = user.user.id;

      modelId = registerModel(ownerId, {
        name: "api-mock-t2i",
        version: "1.0",
        backend: "mock",
        task_types: ["text_to_image"],
        enabled: true,
      }).id;
      assetId = createAsset(
        {
          unique_slug: `canvas_${Math.random().toString(36).slice(2, 8)}`,
          display_name: "Canvas",
          asset_type: "image",
          library_scope: "global",
        },
        ownerId,
      ).id;

      // A second non-owner account for permission checks.
      const otherRes = await req(
        "POST",
        "/api/auth/register",
        {
          email: `member.${Math.random().toString(36).slice(2)}@example.com`,
          password: "password123",
          display_name: "Member",
        },
      );
      assertEquals(otherRes.status, 201);
      otherToken = (otherRes.json as { token: string }).token;
    });
  });

  afterEach(() => {
    closeDb();
    Deno.removeSync(appDataDir, { recursive: true });
  });

  it("requires authentication", () =>
    withServer((base) => {
      baseUrl = base;
      return (async () => {
        assertEquals((await req("GET", "/api/v1/review/jobs/x/candidates")).status, 401);
        assertEquals((await req("POST", "/api/v1/review/candidates/y/approve", {})).status, 401);
      })();
    }));

  it("lists candidates and records decisions with promote", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        const jobId = await createSucceededJob();

        const list = await req(
          "GET",
          `/api/v1/review/jobs/${jobId}/candidates`,
          undefined,
          ownerToken,
        );
        assertEquals(list.status, 200);
        const body = list.json as {
          job: { id: string; status: string; prompt_text: string };
          candidates: CandidateBody[];
        };
        assertEquals(body.job.id, jobId);
        assertEquals(body.job.status, "succeeded");
        assertEquals(body.job.prompt_text, "review flow");
        assertEquals(body.candidates.length, 2);
        assertEquals(
          body.candidates.map((c) => c.candidate_index).sort(),
          [0, 1],
        );

        const [first, second] = body.candidates;

        // Reject the first.
        const reject = await req(
          "POST",
          `/api/v1/review/candidates/${first.asset_version.id}/reject`,
          { notes: "wrong framing" },
          ownerToken,
        );
        assertEquals(reject.status, 200);
        assertEquals(
          (reject.json as { decision: string; notes: string }).decision,
          "rejected",
        );

        // Approve the second -> asset active pointer moves to it.
        const approve = await req(
          "POST",
          `/api/v1/review/candidates/${second.asset_version.id}/approve`,
          {},
          ownerToken,
        );
        assertEquals(approve.status, 200);
        const active = getDb()
          .prepare("SELECT active_version_id FROM assets WHERE id = ?")
          .get(assetId) as { active_version_id: string | null };
        assertEquals(active.active_version_id, second.asset_version.id);

        // Shortlist toggles on and off.
        const on = await req(
          "POST",
          `/api/v1/review/candidates/${first.asset_version.id}/shortlist`,
          { notes: "maybe later" },
          ownerToken,
        );
        assertEquals((on.json as { toggled_off: boolean }).toggled_off, false);
        const off = await req(
          "POST",
          `/api/v1/review/candidates/${first.asset_version.id}/shortlist`,
          {},
          ownerToken,
        );
        assertEquals((off.json as { toggled_off: boolean }).toggled_off, true);
        assertEquals((off.json as { decision: unknown }).decision, null);

        // Decisions visible in the listing now (none remaining for first).
        const again = (
          await req("GET", `/api/v1/review/jobs/${jobId}/candidates`, undefined, ownerToken)
        ).json as { candidates: CandidateBody[] };
        const secondRow = again.candidates.find(
          (c) => c.asset_version.id === second.asset_version.id,
        );
        assert(secondRow?.decision);
        assertEquals(secondRow.decision.decision, "approved");
        const firstRow = again.candidates.find(
          (c) => c.asset_version.id === first.asset_version.id,
        );
        assert(firstRow);
        assertEquals(firstRow.decision, null);

        // Unknown targets.
        assertEquals(
          (
            await req("GET", "/api/v1/review/jobs/nope/candidates", undefined, ownerToken)
          ).status,
          404,
        );
        assertEquals(
          (
            await req(
              "POST",
              "/api/v1/review/candidates/does-not-exist/approve",
              {},
              ownerToken,
            )
          ).status,
          404,
        );
      })();
    });
  });

  it("enforces asset write permission for decisions", async () => {
    await withServer((base) => {
      baseUrl = base;
      return (async () => {
        if (!otherToken) throw new Error("no second user");
        const jobId = await createSucceededJob();
        const list = (
          await req("GET", `/api/v1/review/jobs/${jobId}/candidates`, undefined, ownerToken)
        ).json as { candidates: CandidateBody[] };
        const candidate = list.candidates[0].asset_version.id;

        const denied = await req(
          "POST",
          `/api/v1/review/candidates/${candidate}/approve`,
          {},
          otherToken,
        );
        assertEquals(denied.status, 403);
      })();
    });
  });
});
