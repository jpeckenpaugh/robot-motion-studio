# Robot Servo Sequence Designer

A web application for designing and managing PWM servo motor control sequences
for Arduino-based robots. Users configure servo motors, create reusable poses,
author ordered/timed motion sequences, inspect them, and export them as
structured JSON for use by Arduino firmware or other robot-control software.

This is a proof-of-concept (POC): it covers configuration, poses, sequence
authoring, persistence, and export. It does **not** communicate with physical
Arduino hardware, does not perform autonomous behavior, and does not do
real-time robot control.

## Stack

- **Backend:** FastAPI (Python) + SQLite (stdlib `sqlite3`). Single process
  serves both the REST API and the static frontend.
- **Frontend:** static single-page app (HTML/CSS/JS + Bootstrap 5, vendored
  locally). No build toolchain.
- **Persistence:** SQLite database at `data/app.db`, seeded on first run with a
  sample robot, six servos, four poses, and two example sequences.

## Project structure

```
backend/            FastAPI app (app.main:app): routers, schema, persistence,
                    seed data, preview resolution, export builder
frontend/           Static SPA (index.html, js/, css/, vendor/)
docs/architecture.md        Technical spec: data model, API, export schema
docs/verification-report.md Stage 8 verification results (82/83 pass)
features/           Capability decomposition + feature briefs
summaries/          Per-stage summaries
concept.md          Product concept
install.sh          Provision the environment
run.sh              Start the application
```

## Prerequisites

- A POSIX shell (bash). On Windows use Git Bash or WSL.
- Python `>= 3.9` on `PATH` as `python3` (3.11/3.12 recommended). Override the
  interpreter with a `PYTHON` environment variable if needed.
- No frontend build toolchain or package manager required.

## Setup

```
./install.sh
```

This is idempotent and safe to re-run. It creates a virtual environment at
`.venv/`, upgrades `pip`, and installs the pinned dependencies from
`requirements.txt` (`fastapi`, `uvicorn[standard]`).

## Run

```
./run.sh
```

Starts the FastAPI backend with uvicorn at `http://127.0.0.1:8000`. The backend
serves both the API (`/api/*`) and the static SPA at `/`. On first startup the
SQLite database is created and seeded.

Environment overrides (optional):

| Variable | Default | Purpose |
|----------|---------|---------|
| `HOST`   | `127.0.0.1` | Host to bind |
| `PORT`   | `8000` | Port to bind |
| `APP`    | `app.main:app` | Backend entry point |
| `DB_PATH`| `data/app.db` | SQLite database file |

Then open `http://127.0.0.1:8000` in a browser.

## Using the app

- **Configuration:** view the robot and its servos (name, PWM pin, angle
  limits, neutral angle, pulse calibration); rename the robot; add, edit, and
  delete servos.
- **Poses:** create reusable named poses from servo target positions; edit and
  delete them.
- **Sequences:** create sequences; add, reorder, edit, and remove steps. Each
  step is either a pose reference or a direct servo movement, with a movement
  duration and an optional hold time.
- **Preview:** read-only, ordered inspection of a selected sequence, resolving
  every step to concrete servo targets and timing.
- **Export:** download a self-contained JSON document of the robot
  configuration and all sequences (or a single sequence), with pose references
  resolved to concrete servo targets and computed pulse widths.

## Implementation summary

The application was built across a staged pipeline from concept to verification:

- **Stage 2–3:** the concept was decomposed into seven product capabilities and
  written as behavioral feature briefs.
- **Stage 4:** a reproducible runtime/environment was defined
  (`install.sh`, `run.sh`, `requirements.txt`, `environment-notes.md`).
- **Stage 5:** `docs/architecture.md` fixed the data model (tables `robots`,
  `servos`, `poses`, `pose_targets`, `sequences`, `sequence_steps`), the REST
  API contract, the canonical angle↔pulse formula
  (`pulse_us = round(500 + angle·2000/180)`), and the self-contained export
  JSON schema.
- **Stage 6 (backend):** implemented the full FastAPI app — robots/servos,
  poses, sequences/steps/reorder, preview, and export endpoints, SQLite
  persistence, first-run seed data, and a stable error-code vocabulary
  (`VALIDATION`, `NOT_FOUND`, `CONFLICT`, `SERVO_REFERENCED`,
  `POSE_REFERENCED`). Deletion of referenced data is blocked with a 409; step
  positions are kept contiguous. `run.sh` was adjusted to add `backend/` to
  `PYTHONPATH`.
- **Stage 7 (frontend):** built the static Bootstrap SPA under `frontend/`
  (Configuration, Poses, Sequences, Preview, Export views) consuming only
  endpoints the backend exposes, with vendored Bootstrap and no build step.
- **Stage 8 (verification):** produced `docs/verification-report.md` with an
  83-item pass/fail checklist. Result: **82 PASS, 1 FAIL** (see Known issues).
- **Stage 9 (this stage):** documentation and close-out.

## Known issues

Recorded as delivered; not repaired in this stage.

- **I11 (FAIL in verification): preview may show stale data after edits.**
  The preview view (`frontend/js/views/preview.js`) caches its preview document
  in a module-level `doc` variable, refreshed only from the preview view's
  sequence-list click handler. `frontend/js/main.js` `switchView` →
  `renderActive()` re-renders that cached `doc` without re-fetching. A user who
  selects a sequence in Preview, edits that sequence (or its poses/servos) in
  another view, and returns to Preview can see stale content until they
  re-select a sequence in the preview list. This contradicts brief 04's "no
  stale data" constraint and architecture §4 ("the frontend re-requests the
  preview whenever the sequence/pose/config changes"). It was a static
  code-review finding; browser interaction was not headlessly exercised.
  A fix would re-fetch the preview on view activation.
- **Preview is a simple read-only ordered listing** (architecture §8 default),
  not a richer visual/timeline render. A timeline render is an explicit future
  decision.
- **Reorder uses up/down buttons, not drag-and-drop** (Stage 7 decision; the
  brief permits either).
- **`sequences.js` `createSequence()` calls `StateController.refresh()` twice**
  (harmless duplicate; cosmetic).
- **No authentication:** the POC API is open on the dev host, including the
  export endpoints. Neither the briefs nor the architecture specify auth.
- **Seed content is backend-authored** (architecture fixes shape/quantity but
  not names/values). It behaves like user data (editable/deletable).
- **Cross-platform:** `install.sh`/`run.sh` are bash/POSIX; Windows users need
  Git Bash or WSL.

## Verification results (as delivered)

Stage 8 recorded **82 of 83 checks PASS, 1 FAIL**, in `docs/verification-report.md`.

- **Method:** every backend endpoint was exercised with `curl` against the
  live app (`http://127.0.0.1:8000`); persistence was verified across a server
  restart; fresh-DB seeding was verified by deleting `data/app.db` and
  restarting; seed integrity was checked via direct SQLite queries; the
  frontend was reviewed statically (all `frontend/js/*.js` and `index.html`
  cross-checked against the OpenAPI route map).
- **Limitation:** browser interaction was **not** exercised by an automation
  tool in this environment. All frontend results are static findings and none
  claim browser automation. The single FAIL (I11) was identified by code-path
  analysis, not by rendering the app.

## Next actions (proposed)

1. **Fix the I11 preview staleness:** re-fetch
   `/api/sequences/{id}/preview` when the Preview view is activated (and on
   state refresh), so it can never render stale data.
2. **Exercise the frontend in a browser** (e.g. a headless browser / Playwright
   pass) to close the verification gap left by static-only review and confirm
   the I11 finding in rendered behavior.
3. **Decide on a richer preview/timeline render** if desired; the current
   read-only ordered listing meets the brief's default but a timeline could be
   added.
4. **Finalize any open cosmetic items** (e.g. the duplicate
   `StateController.refresh()` call) and optionally implement drag-and-drop
   reorder.
5. **Set up a git remote (`origin`)** for pushes. All stages so far have
   committed locally only; no remote is configured.
