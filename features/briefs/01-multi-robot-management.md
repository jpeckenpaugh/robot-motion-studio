# Brief 01: Multi-Robot Management

## Purpose

Extend the existing single-current-robot app into one that can work with many
robots at once. Today the user works against one hard-coded robot and its
servos. This feature makes the robot a user-managed, selectable record in a
collection, so poses, sequences, preview, export, and simulation all operate
against whichever robot is currently selected. It is the foundation the other
new features build on: the seed rig, timeline editor, timing, and simulation
all act within the context of a selected robot.

## Expected behavior

- The app exposes a collection of robots rather than a single hard-coded one.
- Each robot has its own independent configuration, consisting of:
  - a name,
  - a description,
  - a servo inventory (the servos belonging to that robot, each with all of
    the servo fields already defined by the existing Robot Configuration
    capability: name, PWM pin/channel, angle limits, neutral position, and
    pulse-width calibration), and
  - per-servo calibration (part of each servo's configuration above).
- The user can create a new robot, giving it a name and description and
  defining its servo inventory.
- The user can select any robot as the "current" robot. Selecting a robot makes
  that robot's configuration, poses, and sequences the active working set for
  every other capability (pose management, sequence authoring, preview, export,
  timeline editor, timing, simulation).
- The user can edit a robot's name, description, and servo inventory. Editing a
  robot's servo inventory follows the same rules already defined for servos
  (unique servo names within the robot, unique PWM pin/channel, neutral and
  commanded angles within limits, no deletion while referenced by a pose or
  sequence).
- The user can delete a robot. Deleting a robot removes its poses and sequences
  with it, because those belong to that robot. Before deleting, the app makes
  clear that the robot's poses and sequences will be removed, and requires
  confirmation. The app must not leave references pointing at a deleted robot.
- Poses and sequences belong to a single robot. A pose sets targets only for
  servos on the robot it belongs to; a sequence step references only poses or
  servos on the same robot. When the user switches the selected robot, they see
  that robot's own poses and sequences, not another robot's.
- Seed data (the door durability tester rig, Brief 02) is one robot in this
  collection like any other and is subject to the same rules.
- When the app first opens, the user is returned to the robot that was selected
  at the end of their last session (persisted), matching the existing
  persistence behavior.

## Inputs / outputs

- Inputs: a robot name and description; for each servo, all the servo
  configuration fields already defined (name, PWM pin/channel, angle limits,
  neutral position, pulse-width calibration); a selection of which robot is
  current.
- Outputs: a user-managed, persistent collection of robots, each with its own
  configuration, poses, and sequences; and a clearly indicated current robot
  that downstream capabilities act on.

## User-visible behavior

- The user sees a way to switch between and manage multiple robots (e.g. a list
  of robots and controls to create, select, edit, and delete them), instead of
  a single fixed robot.
- The current robot is always visible and clearly identified so the user knows
  which configuration, poses, and sequences they are working with.
- Switching robots changes the servo list, poses, and sequences shown to that
  robot's own data.
- When the user creates a robot, it appears in the collection and can be
  selected immediately.
- When the user edits a robot's servo inventory, the same servo validation and
  deletion-protection behavior already present today applies unchanged.
- When the user deletes a robot, the app warns that the robot and its poses and
  sequences will be removed, and the user must confirm before it happens.

## Constraints

- Every robot must have a name and description; servo names must be unique
  within each robot, and each PWM pin/channel used by at most one servo per
  robot, matching the existing Robot Configuration rules.
- All existing servo validation rules are unchanged; nothing here weakens them.
- Poses and sequences are scoped to a single robot and may only reference data
  on that same robot. Referencing across robots is not allowed.
- Deleting a robot must not silently break references elsewhere; the robot's own
  poses and sequences are removed with it, with user confirmation, and no
  cross-robot reference may remain.
- Existing v0.1 capabilities (pose management, read-only sequence preview,
  persistence, JSON export) must continue to work, now operating on the
  currently selected robot. No regression outside this scope.
- The app remains a local, single-user web app; no multi-user or authentication.

## Basic acceptance expectations

- The user can create two or more robots and give each a different name,
  description, and servo inventory.
- The user can switch between robots and sees each robot's own servos, poses,
  and sequences, not another robot's.
- The user can edit and delete a robot; deletion requires confirmation and
  removes that robot's poses and sequences.
- A pose or sequence created for one robot cannot reference servos or poses of a
  different robot.
- After reloading, the user is returned to the same set of robots and the same
  current robot they had before.

## Notes / Clarifications

- The existing app was described as having a "single current robot." This brief
  treats that as becoming the currently selected robot within the new
  collection; all existing single-robot behavior applies to the selection.
- Whether the existing JSON export covers all robots or only the selected robot
  is addressed in Briefs 04 and 05; the export must keep working (constraint f).