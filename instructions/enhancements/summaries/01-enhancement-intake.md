# Summary: Enhancement Intake (Stage 1)

- **Date:** 2026-09-08
- **Author / Executor:** opencode (auto-pilot)
- **Instruction file:** `instructions/enhancements/01-enhancement-intake.md`
- **Scope reference:** `enhancements/scope.md`
- **Commit:** `stage 01: agree scope for sprint 01 (multi-robot, timeline, motion sim)`

## Work Completed

Read the sprint concept (`enhancements/sprint01.md`) in full and translated its
items into the agreed scope for this enhancement pass, recorded in plain,
non-technical language. Each lettered concept was categorized as a feature,
constraint, or boundary, with no concept dropped and nothing added beyond the
concept.

## Outputs Produced / Modified

- `enhancements/scope.md` — **new artifact.** The agreed scope for Sprint 01,
  listing every lettered concept (a–f) with its category and high-level intent,
  plus the pass-level constraints and boundaries.
- `instructions/enhancements/summaries/01-enhancement-intake.md` — **new
  artifact.** This summary.

## Key Decisions

- Categorized each sprint item:
  - a. Multi-robot management — Feature
  - b. New seed rig: door durability tester — Feature
  - c. Visual timeline editor — Feature
  - d. Advanced motion timing — Feature
  - e. Motion simulation / preview — Feature
  - f. Keep existing capabilities — Constraint
- Pass-level constraints (local/single-user app; keep existing v0.1 behavior;
  seed behaves like user data) and boundaries (no Arduino/serial, no
  autonomous behavior/sensors/real-time control; no multi-user/auth; no
  regression of existing behavior) are recorded so downstream stages preserve
  them.
- Kept the document non-technical — no routes, packages, schemas, or code
  structure — per the role's instructions.

## Open Questions & Concerns

- The sprint concept adds capabilities (timeline editor, motion timing, and a
  simulator) that go well beyond the current read-only sequence preview. The
  relationship between the new timeline editor / simulator and the existing
  read-only preview and JSON export schema should be clarified in later stages:
  whether the existing preview and export artifacts are extended or replaced,
  and how the export schema should accommodate speed/easing curves and
  loop/repeat.
- The boundary "seed data behaves exactly like user data" now applies in a
  multi-robot context (the seed rig is one of possibly many robots). Later
  stages should confirm the seed rig is created once on first run and is then a
  normal, editable, deletable user record like any other robot.

## Status

- [x] Complete
- [ ] Needs review