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

## A/B comparison (UI)

The review board supports picking two candidates for a side-by-side A/B comparison:

- Each candidate card has an **A/B** toggle selecting up to two candidates (a third pick replaces
  the oldest selection — `toggleComparePair` in `frontend/src/compare.js`).
- With two selected, an **A/B comparison** pane appears above the candidate list: both media
  previews side by side, the current decision chip for each, a one-click **Approve / Unapprove**
  (approve promotes, per the model above), and the existing notes preview.
- For video/audio candidates the pane offers synced transport — **Play both / Pause both / Stop
  both** and seek mirroring (`CompareSync`, drift threshold 0.25 s) — so both candidates play on a
  locked timeline while judging them.
- Selections are per job view; switching jobs clears them. The shared compare utilities live in
  `frontend/src/compare.js` (unit-tested in `frontend/tests/compare.test.js`) and are reused by the
  Asset Detail version comparison (see `docs/assets.md`).
