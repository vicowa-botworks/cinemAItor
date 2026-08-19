import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertThrows } from "@std/assert";
import * as schema from "../src/db/schema.ts";
import { getDb, resetDb } from "../src/db/database.ts";
import { createAsset, createAssetVersion, getAssetById } from "../src/db/assets.ts";
import { registerModel } from "../src/db/models.ts";
import { createJob } from "../src/db/jobs.ts";
import { type JobRunner, startJobRunner } from "../src/services/job_runner.ts";
import { resetContentStore } from "../src/storage/content_store.ts";
import { getReviewDecision, listCandidatesForJob, setReviewDecision } from "../src/db/reviews.ts";

let ownerId: number;
let otherId: number;
let appData: string;
let runners: JobRunner[] = [];

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("review decisions", () => {
  beforeEach(() => {
    resetDb();
    getDb(":memory:");
    Deno.env.set("JWT_SECRET", "test-jwt-secret-for-ci-only");
    Deno.env.set(
      "APP_DATA_DIR",
      appData = Deno.makeTempDirSync({
        prefix: "cinemaitor_review_test_",
      }),
    );
    resetContentStore();
    ownerId = schema.createUser(
      `owner.${Math.random().toString(36).slice(2)}@example.com`,
      "hash123",
      "Owner",
    );
    otherId = schema.createUser(
      `other.${Math.random().toString(36).slice(2)}@example.com`,
      "hash456",
      "Other",
    );
  });

  afterEach(async () => {
    for (const r of runners) await r.stop();
    runners = [];
    resetDb();
    Deno.removeSync(appData, { recursive: true });
  });

  it("records, replaces and clears decisions with notes", () => {
    const asset = createAsset(
      {
        unique_slug: `pic_${Math.random().toString(36).slice(2, 8)}`,
        display_name: "Pic",
        asset_type: "image",
        library_scope: "global",
      },
      ownerId,
    );
    const v1 = createAssetVersion(asset.id, ownerId, {
      content_hash: "a".repeat(64),
      file_path: "/tmp/v1.png",
      format: "png",
      mime_type: "image/png",
      file_size: 10,
      make_active: true,
    });
    createAssetVersion(asset.id, ownerId, {
      content_hash: "b".repeat(64),
      file_path: "/tmp/v2.png",
      format: "png",
      mime_type: "image/png",
      file_size: 10,
      make_active: false,
    });

    const approved = setReviewDecision(ownerId, v1.id, "approved", "best take");
    assert(approved);
    assertEquals(approved.decision, "approved");
    assertEquals(approved.notes, "best take");

    // Replacement keeps one row per version.
    const replaced = setReviewDecision(ownerId, v1.id, "rejected", "changed mind");
    assert(replaced);
    assertEquals(replaced.id, approved.id);
    assertEquals(replaced.decision, "rejected");
    assertEquals(replaced.notes, "changed mind");

    // Approve promotes the asset's active/preview pointer.
    setReviewDecision(ownerId, v1.id, "approved");
    assertEquals(getAssetById(asset.id)?.active_version_id, v1.id);
    assertEquals(getAssetById(asset.id)?.preview_version_id, v1.id);

    // Clear removes the row.
    const cleared = setReviewDecision(ownerId, v1.id, null);
    assertEquals(cleared, null);
    assertEquals(getReviewDecision(v1.id), undefined);
  });

  it("requires write permission on the candidate's asset", () => {
    const asset = createAsset(
      {
        unique_slug: `pic_${Math.random().toString(36).slice(2, 8)}`,
        display_name: "Pic",
        asset_type: "image",
        library_scope: "global",
      },
      ownerId,
    );
    const v1 = createAssetVersion(asset.id, ownerId, {
      content_hash: "c".repeat(64),
      file_path: "/tmp/v1.png",
      format: "png",
      mime_type: "image/png",
      file_size: 10,
      make_active: true,
    });

    assertThrows(
      () => setReviewDecision(otherId, v1.id, "approved"),
      Error,
    );
    assertThrows(
      () => setReviewDecision(otherId, "nope", "rejected"),
      Error,
      "Asset version not found",
    );
  });

  it("lists job candidates from produced versions and shows decisions", async () => {
    const model = registerModel(ownerId, {
      name: "mock-t2i",
      version: "1.0",
      backend: "mock",
      task_types: ["text_to_image"],
      enabled: true,
    });
    const asset = createAsset(
      {
        unique_slug: `board_${Math.random().toString(36).slice(2, 8)}`,
        display_name: "Board",
        asset_type: "image",
        library_scope: "global",
      },
      ownerId,
    );
    const job = createJob(ownerId, {
      job_type: "text_to_image",
      model_id: model.id,
      asset_id: asset.id,
      prompt_text: "review me",
      seed: "3",
      settings: { candidates: 2 },
    });

    const runner = startJobRunner({ pollMs: 5 });
    runners.push(runner);
    await waitFor(() => {
      const db = getDb();
      const row = db.prepare("SELECT status FROM generation_jobs WHERE id = ?")
        .get(job.id) as { status: string };
      return row.status === "succeeded";
    });

    const { job: jobRow, candidates } = listCandidatesForJob(job.id, ownerId);
    assertEquals(jobRow.candidate_version_ids?.length, 2);
    assertEquals(candidates.length, 2);
    assert(candidates.every((c) => c.decision === null));

    const first = candidates[0].asset_version.id;
    setReviewDecision(ownerId, first, "shortlisted", "maybe");
    const again = listCandidatesForJob(job.id, ownerId);
    const withDecision = again.candidates.find(
      (c) => c.asset_version.id === first,
    );
    assert(withDecision?.decision);
    assertEquals(withDecision.decision.decision, "shortlisted");
    assertEquals(withDecision.decision.notes, "maybe");
    assertEquals(withDecision.decision.job_id, job.id);
  });

  it("rejects unknown jobs for candidate listing", () => {
    assertThrows(
      () => listCandidatesForJob("nope", ownerId),
      Error,
      "Job not found",
    );
  });
});
