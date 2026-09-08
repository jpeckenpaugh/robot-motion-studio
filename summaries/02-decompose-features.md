# Summary: Feature Decomposition (Stage 02)

- **Date:** 2026-09-08
- **Author / Executor:** Feature Decomposition engineer (opencode)
- **Instruction file:** `instructions/build/02-decompose-features.md`
- **Commit:** `stage 02: decompose concept into seven product capabilities`

## Work Completed

Read the approved `concept.md` and decomposed it into seven discrete,
app-specific product capabilities for a Robot Servo Sequence Designer Web App.
Each capability was written to its own numbered file under `features/`, and no
concept requirement was dropped. Files stay strictly at the capability level
with no behavior, workflow, implementation, or code described.

## Outputs Produced

- `features/01-robot-configuration.md`
- `features/02-pose-management.md`
- `features/03-sequence-authoring.md`
- `features/04-sequence-preview.md`
- `features/05-configuration-and-sequence-export.md`
- `features/06-persistence.md`
- `features/07-sample-robot-seed-data.md`
- `summaries/02-decompose-features.md` (this file)

## Key Decisions

- The sample/seed robot requirement is kept as its own feature (`07`) rather
  than folded into Robot Configuration, since it is a distinct start-up
  capability with its own content needs (several servos, basic calibration,
  named poses, example sequences).
- Sequence authoring, preview/inspection, and export are separated into
  distinct features because they represent clearly different capabilities the
  user can perform against sequences.
- Technical architecture named in the concept (SPA frontend, FastAPI, SQLite)
  is intentionally not described in feature files; it belongs to later
  architecture/backend stages. Persistence is captured only at the capability
  level.

## Open Questions & Concerns

- Scope of "preview/inspection": whether the preview is a visual/timeline
  render or a simpler read-only listing is unspecified and should be decided
  during brief writing.
- Degree of pose/sequence relationship coupling (whether sequences may mix
  named poses and raw per-servo movements freely) is left open; the concept
  implies both are supported as step targets.
- Export format specifics beyond "structured JSON" are undefined; downstream
  stages must fix the exact JSON schema.

## Status

- [x] Complete
- [ ] Needs review
