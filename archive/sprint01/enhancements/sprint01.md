# Sprint 01 — Multi-Robot, Timeline Editing, and Motion Simulation

## Sprint concept

The current application (v0.1) is a single-robot sequence designer. This sprint
expands it into a far more useful multi-robot motion design tool. The product
is a Robot Motion Designer: author, preview, and export precisely-timed servo
motion sequences for any robot you model — bipeds, quadrupeds, hexapods,
robotic arms, and actuator test rigs. It remains a local, single-user web app.

a. **Multi-robot management.** The app must support many robots, each with its
   own independent configuration (name, description, servo inventory, and
   per-servo calibration), not just one hard-coded sample robot. Users can
   create, edit, select, and work across multiple robots.

b. **New seed rig: door durability tester.** The default seed data must be a
   non-humanoid example: a wall-mounted servo arm with several servos
   (shoulder/pivot, elbow, wrist twist, and a gripper end-effector) that
   reaches to a door, grasps the door handle with the gripper, and opens and
   closes the door repeatedly over many cycles — a stress/durability test of
   the door's components. It includes the arm's servos with calibration and
   angle limits, a few named poses, and example motion sequences.

c. **Visual timeline editor.** The sequence editor must become a timeline-based
   editor: the user can add, reorder, edit, remove, and duplicate steps, and
   play/pause/scrub through the sequence on a timeline. Each step targets a
   pose or an individual servo, with movement duration, optional hold, and
   speed/easing controls.

d. **Advanced motion timing.** Steps must support per-step speed and
   acceleration/easing curves (not just constant-speed moves), and sequences or
   step groups must support loop/repeat.

e. **Motion simulation / preview.** The app must include a built-in simulator
   that renders the robot's servos and their motion (e.g. the wall-mounted arm
   grasping the handle and working the door) and plays sequences with
   timing-accurate scrubbing, so sequences can be inspected without hardware.

f. **Keep existing capabilities.** Pose management, sequence preview (read-only
   inspection of steps and resolved servo targets), local persistence across
   sessions, and structured JSON export of robot configuration and motion
   sequences must continue to work.

## Boundaries

- No direct physical Arduino/serial control, autonomous behavior, sensors, or
  real-time robot control in this pass.
- No multi-user or auth; stays local/single-user.
- No regression of existing v0.1 behavior that is outside this scope.
- Seed data behaves exactly like user-created data once present.