# Summary: Feature Brief Writer (Stage 3)

- **Date:** 2026-09-08
- **Author / Executor:** opencode (auto-pilot)
- **Instruction file:** `instructions/enhancements/03-write-feature-briefs.md`
- **Scope reference:** `enhancements/scope.md`
- **Commit:** `stage 03: write feature briefs for sprint 01 enhancements`

## Work Completed

Read the agreed scope (`enhancements/scope.md`), all five new feature files
under `features/`, and all seven existing v0.1 briefs under
`features/completed/briefs/` (robot configuration, pose management, sequence
authoring, sequence preview, sequence export, persistence, seed data). Wrote
one behavioral brief per new feature into the newly created `features/briefs/`
folder, with numbering/names in sync with the feature files. Each brief
describes the new behavior as a delta on the existing app — what changes or is
added to the current single-robot UX — and is written purely behaviorally, with
no filenames, classes, SQL, architecture, or framework choices. No upstream
scope or feature files were modified, no constraints were dropped or weakened,
and no features were merged.

## Outputs Produced / Modified

- `features/briefs/01-multi-robot-management.md` — **new artifact.** Collection
  of user-managed robots; each has name, description, servo inventory, per-servo
  calibration; poses/sequences scoped per robot; delete-with-confirmation.
- `features/briefs/02-door-durability-tester-seed-rig.md` — **new artifact.**
  Non-humanoid wall-mounted arm (shoulder/pivot, elbow, wrist twist, gripper)
  seeded once on first run, editable/deletable like any robot.
- `features/briefs/03-visual-timeline-editor.md` — **new artifact.** Timeline
  editing (add/reorder/edit/remove/duplicate) with play/pause/timing-accurate
  scrub, preserving the existing step model and validation.
- `features/briefs/04-advanced-motion-timing.md` — **new artifact.** Per-step
  speed + easing curves, and loop/repeat of a whole sequence or a contiguous
  step group; extends JSON export.
- `features/briefs/05-motion-simulation-and-preview.md` — **new artifact.**
  Browser-rendered simulator of servos/motion with timing-accurate scrub,
  coexisting with the read-only preview; no hardware, no real-time control.
- `instructions/enhancements/summaries/03-write-feature-briefs.md` — **new
  artifact.** This summary.

## Key Decisions

- Resolved the Stage 2/1 open question on the **preview relationship**: the
  existing read-only sequence preview (static step + resolved-target
  inspection) continues to work and coexists with the new simulator (animated
  visual playback) and the timeline editor (the editing surface). The preview
  and simulator are both read-only views of the same saved sequence.
- Resolved the open question on **JSON export**: the existing export is extended
  (not replaced) to include the new per-step timing (easing, speed) and
  loop/repeat fields, keeping its self-contained, Arduino-usable intent. Whether
  export covers all robots or only the selected robot is flagged as still open.
- Resolved the open question on the **seed rig in a multi-robot context**: the
  rig is created once on first run and is then a normal, editable, deletable
  robot record in the collection, never re-seeded after deletion.
- Kept the timeline editor's steps on the same underlying sequence model already
  defined (pose-reference or direct-servo kinds, movement duration + optional
  hold) so the change is to the editing surface, not the data meaning.
- Described the simulator's "3D" render as browser visualization of servos and
  the rig's wall/door/handle context, without prescribing a rendering library or
  2D-vs-3D decision.

## Open Questions & Concerns

- **Export robot scope:** Briefs 04/05 note it is still unresolved whether JSON
  export covers all robots or only the currently selected robot. Behaviorally,
  export must at minimum cover the current robot's configuration and sequences.
  Needs confirmation before the export/architecture stage.
- **Timeline editor vs. step-list surface:** Brief 03 assumes the timeline is
  the sequence editing surface while the read-only preview remains a separate
  inspection surface; whether the timeline visually replaces or sits alongside
  the old step-list authoring surface should be confirmed before implementation.
- **Concrete easing/speed/loop values:** Brief 04 fixes the behavioral contract
  (constant-speed option plus selectable easing curves, per-step speed
  consistent with duration, finite repeat count baseline) but the exact easing
  set, speed units, and whether a "run continuously" option is offered are left
  to a later stage.
- **Concrete seed content:** Brief 02 fixes the behavioral contract (one rig on
  first run, four arm elements represented by its servo inventory, valid
  calibrated servos, named poses, example door open/close sequences) but the
  exact servos, poses, and example sequences are decided in a later content
  stage.

## Status

- [x] Complete
- [ ] Needs review