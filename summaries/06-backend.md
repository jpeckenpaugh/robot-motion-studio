# Summary: Backend Engineer (Stage 06)

- **Date:** 2026-09-08
- **Author / Executor:** Backend Engineer (opencode)
- **Instruction file:** `instructions/build/06-backend.md`
- **Commit:** `stage 06: implement FastAPI backend, SQLite persistence, seed data, and API`

> Note: `summaries/00-template.md` does not exist in the repo; this summary
> follows the structure of the existing stage summaries (e.g. `05-architecture.md`).

## Work Completed

Read the seven feature briefs (`features/briefs/*.md`), `docs/architecture.md`
(the authoritative spec), and the Stage 4 environment definition
(`requirements.txt`, `install.sh`, `run.sh`, `environment-notes.md`).
Implemented the entire backend under `backend/`: FastAPI app with all API
routers, the SQLite persistence layer with the canonical schema, shared
validation, the angle↔pulse conversion, sequence preview resolution, export
document building, and first-run seed data. Verified the server boots and all
endpoints behave per contract.

## Outputs Produced

Backend layout (`backend/`, all new):

```
backend/
└── app/
    ├── __init__.py
    ├── main.py           # FastAPI app (app.main:app); routers + static SPA mount + startup init/seed
    ├── config.py         # paths: DB (data/app.db), frontend dir; env overrides (DB_PATH, FRONTEND_DIR)
    ├── db.py             # sqlite3 connection (check_same_thread=False), schema DDL, init_db()
    ├── seed.py           # first-run seed data (brief 07) — content backend-authored
    ├── validation.py     # shared validation rules + coded error helpers; stable `code` vocabulary
    ├── pulse.py          # angle <-> pulse-width conversion (canonical formula §5.5.1)
    ├── schemas.py        # Pydantic request models (ServoInput, PoseInput, StepInput, reorder, renames)
    ├── export.py         # export JSON document builder (brief 05)
    ├── preview.py        # sequence preview resolution (brief 04)
    └── routers/
        ├── __init__.py
        ├── robot.py      # robots + servos CRUD (brief 01)
        ├── poses.py      # poses + pose targets CRUD (brief 02)
        ├── sequences.py  # sequences + steps CRUD + reorder (brief 03)
        ├── preview.py    # GET /api/sequences/{id}/preview (brief 04)
        └── export.py     # GET /api/export, GET /api/sequences/{id}/export (brief 05)
```

Plus: `run.sh` adjusted (see below).

## API endpoints (all implemented, verified against the architecture §5)

Robots & servos: `GET /api/robots`, `GET /api/robots/{id}`,
`PATCH /api/robots/{id}`, `GET|POST /api/robots/{id}/servos`,
`GET|PUT|DELETE /api/robots/{id}/servos/{servo_id}`.
Poses: `GET|POST /api/poses`, `GET|PUT|DELETE /api/poses/{pose_id}`.
Sequences: `GET|POST /api/sequences`, `GET|PUT|DELETE /api/sequences/{seq_id}`,
`POST /api/sequences/{seq_id}/steps`,
`PUT|DELETE /api/sequences/{seq_id}/steps/{step_id}`,
`POST /api/sequences/{seq_id}/reorder`.
Preview: `GET /api/sequences/{seq_id}/preview`.
Export: `GET /api/export`, `GET /api/sequences/{seq_id}/export`.

Non-contract addition (flagged): `GET /api/health` returns `{"status":"ok"}` —
an ops convenience only; the frontend should ignore it.

## Seed data (BACKEND-AUTHORED — flagged)

The architecture fixes shape/quantity (1 robot, 4–6 servos, 3–4 poses, 2+
sequences) but not content; I authored the following plausible sample content:

- **Robot:** "SampleBot".
- **Servos (6):** `left_shoulder` (pin 2), `right_shoulder` (pin 3),
  `left_elbow` (pin 4), `right_elbow` (pin 5) — all 0–180°, neutral 90°,
  500–2500 µs; `head_pan` (pin 6) −90–90°, neutral 0°; `head_tilt` (pin 7)
  0–90°, neutral 45°.
- **Poses (4):** `neutral` (all six servos at neutral), `wave_left`
  (L-shoulder 170°, R-shoulder 10°, head_pan 30°), `wave_right` (mirror),
  `look_center_up` (head_pan 0°, head_tilt 70°).
- **Sequences (2):** `wave` (4 steps: wave_left→wave_right→head_tilt direct→
  neutral), `look_around` (4 steps: head_pan sweep −60°/60°/0° + look_center_up).

All values satisfy the app's own validation (angles in range, unique
names/pins, resolved references, valid timing). Seed data behaves exactly like
user data once present (no read-only flag).

## run.sh adjustment (flagged, per architecture §1)

Added `backend/` to `PYTHONPATH` so `app.main:app` resolves with the `app`
package at `backend/app/`:

```
PYTHONPATH="${ROOT_DIR}/backend${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONPATH
```

`APP` default stays `app.main:app`. This is the only environment deviation,
as mandated by docs/architecture.md §1 and permitted by Stage 6 guidance.

## Auth / token gates

None. Neither the briefs nor the architecture specify an auth gate; no auth was
implemented (per guidance: "otherwise no auth needed for this POC"). The API is
open on the dev host; the export endpoints are unauthenticated.

## Assumptions / decisions made (flagged)

- **Error `code` vocabulary finalized** (architecture listed examples but no
  exhaustive set): `VALIDATION` (422), `NOT_FOUND` (404), `CONFLICT` (409,
  name/pin uniqueness clashes), `SERVO_REFERENCED` (409, delete blocked),
  `POSE_REFERENCED` (409, delete blocked). Body shape `{"detail", "code"}`
  implemented via a custom HTTPException handler; request-validation failures
  also return 422 `VALIDATION` with a readable message.
- **Hold time `null` vs `0`:** preserved exactly as stored (`NULL` = no hold,
  `0` = explicit zero hold); the API passes both through unchanged, per §3.
- **Deletion renumbers steps:** removing a step compacts remaining step
  `position` values to stay contiguous from 0 (keeps the §3 invariant;
  reorder also rewrites positions in a two-phase update to avoid transient
  UNIQUE(sequence_id, position) clashes).
- **`PATCH /robots` rename, pose/sequence creates target the current robot**
  (lowest robot id = the seeded robot) because the contract has no
  robot_id in those bodies; the frontend discovers the id via `GET /api/robots`.
- **Export filename:** `SampleBot.json` (full) / `SampleBot-<seq>.json`
  (single), sanitized, via `Content-Disposition: attachment`.
- **No new dependencies:** DB uses stdlib `sqlite3`; `requirements.txt`
  unchanged (fastapi, uvicorn only). No ORM/Alembic/pytest added.

## Verification

- `.venv` provisioned via `./install.sh` (Python 3.9.6).
- `python -c "from app.main import app"` imports cleanly; all API routes
  register.
- `./run.sh` boots uvicorn cleanly with the adjusted PYTHONPATH; on startup the
  DB is created under `data/` (git-ignored) and seeded.
- Smoke-tested against the running server: reads (robots/robot/poses/
  sequences), preview (resolved targets incl. correct `pulse_us`, e.g. 170°→2389,
  45°→1833), full + single-sequence export (correct schema, headers, computed
  pulses), servo create/rename, robot rename, deletion guards returning 409
  `SERVO_REFERENCED`/`POSE_REFERENCED`, uniqueness 409, validation 422, step
  add/edit/remove, reorder (positions renumbered), and 404s. Server starts with
  an empty `frontend/` dir (GET / 404 until Stage 7 adds the SPA); this does not
  prevent boot.

## Open Questions & Concerns

- **Frontend dir is empty** until Stage 7; the backend serves whatever exists
  there and boots fine without it.
- **`GET /api/health`** is outside the contract (ops convenience); harmless.
- **Seed content** is backend-authored (see above) and editable/exportable like
  user data; Stage 7 may display it as-is.

## Status

- [x] Complete
- [ ] Needs review