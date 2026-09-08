# Brief 03: Sequence Authoring

## Purpose

Provide the user with an editor to compose ordered, timed motion sequences out
of steps. A sequence is a reusable, ordered list of steps that the robot would
perform one after another.

## Expected behavior

- The user can create a new sequence and give it a name.
- A sequence is an ordered list of steps. The user can add, reorder, edit, and
  remove steps at any point in the list.
- Each step is one of two kinds, both of which must be supported:
  1. a step referencing a named pose (moving all servos to that pose's targets),
     or
  2. a direct movement targeting a single individual servo position.
- Each step carries two timing fields:
  - a movement duration (how long the motion to the target takes), and
  - an optional hold time (how long the robot holds the reached position before
    the next step begins). A hold time of zero/absent means no hold.
- The user can edit any step to change its kind, its target (pose or individual
  servo + position), its movement duration, or its hold time.
- The user can reorder steps; the sequence order always reflects the order in
  which steps would be executed.
- Steps that target a named pose must reference a pose that exists; steps that
  target an individual servo must reference a servo that exists and a valid
  position for it. The editor prevents or flags invalid step targets rather than
  storing broken steps.
- Sequences are the primary object that the Preview, Export, and Persistence
  capabilities operate on.

## Inputs / outputs

- Inputs: a sequence name; an ordered set of steps, each with a kind (pose
  reference or direct servo movement), its target, a movement duration, and an
  optional hold time.
- Outputs: a complete, ordered, named motion sequence with all steps defined,
  viewable and editable by the user and available to Preview, Export, and
  Persistence.

## User-visible behavior

- The user sees a sequence editor showing the sequence's ordered list of steps,
  each step displaying its target and its timing.
- The user can add steps, choose pose-vs-direct for each step, choose the pose
  or the individual servo and position, and set a movement duration and an
  optional hold time.
- The user can drag/reorder steps or otherwise change their order, and the list
  reflects the new execution order immediately.
- The user can remove any step and edits any step's details with the change
  showing immediately.
- If the user tries to create a step referencing a pose or servo that does not
  exist or a position outside the servo's limits, the editor surfaces an error
  and does not save the invalid step.

## Constraints

- A sequence must have a name and an ordered list of steps.
- Every step must resolve to a valid target: an existing named pose, or an
  existing servo with a position within that servo's angle limits.
- Movement duration must be a valid, non-negative measure of time; hold time is
  optional and, when present, must be a valid non-negative measure of time.
- Both supported step kinds (named-pose reference and direct individual servo
  movement) must remain usable; a sequence may freely mix the two kinds.
- The order of steps is meaningful and must be preserved as the execution order.
- Editing a sequence must not silently drop, merge, or reorder steps the user
  did not intend to change.

## Basic acceptance expectations

- The user can create a named sequence and add steps of both kinds (pose
  reference and direct servo movement).
- The user can set each step's movement duration and optional hold time.
- The user can reorder steps and verify the stored order matches the displayed
  order.
- The user can edit and remove any step.
- The user cannot save a step that targets a missing pose or servo, or a servo
  position outside the servo's angle limits; the editor reports it rather than
  accepting it.
