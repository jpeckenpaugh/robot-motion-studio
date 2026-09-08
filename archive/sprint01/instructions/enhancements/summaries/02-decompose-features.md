# Summary: Feature Decomposition (Stage 2)

- **Date:** 2026-09-08
- **Author / Executor:** opencode (auto-pilot)
- **Instruction file:** `instructions/enhancements/02-decompose-features.md`
- **Scope reference:** `enhancements/scope.md`
- **Commit:** `stage 02: decompose sprint 01 scope into new feature capabilities`

## Work Completed

Read the agreed scope (`enhancements/scope.md`) and the existing v0.1 features
under `features/completed/`. Decomposed only the new in-scope enhancements
(a–e) into discrete, capability-level features, written one per file under the
newly populated `features/` folder. Existing v0.1 capabilities (pose
management, read-only preview, persistence, JSON export) were treated as
context to avoid duplication, not re-decomposed. The "keep existing
capabilities" constraint (f) was intentionally not turned into a feature.

## Outputs Produced / Modified

- `features/01-multi-robot-management.md` — **new artifact.** Capability to
  work with many robots at once, each with an independent configuration.
- `features/02-door-durability-tester-seed-rig.md` — **new artifact.** The new
  default seed rig: a non-humanoid wall-mounted door-durability-tester arm with
  gripper, calibrated servos, poses, and example sequences.
- `features/03-visual-timeline-editor.md` — **new artifact.** Timeline-based
  sequence editing (add/reorder/edit/remove/duplicate steps, play/pause/scrub).
- `features/04-advanced-motion-timing.md` — **new artifact.** Per-step speed and
  easing curves, plus loop/repeat of sequences or step groups.
- `features/05-motion-simulation-and-preview.md` — **new artifact.** Built-in
  simulator that renders servo motion and plays sequences with timing-accurate
  scrubbing without hardware.
- `instructions/enhancements/summaries/02-decompose-features.md` — **new
  artifact.** This summary.

## Key Decisions

- Decomposed one feature per in-scope enhancement letter (a–e), each mapped
  directly to its scope item so nothing is dropped and nothing beyond scope is
  added.
- Did not create a feature for constraint (f); existing capabilities are a
  non-regression constraint, not new work.
- Speed/easing controls, which appear in both scope items (c) and (d), are
  captured once under "Advanced Motion Timing" (d) to avoid double-counting; the
  timeline editor (c) covers the editing surface, duplication, and play/pause/
  scrub.
- The seed rig (b) is described as one robot among the user's collection,
  consistent with the multi-robot context and the "seed behaves like user data"
  constraint.

## Open Questions & Concerns

- **Export schema:** existing JSON export (v0.1) must accommodate the new
  timing data (per-step speed/easing curves, loop/repeat) and multiple robots.
  Whether the export format is extended or replaced needs clarification in later
  stages.
- **Preview relationship:** the existing read-only sequence preview and the new
  timeline editor / simulator overlap in intent; later stages should confirm how
  the read-only preview coexists with (or is superseded by) the new editing and
  simulation surfaces.
- **Seed behavior in multi-robot context:** confirm the seed rig is created once
  on first run and is then a normal, editable, deletable robot record like any
  other.

## Status

- [x] Complete
- [ ] Needs review