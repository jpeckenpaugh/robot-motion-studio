# Summary: Frontend Engineer (Stage 7)

- **Date:** 2026-09-08
- **Author / Executor:** Frontend Engineer (auto-pilot, Stage 7)
- **Instruction file:** `instructions/enhancements/07-frontend.md`
- **Scope reference:** `features/briefs/01..05-*.md`, `docs/architecture.md` §9
- **Commit:** `stage 07: add multi-robot, timeline editor, motion timing, and simulator to the SPA`

## Work Completed

Extended the existing v0.1 Bootstrap SPA (under `frontend/`) to implement the
five Sprint-01 enhancements, consuming **only** the Stage-6 backend endpoints —
no new backend routes were invented. The existing views (Configuration, Poses,
Sequences, Preview, Export) keep working and now operate against the selected
robot; two new views (Timeline, Simulator) and a navbar robot switcher were
added.

- **(a) Multi-robot management:** navbar robot switcher (list/create/select/
  edit/delete with a confirmation that warns poses/sequences are removed);
  persisted selection via `GET/PUT /api/state/current-robot`; robot-scoped
  loading (`?robot_id=`) of poses and sequences; per-robot description and
  servo inventory editing (unchanged servo validation rules).
- **(b) Door durability tester seed rig:** ships as a normal editable robot; the
  frontend merely renders it like any other robot (the backend seeds it).
- **(c) Visual timeline editor:** new Timeline view — step blocks laid out on a
  time axis proportional to duration + hold; add (at any position), reorder
  (move earlier/later), edit, remove, duplicate steps; play/pause/reset; and a
  timing-accurate, draggable playhead (scrub). Built on the shared motion
  module.
- **(d) Advanced motion timing:** per-step speed (deg/s) + easing
  (linear/ease_in/ease_out/ease_in_out) controls; whole-sequence repeat
  (`repeat_count` / `repeat_forever`) and contiguous step-group loops (create/
  edit/delete groups over a range of steps), with backend-sourced validation
  errors surfaced (`SPEED_DURATION_MISMATCH`, `GROUP_SPLIT`).
- **(e) Motion simulation/preview:** new Simulator view — a dependency-free
  Canvas renderer (`frontend/js/simulator.js`) that interprets `sim_config`
  (arm-chain + wall/door/handle for the rig) and falls back to an abstract
  servo chain for robots without one. It plays/pauses/resets and scrubs the
  authoritative `/preview` motion document, honoring easing, holds, speed, and
  loops, via the shared motion module.

## Outputs Produced / Modified

New artifacts:

- `frontend/js/motion.js` — shared canonical motion module (easing curves,
  speed/duration derivation, loop expansion, elapsed-time→pose mapping) used by
  both the timeline and the simulator so they cannot diverge (architecture
  §9.4).
- `frontend/js/simulator.js` — Canvas simulator renderer (brief 05).
- `frontend/js/views/robots.js` — robot collection switcher/manager (brief 01).
- `frontend/js/views/timeline.js` — visual timeline editor (briefs 03/04).
- `frontend/js/views/simulator.js` — Simulator view hosting the canvas +
  transport controls (brief 05).

Modified v0.1 artifacts:

- `frontend/js/state.js` — robot collection, current-robot selection via the
  backend, `sim_config`, robot-scoped poses/sequences, empty-collection state.
- `frontend/js/main.js` — registers Timeline/Simulator views, mounts the robot
  switcher, updates brand/switcher on refresh, and renders the nav on first
  load (v0.1 only rendered nav on view switch — fixed so nav entries appear).
- `frontend/js/views/configuration.js` — robot description display; modal
  cleanup (v0.1 modals were never removed from the DOM, leaking duplicate
  element ids that broke the create→edit robot flow).
- `frontend/js/views/preview.js` — read-only preview now reflects the enhanced
  timing fields (easing, speed, from→to angles, start/end ms, repeat/groups,
  pass/total duration) and re-fetches `/preview` on every render (fixes the
  v0.1 I11 stale-cache issue).
- `frontend/index.html` — navbar robot-switcher slot + script tags for the new
  modules/views.
- `frontend/css/styles.css` — timeline + simulator styles.

## Key Decisions

- **Shared motion module** (`motion.js`) implements the backend-canonical easing
  curves verbatim (§9.2.3) and expands the `/preview` document into segments
  honoring group repeats and (for finite repeats) the whole-sequence repeat, so
  timeline playback and the simulator scrub are timing-accurate and agree.
  `repeat_forever` is rendered as a single wrapped pass.
- **Timeline is the authoring surface** (per §9.10); the v0.1 list-based
  Sequences view is kept alongside without change (no regression, no duplicated
  effort beyond what existed).
- **Timeline/Simulator re-sync from `/preview` on every render**, so robot
  switches, pose/servo edits, and external changes are always reflected.
- **Simulator geometry is schematic and frontend-interpreted** (§9.2.1): the
  arm chain is exact from servo angles + `sim_config` segment lengths; the
  environment is drawn from `sim_config`. Because the seed handle
  (`x=150`) lies beyond the arm's ~95-unit reach, the door handle is placed at
  the gripper tip of the robot's "grip" pose (falling back to neutral reach,
  then to `sim_config`), so the arm visibly reaches/grips/works the handle.
- **Each pass starts from the neutral pose** per the backend's `/preview`
  carry model; the simulator/timeline agree because both use the same
  `resolveState`.
- Fixed two pre-existing v0.1 bugs exposed by the enhancements: nav not rendered
  on first load, and modal DOM leak in `openGenericModal`.

## Open Questions & Concerns

- **Sequence-repeat continuity:** `/preview` describes a single pass (steps'
  `from_angle`/`start_ms` are pass-relative). For finite `repeat_count > 1`,
  the frontend expands the pass N times for display/scrub. Each expanded pass
  starts from the neutral pose, matching the backend carry model; a physical
  robot would carry the previous pass's end pose into the next pass. Verify
  this matches product intent.
- **Simulator geometry is schematic:** the seed `sim_config` arm (~95 units of
  reach) cannot physically reach the configured handle (`x=150`). The frontend
  therefore derives the handle position from the grip pose. Confirm this
  interpretation is acceptable, or adjust the seed `sim_config` coordinates
  (backend-authored) to be reachable.
- **Timeline width for very large repeats:** expanded segments are capped at
  4096 (a warning badge is shown); huge `repeat_count` values render the first
  pass only.
- **`repeat_forever` scrubbing** wraps within a single pass (there is no
  infinite timeline); playback loops the pass continuously.
- **Modal cleanup fix** (`hidden.bs.modal` removal) changes shared behavior used
  by every view; verify no regression in modal interactions.
- **v0.1 Sequences view** remains available alongside the Timeline editor;
  confirm this coexistence is acceptable (architecture §9.10 anticipated the
  timeline superseding the raw step-list form).

## Verification performed

- `node --check` on every frontend JS file (all pass).
- Ran the backend (`uvicorn`, fresh seeded DB) and confirmed via curl that all
  endpoints the frontend calls match the Stage-6 contract: `GET/POST
  /robots`, `GET /robots/{id}` (incl. `sim_config`), `PATCH/DELETE /robots`,
  `GET/PUT /api/state/current-robot`, robot-scoped `?robot_id=` on
  poses/sequences, `StepInput` with `speed`/`easing`/`position`, step
  `duplicate`, `reorder`, sequence repeat fields, step-group create/update/
  delete, extended `/preview` (from_angle, start/end_ms, easing, speed,
  pass/total durations, groups), and export v2. All CRUD + preview checks
  returned the expected payloads (derived speeds, renumbering, group
  contiguity, group-repeat pass duration).
- Headless-Chrome smoke tests (CDP) drove every view, selected sequences, and
  verified: 100 timeline blocks for the 25x group-repeat door_cycle and 15 for
  the 5x-repeated grip_and_release; play advances the playhead; scrub is
  timing-accurate (50% → 63750 ms; 25% → 2125 ms); the simulator canvas resizes
  and draws the environment (pixel-sampled door/handle/labels); the robot
  create→edit→switch flow works; the add-step modal lists the robot's poses,
  servos, and the four easing options; modals are cleaned up after close. Zero
  console errors/exceptions across all runs.

## Status

- [x] Complete
- [ ] Needs review