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

  // Additional demo robots (full metadata; see DEMO_ROBOTS).
  for (const demo of DEMO_ROBOTS) {
    seedDemoRobot(demo);
  }

  return robotId;
}

// ---------------------------------------------------------------------------
// Additional demo robots. Each entry mirrors the Python _DEMO_ROBOTS in
// backend/app/seed.py: a complete, self-consistent robot with servos,
// sim_config, poses, and sequences (with optional repeats + step groups).
// ---------------------------------------------------------------------------

const DEMO_ROBOTS = [
  {
    name: 'PickPlaceArm',
    description: 'A 6-DOF articulated pick-and-place arm: rotating base, shoulder, ' +
      'elbow, wrist pitch, wrist roll, and a two-jaw gripper. Demonstrates ' +
      'multi-axis coordination for moving objects between locations.',
    servos: [
      ['base_rotate', 2, -180.0, 180.0, 0.0, 500, 2500],
      ['shoulder', 3, 0.0, 180.0, 90.0, 500, 2500],
      ['elbow', 4, 0.0, 150.0, 60.0, 500, 2500],
      ['wrist_pitch', 5, -90.0, 90.0, 0.0, 500, 2500],
      ['wrist_roll', 6, -180.0, 180.0, 0.0, 500, 2500],
      ['gripper', 7, 0.0, 60.0, 30.0, 500, 2500],
    ],
    sim_config: {
      kind: 'arm-chain',
      anchor: { x: 0, y: 0, z: 80 },
      joints: [
        { servo_name: 'base_rotate', segment_len: 10 },
        { servo_name: 'shoulder', segment_len: 55 },
        { servo_name: 'elbow', segment_len: 45 },
        { servo_name: 'wrist_pitch', segment_len: 12 },
        { servo_name: 'wrist_roll', segment_len: 6 },
      ],
      gripper: { servo_name: 'gripper', jaw_len: 9 },
      environment: {
        pick_zone: { x: 40, z: 60 },
        place_zone: { x: 120, z: 60 },
      },
    },
    poses: {
      home: [[0, 0.0], [1, 90.0], [2, 60.0], [3, 0.0], [4, 0.0], [5, 30.0]],
      reach_pick: [[0, 30.0], [1, 70.0], [2, 80.0], [3, -20.0], [4, 0.0], [5, 30.0]],
      grip: [[0, 30.0], [1, 70.0], [2, 80.0], [3, -20.0], [4, 0.0], [5, 10.0]],
      lift: [[0, 30.0], [1, 55.0], [2, 60.0], [3, -10.0], [4, 0.0], [5, 10.0]],
      carry: [[0, 90.0], [1, 55.0], [2, 60.0], [3, -10.0], [4, 60.0], [5, 10.0]],
      place: [[0, 120.0], [1, 65.0], [2, 85.0], [3, -15.0], [4, 60.0], [5, 10.0]],
      release: [[0, 120.0], [1, 65.0], [2, 85.0], [3, -15.0], [4, 60.0], [5, 30.0]],
    },
    sequences: [
      {
        name: 'pick_and_place',
        steps: [
          ['pose', 'reach_pick', 900, 150, 33.3, 'ease_out'],
          ['pose', 'grip', 500, 250, 40.0, 'ease_in'],
          ['pose', 'lift', 700, 150, 50.0, 'ease_out'],
          ['pose', 'carry', 1200, 200, 41.7, 'ease_in_out'],
          ['pose', 'place', 800, 150, 56.3, 'ease_out'],
          ['pose', 'release', 400, 200, 50.0, 'linear'],
        ],
        repeat_count: 2,
        repeat_forever: 0,
        groups: [
          { name: 'grip_cycle', step_positions: [1, 2, 3, 4], repeat_count: 3, repeat_forever: 0 },
        ],
      },
    ],
  },
  {
    name: 'QuadTrotter',
    description: 'A quadruped with two servos per leg (hip and knee). Demonstrates ' +
      'coordination of diagonal limb pairs for a trot gait and a crouch/sit posture set.',
    servos: [
      ['FL_hip', 2, -45.0, 45.0, 0.0, 500, 2500],
      ['FL_knee', 3, 0.0, 120.0, 60.0, 500, 2500],
      ['FR_hip', 4, -45.0, 45.0, 0.0, 500, 2500],
      ['FR_knee', 5, 0.0, 120.0, 60.0, 500, 2500],
      ['BL_hip', 6, -45.0, 45.0, 0.0, 500, 2500],
      ['BL_knee', 7, 0.0, 120.0, 60.0, 500, 2500],
      ['BR_hip', 8, -45.0, 45.0, 0.0, 500, 2500],
      ['BR_knee', 9, 0.0, 120.0, 60.0, 500, 2500],
    ],
    sim_config: {
      kind: 'leg-chain',
      anchor: { x: 0, y: 0, z: 70 },
      joints: [
        { servo_name: 'FL_hip', segment_len: 30 },
        { servo_name: 'FL_knee', segment_len: 28 },
        { servo_name: 'FR_hip', segment_len: 30 },
        { servo_name: 'FR_knee', segment_len: 28 },
        { servo_name: 'BL_hip', segment_len: 30 },
        { servo_name: 'BL_knee', segment_len: 28 },
        { servo_name: 'BR_hip', segment_len: 30 },
        { servo_name: 'BR_knee', segment_len: 28 },
      ],
      gripper: null,
      environment: { ground: { z: 0 } },
    },
    poses: {
      stand: [[0, 0.0], [1, 60.0], [2, 0.0], [3, 60.0], [4, 0.0], [5, 60.0], [6, 0.0], [7, 60.0]],
      crouch: [[0, 0.0], [1, 80.0], [2, 0.0], [3, 80.0], [4, 0.0], [5, 80.0], [6, 0.0], [7, 80.0]],
      trot_diag1: [[0, 25.0], [1, 50.0], [2, -25.0], [3, 50.0], [4, -25.0], [5, 50.0], [6, 25.0], [7, 50.0]],
      trot_diag2: [[0, -25.0], [1, 50.0], [2, 25.0], [3, 50.0], [4, 25.0], [5, 50.0], [6, -25.0], [7, 50.0]],
    },
    sequences: [
      {
        name: 'trot_gait',
        steps: [
          ['pose', 'trot_diag1', 400, 100, 62.5, 'ease_out'],
          ['pose', 'trot_diag2', 400, 100, 125.0, 'ease_out'],
          ['pose', 'trot_diag1', 400, 100, 125.0, 'ease_out'],
          ['pose', 'trot_diag2', 400, 100, 125.0, 'ease_out'],
        ],
        repeat_count: 3,
        repeat_forever: 0,
        groups: [],
      },
      {
        name: 'crouch_and_stand',
        steps: [
          ['pose', 'crouch', 800, 300, 37.5, 'ease_in_out'],
          ['pose', 'stand', 700, 200, 42.9, 'ease_out'],
        ],
        repeat_count: 2,
        repeat_forever: 0,
        groups: [],
      },
    ],
  },
  {
    name: 'BipedWalker',
    description: 'A two-legged walker with hip, knee, and ankle on each leg. ' +
      'Demonstrates weight-shifting and alternating leg swings for a walking ' +
      'step, plus a crouch and a lunge.',
    servos: [
      ['L_hip', 2, -30.0, 30.0, 0.0, 500, 2500],
      ['L_knee', 3, 0.0, 130.0, 30.0, 500, 2500],
      ['L_ankle', 4, -20.0, 20.0, 0.0, 500, 2500],
      ['R_hip', 5, -30.0, 30.0, 0.0, 500, 2500],
      ['R_knee', 6, 0.0, 130.0, 30.0, 500, 2500],
      ['R_ankle', 7, -20.0, 20.0, 0.0, 500, 2500],
    ],
    sim_config: {
      kind: 'leg-chain',
      anchor: { x: 0, y: 0, z: 95 },
      joints: [
        { servo_name: 'L_hip', segment_len: 35 },
        { servo_name: 'L_knee', segment_len: 30 },
        { servo_name: 'L_ankle', segment_len: 8 },
        { servo_name: 'R_hip', segment_len: 35 },
        { servo_name: 'R_knee', segment_len: 30 },
        { servo_name: 'R_ankle', segment_len: 8 },
      ],
      gripper: null,
      environment: { ground: { z: 0 } },
    },
    poses: {
      stand: [[0, 0.0], [1, 30.0], [2, 0.0], [3, 0.0], [4, 30.0], [5, 0.0]],
      weight_left: [[0, 10.0], [1, 25.0], [2, 0.0], [3, -10.0], [4, 45.0], [5, 5.0]],
      step_right: [[0, -5.0], [1, 30.0], [2, 0.0], [3, -25.0], [4, 60.0], [5, -10.0]],
      weight_right: [[0, -10.0], [1, 45.0], [2, 5.0], [3, 10.0], [4, 25.0], [5, 0.0]],
      step_left: [[0, 25.0], [1, 60.0], [2, -10.0], [3, 5.0], [4, 30.0], [5, 0.0]],
      crouch: [[0, 0.0], [1, 70.0], [2, 10.0], [3, 0.0], [4, 70.0], [5, 10.0]],
      lunge_left: [[0, 25.0], [1, 90.0], [2, -15.0], [3, -15.0], [4, 40.0], [5, 10.0]],
    },
    sequences: [
      {
        name: 'walk_step',
        steps: [
          ['pose', 'weight_left', 500, 100, 62.5, 'ease_out'],
          ['pose', 'step_right', 600, 150, 62.5, 'ease_out'],
          ['pose', 'weight_right', 500, 100, 41.7, 'ease_out'],
          ['pose', 'step_left', 600, 150, 62.5, 'ease_out'],
        ],
        repeat_count: 2,
        repeat_forever: 0,
        groups: [
          { name: 'step_pair', step_positions: [0, 1, 2, 3], repeat_count: 2, repeat_forever: 0 },
        ],
      },
      {
        name: 'crouch_lunge',
        steps: [
          ['pose', 'crouch', 900, 250, 33.3, 'ease_in_out'],
          ['pose', 'lunge_left', 700, 200, 62.5, 'ease_out'],
          ['pose', 'stand', 800, 200, 50.0, 'ease_out'],
        ],
        repeat_count: 1,
        repeat_forever: 0,
        groups: [],
      },
    ],
  },
  {
    name: 'GimbalCam',
    description: 'A minimal two-servo pan/tilt camera gimbal. Demonstrates that the ' +
      'tool serves even the simplest rigs, with smooth eased scanning and a ' +
      'forever-loop patrol.',
    servos: [
      ['pan', 2, -170.0, 170.0, 0.0, 500, 2500],
      ['tilt', 3, -45.0, 45.0, 0.0, 500, 2500],
    ],
    sim_config: {
      kind: 'gimbal',
      anchor: { x: 0, y: 0, z: 60 },
      joints: [
        { servo_name: 'pan', segment_len: 6 },
        { servo_name: 'tilt', segment_len: 10 },
      ],
      gripper: null,
      environment: { target: { x: 100, z: 60 } },
    },
    poses: {
      home: [[0, 0.0], [1, 0.0]],
      look_up: [[0, 0.0], [1, -40.0]],
      scan_left: [[0, -150.0], [1, 0.0]],
      scan_right: [[0, 150.0], [1, 0.0]],
      look_down: [[0, 0.0], [1, 40.0]],
    },
    sequences: [
      {
        name: 'patrol_scan',
        steps: [
          ['pose', 'scan_left', 1000, 150, 150.0, 'ease_in_out'],
          ['pose', 'scan_right', 2000, 150, 150.0, 'ease_in_out'],
          ['pose', 'scan_left', 2000, 150, 150.0, 'ease_in_out'],
        ],
        repeat_count: null,
        repeat_forever: 1,
        groups: [],
      },
      {
        name: 'look_around',
        steps: [
          ['pose', 'look_up', 800, 150, 50.0, 'ease_out'],
          ['pose', 'home', 600, 150, 66.7, 'ease_in'],
          ['pose', 'look_down', 800, 150, 50.0, 'ease_out'],
          ['pose', 'home', 600, 150, 66.7, 'ease_in'],
        ],
        repeat_count: 2,
        repeat_forever: 0,
        groups: [],
      },
    ],
  },
];

function seedDemoRobot(demo) {
  const robotId = insertRobot(demo.name, demo.description, demo.sim_config);
  const servoIds = demo.servos.map((s) => insertServo(robotId, s));

  const poseIds = {};
  for (const [poseName, targets] of Object.entries(demo.poses)) {
    poseIds[poseName] = insertPose(robotId, poseName, targets.map(([i, ang]) => [servoIds[i], ang]));
  }

  for (const seq of demo.sequences) {
    const steps = seq.steps.map((step) => step);
    const seqId = insertSequence(robotId, seq.name, steps,
      seq.repeat_count !== undefined && seq.repeat_count !== null ? seq.repeat_count : null,
      seq.repeat_forever || 0);
    for (const group of seq.groups || []) {
      const members = rows(
        'SELECT id FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id',
        [seqId],
      );
      const memberIds = group.step_positions.map((p) => members[p].id);
      insertGroup(seqId, group.name, group.repeat_count, group.repeat_forever, memberIds);
    }
  }
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

function insertGroup(seqId, name, repeatCount, repeatForever, memberIds = null) {
  let members;
  if (memberIds === null) {
    members = rows(
      'SELECT id FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id',
      [seqId],
    );
  } else {
    members = memberIds.map((id) => ({ id }));
  }
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