# Summary: Verification Engineer (Stage 08)

- **Date:** 2026-09-08
- **Author / Executor:** Verification Engineer (opencode)
- **Instruction file:** `instructions/build/08-verification.md`
- **Commit:** `stage 08: verify API, persistence, seed, and frontend against specs; report 82/83 pass`

## Work Completed

Ran the delivered application using the Stage-4 environment scripts
(`./install.sh` reused the existing `.venv`; `./run.sh` started uvicorn on
`http://127.0.0.1:8000` with `app.main:app`). Derived an 83-item pass/fail
verification checklist from the approved specifications (`concept.md`,
`features/briefs/*.md`, `docs/architecture.md`) covering the API contract
(robots/servos, poses, sequences/steps, preview, export), the data model and
persistence, seed data, and the frontend rendering logic. Exercised every
endpoint with `curl`, verified persistence across a server restart, verified
fresh-DB seeding by deleting `data/app.db` and restarting, ran direct SQLite
integrity queries on the seed data, and performed a static review of all
frontend JS + `index.html`. Compiled the evidence-backed report at
`docs/verification-report.md`.

## Outputs Produced

- `docs/verification-report.md` — 83 checks, each traceable to a spec, with
  recorded evidence (HTTP status/body/headers from `curl`, SQLite integrity
  counts, static-review notes).
- `summaries/08-verification.md` — this summary.

## Verification method (as recorded in the report)

- **Backend/API:** `curl` against the live app at `http://127.0.0.1:8000`;
  status codes, response bodies, and headers captured. Persistence tested by
  killing and restarting uvicorn; seeding tested on a deleted DB.
- **Frontend:** static review only — reading `frontend/js/*.js` and
  `frontend/index.html`, cross-checking every fetch call against the routes in
  `GET /api/openapi.json`. **Browser interaction was NOT exercised by an
  automation tool in this environment**; all frontend results are labeled as
  static findings and none claim browser automation.
- **Data:** direct `sqlite3` queries against `data/app.db` for referential
  integrity, angle-limit compliance, contiguous step positions, and field
  completeness.

## Results

- **Total checks:** 83
- **PASS:** 82
- **FAIL:** 1

### FAIL — I11: preview may show stale data (static review)

`frontend/js/views/preview.js` caches the preview document in a module-level
`doc` variable and refreshes it only from the preview view's sequence-list click
handler; `main.js` `switchView` → `renderActive` re-renders that cached `doc`
without re-fetching. A user who selects a sequence in Preview, edits that
sequence in the Sequences view, and returns to Preview can therefore see stale
content until they re-select a sequence in the preview list. This contradicts
brief 04's "no stale data" constraint and architecture §4 ("the frontend
re-requests the preview whenever the sequence/pose/config changes"). It was NOT
browser-exercised; it is a code-path finding. No code was fixed (out of scope
for this stage).

### Minor concerns the documentation stage should record

- Preview view should re-request `/api/sequences/{id}/preview` on view
  activation to guarantee freshness (the I11 fix; also addresses arch §4).
- Preview remains the simpler read-only ordered listing per architecture §8
  (noted in the Stage-7 summary); a richer timeline render is out of scope.
- `sequences.js` `createSequence()` calls `StateController.refresh()` twice
  (harmless duplicate; cosmetic).
- Reorder is implemented with up/down buttons, not drag-and-drop (Stage-7
  decision; brief permits either).

## Checks that could not be performed

- Browser-rendered behavior (clicking through the SPA, modal flows, toasts,
  downloads) was not headlessly exercised; only static review and API-level
  checks were possible. The API contract that the SPA consumes was fully
  exercised, which mitigates, but does not eliminate, this gap.

## Status

- [x] Complete
- [ ] Needs review