# Robot Motion Designer

A multi-robot servo motion sequence designer for Arduino-based robots: a tool
for authoring, previewing, and exporting precisely-timed servo motion sequences
for any robot you model — from bipeds and quadrupeds to hexapods, robotic arms,
and actuator test rigs.

## Target user

Robotics hobbyists, researchers, and engineers who need to design, refine, and
reuse servo motion programs for physical robots without writing code, and who
want to validate timing and motion before (or instead of) flashing hardware.

## Default baseline stack

Web App / Bootstrap frontend / FastAPI+SQLite backend (local, single-user).
A starting template; the user may substitute.

## Seed data

A sample "door durability test rig": a wall-mounted servo arm with several
servos — shoulder/pivot, elbow, wrist twist, and a gripper end-effector — that
reaches to a door, grasps the handle (with the gripper, not a hand), and opens
and closes the door repeatedly over many cycles, as a stress/durability test of
the door's components. Includes the arm, its servos with calibration and angle
limits, a few named poses, and example motion sequences. Seed data behaves
exactly like user-created data.

## Capabilities

- **Robot management** — create and manage multiple robots (name, description,
  servo inventory with names, PWM pins/channels, angle limits, neutral
  positions, and pulse-width calibration), each with its own independent
  configuration.
- **Pose management** — define reusable named poses from per-servo target
  positions.
- **Sequence authoring** — a visual timeline editor to build ordered, timed
  sequences: add, reorder, edit, remove, duplicate, and play/pause-scrub steps;
  each step targets a pose or individual servo, with movement duration, optional
  hold, and speed/easing controls.
- **Advanced motion timing** — per-step speed and acceleration/easing curves
  (not just constant-speed moves), plus loop/repeat of sequences or step groups.
- **Motion simulation / preview** — a built-in simulator that renders the
  robot's servos and their motion (e.g. the wall-mounted arm grasping the handle
  and working the door) and plays sequences with timing-accurate scrubbing, so
  sequences can be inspected without hardware.
- **Sequence preview** — read-only inspection of a sequence's steps and resolved
  servo targets.
- **Persistence** — all robots, poses, and sequences stored locally and restored
  across sessions.
- **Export** — structured JSON representation of robot configuration and motion
  sequences for use by Arduino firmware or other robot-control software.

Out of scope for this pass: direct physical Arduino/serial control, autonomous
behavior, sensors, real-time robot control, and multi-user/auth.