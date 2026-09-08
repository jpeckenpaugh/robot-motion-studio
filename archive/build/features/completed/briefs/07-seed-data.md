# Brief 07: Seed Data

## Purpose

Provide a starting sample robot so a new user has meaningful, working content to
explore and build on immediately, rather than starting from an empty app. The
sample makes configuration, pose, sequence, preview, and export immediately
exercisable.

## Expected behavior

- On first use, the app comes pre-populated with a sample robot rather than
  being empty.
- The sample robot includes several servo motors, each with basic calibration
  values: for each servo, a name, a PWM pin/channel, angle limits, a neutral
  position, and pulse-width calibration values (as required by the Robot
  Configuration feature).
- The sample robot includes a few named poses, each defined as a set of servo
  target positions consistent with the sample servos (as required by the Pose
  Management feature).
- The sample robot includes one or more example motion sequences, each an
  ordered list of steps with valid targets (referencing the sample poses and/or
  servos) and valid movement durations and hold times (as required by the
  Sequence Authoring feature).
- All seed content is fully valid according to the same rules that apply to
  user-created content: servos have all required fields and valid ranges, poses
  target existing servos within their limits, and sequence steps reference
  existing poses/servos with valid timing.
- The seed data behaves exactly like user-created data: it can be viewed,
  edited, exported, and persists like any other content. It is not read-only or
  special-cased once present.

## Inputs / outputs

- Inputs: none from the user; the seed content is provided by the app on initial
  setup.
- Outputs: a ready-to-use sample robot comprising several servos with calibration
  values, a few named poses, and example motion sequences, present when the app
  is first used.

## User-visible behavior

- When the user first opens the app, they see the sample robot and its data
  already present — several servos, named poses, and example sequences — instead
  of an empty workspace.
- The user can open, inspect, and edit the sample servos, poses, and sequences
  just like content they created.
- The user can preview and export the sample sequences to see the app's features
  working against real example content.
- The sample data persists and is still present after reloading/returning,
  unless the user deliberately modifies or removes it.

## Constraints

- The seed robot must contain several servo motors, a few named poses, and
  example motion sequences; it must not be a single empty robot.
- Every seed servo must carry all required configuration fields (name, PWM
  pin/channel, angle limits, neutral position, pulse-width calibration) with
  valid values.
- Seed poses must reference only seed servos and stay within those servos' angle
  limits.
- Seed sequences must reference only existing seed poses/servos and carry valid
  movement durations and hold times.
- Seed content must comply with the same validation and persistence rules as
  user-authored content; it must not bypass them.
- The seed data is provided only for initial use/starting point; it must be
  editable like normal data and must not be hard-wired as permanent or
  undeletable content.

## Basic acceptance expectations

- On first use, the app already shows a sample robot with multiple servos, a few
  named poses, and example motion sequences.
- Each sample servo shows complete, valid calibration/configuration values.
- The sample poses and sequences are internally consistent (references resolve to
  existing sample servos/poses with valid angles and timing).
- The user can preview and export the sample sequences successfully.
- The sample content can be edited like user content and persists across reloads.
