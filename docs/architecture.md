# Architecture — Robot Servo Sequence Designer

**Stage 5 — Architect.**
**Date:** 2026-09-08
**Status:** Approved technical specification (reference for Stage 6 backend and Stage 7 frontend).

This document is a technical specification, not code. It fixes the project/file
structure, module boundaries, data model and SQLite schema, API contracts,
backend/frontend responsibility split, component interactions, and the export
JSON schema. Engineers implementing Stage 6 and Stage 7 must treat this as the
authoritative reference and not guess at contracts.

The product behavior comes from `concept.md` and `features/briefs/*.md`; this
document translates that behavior into a concrete technical shape without
changing the behavior. Where a brief left a decision open (notably the export
JSON schema), that decision is made here and recorded.

---

## 1. High-level architecture

A single-process web application.

- **Backend:** FastAPI (Python) exposing a JSON REST API under `/api/*` and
  serving the static SPA frontend via `StaticFiles`.
- **Database:** SQLite (Python stdlib `sqlite3`), file `data/app.db`
  (git-ignored). The DB is the single source of truth and persists all authored
  content across sessions.
- **Frontend:** static HTML/CSS/JS SPA using Bootstrap. No build toolchain.
  Rendered in the browser; consumes the `/api/*` endpoints; never persists
  directly.

One process (uvicorn, `./run.sh`) serves both API and UI. The frontend is served
from the `frontend/` directory. All `*` routes not matched by the `/api/*`
routers fall through to the SPA static mount so client-side navigation works.

### Environment contract (Stage 4) — honored

- Entry point importable as `app.main:app`.
- Static SPA served from a `frontend/` directory via `StaticFiles`.
- SQLite `.db` under `data/` (git-ignored), default `data/app.db`.
- `requirements.txt` currently pins only `fastapi` and `uvicorn[standard]`.
  The DB layer uses the stdlib `sqlite3`; **no ORM dependency is required** and
  none is added. If Stage 6 opts for an ORM or test tooling, it must extend
  `requirements.txt` and `environment-notes.md` (permitted, but must be flagged).

> **Required `run.sh` adjustment (flagged, permitted by Stage 6 guidance):**
> Stage 6 places backend code under `backend/`. To keep the `app.main:app`
> entry point while living under `backend/`, the `app` package is created at
> `backend/app/` and `run.sh` must add `backend/` to `PYTHONPATH` (e.g.
> `PYTHONPATH="${ROOT_DIR}/backend${PYTHONPATH:+:$PYTHONPATH}"` before the
> `exec`). The `APP` default remains `app.main:app`. This is the only change to
> the Stage 4 environment and is recorded in the Stage 5 summary.

---

## 2. Project / file structure

```
kev-web-app-002/
├── concept.md                  # product concept (Stage 1)
├── features/                   # capability decomposition + briefs (Stages 2-3)
│   └── briefs/*.md
├── requirements.txt            # pinned runtime deps (Stage 4)
├── install.sh                  # provisioning (Stage 4)
├── run.sh                      # start script (Stage 4; + PYTHONPATH per §1)
├── environment-notes.md        # env contract (Stage 4)
├── .gitignore
├── docs/
│   └── architecture.md         # this document
├── backend/                    # STAGE 6 — backend implementation
│   └── app/
│       ├── __init__.py
│       ├── main.py             # FastAPI app; mounts routers + StaticFiles (app.main:app)
│       ├── config.py           # paths: DB path (data/app.db), frontend dir
│       ├── db.py               # sqlite3 connection, schema DDL, migrations (if any)
│       ├── seed.py             # first-run seed data (brief 07)
│       ├── validation.py       # shared validation rules / error helpers
│       ├── pulse.py            # angle <-> pulse-width conversion math
│       ├── schemas.py          # Pydantic request/response models
│       ├── export.py           # export JSON document builder (brief 05)
│       ├── preview.py          # sequence preview resolution (brief 04)
│       └── routers/
│           ├── __init__.py
│           ├── robot.py        # robots + servos CRUD (brief 01)
│           ├── poses.py        # poses + pose targets CRUD (brief 02)
│           ├── sequences.py    # sequences + steps CRUD + reorder (brief 03)
│           ├── preview.py      # preview endpoint (brief 04)
│           └── export.py       # export endpoints (brief 05)
├── frontend/                   # STAGE 7 — static SPA served by backend
│   ├── index.html
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── api.js              # thin fetch wrapper over /api/*  (single client)
│   │   ├── state.js            # client-side view state + refresh orchestration
│   │   ├── views/
│   │   │   ├── configuration.js # robots/servos screens (brief 01)
│   │   │   ├── poses.js         # pose management (brief 02)
│   │   │   ├── sequences.js     # sequence editor (brief 03)
│   │   │   ├── preview.js       # read-only preview (brief 04)
│   │   │   └── export.js        # export download (brief 05)
│   │   └── main.js             # app bootstrap, nav, routing
│   └── vendor/                 # Bootstrap + Bootstrap Icons (no build step)
│       └── bootstrap.min.css (js bundle, css bundle)
└── data/                       # git-ignored; SQLite .db lives here
    └── app.db                  # created at runtime by backend
```

### Module boundaries

- `backend/app/` — the entire server side: API, persistence, validation,
  seed, preview/export resolution, static serving. Contains **all** backend
  logic; no business logic in the frontend.
- `frontend/` — presentation only. Renders state, collects input, calls the
  API, renders preview and triggers export download. No persistence, no
  validation of record integrity (client-side checks are UX-only conveniences;
  the backend remains the enforcement point).
- `docs/` — specifications only (this document).

---

## 3. Data model & SQLite schema

### Design decisions

- **Single current robot (POC).** Brief 01: "The user works with a single
  current robot." The schema keeps a `robots` table but seeds exactly one row
  (the current robot). Endpoints are robot-scoped so a future multi-robot model
  needs no schema change. The frontend always operates on the current robot.
- **References are identity-based, not name-based.** Poses reference servos by
  `servo_id`; sequence steps reference poses by `pose_id` and servos by
  `servo_id`. Editing a servo/pose name does not change references; only
  deletion of a referenced row is guarded. (Name uniqueness is enforced so
  names can be displayed/re-exported unambiguously, but identity is the key.)
- **Units (normalized everywhere):**
  - Angles: degrees, decimal (e.g. `90.0`).
  - Time: milliseconds, integer (`duration_ms`, `hold_ms`).
  - Pulse widths: microseconds, integer (`pulse_min_us`, `pulse_max_us`).
- **Ordering:** steps carry an explicit integer `position` (0-based) within a
  sequence; sequence order = ascending `position`. Reordering rewrites
  `position` values.
- **Timing:** `duration_ms` is required and `>= 0`. `hold_ms` is optional and
  nullable; `NULL` means "no hold" (absent). A `hold_ms` of `0` is valid and
  means an explicit zero-duration hold. The API may return either `null` or
  `0`; the frontend treats `null` as absent and may display `0` as no hold.
- **Deletion guards (block, do not cascade):** a servo referenced by any pose
  target or any sequence step cannot be deleted; a pose referenced by any
  sequence step cannot be deleted. The API returns `409 Conflict` with a
  machine- and human-readable reason. This satisfies briefs 01/02/03 "block
  until references resolved."

### Tables (SQLite DDL — canonical)

```sql
-- The current robot. POC seeds exactly one row (id=1).
CREATE TABLE robots (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL
);

CREATE TABLE servos (
    id            INTEGER PRIMARY KEY,
    robot_id      INTEGER NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    pwm_pin       INTEGER NOT NULL,
    angle_min     REAL NOT NULL,
    angle_max     REAL NOT NULL,
    neutral_angle REAL NOT NULL,
    pulse_min_us  INTEGER NOT NULL,
    pulse_max_us  INTEGER NOT NULL,
    UNIQUE (robot_id, name),
    UNIQUE (robot_id, pwm_pin)
);

-- A named pose: a reusable set of servo target positions.
CREATE TABLE poses (
    id         INTEGER PRIMARY KEY,
    robot_id   INTEGER NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (robot_id, name)
);

-- One servo target within a pose.
CREATE TABLE pose_targets (
    id       INTEGER PRIMARY KEY,
    pose_id  INTEGER NOT NULL REFERENCES poses(id) ON DELETE CASCADE,
    servo_id INTEGER NOT NULL REFERENCES servos(id),
    angle    REAL NOT NULL,
    UNIQUE (pose_id, servo_id)
);

CREATE TABLE sequences (
    id         INTEGER PRIMARY KEY,
    robot_id   INTEGER NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (robot_id, name)
);

-- A step is one of two kinds (see kind), carrying timing.
CREATE TABLE sequence_steps (
    id          INTEGER PRIMARY KEY,
    sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,           -- 0-based execution order within the sequence
    kind        TEXT NOT NULL,              -- 'pose' | 'servo'
    pose_id     INTEGER REFERENCES poses(id),   -- set when kind='pose'
    servo_id    INTEGER REFERENCES servos(id),  -- set when kind='servo'
    angle       REAL,                           -- set when kind='servo'
    duration_ms INTEGER NOT NULL,
    hold_ms     INTEGER,                       -- NULL = no hold
    CHECK (kind IN ('pose','servo')),
    CHECK (duration_ms >= 0),
    CHECK (hold_ms IS NULL OR hold_ms >= 0),
    CHECK (
        (kind = 'pose'  AND pose_id  IS NOT NULL AND servo_id IS NULL AND angle IS NULL) OR
        (kind = 'servo' AND servo_id IS NOT NULL AND angle    IS NOT NULL AND pose_id IS NULL)
    ),
    UNIQUE (sequence_id, position)
);
```

### Integrity rules enforced by the backend

- **Servo:** name non-empty and unique per robot; `pwm_pin` unique per robot;
  `angle_min < angle_max`; `neutral_angle` within `[angle_min, angle_max]`;
  `pulse_min_us < pulse_max_us`; all pulse widths `> 0`.
- **Pose:** name non-empty and unique per robot; at least one pose target;
  every target's `servo_id` exists on the robot; every target `angle` within
  that servo's `[angle_min, angle_max]`; no duplicate servo in a pose.
- **Sequence:** name non-empty and unique per robot; steps have contiguous
  `position` values starting at 0 (a reorder normalizes them); each step's
  target resolves: `kind='pose'` → an existing pose; `kind='servo'` → an
  existing servo with `angle` within limits.
- **Deletion guards** as described above.

These rules are enforced server-side regardless of any client-side checks. A
violation returns a `422` (request validation) or `409` (reference conflict) as
detailed in §5.

---

## 4. Component interactions & state flow

### Runtime flow

1. `./run.sh` starts uvicorn on `app.main:app` (`backend/app/main.py`).
2. On startup, `main.py` ensures the schema exists (`db.py`) and, if the DB is
   empty, seeds the sample robot (`seed.py`, brief 07). The DB file is created
   under `data/` if absent.
3. Routers under `/api/*` handle CRUD, preview, and export. Each handler:
   validates the request, applies business rules, reads/writes SQLite, returns
   JSON (Pydantic-serialized).
4. `main.py` mounts `StaticFiles(directory="frontend/", html=True)` for all
   non-`/api` routes, serving the SPA at `/`.

### State flow

- **Single source of truth = SQLite.** Every capability reads and writes the
  same persisted records.
- The **frontend keeps a client-side view state** (current robot, servos,
  poses, sequences, selected sequence) loaded from the API on startup and
  refreshed after each mutation.
- **Mutation pattern:** the frontend issues an API call; on success it updates
  its local state from the response (or by refetching the affected resource),
  then re-renders. On error it surfaces the backend's error message. There is
  no divergent copy of persisted data in the frontend; it is a view.
- **Preview reads through the API** (`/api/sequences/{id}/preview`) so it always
  reflects the current saved state of the sequence, its poses, and the robot
  config — satisfying brief 04's "no stale data" constraint. The frontend
  re-requests the preview whenever the sequence/pose/config changes.
- **Export reads through the API** (`/api/export`) at request time, so the
  artifact always reflects the current state (brief 05).
- **Seed data** behaves exactly like user data (brief 07): once seeded it is a
  normal record; nothing marks it read-only.

---

## 5. API contracts

Base path: `/api`. All request/response bodies are JSON (UTF-8). Errors use the
standard shape:

```json
{
  "detail": "human-readable message",
  "code": "MACHINE_CODE"   // optional; e.g. SERVO_REFERENCED, POSE_REFERENCED, VALIDATION
}
```

Error semantics: `400` malformed request; `404` resource not found; `409`
reference conflict (deletion blocked / uniqueness clash); `422` validation
failure.

The current robot is id `1` in the POC; the frontend discovers it via
`GET /api/robots` and uses the returned id thereafter.

### 5.1 Robots & servos (brief 01)

| Method | Path | Purpose | Request body | Response |
|---|---|---|---|---|
| GET | `/api/robots` | List robots (POC: the single current robot, without servos) | — | `[{ "id", "name" }]` |
| GET | `/api/robots/{robot_id}` | Full robot incl. servos | — | Robot object (§5.1.1) |
| PATCH | `/api/robots/{robot_id}` | Rename robot | `{ "name" }` | Robot object |
| GET | `/api/robots/{robot_id}/servos` | List servos | — | `[Servo]` |
| POST | `/api/robots/{robot_id}/servos` | Create servo | `ServoInput` | Servo (201) |
| GET | `/api/robots/{robot_id}/servos/{servo_id}` | Get one servo | — | Servo |
| PUT | `/api/robots/{robot_id}/servos/{servo_id}` | Update servo | `ServoInput` | Servo |
| DELETE | `/api/robots/{robot_id}/servos/{servo_id}` | Delete servo (409 if referenced) | — | `204` |

#### 5.1.1 Robot object

```json
{
  "id": 1,
  "name": "SampleBot",
  "servos": [
    {
      "id": 1,
      "name": "left_shoulder",
      "pwm_pin": 9,
      "angle_min": 0.0,
      "angle_max": 180.0,
      "neutral_angle": 90.0,
      "pulse_min_us": 500,
      "pulse_max_us": 2500
    }
  ]
}
```

`ServoInput` = `{ "name", "pwm_pin", "angle_min", "angle_max", "neutral_angle", "pulse_min_us", "pulse_max_us" }` (all required). `PUT` is full replace; `PATCH` is not offered for servos (keep it simple).

### 5.2 Poses (brief 02)

| Method | Path | Purpose | Request body | Response |
|---|---|---|---|---|
| GET | `/api/poses` | List all poses (with targets) | — | `[Pose]` |
| POST | `/api/poses` | Create pose | `PoseInput` | Pose (201) |
| GET | `/api/poses/{pose_id}` | Get one pose | — | Pose |
| PUT | `/api/poses/{pose_id}` | Update pose (rename / replace targets) | `PoseInput` | Pose |
| DELETE | `/api/poses/{pose_id}` | Delete pose (409 if referenced by a step) | — | `204` |

`PoseInput` = `{ "name", "targets": [ { "servo_id", "angle" } ] }` (≥1 target).
`Pose` object:

```json
{
  "id": 1,
  "name": "raise_arm",
  "targets": [ { "servo_id": 1, "angle": 120.0 } ]
}
```

### 5.3 Sequences & steps (brief 03)

| Method | Path | Purpose | Request body | Response |
|---|---|---|---|---|
| GET | `/api/sequences` | List sequences (summaries w/o steps) | — | `[{ "id", "name", "step_count" }]` |
| POST | `/api/sequences` | Create sequence | `{ "name" }` | Sequence (201) |
| GET | `/api/sequences/{seq_id}` | Get sequence incl. ordered steps | — | Sequence object |
| PUT | `/api/sequences/{seq_id}` | Rename sequence | `{ "name" }` | Sequence |
| DELETE | `/api/sequences/{seq_id}` | Delete sequence (and its steps) | — | `204` |
| POST | `/api/sequences/{seq_id}/steps` | Add step (appends at end) | `StepInput` | Step (201) |
| PUT | `/api/sequences/{seq_id}/steps/{step_id}` | Update step | `StepInput` | Step |
| DELETE | `/api/sequences/{seq_id}/steps/{step_id}` | Remove step | — | `204` |
| POST | `/api/sequences/{seq_id}/reorder` | Reorder steps | `{ "step_ids": [1,3,2] }` | Sequence (renumbered positions) |

`StepInput`:
- pose kind: `{ "kind": "pose", "pose_id": 1, "duration_ms": 500, "hold_ms": null }`
- servo kind: `{ "kind": "servo", "servo_id": 1, "angle": 120.0, "duration_ms": 500, "hold_ms": 100 }`

Step object (as returned):

```json
{
  "id": 10,
  "position": 0,
  "kind": "servo",
  "pose_id": null,
  "servo_id": 1,
  "angle": 120.0,
  "duration_ms": 500,
  "hold_ms": 100
}
```

For a pose-kind step, `pose_id` is set and `servo_id`/`angle` are `null`; for a
servo-kind step, the inverse. The backend rejects targets that don't resolve
(existing pose / existing servo + in-range angle) with `422`.

### 5.4 Preview (brief 04)

| Method | Path | Purpose | Response |
|---|---|---|---|
| GET | `/api/sequences/{seq_id}/preview` | Read-only, resolved, ordered steps | Preview document |

Preview document resolves every step to concrete servo targets and timing:

```json
{
  "sequence_id": 1,
  "sequence_name": "wave",
  "steps": [
    {
      "order": 0,
      "kind": "pose",
      "pose_id": 2,
      "pose_name": "raise_arm",
      "duration_ms": 500,
      "hold_ms": null,
      "targets": [ { "servo_id": 1, "servo_name": "left_shoulder", "angle": 120.0, "pulse_us": 1833 } ]
    },
    {
      "order": 1,
      "kind": "servo",
      "servo_id": 3,
      "servo_name": "head_pan",
      "angle": 45.0,
      "pulse_us": 1000,
      "duration_ms": 400,
      "hold_ms": 200,
      "targets": [ { "servo_id": 3, "servo_name": "head_pan", "angle": 45.0, "pulse_us": 1000 } ]
    }
  ]
}
```

For a pose-kind step, `targets` = the pose's resolved servo targets; for a
servo-kind step, `targets` = the single servo target. `pulse_us` is computed via
the formula in §5.5.1. The document is derived on every request, so it always
reflects current saved data. It is read-only; there is no write route here.

### 5.5 Export (brief 05)

| Method | Path | Purpose | Response |
|---|---|---|---|
| GET | `/api/export` | Full export: robot config + all sequences | JSON document (download) |
| GET | `/api/sequences/{seq_id}/export` | Export a single sequence (same schema) | JSON document (download) |

The full export is the primary endpoint and satisfies brief 05 (robot
configuration **and** the authored sequences). The per-sequence endpoint is a
convenience and uses the identical schema. Both return `Content-Disposition:
attachment; filename="<name>.json"` so the browser can save the artifact.

#### 5.5.1 Angle ↔ pulse-width conversion (canonical formula)

For a servo with `angle_min`, `angle_max`, `pulse_min_us`, `pulse_max_us`:

```
pulse_us = round(
    pulse_min_us
    + (angle - angle_min) * (pulse_max_us - pulse_min_us) / (angle_max - angle_min)
)
```

This is the only place conversion is computed; the backend uses it for both
preview and export so the two stay consistent.

#### 5.5.2 Export JSON schema (the decision that was previously undefined)

```json
{
  "schema_version": 1,
  "format": "robot-servo-sequence",
  "exported_at": "2026-09-08T00:00:00Z",
  "robot": {
    "id": 1,
    "name": "SampleBot",
    "servos": [
      {
        "id": 1,
        "name": "left_shoulder",
        "pwm_pin": 9,
        "angle_min": 0.0,
        "angle_max": 180.0,
        "neutral_angle": 90.0,
        "pulse_min_us": 500,
        "pulse_max_us": 2500
      }
    ]
  },
  "sequences": [
    {
      "id": 1,
      "name": "wave",
      "steps": [
        {
          "order": 0,
          "duration_ms": 500,
          "hold_ms": null,
          "targets": [
            { "servo_id": 1, "servo_name": "left_shoulder", "angle": 120.0, "pulse_us": 1833 }
          ]
        }
      ]
    }
  ]
}
```

Design rationale (satisfies brief 05):
- **Self-contained:** pose references are **resolved into concrete servo
  targets**; the consumer never needs the app to interpret a pose name. Each
  step exports a flat `targets` list of concrete `{ servo_id, servo_name,
  angle, pulse_us }` regardless of whether it was authored as a pose reference
  or a direct servo movement.
- **Firmware-friendly:** includes both `angle` (degrees) and `pulse_us`
  (computed per §5.5.1) plus `servo_name`, and uses `servo_id` only as a stable
  key. No app-only implementation details (no `created_at`, internal ordering
  indexes, or ORM internals) are embedded.
- **Complete:** includes every servo with all required configuration fields,
  and every sequence/step, in execution order (`order` = 0-based).
- **Versioned:** `schema_version: 1` and `format` allow future evolution.
- **Consistent with validation:** all emitted values correspond to states the
  app itself accepts (angles within limits, valid timing, resolved references).

---

## 6. Backend vs. frontend responsibilities

### Backend (Stage 6) owns

- FastAPI app, routers, and static SPA serving.
- SQLite schema creation, connections, and all persistence.
- **All business-rule validation** (angle limits, uniqueness, reference
  integrity, deletion guards) — the enforcement point.
- Angle↔pulse conversion; preview resolution; export document building.
- First-run seed data creation.
- Error responses with stable `code` values for the frontend to display.

### Frontend (Stage 7) owns

- The Bootstrap SPA: screens, forms, nav, sequence editor interactions
  (add/reorder/edit/remove), preview rendering, and export download.
- Client-side view state and API refresh orchestration.
- Client-side **UX** validation (e.g., inline "angle out of range" before
  submit) — purely for responsiveness; it never replaces backend enforcement.
- Rendering backend error messages to the user.
- Interpreting `null` vs `0` hold time for display.

The frontend must not persist, must not compute authoritative pulse widths, and
must not silently change contracts. It consumes only the endpoints in §5.

---

## 7. Component interaction summary

```
Browser (Bootstrap SPA)
   │  fetch /api/*  (JSON)
   ▼
FastAPI app (backend/app/main.py)
   ├─ routers/robot, poses, sequences  → validation.py → db.py (SQLite data/app.db)
   ├─ routers/preview, export          → preview.py / export.py → pulse.py
   └─ StaticFiles(frontend/) for non-/api routes
```

- CRUD mutations → validated → written to SQLite → response returned → frontend
  updates its view state → re-render.
- Preview/export → read current SQLite → resolve/convert → return JSON → render
  or download.
- Persistence is implicit (brief 06): every mutation persists immediately; there
  is no separate save step.

---

## 8. Open items / notes for downstream stages

- **Seed content (brief 07):** the architecture fixes the seed *shape and
  quantity* — one robot, 4–6 servos, 3–4 poses, 2+ sequences, all mutually
  consistent and valid — but not the exact names/values. Stage 6 authors
  plausible content and flags it (per Stage 6 guidance).
- **Preview rendering (brief 04):** this architecture specifies a read-only,
  ordered step listing (per the brief's default assumption). A richer
  visual/timeline render is out of scope unless a later stage explicitly opts in.
- **`run.sh` PYTHONPATH adjustment** must be made by Stage 6 (see §1); it is the
  only environment deviation and is flagged.
- **Requirements.txt:** no new runtime deps are required for the backend as
  specified (stdlib `sqlite3`). If Stage 6 adds an ORM/Alembic/pytest, it must
  update `requirements.txt` and `environment-notes.md`.

---

## 9. ENHANCEMENT — Sprint 01: multi-robot, timeline editing, timing, simulation

**Stage 5 — Architect (enhancement pass).**
**Date:** 2026-09-08

This section is an **addendum** to the v0.1 specification above. It fixes the
deltas required for the Sprint 01 enhancement pass: multi-robot management
(brief 01), the door durability tester seed rig (brief 02), the visual timeline
editor (brief 03), advanced motion timing — per-step speed/easing and
loop/repeat (brief 04), and motion simulation/preview (brief 05). It does not
rewrite or remove any v0.1 content; where an enhancement necessarily extends a
v0.1 structure, the change is described here as a delta and marked. The
environment is unchanged (Stage 4 confirmed none).

### 9.1 Revision notes on v0.1 assumptions

- v0.1 §3 claimed multi-robot would need "no schema change." That assumption is
  **superseded**: persisted robot selection and the new timing/loop fields
  require additive schema changes (§9.2). No v0.1 table or column is removed;
  all changes are additive.
- v0.1 §3 "Single current robot (POC)" is replaced by **currently selected
  robot**: the `robots` collection exists; exactly one robot is current (or
  none). "The frontend always operates on the current robot" (§3) still holds —
  the current robot is now the persisted selection.
- v0.1 seed data (humanoid sample, brief 07) is replaced on **fresh** databases
  by the door durability tester rig (brief 02). See §9.7.

### 9.2 Data model & schema changes

All changes are additive. DDL below is canonical for **fresh** databases;
upgraded databases apply the same changes via idempotent `ALTER TABLE`
(§9.8).

```sql
-- robots: add description (brief 01) + simulator visualization metadata (brief 05)
ALTER TABLE robots ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE robots ADD COLUMN sim_config   TEXT;   -- JSON string, nullable; frontend-interpreted (§9.2.1)

-- sequence_steps: per-step timing (brief 04)
ALTER TABLE sequence_steps ADD COLUMN speed  REAL;   -- deg/s, nullable (NULL = constant-speed, v0.1) (§9.2.2)
ALTER TABLE sequence_steps ADD COLUMN easing TEXT NOT NULL DEFAULT 'linear';
-- fresh DDL adds: CHECK (easing IN ('linear','ease_in','ease_out','ease_in_out'))

-- sequences: whole-sequence loop (brief 04)
ALTER TABLE sequences ADD COLUMN repeat_count   INTEGER;  -- NULL = run once; >= 1 = finite count
ALTER TABLE sequences ADD COLUMN repeat_forever INTEGER NOT NULL DEFAULT 0;  -- 0/1; mutually exclusive with repeat_count

-- step groups: loop over a contiguous run of steps (brief 04)
CREATE TABLE step_groups (
    id             INTEGER PRIMARY KEY,
    sequence_id    INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    name           TEXT,                        -- optional display label
    repeat_count   INTEGER,                     -- NULL = run once; >= 1 = finite count
    repeat_forever INTEGER NOT NULL DEFAULT 0,  -- 0/1; mutually exclusive with repeat_count
    CHECK (repeat_count IS NULL OR repeat_count >= 1),
    CHECK (repeat_forever IN (0, 1)),
    CHECK (repeat_count IS NULL OR repeat_forever = 0)
);

-- A step belongs to at most one group (PK on step_id). Groups must be contiguous
-- and non-overlapping; enforced by the backend, not the schema alone.
CREATE TABLE step_group_members (
    step_id  INTEGER PRIMARY KEY REFERENCES sequence_steps(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES step_groups(id) ON DELETE CASCADE
);

-- Single-row app state: persisted robot selection + first-run seed flag.
CREATE TABLE app_state (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    current_robot_id INTEGER REFERENCES robots(id) ON DELETE SET NULL,
    seeded           INTEGER NOT NULL DEFAULT 0
);
```

#### 9.2.1 `robots.sim_config` (visualization metadata)

`sim_config` is an optional JSON string describing how the simulator renders
this robot: joint/segment chain order (mapping servo names to joints), segment
lengths, the wall-mount anchor, and environment primitives (wall, door, handle)
for the door rig. It is **presentation data**: the backend stores it, validates
only that it is well-formed JSON when present, and never interprets it. The
exact JSON shape is defined by the frontend simulator (Stage 7); a suggested
minimal shape is in §9.6. The door-rig seed ships a populated `sim_config`;
user-created robots may omit it (the simulator falls back to an abstract
servo/chain rendering).

#### 9.2.2 Speed semantics (decision)

- Units: degrees/second (deg/s), `REAL`, nullable.
- `NULL` speed ⇒ constant-speed motion over `duration_ms` — exactly v0.1
  behavior. This is the migration default and the "no speed set" fallback
  (brief 04: existing steps keep their meaning).
- Consistency rule: for a step, `travel_deg` = max over the step's resolved
  target servos of |`target_angle` − `start_angle`|, where `start_angle` is the
  servo's resolved angle at the end of the previous step that moved it (or its
  `neutral_angle` if no prior step moved it). Then
  `speed = travel_deg / (duration_ms / 1000)`.
- On save the backend derives the missing value: client sends only
  `duration_ms` → backend computes and stores `speed`; client sends only
  `speed` → backend derives `duration_ms = round(travel_deg / speed * 1000)`;
  client sends both but they disagree beyond tolerance (±0.5% of travel, or
  0.05 deg/s absolute) → `422` with `code: "SPEED_DURATION_MISMATCH"`. If
  `travel_deg` is 0 (stationary step), `speed` is stored as `NULL`.
- Existing rows are backfilled on migration with their derived speed; behavior
  is unchanged (linear easing + derived speed ≡ constant speed). Speed and
  easing apply to the movement phase only; holds are unaffected (brief 04).

#### 9.2.3 Easing set (decision)

Canonical, finite set. `linear` is the default and preserves v0.1 behavior:
`linear`, `ease_in`, `ease_out`, `ease_in_out`. Canonical curves (t = normalized
elapsed time over the movement phase, p = eased progress):

| easing | p(t) |
|---|---|
| linear | p = t |
| ease_in | p = t³ |
| ease_out | p = 1 − (1−t)³ |
| ease_in_out | p = t < 0.5 ? 4t³ : 1 − (−2t+2)³ / 2 |

Backend preview resolution and the frontend simulator/timeline must implement
exactly these curves so playback, scrub, and preview agree (§9.4). The set may
be extended additively in the future, never renamed or removed.

#### 9.2.4 Loop semantics (decision)

- **Whole-sequence loop:** `sequences.repeat_count = N` (run the sequence N
  times) or `repeat_forever = 1` (until stopped). Default: `NULL`/`0` ⇒ once.
- **Group loop:** `step_groups.repeat_count / repeat_forever`; a group is a
  contiguous run of steps (by `position`) executed back-to-back the given
  number of times before the sequence continues after the group. A 1-step group
  is valid (repeat a single move).
- **Composition:** within one pass of the sequence, each group runs its own
  count (including its holds); the sequence-level repeat runs the whole pass
  (including all group expansions) the given number of times.
- **Contiguity:** groups must be non-empty, contiguous, and non-overlapping.
  Any step mutation (reorder, insert, delete, duplicate) revalidates group
  contiguity; a mutation that would split a group is rejected with
  `422 code "GROUP_SPLIT"` (the user must move/remove the group first).

### 9.3 API contract changes

All v0.1 endpoint paths and methods are preserved. Changes below are additive:
new endpoints, new optional fields, and optional query parameters.

#### 9.3.1 Robots & selection (brief 01)

| Method | Path | Purpose | Request body | Response |
|---|---|---|---|---|
| GET | `/api/robots` | List robots (now incl. description + current flag) | — | `[{ "id", "name", "description", "servo_count", "current" }]` |
| POST | `/api/robots` | Create robot | `{ "name", "description" }` | Robot (201) |
| GET | `/api/robots/{robot_id}` | Full robot incl. servos | — | Robot (§5.1.1 + `description`) |
| PATCH | `/api/robots/{robot_id}` | Update name and/or description (≥1 field) | `{ "name"?, "description"? }` | Robot |
| DELETE | `/api/robots/{robot_id}` | Delete robot; cascades its poses + sequences; clears current selection if it was current | — | `204` |
| GET | `/api/state/current-robot` | Read persisted current selection | — | `{ "robot_id": 1 \| null, "robot": {…} \| null }` |
| PUT | `/api/state/current-robot` | Set current robot | `{ "robot_id": N }` | `{ "robot_id": N }` (200); `404` if unknown |

Notes:
- `GET /api/robots` derives `"current": true` on exactly one row from
  `app_state.current_robot_id`.
- `POST /api/robots` requires `name` (non-empty) and `description` (present; may
  be an empty string). Creation does **not** change the current selection; the
  frontend may auto-select after create as a UX choice.
- `DELETE /api/robots/{robot_id}` removes the robot and, via FK cascades, its
  poses, pose targets, sequences, steps, and step groups. Because poses and
  sequences belong to that robot and nothing else may reference it, no `409`
  path exists at the robot level. If the deleted robot was current,
  `current_robot_id` becomes `NULL` (FK `ON DELETE SET NULL`); the frontend
  responds by selecting the first remaining robot or showing an empty state.

#### 9.3.2 Pose & sequence scoping (brief 01)

- `GET /api/poses`, `POST /api/poses`, `GET /api/sequences`, and
  `POST /api/sequences` operate on the **currently selected robot** by default
  and accept an optional `?robot_id=` query parameter for explicit scoping.
  Omitted ⇒ current robot. Responses are always scoped to one robot.
- v0.1 paths/methods are unchanged; this preserves the v0.1 single-robot
  behavior (that robot is now the selected robot).
- Cross-robot reference integrity is enforced server-side: a pose target's
  `servo_id` must belong to the pose's robot; a step's `pose_id`/`servo_id`
  must belong to the sequence's robot. Violations return `422`.

#### 9.3.3 Steps: timing, insert-at-position, duplicate (briefs 03/04)

`StepInput` gains optional fields:
- `position` (int, 0-based): insert at this position, shifting later steps
  (renumbering); omitted ⇒ append at end (v0.1 behavior).
- `speed` (REAL deg/s) and `easing` (enum per §9.2.2–9.2.3). Omitted or `null`
  ⇒ derived / `linear` respectively (v0.1 behavior).

The Step object gains `speed` and `easing`.

New endpoint (brief 03):

| Method | Path | Purpose | Request body | Response |
|---|---|---|---|---|
| POST | `/api/sequences/{seq_id}/steps/{step_id}/duplicate` | Copy a step adjacent to the original (position+1, shifting later steps); copy carries target, timing, speed, easing | — | Step (201) |

#### 9.3.4 Sequence loop fields (brief 04)

- The Sequence object gains `repeat_count`, `repeat_forever`, and `groups`
  (list of Group objects).
- `PUT /api/sequences/{seq_id}` accepts `{ "name"?, "repeat_count"?,
  "repeat_forever"? }` (≥1 field).

#### 9.3.5 Step groups (brief 04)

| Method | Path | Purpose | Request body | Response |
|---|---|---|---|---|
| POST | `/api/sequences/{seq_id}/groups` | Create group over contiguous steps | `{ "name"?, "step_ids": [...], "repeat_count"?, "repeat_forever"? }` | Group (201) |
| GET | `/api/sequences/{seq_id}/groups/{group_id}` | Get one group | — | Group |
| PUT | `/api/sequences/{seq_id}/groups/{group_id}` | Update name and/or repeat fields | `{ "name"?, "repeat_count"?, "repeat_forever"? }` | Group |
| DELETE | `/api/sequences/{seq_id}/groups/{group_id}` | Remove group (its steps remain) | — | `204` |

Group object:

```json
{
  "id": 1, "sequence_id": 1, "name": "grip_and_open",
  "step_ids": [4, 5], "repeat_count": 5, "repeat_forever": 0
}
```

Validation: `step_ids` non-empty, all in the sequence, contiguous by `position`,
non-overlapping with other groups. Contiguity is revalidated on every step
mutation; a split-producing mutation returns `422` `GROUP_SPLIT` (§9.2.4).

#### 9.3.6 Preview — extended, and the single resolved motion source (briefs 03/04/05)

`GET /api/sequences/{seq_id}/preview` remains the read-only, resolved view and
**becomes the data source for both the read-only preview and the simulator.**
The v0.1 document shape is preserved; additive fields:

- Per step: `easing`, `speed_deg_per_s` (resolved effective values), per-target
  `from_angle` / `from_pulse_us` (resolved start position carried through prior
  steps; first mover of a servo ⇒ its `neutral_angle`), and `start_ms` /
  `end_ms` (absolute time from pass start, `end_ms = start_ms + duration_ms`;
  the hold, when present, extends past `end_ms`).
- Sequence-level: `repeat_count`, `repeat_forever`, `groups` (with
  `step_orders` using 0-based `order` plus repeat fields), `pass_duration_ms`
  (single pass including all group expansions), and `total_duration_ms`
  (`pass_duration_ms * repeat_count`, or `null` when `repeat_forever`).

Example extended step:

```json
{
  "order": 2, "kind": "pose", "pose_id": 3, "pose_name": "reach_handle",
  "start_ms": 1200, "end_ms": 1700, "hold_ms": 250,
  "easing": "ease_out", "speed_deg_per_s": 42.0,
  "targets": [
    { "servo_id": 1, "servo_name": "shoulder",
      "from_angle": 30.0, "from_pulse_us": 833,
      "angle": 60.0, "pulse_us": 1250 }
  ]
}
```

The read-only preview UI renders this document statically (v0.1 behavior,
unchanged). The simulator and timeline playback animate the same document. For
**unsaved draft playback** the timeline editor may build an equivalent local
model from in-memory edits using the canonical rules in §9.2.2–9.2.4; saved
state always re-syncs from `/preview` (brief 05: "reflected when reopened or
re-synced").

#### 9.3.7 Export (briefs 01/04/05)

- Export endpoints are unchanged in path/method and operate on the **currently
  selected robot** (decision recorded here: v0.1 exported the single robot; the
  selected robot is its successor). Both accept an optional `?robot_id=` for
  explicit scope.
- `schema_version` bumps to `2`. Additive fields: robot `description`; per-step
  `easing` and `speed_deg_per_s`; sequence `repeat_count` / `repeat_forever`;
  and `groups` exported as
  `[ { "name", "step_orders": [0,1,2], "repeat_count", "repeat_forever" } ]`
  using 0-based step order. All v0.1 export fields and shape are unchanged
  (pose references still resolved to concrete `{ servo_id, servo_name, angle,
  pulse_us }` targets; no app-only implementation details added).

### 9.4 Backend vs frontend responsibility changes

**Backend (Stage 6) adds:**

- Robots CRUD + `description`; `app_state` persistence; current-robot endpoints;
  seed-once logic (§9.7); idempotent migration of upgraded databases (§9.8).
- New validation: speed/duration consistency, easing enum, loop/group rules,
  group contiguity, cross-robot reference integrity (§9.2, §9.3).
- Preview resolution extended: carry-through `from_angle`, `start_ms/end_ms`,
  pass/total durations, loop descriptors — the authoritative resolved motion
  document consumed by simulator and timeline.
- Export v2 with timing/loop fields.

**Frontend (Stage 7) adds:**

- Robot collection UI (create/select/edit/delete with confirmation dialog that
  warns poses/sequences are removed); current robot always visible; switching
  robots reloads servos, poses, sequences, preview, and simulator context.
- Visual timeline editor: timeline with step extents from durations/holds;
  add at any point, reorder, edit, remove, duplicate; play/pause/scrub with
  timing-accurate playhead; per-step speed/easing controls; sequence/group loop
  controls; group-split and invalid-step errors surfaced.
- **Shared motion module `frontend/js/motion.js`:** canonical easing math,
  speed/duration resolution for drafts, and elapsed-time→pose mapping honoring
  holds, easing, speed, and loops. Used by **both** the timeline editor
  playback and the simulator so they cannot diverge. Backend `/preview` is
  authoritative for saved data; `motion.js` animates the resolved preview
  document and builds drafts for unsaved edits.
- **Simulator renderer** (`frontend/js/simulator/`): Canvas-based, no new
  dependencies, no build step (Stage 4). Renders servos/links from the robot
  config + `sim_config` (wall/door/handle for the door rig); play/pause/scrub
  against the preview document; read-only with respect to the sequence.

**Unchanged responsibilities:** backend remains the enforcement point and sole
persister; the frontend never persists, never computes authoritative pulse
widths, and never weakens validation. Client-side checks remain UX conveniences.

### 9.5 Component interaction & state flow

- **Active robot:** `app_state.current_robot_id` (server-persisted, so it
  survives reloads — brief 01). The frontend loads it on startup
  (`GET /api/state/current-robot`), holds it in view state, and every
  robot-scoped capability (configuration, poses, sequences, preview, export,
  timeline, simulator) operates against it. Switching robots =
  `PUT /api/state/current-robot` + full view-state refresh.
- **Delete current robot:** backend sets `current_robot_id` to `NULL`
  (FK `SET NULL`); the frontend selects the first remaining robot or shows an
  empty state.
- **Mutation → refresh** pattern is unchanged (v0.1 §4): API call → update view
  state from response → re-render. Persistence remains immediate (no save step).
- **Simulator data flow:** open/simulate → fetch robot
  (`GET /api/robots/{robot_id}`, incl. servos + `sim_config`) and sequence
  (`GET /api/sequences/{seq_id}/preview`) → animate with `motion.js`. Re-sync
  after a sequence edit save or on reopen, matching brief 05.
- **Timeline editor:** edits build a local draft resolved model (via
  `motion.js`) for live playback/scrub; save via the step/sequence/group
  endpoints; after save the editor, read-only preview, and simulator all
  re-sync to the same saved data (preview is re-requested on sequence/pose/
  config change, as v0.1).

### 9.6 `sim_config` — suggested minimal shape (behavioral only, frontend-defined)

```json
{
  "kind": "arm-chain",
  "anchor": { "x": 0, "y": 0, "z": 0 },
  "joints": [ { "servo_name": "shoulder", "segment_len": 40 },
              { "servo_name": "elbow",    "segment_len": 35 },
              { "servo_name": "wrist",    "segment_len": 12 } ],
  "gripper": { "servo_name": "gripper", "jaw_len": 8 },
  "environment": { "wall": { }, "door": { }, "handle": { } }
}
```

The backend does not interpret this; it stores/validates well-formed JSON and
ships it for the door-rig seed. The exact structure is finalized by Stage 7.

### 9.7 Seed rig content contract (brief 02)

- **Fresh DB:** on first startup, if `app_state.seeded = 0`, seed exactly one
  robot — the door durability tester rig — including a populated `sim_config`,
  then set `seeded = 1`. Never re-seed after the user deletes it (seeded stays
  1), even if the robots table becomes empty.
- **Upgraded v0.1 DB:** set `seeded = 1` without seeding and leave existing
  data untouched (the v0.1 sample robot remains; it may have been edited).
  Flagged: brief 02's "replace the existing sample" applies to fresh databases;
  existing user data is never deleted.
- **Content shape (concrete values authored by Stage 6 and flagged):** one
  robot with 4–6 servos representing the four arm elements — shoulder/pivot,
  elbow, wrist twist, gripper — each with complete calibration within limits; a
  few named poses (e.g. rest, reach_handle, grip_handle, door_open, door_closed)
  within the servos' limits; one or more example sequences whose steps reference
  those poses/servos with valid durations/holds and demonstrate the door
  open/close cycle, using group or sequence loop/repeat to show many cycles.
- Seed data is normal, editable, deletable data; nothing marks it read-only or
  undeletable (briefs 02 and 07).

### 9.8 Migration & compatibility

- **Upgraded DB:** idempotent additive migration — `ALTER TABLE` for
  `robots.description`, `robots.sim_config`, `sequence_steps.speed`,
  `sequence_steps.easing`, `sequences.repeat_count`, `sequences.repeat_forever`;
  create `step_groups`, `step_group_members`, `app_state`; set `seeded = 1` and
  `current_robot_id` = the lowest robot id; backfill derived `speed` on existing
  steps (existing rows keep v0.1 meaning: linear easing, no loops).
  New CHECK constraints are enforced in code for upgraded DBs (SQLite cannot add
  `CHECK` via `ALTER TABLE`).
- **Fresh DB:** full DDL including the new `CHECK` constraints + seed rig
  (§9.7).
- Migration is idempotent (column-presence checks or `PRAGMA user_version`).
- No environment changes; no new dependencies; no frontend build toolchain
  (Stage 4 confirmed).

### 9.9 Explicitly unchanged / out of scope

- All v0.1 endpoint paths and methods remain; every change in §9.3 is additive
  (new optional fields, optional query parameters, new endpoints).
- v0.1 capabilities keep working on the selected robot: pose management,
  read-only sequence preview, immediate local persistence (no save step),
  structured JSON export (extended additively), and deletion guards (servo/pose
  reference rules unchanged and not weakened).
- No hardware control, no Arduino/serial, no real-time robot control, no
  autonomous behavior, no sensors. Playback and simulation are visual only.
- No multi-user, no authentication; the app remains a local, single-user web
  app.
- No environment/dependency changes beyond the v0.1 `run.sh` PYTHONPATH
  adjustment already recorded in §1.
- The simulator never edits the sequence; editing happens in the timeline
  editor only.

### 9.10 Open items for downstream stages

- **Concrete seed content** (names/values/`sim_config` geometry) is authored by
  Stage 6 and flagged, per §9.7.
- **`sim_config` exact JSON schema** is frontend-defined but must be agreed
  before Stage 6/7 so the door-rig seed carries the visuals the simulator
  renders; §9.6 gives a suggested shape.
- **Speed units (deg/s) and consistency tolerance** are decided in §9.2.2;
  confirm they match product intent before implementation.
- **"Run continuously" (`repeat_forever`)** is exported as `repeat_forever:
  true` with `repeat_count: null`; interpretation by downstream firmware
  consumers is left open.
- **Timeline editor vs. step-list surface:** this spec decides the timeline
  becomes the sequence editing surface and the read-only preview remains the
  static inspection surface (the v0.1 raw step-list editing form is superseded).
  Confirm with product before Stage 7 UI work.
- **Draft-vs-saved resolution:** `motion.js`'s draft resolver must mirror the
  backend preview rules exactly (canonical easing/speed/carry/loop semantics
  defined in §9.2) to avoid divergence between unsaved playback and saved state.
