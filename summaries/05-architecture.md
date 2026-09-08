# Summary: Architect (Stage 05)

- **Date:** 2026-09-08
- **Author / Executor:** Architect (opencode)
- **Instruction file:** `instructions/build/05-architecture.md`
- **Commit:** `stage 05: write technical architecture, data model, API contracts, and export JSON schema`

## Work Completed

Read `concept.md`, all seven feature briefs in `features/briefs/*.md`, and the
Stage 4 environment definition (`requirements.txt`, `install.sh`, `run.sh`,
`environment-notes.md`). Produced the technical specification
`docs/architecture.md` covering: project/file structure, module boundaries, the
SQLite data model and schema, REST API contracts, backend/frontend
responsibility split, component interactions, and a concrete export JSON schema
(the previously-undefined item flagged by brief 05). No application code was
written.

## Outputs Produced

- `docs/architecture.md` — the technical specification (reference for Stage 6
  backend and Stage 7 frontend).

## Key Decisions

- **Data model:** tables `robots`, `servos`, `poses`, `pose_targets`,
  `sequences`, `sequence_steps`. References are identity-based (`servo_id`,
  `pose_id`), not name-based. Steps use an explicit `position` for ordering and
  a `kind` (`'pose'` | `'servo'`) with a CHECK constraint enforcing that each
  kind sets exactly the right columns. Timing: `duration_ms` (required, >=0),
  `hold_ms` (nullable; NULL = no hold). Units: degrees, milliseconds,
  microseconds.
- **Single current robot:** `robots` table seeded with one row; endpoints are
  robot-scoped for future-proofing.
- **Deletion guards:** block (409), do not cascade — a servo referenced by a
  pose target or step, or a pose referenced by a step, cannot be deleted.
- **Export schema:** fixed a versioned, self-contained JSON document
  (`schema_version`, `format`, `exported_at`, `robot.servos`, `sequences`).
  Pose references are **resolved to concrete servo targets** with `servo_id`,
  `servo_name`, `angle`, and computed `pulse_us`, so consumers need no app.
  Defined the canonical angle↔pulse formula used by both preview and export.
- **Static serving:** kept the Stage 4 contract (`app.main:app`, `frontend/`
  via StaticFiles). Backend code lives under `backend/`, so the `app` package
  is at `backend/app/` and `run.sh` must add `backend/` to `PYTHONPATH` (the
  only environment deviation, flagged).
- **No new dependencies:** DB uses stdlib `sqlite3`; `requirements.txt`
  unchanged.

## Open Questions & Concerns

- **`run.sh` PYTHONPATH adjustment (required):** Stage 6 must update `run.sh`
  to add `backend/` to `PYTHONPATH` so `app.main:app` resolves while backend
  code lives under `backend/`. This is permitted by Stage 6 guidance but must
  be implemented and confirmed.
- **Seed content (07):** shape/quantity fixed (1 robot, 4–6 servos, 3–4 poses,
  2+ sequences) but exact names/values are backend-authored in Stage 6 and must
  be flagged there.
- **Preview (04):** specified as a read-only ordered step listing per the
  brief's default assumption; a richer visual/timeline render would need an
  explicit later decision.
- **Error contract:** stable `code` strings on errors (e.g. `SERVO_REFERENCED`,
  `POSE_REFERENCED`, `VALIDATION`) are suggested but not exhaustively enumerated
  in the spec — Stage 6 should finalize the exact code vocabulary and record it.
- **Hold-time semantics:** NULL vs 0 both mean "no hold" at the API layer; the
  frontend must decide display handling — flagged for Stage 6/7 confirmation.

## Status

- [x] Complete
- [ ] Needs review
