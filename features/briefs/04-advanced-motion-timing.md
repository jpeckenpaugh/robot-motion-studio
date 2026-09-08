# Brief 04: Advanced Motion Timing

## Purpose

Extend the existing timing model — where a step has a movement duration and an
optional hold — with two new capabilities: per-step speed and
acceleration/easing curves, and loop/repeat of a sequence or a group of steps.
Today all movement is implicitly constant-speed over the step's duration. This
feature lets a step specify how the movement progresses over time (not just how
long it takes) and lets a user repeat part or all of a sequence without
re-authoring the steps.

## Expected behavior

### Per-step speed and easing

- Each step in a sequence gains a speed control and an easing (acceleration)
  curve control, in addition to the existing movement duration and optional
  hold time.
- The user can set an easing curve per step that describes how the servo motion
  accelerates and decelerates over the step's movement duration, rather than
  always moving at constant speed. At minimum the app offers a constant-speed
  option (preserving today's behavior) and a set of easing options (e.g. ease
  in, ease out, ease in-out), so the user can choose how the motion ramps.
- The user can set a per-step speed. The speed and the movement duration
  together define how far the servo travels in the given time. The speed must be
  consistent with the movement duration so that a valid step always has a
  coherent speed and duration; the app enforces that both fields are valid and
  mutually consistent.
- Easing and speed apply to the movement portion of a step; the hold time (if
  any) is unaffected by easing and speed and simply holds the reached position.
- Existing steps without an explicit easing or speed value behave exactly as
  before (constant-speed over their movement duration), so previously authored
  sequences are not broken or changed in meaning.

### Loop / repeat

- The user can mark a sequence to repeat itself: a loop/repeat count that the
  whole sequence runs that many times (or an indication to run continuously),
  applied after the user triggers playback (Brief 03) or simulation (Brief 05).
- The user can also define a group of consecutive steps within a sequence and
  loop that group: the group runs a specified number of times (or continuously)
  before the sequence continues to the next step after the group.
- A loop is expressed as a repeat count plus, when defined on a group, the
  start and end of the group. The user can set these from the timeline editor
  (Brief 03) on either the whole sequence or a selected run of consecutive
  steps.
- Loop/repeat is part of the sequence's saved definition and is preserved in
  persistence and export, and honored during timeline playback and simulation.

### Interaction with existing behavior

- Playback (Brief 03) and simulation (Brief 05) honor per-step easing, speed,
  and any loop/repeat, so what the user sees matches the saved timing.
- The read-only sequence preview continues to show steps and their resolved
  servo targets in order; it additionally reflects the new timing fields
  (easing, speed, and loop/repeat) where relevant, without changing its
  read-only nature.
- JSON export continues to work and now includes the new per-step timing fields
  and any loop/repeat so the exported data fully represents the authored motion.
  Export operates per the multi-robot context (Brief 01).

## Inputs / outputs

- Inputs: per step, an easing curve choice and a speed; for a sequence or a
  selected group of consecutive steps, a loop/repeat count (or a continuous
  repeat indication) and, for a group, the group's boundaries.
- Outputs: a sequence whose steps carry speed and easing, and which (or which
  contains groups that) can repeat, all saved, persisted, exportable, and
  honored in playback and simulation.

## User-visible behavior

- The user can choose an easing curve and speed for any step and sees the
  choice reflected in the step's motion during playback/scrubbing/simulation
  (easing-affected, not constant-speed).
- The user can set a whole sequence or a selected group of steps to repeat and
  sees it loop the requested number of times when played or simulated.
- Steps authored without these fields behave exactly as constant-speed moves did
  before, so existing sequences still work unchanged.
- The user can see the new timing fields and loop/repeat in the read-only
  preview and in the exported JSON.

## Constraints

- The existing step model (movement duration and optional hold) is preserved and
  extended, not replaced; hold time is unaffected by speed/easing.
- A step must always have a valid, mutually consistent speed and movement
  duration; the app must not store a step with an incoherent speed/duration.
- Easing choices are finite, selectable options including a constant-speed
  option; a step always resolves to a defined easing behavior (defaulting to
  constant speed when none is set).
- Loop/repeat must be defined over a whole sequence or a contiguous group of
  steps, never over a non-contiguous set.
- All existing validation rules (valid targets, non-negative durations/holds)
  remain in force and are not weakened.
- Existing authored sequences must retain their meaning: steps without the new
  fields behave as constant-speed, non-looping, exactly as before. This feature
  must not change or break existing behavior.
- JSON export must continue to produce self-contained data usable by downstream
  robot-control software, now including the new timing and loop/repeat fields;
  it must not embed app-only implementation details.

## Basic acceptance expectations

- The user can set an easing curve and speed on a step and the exported data and
  playback reflect them.
- A step with no easing set behaves as a constant-speed move over its duration,
  preserving prior behavior.
- The user can loop a whole sequence and loop a group of steps a chosen number
  of times, and playback/simulation repeat accordingly.
- The user cannot create an incoherent speed/duration or a non-contiguous loop
  group.
- Existing sequences, preview, and export continue to work with the new fields
  present.

## Notes / Clarifications

- This resolves the Stage 2/1 open question on JSON export: the existing JSON
  export is extended (not replaced) to include the new per-step timing fields
  and loop/repeat, while keeping its existing shape and self-contained,
  Arduino-usable intent. Whether export covers all robots or only the selected
  robot is left open here; see Brief 05.
- The exact easing options and how speed is expressed numerically are not
  specified by scope. This brief fixes the behavioral contract: a constant-speed
  option plus selectable easing curves, and a per-step speed consistent with the
  movement duration. The concrete easing set and speed units are decided in a
  later stage.
- Loop/repeat with a finite count is in scope; a "run continuously" option is
  noted as an acceptable indicator where the scope's loop/repeat intent allows
  it, but a finite repeat count is the required baseline.