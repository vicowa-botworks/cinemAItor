import { getDb } from "./database.ts";
import { badRequest, forbidden, notFound } from "../errors.ts";
import {
  type Asset,
  type AssetVersion,
  getAssetById,
  getAssetVersion,
  hasAssetPermission,
} from "./assets.ts";
import { type GenerationJob, getJob } from "./jobs.ts";

export const REVIEW_DECISIONS = ["approved", "rejected", "shortlisted"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export interface ReviewDecisionRow {
  id: string;
  asset_version_id: string;
  job_id: string | null;
  decision: string;
  notes: string | null;
  decided_by_user_id: number;
  created_at: string;
  updated_at: string;
}

export interface JobCandidate {
  asset_version: AssetVersion;
  asset: Pick<Asset, "id" | "unique_slug" | "display_name" | "asset_type" | "status">;
  candidate_index: number;
  candidate_count: number;
  decision: ReviewDecisionRow | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rowToDecision(row: Record<string, unknown>): ReviewDecisionRow {
  return {
    id: row.id as string,
    asset_version_id: row.asset_version_id as string,
    job_id: (row.job_id as string | null) ?? null,
    decision: row.decision as string,
    notes: (row.notes as string | null) ?? null,
    decided_by_user_id: Number(row.decided_by_user_id),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function getReviewDecision(
  assetVersionId: string,
): ReviewDecisionRow | undefined {
  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM review_decisions WHERE asset_version_id = ?",
  ).get(assetVersionId) as Record<string, unknown> | undefined;
  return row ? rowToDecision(row) : undefined;
}

export function listCandidatesForJob(
  jobId: string,
  userId: number,
): { job: GenerationJob; candidates: JobCandidate[] } {
  const job = getJob(jobId);
  if (!job) throw notFound("Job not found");

  const versionIds = job.candidate_version_ids ??
    (job.output_asset_version_id ? [job.output_asset_version_id] : []);
  const candidates: JobCandidate[] = [];
  for (const versionId of versionIds) {
    const version = getAssetVersion(versionId);
    if (!version) continue;
    const asset = getAssetById(version.asset_id);
    if (!asset || asset.status === "deleted") continue;
    if (!hasAssetPermission(userId, asset.id, "read")) continue;
    let provenance: { candidate_index?: number; candidate_count?: number };
    try {
      provenance = version.technical_metadata_json
        ? JSON.parse(version.technical_metadata_json)
        : {};
    } catch {
      provenance = {};
    }
    candidates.push({
      asset_version: version,
      asset: {
        id: asset.id,
        unique_slug: asset.unique_slug,
        display_name: asset.display_name,
        asset_type: asset.asset_type,
        status: asset.status,
      },
      candidate_index: provenance.candidate_index ?? candidates.length,
      candidate_count: provenance.candidate_count ?? versionIds.length,
      decision: getReviewDecision(versionId) ?? null,
    });
  }
  return { job, candidates };
}

/**
 * Record (or replace) a review decision. `decision: null` clears it
 * (e.g. shortlist toggle-off). Approving additionally promotes the version
 * to the asset's active/preview pointer.
 */
export function setReviewDecision(
  userId: number,
  assetVersionId: string,
  decision: ReviewDecision | null,
  notes?: string,
): ReviewDecisionRow | null {
  const version = getAssetVersion(assetVersionId);
  if (!version) throw notFound("Asset version not found");
  const asset = getAssetById(version.asset_id);
  if (!asset || asset.status === "deleted") throw notFound("Asset not found");
  if (!hasAssetPermission(userId, asset.id, "write")) throw forbidden();
  if (notes !== undefined && typeof notes !== "string") {
    throw badRequest("notes must be a string");
  }
  if (decision !== null && !REVIEW_DECISIONS.includes(decision)) {
    throw badRequest(`decision must be one of: ${REVIEW_DECISIONS.join(", ")}`);
  }

  const db = getDb();
  const job = jobFromVersion(assetVersionId);

  if (decision === null) {
    db.prepare(
      "DELETE FROM review_decisions WHERE asset_version_id = ?",
    ).run(assetVersionId);
    logAudit(userId, "review.clear", assetVersionId);
    return null;
  }

  const existing = getReviewDecision(assetVersionId);
  const now = nowIso();
  if (existing) {
    (db.prepare(
      `UPDATE review_decisions
       SET decision = ?, notes = ?, job_id = COALESCE(?, job_id),
           decided_by_user_id = ?, updated_at = ?
       WHERE asset_version_id = ?`,
    ).run as (...params: unknown[]) => unknown)(
      decision,
      notes ?? existing.notes,
      job,
      userId,
      now,
      assetVersionId,
    );
  } else {
    (db.prepare(
      `INSERT INTO review_decisions
         (id, asset_version_id, job_id, decision, notes,
          decided_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run as (...params: unknown[]) => unknown)(
      crypto.randomUUID(),
      assetVersionId,
      job,
      decision,
      notes ?? null,
      userId,
      now,
      now,
    );
  }

  if (decision === "approved") {
    db.prepare(
      "UPDATE assets SET active_version_id = ?, preview_version_id = ?, updated_at = ? WHERE id = ?",
    ).run(assetVersionId, assetVersionId, now, asset.id);
  }
  logAudit(userId, `review.${decision}`, assetVersionId, { job_id: job });
  return getReviewDecision(assetVersionId) ?? null;
}

/** Best effort: recover the producing job id from version provenance. */
function jobFromVersion(assetVersionId: string): string | null {
  const version = getAssetVersion(assetVersionId);
  if (!version?.technical_metadata_json) return null;
  try {
    const provenance = JSON.parse(version.technical_metadata_json) as {
      job_id?: string;
    };
    return provenance.job_id ?? null;
  } catch {
    return null;
  }
}

function logAudit(
  userId: number,
  action: string,
  versionId: string,
  data: Record<string, unknown> = {},
): void {
  const db = getDb();
  (db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, data_json, created_at)
     VALUES (?, ?, ?, 'review', ?, ?, ?)`,
  ).run as (...params: unknown[]) => unknown)(
    crypto.randomUUID(),
    userId,
    action,
    versionId,
    JSON.stringify(data),
    nowIso(),
  );
}
