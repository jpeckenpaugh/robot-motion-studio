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
