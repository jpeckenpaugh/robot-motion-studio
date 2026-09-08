# Summary: Backend Engineer (Stage 6)

- **Date:** 2026-09-08
- **Author / Executor:** opencode (Stage 6 backend engineer)
- **Instruction file:** `instructions/enhancements/06-backend.md`
- **Scope reference:** `enhancements/scope.md`
- **Commit:** `stage 06: extend backend for multi-robot, timeline editing, timing, and simulation`

## Work Completed

Extended the existing v0.1 FastAPI + SQLite backend under `backend/` (no
recreation) to implement the Sprint 01 enhancements per `docs/architecture.md`
§9, additively and without regressing any v0.1 endpoint:

1. **Multi-robot management** — full robots CRUD (list/create/patch/delete),
   persisted current-robot selection (`app_state.current_robot_id`) with
   `GET/PUT /api/state/current-robot`, `current` flag in the robots list, robot
   `description`, `sim_config`, and robot scoping (`?robot_id=`) for poses,
   sequences, and export. Cross-robot reference integrity is enforced.
2. **Door durability tester seed rig** — fresh databases now seed exactly one
   robot (wall-mounted shoulder/pivot + elbow + wrist-twist + gripper arm) with
   a populated `sim_config`, 5 named poses, and 2 example sequences that
   demonstrate the door open/close cycle via a step-group loop (25x) and
   per-step speed/easing with a sequence repeat (5x). Seed-once is honored
   (`app_state.seeded`); upgraded v0.1 databases are never re-seeded.
3. **Timeline-editor support** — step `position` (insert-at-position),
   step-duplicate endpoint, and all existing add/update/delete/reorder
   endpoints preserved.
4. **Advanced motion timing** — per-step `speed` + `easing`, whole-sequence
   `repeat_count`/`repeat_forever`, `step_groups` + `step_group_members`
   (contiguous group loops) with `GROUP_SPLIT` protection on every step
   mutation.
5. **Motion simulation source** — the extended `GET /api/sequences/{id}/preview`
   is the single resolved motion document: carry-through `from_angle` /
   `from_pulse_us`, absolute `start_ms`/`end_ms`, `easing`, `speed_deg_per_s`,
   `groups` (with 0-based `step_orders`), `pass_duration_ms` (incl. group
   expansions), `total_duration_ms` (null when `repeat_forever`). Export is
   scoped to the selected robot and bumped to `schema_version: 2`.

Verification: the server boots via `run.sh`; the full new contract was
exercised with curl (multi-robot CRUD, current-robot state, step duplicate,
step groups, `GROUP_SPLIT`, `SPEED_DURATION_MISMATCH`, preview resolution, and
export v2), and all v0.1 endpoints (poses, sequences, servos, guards, existing
preview/export) were confirmed working. Migration runs cleanly and idempotently
on both a fresh DB and the existing v0.1 `data/app.db`.

## Outputs Produced / Modified

All under `backend/` (modifications to existing v0.1 modules; no new files):

- `backend/app/db.py` — fresh DDL for the new columns/tables +
  idempotent `ALTER TABLE` migration, `app_state` row management, seed-once /
  upgraded-DB logic, backfill invocation.
- `backend/app/seed.py` — rewritten: door durability tester rig (backend-authored
  content + `sim_config`), returns the seeded robot id.
- `backend/app/schemas.py` — new/updated Pydantic models: `RobotCreate`,
  `RobotUpdate`, `SequenceInput`, `SequenceUpdate`, extended `StepInput`
  (position/speed/easing), `GroupInput`, `GroupUpdate`, `CurrentRobotSet`.
- `backend/app/validation.py` — easing enum, repeat validation,
  `app_state`-based `current_robot_id`, `resolve_robot_id`, group-contiguity
  revalidation (`GROUP_SPLIT`), description normalization.
- `backend/app/preview.py` — extended preview (carry-through, absolute timing,
  groups, pass/total durations) plus the shared speed/duration derivation
  (§9.2.2) used by step saves and migration backfill.
- `backend/app/export.py` — `schema_version: 2`, selected-robot scoping,
  description, per-step easing/speed, sequence repeat fields, groups by
  `step_orders`.
- `backend/app/routers/robot.py` — robots CRUD + current-robot state; `get_robot`
  now returns `sim_config` (parsed JSON) for the simulator.
- `backend/app/routers/poses.py` — `?robot_id=` scoping on list/create.
- `backend/app/routers/sequences.py` — sequence loop fields, insert-at-position,
  speed/easing save derivation, duplicate endpoint, step-groups CRUD, group
  contiguity enforcement on every step mutation.
- `backend/app/routers/export.py` — optional `?robot_id=` on both endpoints.
- `backend/app/routers/preview.py` — unchanged (path preserved).

`run.sh` needed no change: the PYTHONPATH adjustment from the Stage 5 spec
(§1) was already present.

## Key Decisions

- **Schema migration approach (idempotent, additive).** Fresh DBs run the full
  canonical DDL (including new `CHECK` constraints). Upgraded v0.1 DBs run
  `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info`-guarded `ALTER TABLE ADD
  COLUMN` for `robots.description`/`sim_config`,
  `sequence_steps.speed`/`easing`, `sequences.repeat_count`/`repeat_forever`,
  plus creation of `step_groups`, `step_group_members`, `app_state`. Then:
  existing-data DBs get `seeded = 1`, `current_robot_id` = lowest robot id, and
  a derived-speed backfill on NULL-speed steps (existing rows keep their v0.1
  meaning: linear, non-looping). A re-run changes nothing (verified).
- **Speed semantics (§9.2.2).** Implemented as specified: on save, backend
  derives the missing value (`duration_ms`→speed, speed→`duration_ms`) from the
  resolved travel over the sequence's linear step order (carry-through; first
  mover of a servo ⇒ neutral). Both-present disagreement beyond
  `max(0.5% · derived_speed, 0.05 deg/s)` → `422 SPEED_DURATION_MISMATCH`.
  Stationary steps store `speed = NULL`. A step must provide at least one of
  `duration_ms` / `speed` (`StepInput` now treats `duration_ms` as optional).
- **Repeat-forever / repeat-count merge.** Setting one clears the other;
  providing both non-null in the same request is `422`. This makes
  `{"repeat_forever": true}` work on a sequence that had a finite count without
  requiring the client to also send `repeat_count: null` (which the Pydantic
  model cannot distinguish from "absent").
- **Preview `steps` list is NOT loop-expanded** (flagged; §9.3.6 left this
  open). The flat `steps` list keeps v0.1 semantics: one entry per authored
  step, `order` = authored index, per-step `start_ms`/`end_ms` computed over the
  linear authored order (duration + hold), `from_angle` carry also linear.
  Loops/repeats are described by the `groups` array, `repeat_count` /
  `repeat_forever`, `pass_duration_ms` (includes group expansions, computed
  separately), and `total_duration_ms`. A `repeat_forever` group makes
  `pass_duration_ms`/`total_duration_ms` null (a pass with a forever-group never
  completes). Frontend `motion.js` must treat the `steps` list as the authored
  (single-occurrence) order and apply groups/loops on top.
- **`sim_config` in the API** is returned as a **parsed JSON object** (or
  `null`) in `GET /api/robots/{id}` so the simulator can consume it directly;
  the robots **list** omits it (matches §9.3.1). Stored as a JSON TEXT column;
  the backend validates only well-formedness and never interprets it.
- **Door-rig seed content and `sim_config` geometry are BACKEND-AUTHORED** (§9.7,
  flagged). Servos: `shoulder` (-90..90), `elbow` (0..120), `wrist` (-90..90),
  `gripper` (0..60), pins 2-5. Poses: `rest`, `reach_handle`, `grip_handle`,
  `door_open`, `door_closed`. Sequences: `door_cycle` (4 pose steps looped by a
  group, 25x) and `grip_and_release` (servo/pose steps with explicit
  speed/easing, sequence repeat 5x). The `sim_config` follows §9.6's suggested
  shape with concrete environment hints (wall at x=0, handle at
  x=150/z=100, door frame dims). All angles/durations are within limits and
  mutually consistent; seed data is a normal editable/deletable record.
- **Group split semantics.** Because step deletion renumbers positions, deleting
  a group member always leaves remaining members contiguous (allowed). A split
  is only possible via reorder or insert/duplicate between members — those are
  rejected with `422 GROUP_SPLIT` before commit (no partial writes; verified).
  Note: duplicating any member of the seeded `door_cycle` group is therefore
  blocked until the user removes/re-sizes that group (per §9.2.4).
- **No new runtime dependencies.** stdlib `sqlite3` only; `requirements.txt`
  and `environment-notes.md` unchanged.

## Open Questions & Concerns

- **Preview linear-vs-expanded `steps`** (see Key Decisions). If the product
  wants per-occurrence timeline entries (each group iteration visible in the
  `steps` array with its own `start_ms`), Stage 7 would need that modeled in
  `motion.js` from the `groups` + linear `steps`; confirm before relying on
  per-step times inside a looped group.
- **`step_orders` semantics.** Group `step_orders` use 0-based authored
  `position` (== `order` in the preview `steps` list), not expanded-occurrence
  indices. Verified consistent for the linear model.
- **`repeat_forever` export** is `repeat_forever: true` with `repeat_count:
  null`; interpretation by downstream firmware consumers remains open (§9.10).
- **`sim_config` final schema** is frontend-defined (Stage 7); the seed's
  geometry (anchor/joints/environment) is a plausible default and may need
  tuning to match the simulator's rendering assumptions.
- **Speed backfill for zero-duration steps.** A v0.1 step with `duration_ms =
  0` and travel > 0 keeps `speed = NULL` (no meaningful finite speed); flagged
  for the preview/verification stage.

## Status

- [x] Complete
- [ ] Needs review