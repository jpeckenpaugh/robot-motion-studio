# Brief 02: Pose Management

## Purpose

Let the user create and manage reusable named poses. A pose captures a set of
servo target positions under a single name so it can be reused as a target in
motion sequences.

## Expected behavior

- The user can create a new pose by giving it a name and choosing target
  positions for the robot's servo motors.
- A pose is defined by the set of target positions it assigns to the robot's
  servo motors. The user can specify which servos participate in the pose and
  what each participating servo's target angle/position is.
- The user can edit an existing pose: rename it or change which servos it sets
  and their target positions.
- The user can delete a pose. If a sequence step still references the pose, the
  app prevents deletion or requires the references to be resolved first; it must
  not silently leave a dangling pose reference in a sequence.
- Poses refer to servos by identity. If the underlying robot configuration
  changes, the pose's stored targets continue to refer to the intended servos
  wherever those servos still exist.
- Poses are usable by name as step targets within the Sequence Authoring
  capability.

## Inputs / outputs

- Inputs: a pose name; for each participating servo, an identification of that
  servo and its target position/angle.
- Outputs: the current set of named poses, each with its servo target positions,
  viewable and editable by the user and available to Sequence Authoring.

## User-visible behavior

- The user sees a list of existing poses and, for a selected pose, the list of
  servo target positions it contains.
- The user can create a pose, name it, and pick which servos and which target
  angles it sets.
- The user can edit any pose's name or servo targets and sees the result
  immediately.
- When the user tries to delete a pose still used by a sequence step, the app
  explains that the pose is in use and does not delete it until those uses are
  removed.

## Constraints

- A pose must have a unique name so it can be referenced unambiguously by name
  in sequences.
- Every servo target position stored in a pose must be a valid angle for that
  servo (within the servo's defined angle limits).
- Only servos that exist on the configured robot may be assigned a target in a
  pose.
- Deleting a pose that is referenced by a sequence step must not be allowed, or
  must require the user to remove those references first.
- Editing a pose must not silently alter the sequences that reference it; the
  change is reflected wherever the pose is used, in line with that pose's new
  definition.

## Basic acceptance expectations

- The user can create a named pose with target positions for one or more servos
  and can see it listed afterward.
- The user can rename a pose and change its servo targets, and the saved pose
  reflects those edits when reopened.
- The user cannot create two poses with the same name, or assign a servo target
  that is outside that servo's angle limits.
- The user cannot delete a pose that a sequence step references and is told why.
- The user can delete an unreferenced pose and it disappears from the pose list.
