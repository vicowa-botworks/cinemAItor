# Review

Per-candidate review of generation output, per the Milestone 4 plan: candidate comparison,
approve/reject, promote-to-active, shortlist, notes.

## Concepts

- A job stores every candidate version id it produced (`generation_jobs.candidate_version_ids`).
- A **review decision** (`review_decisions`) is one row per asset version: `approved` | `rejected` |
  `shortlisted`, optional notes, deciding user, timestamps.
- **Approve** additionally promotes that version to the asset's active/preview pointer (replacing
  whatever was active before).
- Decisions require **write** permission on the candidate's asset (global-scope assets fall back to
  admin/creator rules from the authorization model).

## Endpoints

| Method | Endpoint                                         | Description                                                              |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------ |
| GET    | `/api/v1/review/jobs/:jobId/candidates`          | Job summary + candidates (version, asset, index/count, current decision) |
| POST   | `/api/v1/review/candidates/:versionId/approve`   | Approve + promote to active version; body `{notes?}`                     |
| POST   | `/api/v1/review/candidates/:versionId/reject`    | Reject; body `{notes?}`                                                  |
| POST   | `/api/v1/review/candidates/:versionId/shortlist` | Toggle shortlist on/off; body `{notes?}`                                 |

Decisions are replaceable (same version + new decision replaces the row) and shortlist toggles off
by posting again while shortlisted. All mutations are audited (`review.approve` / `review.reject` /
`review.shortlist` / `review.clear`).
