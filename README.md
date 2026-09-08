# Robot Servo Sequence Designer

> **Current state (Sprint 01 enhancement pass, 2026-09-08):** the app is now a
> local, single-user **multi-robot motion designer** — a FastAPI + SQLite
> backend serving a static Bootstrap SPA. On top of the v0.1 capabilities
> described below it adds multi-robot management (create/edit/select/delete
> robots, each with an independent configuration), a door-durability-tester
> seed rig (a wall-mounted servo arm that reaches to a door, grasps the handle,
> and repeatedly opens/closes the door), a visual timeline editor
> (add/reorder/edit/remove/duplicate steps, play/pause/scrub, per-step speed
> and easing), advanced motion timing (easing curves, sequence repeat,
> contiguous step-group loops), and a browser Canvas motion simulator that
> consumes the extended `/preview` document. JSON export is now robot-scoped
> with `schema_version: 2`. See **"Sprint 01 enhancement pass"** under
> Implementation summary, plus the enhancement status/known-issue sections
> below. The v0.1 description, setup/run instructions, known-issue list, and
> v0.1 verification results are preserved unchanged beneath that material.

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
  locally). No build toolchain. Simulation is a dependency-free browser Canvas
  renderer.
- **Persistence:** SQLite database at `data/app.db`. Fresh (first-run)
  databases seed the door-durability-tester rig — one robot (`DoorDurabilityRig`,
  4 servos: shoulder/elbow/wrist/gripper), five poses, and two example
  sequences. (v0.1 seeded a sample robot with six servos, four poses, and two
  example sequences; upgraded v0.1 databases keep their existing data and are
  never re-seeded.)

## Project structure

```
backend/            FastAPI app (app.main:app): routers, schema, persistence,
                    seed data, preview resolution, export builder, migration
frontend/           Static SPA (index.html, js/, css/, vendor/) — Configuration,
                    Poses, Sequences, Preview, Export views plus the Sprint-01
                    Robots/Timeline/Simulator views and the shared motion.js +
                    simulator.js modules
docs/architecture.md        Technical spec: data model, API, export schema,
                    §9 Sprint-01 enhancement spec (schema, API, sim_config,
                    seed, migration)
docs/verification-report.md Stage 8 verification results: v0.1 82/83 pass and
                    Sprint 01 enhancement 85/86 pass (1 FAIL each, preserved)
features/           Sprint-01 capability decomposition + briefs/ (feature briefs
                    01–05)
features/completed/ v0.1 capabilities + briefs/ (archived at Sprint-01 setup)
enhancements/       Sprint-01 scope (scope.md, sprint01.md)
summaries/          Per-stage summaries (v0.1 build pipeline)
instructions/       Role instructions (build/, debug/, enhancements/) + the
                    enhancement-pass summaries under
                    instructions/enhancements/summaries/
concept.md          Product concept
environment-notes.md        Environment notes (unchanged in Sprint 01)
requirements.txt    Pinned Python dependencies (unchanged in Sprint 01)
data/app.db         SQLite database (git-ignored; clean seeded state)
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

- **Robots (new in Sprint 01):** the app manages a collection of robots, not
  one fixed sample. A navbar switcher lists the collection with controls to
  create, select, edit, and delete robots. Each robot has its own name,
  description, and servo inventory. Deleting a robot warns that its poses and
  sequences will be removed and requires confirmation. The current robot is
  always visible and clearly identified; poses, sequences, preview, export,
  timeline, and simulation all operate on it. The robot selected at the end of
  the last session is restored on reload.
- **Configuration:** view the robot and its servos (name, PWM pin, angle
  limits, neutral angle, pulse calibration); rename the robot; add, edit, and
  delete servos. Sprint 01 also shows and edits the robot's description and
  stores its `sim_config` (simulator visualization metadata).
- **Poses:** create reusable named poses from servo target positions; edit and
  delete them. Poses belong to the current robot only.
- **Sequences:** create sequences; add, reorder, edit, and remove steps. Each
  step is either a pose reference or a direct servo movement, with a movement
  duration and an optional hold time. (This v0.1 step-list view remains; the
  timeline editor below is the Sprint-01 editing surface.)
- **Preview:** read-only, ordered inspection of a selected sequence, resolving
  every step to concrete servo targets and timing. Sprint 01 extended the
  preview document with per-step easing/speed, `from_angle` carry-through,
  absolute `start_ms`/`end_ms`, loop/group descriptors, and pass/total
  durations — the same document the timeline and simulator animate.
- **Export:** download a self-contained JSON document of the robot
  configuration and all sequences (or a single sequence), with pose references
  resolved to concrete servo targets and computed pulse widths. Sprint 01
  scoped export to the selected robot and bumped it to `schema_version: 2`.
- **Timeline editor (new in Sprint 01):** the visual sequence editing surface.
  Steps appear as blocks on a time axis proportional to their duration + hold;
  add (at any position), reorder, edit, remove, and duplicate steps; play,
  pause, and scrub (drag a playhead) with timing-accurate progress that honors
  easing. Per-step speed and easing controls and whole-sequence / step-group
  loop controls live here.
- **Motion timing (new in Sprint 01):** steps carry an easing curve
  (`linear`, `ease_in`, `ease_out`, `ease_in_out`) and a speed; the backend
  derives the missing value (`duration_ms` ↔ deg/s) from the step's resolved
  travel and rejects incoherent pairs. Sequences can repeat a finite number of
  times (or forever), and contiguous runs of steps can be grouped and looped.
- **Simulator (new in Sprint 01):** a browser Canvas renderer that draws the
  selected robot — the door rig's arm chain plus its wall/door/handle
  environment from `sim_config`, or an abstract servo chain for other robots —
  and plays/pauses/resets/scrubs a sequence against the `/preview` motion
  document. Read-only with respect to the sequence; it cannot edit it.

## Implementation summary

The v0.1 application was built across a staged pipeline from concept to
verification:

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

### Sprint 01 enhancement pass (multi-robot, timeline, timing, simulation)

The Sprint 01 pass ran its own staged pipeline (`instructions/enhancements/`):

- **Stage 1 (intake):** agreed `enhancements/scope.md` (items a–f) from
  `enhancements/sprint01.md`.
- **Stage 2 (decomposition):** decomposed the in-scope enhancements into five
  capabilities (`features/01..05`); constraint (f, keep existing capabilities)
  was not turned into a feature.
- **Stage 3 (briefs):** wrote behavioral feature briefs
  `features/briefs/01..05` (multi-robot management, door-durability-tester
  seed rig, visual timeline editor, advanced motion timing, motion
  simulation/preview).
- **Stage 4 (system engineering):** confirmed **no environment changes** —
  `requirements.txt`, `install.sh`, `run.sh`, `.gitignore`, and
  `environment-notes.md` are unchanged.
- **Stage 5 (architecture):** appended §9 to `docs/architecture.md` — additive
  schema changes (`robots.description`/`sim_config`,
  `sequence_steps.speed`/`easing`, `sequences.repeat_count`/`repeat_forever`,
  new `step_groups`/`step_group_members`/`app_state`), speed/easing/loop
  semantics, new endpoints (robots CRUD, current-robot state, step duplicate,
  insert-at-position, step-group CRUD), the extended `/preview` as the single
  resolved motion source, export v2, the seed-rig and migration contracts.
- **Stage 6 (backend):** extended `backend/` additively — robots CRUD and
  persisted current-robot selection, `?robot_id=` scoping with cross-robot
  reference integrity, idempotent additive migration + seed-once (door rig on
  fresh DBs only), speed/duration derivation with
  `SPEED_DURATION_MISMATCH`, easing enum, sequence/group loop fields with
  `GROUP_SPLIT` protection, step duplicate, extended preview (carry-through
  `from_angle`, `start_ms`/`end_ms`, groups, pass/total durations), and
  robot-scoped export `schema_version: 2`.
- **Stage 7 (frontend):** extended `frontend/` — navbar robot switcher
  (`views/robots.js`), visual timeline editor (`views/timeline.js`), Canvas
  simulator (`simulator.js` + `views/simulator.js`), and the shared
  `motion.js` module used by both the timeline and simulator so they cannot
  diverge. The read-only preview re-fetches `/preview` on every render (this
  fixes v0.1 issue I11). Two pre-existing v0.1 frontend bugs were also fixed:
  nav not rendered on first load, and a modal DOM leak in `openGenericModal`.
- **Stage 8 (verification):** appended an ENHANCEMENT PASS section to
  `docs/verification-report.md`: **85 PASS, 1 FAIL (G7)** of 86 new checks;
  **no v0.1 regression found** (v0.1 results preserved).
- **Stage 9 (this stage):** documentation and close-out — updated `README.md`,
  this file; no code was changed.

## Known issues

Recorded as delivered; not repaired in this documentation stage. This section
keeps the v0.1 list (annotated with their status after Sprint 01) and adds the
Sprint 01 findings.

### v0.1 (recorded at the v0.1 close-out; status as of Sprint 01)

- **I11 (FAIL in v0.1 verification): preview may show stale data after edits.**
  The preview view (`frontend/js/views/preview.js`) cached its preview document
  in a module-level `doc` variable, refreshed only from the preview view's
  sequence-list click handler, so returning to Preview after editing elsewhere
  could render stale content. **Resolved in Sprint 01:** `preview.js` now
  re-fetches `/preview` on every render (Stage 8 enhancement check K8 PASS).
- **Preview was a simple read-only ordered listing** (architecture §8
  default), not a richer visual/timeline render. **Superseded in Sprint 01:**
  the app now has a visual timeline editor and a motion simulator; the
  read-only preview remains as a separate static inspection surface.
- **Reorder uses up/down buttons, not drag-and-drop** (Stage 7 decision; the
  brief permits either). **Still true:** the Sprint-01 timeline also moves steps
  with earlier/later controls; no drag-and-drop anywhere.
- **`sequences.js` `createSequence()` calls `StateController.refresh()` twice**
  (lines 140–142; harmless duplicate; cosmetic). **Still present.**
- **No authentication:** the POC API is open on the dev host, including the
  export endpoints. Neither the briefs nor the architecture specify auth.
  **Unchanged by design** (local, single-user app).
- **Seed content is backend-authored** (architecture fixes shape/quantity but
  not names/values). It behaves like user data (editable/deletable).
  **Still true;** the Sprint-01 seed rig content is likewise backend-authored.
- **Cross-platform:** `install.sh`/`run.sh` are bash/POSIX; Windows users need
  Git Bash or WSL. **Unchanged.**

### Sprint 01 enhancement pass (recorded at this close-out)

- **G7 (FAIL in Sprint 01 verification): stored step `speed` / preview
  `speed_deg_per_s` is not recomputed after a step mutation changes a step's
  resolved travel.** The backend derives `speed` from resolved travel at save
  time but does not recompute it when a later insert/delete/reorder changes the
  `from_angle` context. The preview can then report e.g. `speed_deg_per_s: 20.0`
  for a step whose own `from_angle:-20 → angle:0` over 500 ms implies 40 deg/s.
  Playback and scrubbing are unaffected (both use `duration_ms`/`easing`, not
  `speed`), so this is a metadata/display-consistency defect, not a timing
  defect.
- **`repeat_count` cannot be cleared back to `null` via `PUT` once set** (a
  `null` value is indistinguishable from "not provided" in the request model).
  The frontend works around it by sending `repeat_count:null` +
  `repeat_forever:false`, which yields a run-once sequence. Minor API
  ergonomics only.
- **The v0.1 list-based Sequences view coexists with the timeline editor.**
  Architecture §9.10 anticipated the timeline superseding the raw step-list
  form; coexistence is recorded as acceptable, but whether the step-list view
  stays is an open product decision.
- **Simulator geometry is schematic.** The seed rig's `sim_config` arm
  (~95 units of reach) cannot physically reach the configured handle
  (`x=150`), so the frontend places the door handle at the gripper tip of the
  robot's "grip" pose (falling back to neutral reach, then `sim_config`). The
  render is an interpretation; adjust the seed `sim_config` coordinates if
  reachable geometry is desired.
- **Very large `repeat_count` values render only the first pass.** The
  frontend caps expanded segments at 4096 and shows a warning badge ("very
  large repeat — showing first pass"); the full repetition is not scrubbed.
- **Sequence-repeat continuity is pass-relative.** `/preview` describes a
  single pass (`from_angle`/`start_ms` are pass-relative); for finite
  `repeat_count > 1` the frontend expands the pass N times, each starting from
  the neutral pose (matching the backend carry model). A physical robot would
  carry the previous pass's end pose into the next pass; product intent is
  unconfirmed.
- **`repeat_forever`** is stored/exported as `repeat_forever:true` with
  `repeat_count:null`; interpretation by downstream firmware consumers is open.
  The frontend renders a forever-repeat as a single wrapped pass.
- **Frontend browser-verification gap.** Stage 7 (frontend) reported its own
  headless-Chrome CDP smoke tests of the timeline, simulator, and robot
  flows, but Stage 8's formal verification records that browser interaction was
  **not** exercised by an automation tool and labels its frontend checks
  "(static)". A formal browser-automated verification pass remains open, and
  the two records have not been reconciled.
- **No git remote (`origin`) is configured.** All stages (v0.1 and Sprint 01)
  have committed **locally only**; nothing has been pushed.

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

### Sprint 01 enhancement pass (as delivered)

The Sprint 01 Stage 8 recorded **85 of 86 checks PASS, 1 FAIL (G7)**, appended
to `docs/verification-report.md`; the v0.1 results above are preserved
unchanged, and **no v0.1 regression was found**.

- **Method:** the app was run with the unchanged Stage-4 environment scripts;
  every enhancement endpoint in architecture §9.3 was exercised with `curl`;
  fresh-DB seeding/seed-once and upgraded-v0.1 idempotent migration were tested
  on throwaway databases on separate ports (8001/8002) via `DB_PATH` overrides;
  the default `data/app.db` was restored to the clean seeded baseline (1 robot,
  4 servos, 5 poses, 2 sequences).
- **Limitation:** frontend checks (timeline/simulator behavior, canvas
  rendering) were **static** findings; browser interaction was not exercised by
  a Stage-8 automation tool. The single FAIL (G7) was confirmed via live API
  responses, not by rendering.

## Next actions (proposed)

Status of the v0.1 proposals as of Sprint 01, then new proposals:

1. **Fix the I11 preview staleness:** re-fetch
   `/api/sequences/{id}/preview` when the Preview view is activated (and on
   state refresh), so it can never render stale data. **Done in Sprint 01**
   (`preview.js` re-fetches on every render; check K8 PASS).
2. **Exercise the frontend in a browser** (e.g. a headless browser / Playwright
   pass) to close the verification gap left by static-only review and confirm
   the I11 finding in rendered behavior. **Partly addressed:** Stage 7 ran its
   own headless-Chrome CDP smoke tests, but Stage 8's formal verification did
   not automate a browser; a formal browser-automated pass is still open.
3. **Decide on a richer preview/timeline render.** **Done in Sprint 01:** a
   visual timeline editor and a Canvas motion simulator were added.
4. **Finalize any open cosmetic items** (e.g. the duplicate
   `StateController.refresh()` call) and optionally implement drag-and-drop
   reorder. **Still open** (both remain).
5. **Set up a git remote (`origin`)** for pushes. All stages so far have
   committed locally only; no remote is configured. **Still open.**

### Proposed for a future pass

1. **Fix G7** so preview `speed_deg_per_s` is consistent with each step's
   resolved travel: recompute the stored `speed` of affected steps on any step
   mutation (insert/delete/reorder/duplicate), or derive `speed_deg_per_s`
   during preview resolution instead of storing it.
2. **Define explicit `repeat_count` clearing** (e.g. distinguish "absent" from
   "null" in the update model) so a finite repeat can be reset to run-once via
   `PUT` without the frontend's `null`+`repeat_forever:false` workaround.
3. **Run a formal browser-automated verification pass** (timeline
   play/pause/scrub, simulator rendering, robot-switch flows) and reconcile it
   with Stage 7's reported CDP smoke tests and Stage 8's static-only record.
4. **Resolve the seed `sim_config` geometry** so the door rig's arm can reach
   the configured handle in the simulator, or formally accept the current
   schematic re-derivation of the handle position from the grip pose.
5. **Confirm sequence-repeat continuity intent** (neutral-pose restart per pass
   vs. carry-over of the previous pass's end pose) and how `repeat_forever`
   should be interpreted by downstream firmware consumers of export v2.
6. **Decide the fate of the v0.1 list-based Sequences view** now that the
   timeline editor is the sequence editing surface.
7. **Exercise the frontend in a browser** as a repeat of the v0.1 gap, closing
   the static-only verification limitation recorded above.
