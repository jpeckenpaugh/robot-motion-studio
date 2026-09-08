# Summary: Architect (Stage 5)

- **Date:** 2026-09-08
- **Author / Executor:** opencode (auto-pilot)
- **Instruction file:** `instructions/enhancements/05-architecture.md`
- **Scope reference:** `enhancements/scope.md`
- **Commit:** `stage 05: extend architecture spec for multi-robot, timeline, timing, and simulation`

## Work Completed

Read `enhancements/scope.md`, the five new feature briefs
(`features/briefs/01`–`05`), the existing v0.1 `docs/architecture.md`, and the
Stage 4 environment definition. Appended a clearly-marked enhancement section
(§9) to `docs/architecture.md` that specifies the deltas for Sprint 01 without
rewriting or removing the v0.1 spec: data model/schema changes, API contract
changes, frontend/backend responsibility changes, component interaction and
state flow, the simulator's data consumption model, the new seed rig contract,
migration rules, and an explicit unchanged/out-of-scope list.

## Outputs Produced / Modified

- `docs/architecture.md` — **modification.** New §9 "ENHANCEMENT — Sprint 01"
  appended after the existing v0.1 sections 1–8. No v0.1 content was changed.
- `instructions/enhancements/summaries/05-architecture.md` — **new artifact.**
  This summary.

## Key Decisions

- **Multi-robot was already half-supported** (servos/poses/sequences carry
  `robot_id`); the deltas are: add `robots.description` and `robots.sim_config`;
  persist the selected robot in a single-row `app_state` table
  (`current_robot_id` with `ON DELETE SET NULL`) plus a `seeded` flag for
  seed-once semantics.
- **Timing fields (additive):** `sequence_steps.speed` (deg/s, nullable;
  `NULL` = v0.1 constant-speed) and `sequence_steps.easing` (enum
  `linear|ease_in|ease_out|ease_in_out`); `sequences.repeat_count` /
  `repeat_forever`; new `step_groups` + `step_group_members` for contiguous
  group looping. Speed and duration are mutually derived from resolved travel
  distance; inconsistency returns 422 `SPEED_DURATION_MISMATCH`.
- **Simulator design:** the existing `/api/sequences/{id}/preview` document is
  extended (per-step `from_angle`/`from_pulse_us`, `start_ms`/`end_ms`,
  `easing`, `speed`, loop descriptors, `pass_duration_ms`) and becomes the
  single authoritative resolved motion source consumed by the read-only preview,
  the timeline playback, and the simulator. A shared frontend module
  (`frontend/js/motion.js`) holds the canonical easing math and
  elapsed-time→pose mapping so the editor and simulator cannot diverge; the
  simulator is Canvas-based, client-side, read-only, no new deps.
- **Export:** operates on the currently selected robot (resolves the Stage 2/3
  open question), `schema_version` bumps to 2, additive timing/loop fields;
  v0.1 shape preserved.
- **Seed rig:** replaces the v0.1 sample on fresh DBs only, gated by
  `app_state.seeded` so it is never re-seeded after deletion; upgraded DBs keep
  existing data and are marked seeded.
- **API changes are additive:** all v0.1 endpoint paths/methods preserved;
  pose/sequence list+create default to the current robot with optional
  `?robot_id=`; new endpoints for robots POST/DELETE, current-robot state,
  step duplicate, insert-at-position (`StepInput.position`), and step-group CRUD.
- **Timeline editor** becomes the sequence editing surface; the read-only
  preview remains the static inspection surface.

## Open Questions & Concerns

- **`sim_config` JSON schema** is frontend-defined but backend stores it; needs
  agreement between Stage 6 (to seed the door rig visuals) and Stage 7 before
  implementation. §9.6 gives a suggested shape.
- **Speed units/tolerance (deg/s, ±0.5%)** decided in §9.2.2; confirm product
  intent.
- **Timeline replaces the step-list editing form** (read-only preview remains);
  confirm with product before Stage 7 UI work.
- **`repeat_forever` export representation** (`repeat_forever: true`,
  `repeat_count: null`) — downstream firmware interpretation open.
- **Draft-vs-saved resolution parity:** `motion.js` draft resolver must mirror
  backend preview rules exactly to avoid divergence.
- **Upgrade-DB seed behavior:** brief 02's "replace the existing sample" applies
  to fresh databases; existing v0.1 user data is preserved and marked seeded.

## Status

- [x] Complete
- [ ] Needs review