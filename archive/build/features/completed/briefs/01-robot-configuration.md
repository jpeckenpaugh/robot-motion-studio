# Brief 01: Robot Configuration

## Purpose

Let the user configure a robot and its servo motors so the rest of the app
(poses, sequences, export) operates against a concrete, defined robot. This is
the foundation every other capability builds on.

## Expected behavior

- The user works with a single current robot in the app.
- The robot has an identity/name and a collection of servo motors.
- The user can add a new servo motor to the robot, edit any of its fields, and
  remove it.
- Each servo motor is fully described by the following fields, all of which the
  user can view and edit:
  - a name (a user-assignable label identifying the servo),
  - a PWM pin/channel it is attached to,
  - angle limits (a minimum and a maximum angle the servo may be commanded to),
  - a neutral position (the servo's center/rest position, expressed as an
    angle),
  - pulse-width calibration values (the pulse widths that correspond to the
    defined angle limits, enabling conversion between commanded angle and the
    PWM pulse width sent to the servo).
- Removing a servo is possible. When a servo is referenced by other data (poses
  or sequence steps), the app prevents removal that would orphan or invalidate
  that data, or requires the user to resolve the references first. The app must
  not silently leave broken references.
- The configuration the user edits reflects the current state of the robot and
  feeds into the poses, sequences, preview, and export capabilities.

## Inputs / outputs

- Inputs: robot name; for each servo, a name, PWM pin/channel, min and max
  angle, neutral angle, and pulse-width calibration values (min-pulse and
  max-pulse widths).
- Outputs: the current, up-to-date robot configuration with its list of servos,
  viewable by the user and available to downstream capabilities (pose, preview,
  export).

## User-visible behavior

- The user sees a screen listing the robot and its servo motors with all fields
  shown.
- The user can create, edit, and delete servos through clear form controls and
  sees changes take effect immediately.
- When the user tries to delete a servo still referenced by a pose or sequence
  step, the app communicates why it cannot be deleted and what must change
  first; it does not silently drop the servo or the references.

## Constraints

- Each servo motor in the robot must have all required fields: name, PWM
  pin/channel, angle limits, neutral position, and pulse-width calibration.
- The neutral position and the commanded angles must stay within the defined
  angle limits.
- Each PWM pin/channel must be used by at most one servo (no two servos share
  the same pin/channel).
- Servo names must be unique within the robot so that servos can be referenced
  unambiguously elsewhere.
- Removing a servo must not be permitted while it is still referenced by a pose
  or a sequence step.
- These configuration capabilities are what downstream capabilities build on;
  the constraints here are not weakened by later features.

## Basic acceptance expectations

- The user can add at least one servo and set every field listed above.
- The user can edit any field and the new value is reflected when viewed again.
- The user cannot save a servo whose neutral position or commanded angles fall
  outside its angle limits, or whose name/pin conflicts with another servo.
- The user cannot delete a servo that a pose or sequence step still references,
  and receives a clear explanation when attempting to do so.
- The user can delete a servo that is not referenced anywhere, and that servo no
  longer appears in the configuration.
