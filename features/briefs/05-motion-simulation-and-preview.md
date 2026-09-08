# Brief 05: Motion Simulation and Preview

## Purpose

Add a built-in simulator that visually renders a selected robot's servos and
their motion — for example the wall-mounted door durability tester arm reaching
to, grasping, and working the door handle — and plays sequences with
timing-accurate scrubbing, so the user can inspect a sequence's motion without
hardware. This is distinct from the existing read-only sequence preview, which
is a static inspection of steps and resolved servo targets. The simulator is a
visual, animated, browser-rendered representation of that same saved sequence;
it coexists with, and reflects, the read-only preview and the timeline editor.

## Expected behavior

- The user can select any robot and, for a sequence on that robot, open the
  simulator to see a visual representation of the robot and its servos.
- The simulator renders the robot's servos and joints so the user can see the
  arm move, including a representation of the robot's environment relevant to
  the sequence (for the door rig, a wall, the door, and the handle the gripper
  reaches and works). The rendering is a browser visualization only; it does not
  require hardware and is not real-time robot control.
- The simulator plays a sequence: servos move through the steps in execution
  order and in real time, honoring each step's movement duration, hold time,
  easing, and speed (Brief 04).
- The user can pause playback and scrub a playhead across the sequence
  timeline, exactly as in the timeline editor, and the rendered robot reflects
  the pose at the scrubbed time. Scrubbing is timing-accurate: the pose shown
  matches the elapsed time from sequence start given the steps' durations,
  holds, and easing.
- The simulator honors loop/repeat (Brief 04): a looping sequence or a looping
  group of steps is rendered repeating the requested number of times.
- The simulator shows the same saved sequence state as the timeline editor and
  the read-only preview. Editing the sequence (in the timeline) is reflected in
  the simulator when it is reopened or re-synced, and the read-only preview and
  simulator always agree on the sequence's steps and timing.
- The simulator is not an editing surface for the sequence: the user cannot
  modify the sequence from within it. Editing happens in the timeline editor
  (Brief 03).
- For a pose-based step, the simulator resolves the pose to the servo positions
  it sets and animates those servos, consistent with the read-only preview's
  treatment of pose references.
- The simulator is read-only with respect to the sequence and must not perform
  or claim to perform physical robot motion; it is inspection/simulation only.

## Inputs / outputs

- Inputs: a user selection of a robot and a sequence, and play, pause, and scrub
  actions.
- Outputs: a visual, animated, browser-rendered representation of the robot's
  servos and their motion over the sequence, honoring timing, easing, speed, and
  loop/repeat, in sync with the saved sequence state.

## User-visible behavior

- The user opens the simulator and sees the selected robot's servos/arm rendered
  in the browser, with the rig's environment (wall, door, handle) shown for the
  door durability tester.
- Pressing play animates the arm through the sequence in real time; the gripper
  reaches, grasps, and works the door handle as the sequence directs.
- The user can pause and scrub the playhead to any point and sees the arm in the
  pose corresponding to that exact elapsed time, with easing and holds
  respected.
- The rendered motion visibly differs from constant-speed when a step has an
  easing curve (ramps in/out), and the sequence or group repeats the configured
  number of times when looped.
- The user cannot edit the sequence from the simulator; edits happen in the
  timeline editor and the simulator reflects them.
- The read-only preview remains available as a separate static step/target
  inspection and stays consistent with the simulator and the edited sequence.

## Constraints

- The simulator must reflect the current saved sequence state and the referenced
  robot configuration and poses; it must not show stale or idealized data.
- Playback and scrubbing must be timing-accurate, honoring movement duration,
  hold, speed, easing, and loop/repeat.
- The simulator is read-only with respect to the sequence: no editing, no
  non-destructive side effects on the sequence.
- It must not perform, simulate-claim to perform, or depend on any physical
  robot motion or hardware; it is a browser visualization, consistent with the
  app's boundary (no real-time robot control, no Arduino/serial).
- The existing read-only sequence preview (constraint f) must continue to work
  and coexist with the simulator; the simulator adds a visual/animated layer on
  top of the same sequence data and does not remove the preview.
- The simulator must represent the robot faithfully enough that the user can see
  the servos' motion (including the rig's wall/door/handle context); it must
  not misrepresent the configured servos or their angle limits.
- The app remains a local, single-user web app.

## Basic acceptance expectations

- The user can open the simulator for a sequence and sees the selected robot's
  servos rendered and animating through the steps.
- For the door rig, the user can see the arm reach, grasp, and work the door
  handle in line with the sequence.
- Play, pause, and scrub work, and the rendered pose at a scrubbed time matches
  the true elapsed time including holds and easing.
- Looping sequences/groups repeat the configured number of times.
- The simulator agrees with the read-only preview on the sequence's steps and
  timing, and reflects edits made in the timeline editor.
- The user cannot modify the sequence from within the simulator.

## Notes / Clarifications

- The scope calls the render "3D." This brief intentionally describes only the
  desired user-visible behavior (a browser visualization of servos and their
  motion, plus the rig's wall/door/handle context) and does not prescribe any
  specific rendering library or whether it is 2D or 3D. That decision is left to
  the implementation stage.
- This resolves the Stage 2/1 open question on the preview relationship: the
  existing read-only sequence preview (static step + resolved-target inspection)
  continues to work and coexists with the new simulator (animated visual
  playback). The timeline editor (Brief 03) is the editing surface; the preview
  and simulator are both read-only views of the same saved sequence.
- This also notes the export context: per Brief 04, JSON export is extended to
  include the new timing and loop/repeat fields. Whether export covers all
  robots or only the selected robot is still to be confirmed in a later stage;
  the multi-robot management (Brief 01) treats export as operating on the
  current robot's data at minimum.