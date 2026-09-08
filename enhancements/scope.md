# Enhancement Scope — Sprint 01

**Stage 1 — Enhancement Intake.**
Reference: `enhancements/sprint01.md`.

This pass turns the existing single-robot servo sequence designer into a
multi-robot motion design tool. It remains a local, single-user web app.

## Agreed scope

- **a. Multi-robot management — Feature**
  Support many robots at once, each with its own independent configuration
  (name, description, servo inventory, per-servo calibration). Users can
  create, edit, select, and work across multiple robots, instead of one
  hard-coded sample.

- **b. New seed rig: door durability tester — Feature**
  The default seed data becomes a non-humanoid example: a wall-mounted servo
  arm (shoulder/pivot, elbow, wrist twist, gripper end-effector) that reaches
  to a door, grasps the handle, and repeatedly opens/closes the door over many
  cycles — a door stress/durability test. It ships with the arm's calibrated
  servos and angle limits, a few named poses, and example motion sequences.

- **c. Visual timeline editor — Feature**
  The sequence editor becomes timeline-based: users can add, reorder, edit,
  remove, and duplicate steps, and play/pause/scrub through the sequence on a
  timeline. Each step targets a pose or an individual servo, with movement
  duration, optional hold, and speed/easing controls.

- **d. Advanced motion timing — Feature**
  Steps support per-step speed and acceleration/easing curves (not just
  constant-speed moves), and sequences or step groups support loop/repeat.

- **e. Motion simulation / preview — Feature**
  A built-in simulator renders the robot's servos and their motion (e.g. the
  wall-mounted arm grasping the handle and working the door) and plays
  sequences with timing-accurate scrubbing, so sequences can be inspected
  without hardware.

- **f. Keep existing capabilities — Constraint**
  Pose management, read-only sequence preview (inspection of steps and resolved
  servo targets), local persistence across sessions, and structured JSON export
  of robot configuration and motion sequences must continue to work.

## Constraints on the pass

- The app remains a local, single-user web app.
- Existing v0.1 capabilities (pose management, preview, persistence, JSON
  export) must keep working — no regression outside this scope.
- Seed data behaves exactly like user-created data once present (nothing marks
  it read-only).

## Boundaries on the pass

- **No** direct physical Arduino/serial control, autonomous behavior, sensors,
  or real-time robot control.
- **No** multi-user or authentication.
- **No** regression of existing v0.1 behavior that is outside this scope.

---

*Nothing has been added beyond the sprint concept; nothing from it has been
dropped. No implementation detail is specified here.*