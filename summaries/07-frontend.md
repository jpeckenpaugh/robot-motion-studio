# Summary: Frontend Engineer (Stage 07)

- **Date:** 2026-09-08
- **Author / Executor:** Frontend Engineer (opencode)
- **Instruction file:** `instructions/build/07-frontend.md`
- **Commit:** `stage 07: build Bootstrap SPA frontend for robot servo sequence designer`

> Note: `summaries/00-template.md` does not exist in the repo; this summary
> follows the structure of the existing stage summaries (e.g. `06-backend.md`).

## Work Completed

Read the seven feature briefs (`features/briefs/*.md`), `docs/architecture.md`
(the authoritative spec, esp. §4 state flow and §5 API contracts), and the Stage
6 backend API (read `backend/app/main.py`, `backend/app/routers/*.py`,
`backend/app/schemas.py`, plus `preview.py`/`export.py` builders) to learn the
exact endpoints and payload shapes. Built a static, no-build Bootstrap SPA under
`frontend/` served by the backend at the same origin, consuming `/api/*` exactly
as exposed. Verified it against the live backend (`./run.sh`).

## Outputs Produced

Frontend layout (`frontend/`, all new):

```
frontend/
├── index.html                 # SPA shell, navbar, view container
├── css/
│   └── styles.css             # light theming
├── js/
│   ├── api.js                 # thin fetch wrapper over /api/* (single client)
│   ├── state.js               # client-side view state + refresh() orchestration
│   ├── ui.js                  # shared toast / confirm / error-render helpers
│   ├── main.js                # bootstrap, nav, view routing, initial load
│   └── views/
│       ├── configuration.js   # robots/servos screen (brief 01)
│       ├── poses.js           # pose management (brief 02)
│       ├── sequences.js       # sequence editor (brief 03)
│       ├── preview.js         # read-only preview (brief 04)
│       └── export.js          # export download (brief 05)
└── vendor/                    # vendored Bootstrap 5.3.3 + Bootstrap Icons 1.11.3
    ├── bootstrap.min.css
    ├── bootstrap.bundle.min.js
    ├── bootstrap-icons.min.css
    └── fonts/bootstrap-icons.woff2
```

## Views / behaviors mapped to briefs

- **Configuration (brief 01):** shows the current robot (discovered via
  `GET /api/robots`, id thereafter) and every servo with all fields (name, PWM
  pin, angle range, neutral angle, pulse calibration). Rename robot
  (`PATCH /robots/{id}`); add/edit servo (`POST`/`PUT /robots/{id}/servos[/{id}]`);
  delete servo (`DELETE`). Delete surfacing the backend's 409
  (`SERVO_REFERENCED`) message when the servo is referenced by a pose/step.
  Client-side UX pre-checks (neutral/angle within limits) but the backend is the
  enforcement point.
- **Poses (brief 02):** list of poses with servo targets; create/edit pose by
  name + checkbox-per-servo target rows (`GET|POST /api/poses`,
  `PUT /api/poses/{id}`); delete guarded by 409 `POSE_REFERENCED`
  (`DELETE /api/poses/{id}`). Duplicate-servo and out-of-range targets blocked
  client-side (UX) and server-side (422).
- **Sequences (brief 03):** sequence list + full editor (loads the selected
  sequence via `GET /api/sequences/{id}`). Create/rename/delete sequences
  (`POST /sequences`, `PUT|DELETE /sequences/{id}`). Step editor: add, edit,
  remove (`POST /sequences/{id}/steps`,
  `PUT|DELETE /sequences/{id}/steps/{step_id}`); each step kind = pose reference
  or direct servo movement with movement duration + optional hold. Reorder via
  up/down buttons calling `POST /sequences/{id}/reorder` with the new
  `step_ids` order (backend renumbers positions).
- **Preview (brief 04):** read-only, ordered step listing rendered from
  `GET /api/sequences/{id}/preview` — resolves pose steps to concrete servo
  targets with `pulse_us`, so it always reflects current saved state. No write
  path. Step-by-step cards with target + timing, plus a summary (step/target
  counts, approx total ms).
- **Export (brief 05):** full export button and per-sequence selector that
  navigate to `GET /api/export` and `GET /api/sequences/{id}/export`; the
  backend's `Content-Disposition: attachment` makes the browser save the
  self-contained JSON artifact. Pose references are already resolved to concrete
  servo targets by the backend.
- **Persistence (brief 06) & Seed (brief 07):** handled entirely by the backend;
  the SPA reloads state from the API on startup and after every mutation, so it
  is a view over the single source of truth and displays seed data as-is.

## API contract verification

Every fetch the frontend makes maps to a real backend route (no invented
endpoints):

- `GET /api/robots`, `GET /api/robots/{id}`, `PATCH /api/robots/{id}`
- `GET|POST /api/robots/{id}/servos`, `PUT|DELETE /api/robots/{id}/servos/{id}`
- `GET|POST /api/poses`, `PUT|DELETE /api/poses/{id}`
- `GET|POST /api/sequences`, `PUT|DELETE /api/sequences/{id}`
- `POST /api/sequences/{id}/steps`, `PUT|DELETE /api/sequences/{id}/steps/{id}`
- `POST /api/sequences/{id}/reorder`
- `GET /api/sequences/{id}/preview`
- `GET /api/export`, `GET /api/sequences/{id}/export` (via `window.location.href`)

Payloads match `schemas.py`/the architecture (e.g. `ServoInput` all-required
fields; `PoseInput {name, targets[]}`; `StepInput {kind, pose_id|servo_id+angle,
duration_ms, hold_ms}`; reorder `{step_ids}`). The SPA was functionally exercised
against the live server: servo create/edit, pose create/edit, sequence
create/step-add/reorder/preview/export, and 409 deletion guards all behaved per
contract, and test data was cleaned up (back to the seeded 6 servos / 4 poses /
2 sequences).

## Key Decisions

- **Reorder = up/down buttons**, not drag-and-drop. The brief permits "drag/reorder
  or otherwise change order"; buttons are robust, no-build, and consume the
  reorder endpoint with the correct `step_ids` payload. (Flagged as a UX choice;
  drag could be added later.)
- **`window.location.href` for export** so the browser respects the backend's
  `Content-Disposition` attachment header (a plain `fetch` would need extra
  blob handling and would duplicate the backend's job).
- **Vendored Bootstrap + Bootstrap Icons** locally under `frontend/vendor/`
  (no CDN dependency, no build step), consistent with the no-toolchain SPA.
- **Sequences/preview share `STATE.selectedSequenceId`** so selecting a sequence
  in the editor also pre-selects it in preview (a small UX convenience; does not
  diverge from the contract).

## Open Questions & Concerns

- **Preview is a read-only ordered listing** (per the architecture §8 default);
  the brief's optional richer visual/timeline render was deliberately not
  implemented. Flagged for the verification stage to confirm the simpler listing
  is acceptable.
- **Client-side UX validation duplicates (does not replace) backend rules.** The
  frontend shows inline errors for out-of-range angles, duplicate servos, missing
  names, etc., but the backend remains the authority. Verification should confirm
  backend 422/409 paths are still surfaced correctly through `UI.renderApiError`.
- **`GET /api/health`** is outside the product contract (ops convenience); the
  frontend does not use it.
- **Seed content** is backend-authored and editable; the SPA shows it as normal
  data (nothing read-only).

## Status

- [x] Complete
- [ ] Needs review