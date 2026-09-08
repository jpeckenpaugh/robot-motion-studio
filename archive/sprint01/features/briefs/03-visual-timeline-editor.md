# Brief 03: Visual Timeline Editor

## Purpose

Turn the existing step-list sequence authoring into a timeline-based editing
surface. Today the user composes a sequence as an ordered list of steps with
targets and timing. This feature presents that same sequence as a visual
timeline where the user can add, reorder, edit, remove, and duplicate steps,
and play, pause, and scrub through the sequence. The steps retain the same
underlying meaning already defined (a step targets a named pose or an
individual servo, with a movement duration and an optional hold), so the
authoring data model from the existing Sequence Authoring capability is
preserved and simply edited through a richer surface.

## Expected behavior

- The user opens a sequence for a selected robot and sees it on a visual
  timeline, where each step appears in order along a time axis.
- A step's position and extent on the timeline reflect its movement duration
  and optional hold time, so the user can see how long each part of the
  sequence takes relative to the others.
- The user can add a new step at any point on the timeline. Each new step is
  defined the same way existing steps are: choose a target (a named pose, or an
  individual servo plus a position), a movement duration, and an optional hold
  time. Speed and easing controls are added by Advanced Motion Timing (Brief
  04) and appear on steps here as well.
- The user can reorder steps by moving them on the timeline; the sequence's
  execution order always matches the order shown.
- The user can edit any existing step's target, movement duration, hold time,
  and (per Brief 04) speed and easing without changing other steps.
- The user can remove any step from the timeline.
- The user can duplicate any step, creating a copy with the same target, timing,
  speed, and easing placed adjacent to the original, which the user can then
  move or edit.
- The user can play the sequence from the timeline: steps advance in execution
  order and in real time according to their movement durations and holds.
- The user can pause playback at any point.
- The user can scrub (drag a playhead) along the timeline to move to and inspect
  any point in the sequence. Scrubbing is timing-accurate: the position on the
  timeline corresponds exactly to the elapsed time from sequence start given the
  steps' durations and holds.
- Playback and scrubbing respect each step's easing curve (Brief 04): the
  playhead reflects easing-affected progress within a step, not constant-speed
  motion, where an easing curve is set.
- The timeline editor is the editing surface for sequences; the existing
  read-only sequence preview and the new simulator (Brief 05) remain available
  and show the same saved sequence state. Editing in the timeline updates what
  the read-only preview and simulator show.
- Step validation rules from the existing Sequence Authoring capability still
  apply: steps must target an existing pose or an existing servo with a
  position within its angle limits, and durations/holds must be valid
  non-negative measures of time. The editor prevents or flags invalid steps
  rather than saving them.
- The existing capability to author steps as either a named-pose reference or a
  direct individual servo movement remains fully supported and freely mixed
  within a sequence.

## Inputs / outputs

- Inputs: the user's editing actions — add, reorder, edit, remove, and duplicate
  steps, each step carrying a kind (pose reference or direct servo movement),
  a target, a movement duration, an optional hold time, and (per Brief 04)
  speed and easing; and play, pause, and scrub actions.
- Outputs: an up-to-date, ordered, named motion sequence for the selected robot,
  editable on the timeline and shared with preview, export, persistence, and
  simulation.

## User-visible behavior

- The user sees a visual timeline of the current sequence instead of (or in
  addition to) a plain step list, with steps laid out in order along a time axis
  proportional to their durations and holds.
- The user can add a step and immediately place it on the timeline, then move,
  edit, duplicate, or delete it.
- Reordering is visual (moving steps on the timeline) and the displayed order is
  always the execution order.
- The user can hit play to see the sequence advance in real time, pause to stop
  it, and drag a playhead to scrub to any point and see the matching point in the
  sequence.
- Step targets that are invalid (missing pose/servo or out-of-limits position)
  are surfaced as errors and not saved, matching existing authoring behavior.
- The timeline shows speed and easing controls on steps once Brief 04 is in
  place.

## Constraints

- The underlying sequence model (ordered steps; pose-reference or direct-servo
  step kinds; movement duration and optional hold per step) from the existing
  Sequence Authoring capability is preserved — this feature changes how steps
  are edited, not what a step is.
- All existing step validation rules remain in force and are not weakened.
- The order of steps is meaningful and must be preserved as execution order.
- Playback and scrubbing must reflect the true saved sequence state and be
  timing-accurate; they must not show idealized or stale step data.
- The existing read-only sequence preview (constraint f) must continue to work,
  now reflecting the sequence as edited on the timeline. This feature does not
  remove that read-only inspection surface.
- No physical hardware is driven; playback/scrubbing is a visual/timeline
  representation only, consistent with the app's boundary (no real-time robot
  control).

## Basic acceptance expectations

- The user can add, reorder, edit, remove, and duplicate steps on a visual
  timeline, and the saved sequence matches what is shown.
- Step lengths on the timeline reflect movement durations and hold times.
- The user can play, pause, and scrub through the sequence, and scrubbing maps
  to the correct elapsed time given the steps' timing.
- The user cannot save an invalid step (missing pose/servo or out-of-limits
  position); the editor reports it.
- The read-only preview and simulator (Brief 05) show the sequence exactly as
  edited on the timeline.

## Notes / Clarifications

- Scope item (c) mentions both the editing surface (add/reorder/edit/remove/
  duplicate, play/pause/scrub) and, in the same sentence, "speed/easing
  controls." Per the Stage 2 decision, speed/easing is captured under Brief 04
  (Advanced Motion Timing); this brief includes speed/easing controls on steps
  only insofar as they appear on the timeline once Brief 04 defines them.
- Whether the timeline editor visually replaces the existing step-list
  authoring surface or sits alongside it is not fully specified. This brief
  assumes the timeline is the sequence editing surface and the existing
  read-only preview remains a separate inspection surface; this coexistence
  should be confirmed before implementation.