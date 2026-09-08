# Brief 02: Door Durability Tester Seed Rig

## Purpose

Replace the existing single hard-coded sample robot with a new default seed rig
that demonstrates a non-humanoid, multi-robot context: a wall-mounted servo arm
intended to repeatedly open and close a door as a stress/durability test. It
gives a new user realistic, fully valid content (servos, poses, and example
sequences) to explore and build on, and it exercises the multi-robot feature by
being one robot record in the collection.

## Expected behavior

- On first use (when no persisted data exists yet), the app seeds exactly one
  robot: the door durability tester rig. It is created once on first run and is
  not re-created if the user deletes it or if persisted data already exists.
- The rig is non-humanoid and wall-mounted. It is a servo arm made of these
  joints/segments:
  - a shoulder / pivot joint at the mount,
  - an elbow joint,
  - a wrist-twist joint, and
  - a gripper end-effector that can reach to a door, grasp the handle, and
    repeatedly open and close the door.
- The rig ships with a calibrated servo inventory: for each servo, all of the
  required servo fields already defined (name, PWM pin/channel, angle limits, a
  neutral position, and pulse-width calibration values). The servo names and
  angle limits reflect the arm's joints and its reach to the door handle.
- The rig ships with a few named poses, each a set of servo target positions on
  the rig's servos within their angle limits. These represent useful arm
  configurations for the door test (e.g. reaching the handle, gripping,
  opening, closing, resting) so the example sequences are meaningful.
- The rig ships with one or more example motion sequences. Each is an ordered
  list of steps that reference the rig's named poses and/or servos with valid
  targets and valid movement durations and hold times, and that together
  illustrate the door open/close cycle being repeated.
- The seed rig behaves exactly like user-created data once present. It can be
  viewed, edited, selected, deleted, persisted, previewed, simulated, and
  exported like any other robot. Nothing marks it read-only or undeletable. If
  the user deletes it, it is gone like any user-deleted robot.
- The seed rig must conform to the same validation and persistence rules as
  user-authored content; it must not bypass them.

## Inputs / outputs

- Inputs: none from the user; the seed rig is provided by the app on initial
  setup.
- Outputs: a ready-to-use robot in the collection comprising a door-durability-
  tester arm with calibrated servos, a few named poses, and example motion
  sequences, present on first use.

## User-visible behavior

- When the user first opens the app, the collection already contains the door
  durability tester rig, rather than a humanoid sample or an empty workspace.
- The user can select, inspect, and edit the rig's name, description, servos,
  poses, and sequences exactly as they would any robot they created.
- The user can preview, simulate, and export the rig's example sequences to see
  the app's features working against realistic content.
- The rig persists across reloads and sessions like any other data, unless the
  user deliberately modifies or removes it.
- If the user deletes the rig, it does not reappear on reload; the app does not
  silently recreate seed content after it has been deleted.

## Constraints

- The seed must contain exactly one robot (the rig) on first run, and must not
  re-seed if persisted data already exists (including if the rig was previously
  deleted by the user).
- The rig must include the four articulated elements described (shoulder/pivot,
  elbow, wrist twist, gripper), reflected in its servo inventory.
- Every seed servo must carry all required configuration fields with valid
  values, per the Robot Configuration rules.
- Seed poses must reference only the rig's servos and stay within those servos'
  angle limits.
- Seed sequences must reference only the rig's existing poses/servos and carry
  valid movement durations and hold times.
- Seed content must comply with the same validation and persistence rules as
  user-authored content and must not be read-only, undeletable, or special-cased
  once present.

## Basic acceptance expectations

- On first use, the app shows the door durability tester rig in the robot
  collection with a non-humanoid arm (shoulder/pivot, elbow, wrist twist,
  gripper) and multiple servos.
- Each seed servo shows complete, valid calibration values.
- The seed poses and sequences are internally consistent (references resolve to
  existing rig servos/poses with valid angles and timing) and visibly represent
  the door open/close durability cycle.
- The user can preview, simulate, and export the rig's sequences successfully.
- The rig can be edited and deleted like user content, persists across reloads,
  and does not reappear after the user deletes it.

## Notes / Clarifications

- The exact number of servos, the exact servo names, and the exact set of poses
  and example sequences are not specified by scope. This brief fixes the
  behavioral contract: one seeded rig on first run, with the four arm elements
  represented by its servo inventory, valid calibrated servos, a few named
  poses, and example sequences illustrating the door open/close cycle. The
  concrete seed content is decided during a later content/implementation stage.
- This resolves the Stage 2 open question: the seed rig is created once on first
  run and is then a normal, editable, deletable robot record in the multi-robot
  collection like any other.