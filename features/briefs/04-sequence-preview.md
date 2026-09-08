# Brief 04: Sequence Preview

## Purpose

Provide basic preview and inspection of a completed motion sequence so the user
can review its contents before exporting or using it. It exists purely for the
user's review benefit; it does not drive any real hardware.

## Expected behavior

- The user can select any authored sequence and view a preview/inspection of it.
- The preview presents the sequence's contents in execution order so the user
  can review each step before using the sequence.
- For each step, the preview shows the step's effective action (which named pose
  or which individual servo + position it targets) and its timing (movement
  duration and, if set, hold time), consistent with the current, saved state of
  the sequence and the robot configuration.
- If a sequence references a pose, the preview makes clear what that pose does
  (which servos it sets) so the user can understand the full resulting motion
  without leaving the preview.
- The preview reflects the current sequence state; it updates when the sequence
  changes and when the referenced robot configuration or poses change, so the
  user is always reviewing an accurate picture.
- The preview is read-only for the sequence: it must not allow or require the
  user to modify the sequence from within it.

## Inputs / outputs

- Inputs: a user-selected sequence to review.
- Outputs: a read-only, ordered, human-readable rendering of that sequence,
  including each step's target and timing, and the pose details for any pose
  referenced.

## User-visible behavior

- The user selects a sequence and sees a clear, ordered view of its steps.
- Each step visibly shows what it will move to (pose name, or servo + angle) and
  how long the movement and any hold take.
- The user can follow the sequence from first to last step and understand the
  intended motion, without performing any physical movement.
- The preview updates to stay consistent with any edits made to the sequence,
  its poses, or the robot configuration.
- The user cannot accidentally change the sequence while reviewing it; the
  preview is for inspection only.

## Constraints

- The preview must always reflect the current saved state of the sequence and
  the data it depends on (poses, robot/servo configuration); it must not show
  stale or idealized step data.
- The preview must present the sequence in its true execution order.
- The preview must be non-destructive and read-only with respect to the sequence
  being reviewed.
- It must not perform, simulate claim to perform, or depend on any physical
  robot motion; this capability is inspection only.
- The preview must not omit steps; every step in the sequence is represented.

## Basic acceptance expectations

- The user can open a preview for a sequence and sees every step in order.
- Each step shows its target (pose or individual servo + position) and timing
  (movement duration and hold time) accurately.
- For pose-based steps, the user can see which servos and positions that pose
  represents.
- When a sequence, pose, or servo configuration is edited, reopening the preview
  shows the updated result.
- The user is not able to modify the sequence from within the preview.

## Notes / Clarifications

- The feature (and upstream concept) specifies only "basic preview/inspection."
  Whether this is a visual/timeline render or a simpler read-only listing is
  unspecified. The default assumption in this brief is a read-only, ordered
  step listing that accurately reflects the current sequence and its referenced
  data. If a richer visual/timeline preview is desired, that decision must be
  made before implementation. This should be flagged and resolved before
  engineering begins.
