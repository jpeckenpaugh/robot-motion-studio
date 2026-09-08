/* First-run seed data — the door durability tester rig (ported from
 * backend/app/seed.py, brief 02; §9.7). On a FRESH workspace (app_state.seeded
 * = 0) this seeds exactly one robot: a wall-mounted, non-humanoid servo arm
 * that reaches to a door handle and repeatedly opens/closes the door. It is
 * created once on first run and then behaves exactly like user-created data.
 *
 * All concrete content below is backend-authored default content (the backend
 * fixed the shape/quantity, not the names/values); see seed.py for provenance.
 */
import { rows, one, run, lastId } from './engine.js';

const DESCRIPTION =
  'Wall-mounted door durability tester: a servo arm that reaches to the door ' +
  'handle, grips it, and repeatedly opens and closes the door to stress-test ' +
  'the hinges and closer over many cycles.';

// (name, pwm_pin, angle_min, angle_max, neutral_angle, pulse_min_us, pulse_max_us)
const SERVOS = [
  ['shoulder', 2, -90.0, 90.0, 0.0, 500, 2500],   // pivot at the wall mount
  ['elbow', 3, 0.0, 120.0, 45.0, 500, 2500],      // vertical reach to the handle
  ['wrist', 4, -90.0, 90.0, 0.0, 500, 2500],      // wrist twist
  ['gripper', 5, 0.0, 60.0, 30.0, 500, 2500],     // open/close end-effector
];

const SIM_CONFIG = {
  kind: 'arm-chain',
  anchor: { x: 0, y: 0, z: 120 },
  joints: [
    { servo_name: 'shoulder', segment_len: 45 },
    { servo_name: 'elbow', segment_len: 40 },
    { servo_name: 'wrist', segment_len: 10 },
  ],
  gripper: { servo_name: 'gripper', jaw_len: 8 },
  environment: {
    wall: { x: 0 },
    door: { frame_width: 90, frame_height: 200, open_axis: 'z' },
    handle: { x: 150, y: 0, z: 100, reach_angle: -30 },
  },
};

// Servo indices referenced by name below for readability.
const SHOULDER = 0;
const ELBOW = 1;
const WRIST = 2;
const GRIPPER = 3;

export function seed() {
  const robotId = insertRobot('DoorDurabilityRig', DESCRIPTION, SIM_CONFIG);
  const servoIds = SERVOS.map((s) => insertServo(robotId, s));

  // (pose_name, [[servo_index, angle], ...]) -- angles within each servo's limits.
  const poses = [
    ['rest', [[SHOULDER, 0.0], [ELBOW, 20.0], [WRIST, 0.0], [GRIPPER, 30.0]]],
    ['reach_handle', [[SHOULDER, -30.0], [ELBOW, 90.0], [WRIST, 0.0], [GRIPPER, 30.0]]],
    ['grip_handle', [[SHOULDER, -30.0], [ELBOW, 95.0], [WRIST, -20.0], [GRIPPER, 10.0]]],
    ['door_open', [[SHOULDER, -45.0], [ELBOW, 110.0], [WRIST, 40.0], [GRIPPER, 10.0]]],
    ['door_closed', [[SHOULDER, -15.0], [ELBOW, 80.0], [WRIST, -30.0], [GRIPPER, 10.0]]],
  ];
  const poseIds = {};
  for (const [name, targets] of poses) {
    poseIds[name] = insertPose(robotId, name, targets.map(([i, ang]) => [servoIds[i], ang]));
  }

  // door_cycle: the open/close durability cycle, looped via a step group.
  // Speeds are pre-derived constant speeds consistent with each step's resolved
  // travel (degrees) over its duration (ms); easing is illustrative.
  const doorCycleId = insertSequence(robotId, 'door_cycle', [
    ['pose', 'reach_handle', 800, 200, 56.25, 'linear'],
    ['pose', 'grip_handle', 400, 300, 50.0, 'ease_in'],
    ['pose', 'door_open', 1200, 500, 50.0, 'ease_out'],
    ['pose', 'door_closed', 1200, 500, 58.33, 'ease_in_out'],
  ]);
  insertGroup(doorCycleId, 'open_close_cycle', 25, 0);

  // grip_and_release: per-step speed/easing on direct servo moves + sequence
  // repeat. Speeds are pre-derived constant speeds consistent with each step's
  // travel (degrees) over its duration (ms); easing is illustrative.
  insertSequence(robotId, 'grip_and_release', [
    ['servo', GRIPPER, 10.0, 300, 200, 66.7, 'ease_in_out'],
    ['servo', GRIPPER, 60.0, 400, 100, 125.0, 'linear'],
    ['pose', 'rest', 600, 100, 50.0, 'ease_out'],
  ], 5, 0);

  return robotId;
}

function insertRobot(name, description, simConfig) {
  run(
    'INSERT INTO robots (name, description, sim_config) VALUES (?, ?, ?)',
    [name, description, JSON.stringify(simConfig)],
  );
  return lastId();
}

function insertServo(robotId, s) {
  const [name, pin, amin, amax, neutral, pmin, pmax] = s;
  run(
    `INSERT INTO servos
       (robot_id, name, pwm_pin, angle_min, angle_max, neutral_angle,
        pulse_min_us, pulse_max_us)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [robotId, name, pin, amin, amax, neutral, pmin, pmax],
  );
  return lastId();
}

function insertPose(robotId, name, targets) {
  run('INSERT INTO poses (robot_id, name) VALUES (?, ?)', [robotId, name]);
  const poseId = lastId();
  for (const [servoId, angle] of targets) {
    run('INSERT INTO pose_targets (pose_id, servo_id, angle) VALUES (?, ?, ?)', [poseId, servoId, angle]);
  }
  return poseId;
}

function insertSequence(robotId, name, steps, repeatCount = null, repeatForever = 0) {
  run(
    'INSERT INTO sequences (robot_id, name, repeat_count, repeat_forever) VALUES (?, ?, ?, ?)',
    [robotId, name, repeatCount, repeatForever],
  );
  const seqId = lastId();
  for (const position of steps.keys()) {
    const step = steps[position];
    const kind = step[0];
    if (kind === 'pose') {
      const [, poseName, durationMs, holdMs, speed, easing] = step;
      run(
        `INSERT INTO sequence_steps
           (sequence_id, position, kind, pose_id, servo_id, angle,
            duration_ms, hold_ms, speed, easing)
         VALUES (?, ?, 'pose', ?, NULL, NULL, ?, ?, ?, ?)`,
        [seqId, position, lookupPose(robotId, poseName), durationMs, holdMs, speed, easing],
      );
    } else {
      const [, servoIndex, angle, durationMs, holdMs, speed, easing] = step;
      run(
        `INSERT INTO sequence_steps
           (sequence_id, position, kind, pose_id, servo_id, angle,
            duration_ms, hold_ms, speed, easing)
         VALUES (?, ?, 'servo', NULL, ?, ?, ?, ?, ?, ?)`,
        [seqId, position, servoIndexToId(robotId, servoIndex), angle, durationMs, holdMs, speed, easing],
      );
    }
  }
  return seqId;
}

function lookupPose(robotId, name) {
  return one('SELECT id FROM poses WHERE robot_id = ? AND name = ?', [robotId, name]).id;
}

function servoIndexToId(robotId, index) {
  return rows(
    'SELECT id FROM servos WHERE robot_id = ? ORDER BY id LIMIT 1 OFFSET ?',
    [robotId, index],
  )[0].id;
}

function insertGroup(seqId, name, repeatCount, repeatForever) {
  const members = rows(
    'SELECT id FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id',
    [seqId],
  );
  run(
    'INSERT INTO step_groups (sequence_id, name, repeat_count, repeat_forever) VALUES (?, ?, ?, ?)',
    [seqId, name, repeatCount, repeatForever],
  );
  const groupId = lastId();
  for (const m of members) {
    run('INSERT INTO step_group_members (step_id, group_id) VALUES (?, ?)', [m.id, groupId]);
  }
  return groupId;
}