/* Node parity tests for the browser-edition domain layer (schema, seed,
 * handlers, preview, export). Runs the same sql.js the worker uses, but
 * directly (no Worker/OPFS), so it needs no browser. Mirrors the checks the
 * backend verification stage performed against the FastAPI app.
 *
 * Run: node tests/run.mjs
 */
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { setDatabase } from '../js/db/engine.js';
import { SCHEMA_SQL, validateDatabase, REVISION } from '../js/db/schema.js';
import { seed } from '../js/db/seed.js';
import * as handlers from '../js/db/handlers.js';
import * as preview from '../js/db/preview.js';

const require = createRequire(import.meta.url);
const initSqlJs = require('../vendor/sql.js/sql-wasm.js');

let SQL = null;
let db;

function freshDb() {
  db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  setDatabase(db);
  return db;
}

function reset() {
  freshDb();
  db.run(SCHEMA_SQL);
  const robotId = seed();
  db.run('UPDATE app_state SET seeded = 1, current_robot_id = ? WHERE id = 1', [robotId]);
  validateDatabase(db);
  return robotId;
}

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    failures.push(name);
    console.log('  FAIL ' + name + '\n       ' + (err && err.message ? err.message : err));
  }
}

console.log('browser-edition domain parity tests');

const sqlModule = await initSqlJs();
SQL = sqlModule;
reset();

console.log('\n[schema]');
check('schema revision marker present', () => {
  assert.strictEqual(db.exec("SELECT value FROM app_meta WHERE key='schema_revision'")[0].values[0][0], REVISION);
});

console.log('\n[seed]');
let seededRobotId;
check('seed creates the door durability rig', () => {
  seededRobotId = reset();
  const robots = handlers.listRobots();
  assert.strictEqual(robots.length, 5);
  assert.strictEqual(robots[0].name, 'DoorDurabilityRig');
  assert.strictEqual(robots[0].current, true);
});
check('demo robots seeded (PickPlaceArm, QuadTrotter, BipedWalker, GimbalCam)', () => {
  const names = handlers.listRobots().map((r) => r.name);
  assert.deepStrictEqual(names,
    ['DoorDurabilityRig', 'PickPlaceArm', 'QuadTrotter', 'BipedWalker', 'GimbalCam']);
});
check('demo robots carry sim_config', () => {
  const robots = handlers.listRobots();
  for (const r of robots) {
    const full = handlers.getRobot(r.id);
    assert.ok(full.sim_config, `${r.name} has sim_config`);
    assert.ok(Array.isArray(full.sim_config.joints), `${r.name} joints array`);
  }
});
check('PickPlaceArm: 6 servos, poses, pick_and_place with group', () => {
  const robots = handlers.listRobots();
  const arm = robots.find((r) => r.name === 'PickPlaceArm');
  const full = handlers.getRobot(arm.id);
  assert.strictEqual(full.servos.length, 6);
  assert.strictEqual(full.servos.map((s) => s.name).join(','),
    'base_rotate,shoulder,elbow,wrist_pitch,wrist_roll,gripper');
  const seqs = handlers.listSequences(arm.id);
  assert.strictEqual(seqs.length, 1);
  const seq = handlers.getSequence(seqs[0].id);
  assert.strictEqual(seq.name, 'pick_and_place');
  assert.strictEqual(seq.repeat_count, 2);
  assert.strictEqual(seq.groups.length, 1);
  assert.strictEqual(seq.groups[0].name, 'grip_cycle');
  assert.strictEqual(seq.groups[0].repeat_count, 3);
  // preview resolves and group repeat is folded in
  const p = handlers.previewSequence(seq.id);
  assert.strictEqual(p.steps.length, 6);
  assert.strictEqual(p.groups[0].step_orders.join(','), '1,2,3,4');
});
check('QuadTrotter: 8 servos, trot_gait + crouch_and_stand', () => {
  const robots = handlers.listRobots();
  const quad = robots.find((r) => r.name === 'QuadTrotter');
  assert.strictEqual(handlers.getRobot(quad.id).servos.length, 8);
  const seqs = handlers.listSequences(quad.id);
  assert.deepStrictEqual(seqs.map((s) => s.name).sort(), ['crouch_and_stand', 'trot_gait']);
  const trot = handlers.getSequence(seqs.find((s) => s.name === 'trot_gait').id);
  assert.strictEqual(trot.repeat_count, 3);
});
check('BipedWalker: 6 servos, walk_step with step_pair group', () => {
  const robots = handlers.listRobots();
  const biped = robots.find((r) => r.name === 'BipedWalker');
  assert.strictEqual(handlers.getRobot(biped.id).servos.length, 6);
  const walk = handlers.getSequence(handlers.listSequences(biped.id).find((s) => s.name === 'walk_step').id);
  assert.strictEqual(walk.groups.length, 1);
  assert.strictEqual(walk.groups[0].name, 'step_pair');
  assert.strictEqual(walk.groups[0].repeat_count, 2);
});
check('GimbalCam: 2 servos, patrol_scan repeat_forever', () => {
  const robots = handlers.listRobots();
  const gimbal = robots.find((r) => r.name === 'GimbalCam');
  assert.strictEqual(handlers.getRobot(gimbal.id).servos.length, 2);
  const patrol = handlers.getSequence(handlers.listSequences(gimbal.id).find((s) => s.name === 'patrol_scan').id);
  assert.strictEqual(patrol.repeat_forever, true);
  assert.strictEqual(patrol.repeat_count, null);
  const p = handlers.previewSequence(patrol.id);
  assert.strictEqual(p.repeat_forever, true);
  assert.strictEqual(p.total_duration_ms, null);
});
check('every pose target angle is within its servo limits', () => {
  const robots = handlers.listRobots();
  for (const r of robots) {
    const full = handlers.getRobot(r.id);
    const limits = {};
    full.servos.forEach((s) => { limits[s.id] = [s.angle_min, s.angle_max]; });
    for (const pose of handlers.listPoses(r.id)) {
      for (const t of pose.targets) {
        const [amin, amax] = limits[t.servo_id];
        assert.ok(amin <= t.angle && t.angle <= amax,
          `${r.name}/${pose.name} target ${t.angle} within [${amin},${amax}]`);
      }
    }
  }
});
check('every demo step references a pose/servo on the same robot', () => {
  const robots = handlers.listRobots();
  for (const r of robots) {
    for (const seq of handlers.listSequences(r.id)) {
      const full = handlers.getSequence(seq.id);
      const fullRobot = handlers.getRobot(r.id);
      const poseIds = new Set(handlers.listPoses(r.id).map((p) => p.id));
      const servoIds = new Set(fullRobot.servos.map((s) => s.id));
      for (const step of full.steps) {
        if (step.kind === 'pose') assert.ok(poseIds.has(step.pose_id), 'pose ref');
        else assert.ok(servoIds.has(step.servo_id), 'servo ref');
      }
    }
  }
});
check('seed rig has 4 servos (shoulder/elbow/wrist/gripper)', () => {
  const servos = handlers.listServos(seededRobotId);
  assert.strictEqual(servos.length, 4);
  assert.deepStrictEqual(servos.map((s) => s.name),
    ['shoulder', 'elbow', 'wrist', 'gripper']);
});
check('seed rig has 5 poses', () => {
  assert.strictEqual(handlers.listPoses(seededRobotId).length, 5);
});
check('seed rig has 2 sequences with repeat/group', () => {
  const seqs = handlers.listSequences(seededRobotId);
  assert.strictEqual(seqs.length, 2);
  const cycle = handlers.getSequence(seqs.find((s) => s.name === 'door_cycle').id);
  assert.strictEqual(cycle.groups.length, 1);
  assert.strictEqual(cycle.groups[0].repeat_count, 25);
  assert.strictEqual(cycle.groups[0].repeat_forever, false);
  assert.strictEqual(cycle.groups[0].step_ids.length, 4);
  const gar = handlers.getSequence(seqs.find((s) => s.name === 'grip_and_release').id);
  assert.strictEqual(gar.repeat_count, 5);
  assert.strictEqual(gar.steps.length, 3);
});

console.log('\n[preview]');
check('door_cycle preview resolves timing + group repeat', () => {
  const seqs = handlers.listSequences(seededRobotId);
  const p = handlers.previewSequence(seqs.find((s) => s.name === 'door_cycle').id);
  assert.strictEqual(p.steps.length, 4);
  assert.strictEqual(p.groups.length, 1);
  assert.strictEqual(p.groups[0].step_orders.join(','), '0,1,2,3');
  // group run = 1000+700+1700+1700 = 5100ms; pass_duration_ms INCLUDES the
  // 25x group expansion (matches backend preview.py _pass_duration_ms), so a
  // single pass of the sequence is 5100 * 25 = 127500ms.
  assert.strictEqual(p.pass_duration_ms, 127500);
  assert.strictEqual(p.total_duration_ms, 127500);
  // first step starts at 0, resolved from neutral
  assert.strictEqual(p.steps[0].start_ms, 0);
  assert.strictEqual(p.steps[0].end_ms, 800);
  // grip_handle: shoulder -30 deg; check easing propagated
  assert.strictEqual(p.steps[1].easing, 'ease_in');
  assert.strictEqual(p.steps[2].easing, 'ease_out');
  assert.strictEqual(p.steps[3].easing, 'ease_in_out');
});
check('grip_and_release preview: sequence repeat', () => {
  const seqs = handlers.listSequences(seededRobotId);
  const p = handlers.previewSequence(seqs.find((s) => s.name === 'grip_and_release').id);
  assert.strictEqual(p.repeat_count, 5);
  // steps: (300+200) + (400+100) + (600+100) = 1700ms
  assert.strictEqual(p.pass_duration_ms, 1700);
  assert.strictEqual(p.total_duration_ms, 1700 * 5);
});

console.log('\n[export]');
check('export is schema_version 2, robot-scoped', () => {
  const { doc } = handlers.exportAll(seededRobotId);
  assert.strictEqual(doc.schema_version, 2);
  assert.strictEqual(doc.format, 'robot-servo-sequence');
  assert.strictEqual(doc.robot.name, 'DoorDurabilityRig');
  assert.strictEqual(doc.robot.servos.length, 4);
  assert.strictEqual(doc.sequences.length, 2);
  // self-contained: pose refs resolved to concrete targets with pulse_us
  const first = doc.sequences[0].steps[0];
  assert.ok(first.targets.length > 0);
  assert.ok(first.targets.every((t) => t.servo_id !== undefined && t.servo_name && t.pulse_us !== undefined));
});
check('export filename matches backend convention', () => {
  const { filename } = handlers.exportAll(seededRobotId);
  assert.strictEqual(filename, 'DoorDurabilityRig.json');
  const { filename: per } = handlers.exportSequence(
    handlers.listSequences(seededRobotId)[0].id, seededRobotId);
  assert.ok(per.endsWith('.json'));
});

console.log('\n[CRUD + guards]');
check('create robot, then switch current', () => {
  const r = handlers.createRobot({ name: 'TestBot', description: 'd' });
  assert.strictEqual(r.name, 'TestBot');
  const robots = handlers.listRobots();
  assert.strictEqual(robots.length, 6); // 5 seeded + TestBot
  handlers.setCurrentRobot({ robot_id: r.id });
  assert.strictEqual(handlers.getCurrentRobot().robot_id, r.id);
  handlers.setCurrentRobot({ robot_id: seededRobotId });
});
check('delete servo referenced by pose is blocked (409 SERVO_REFERENCED)', () => {
  const servos = handlers.listServos(seededRobotId);
  try {
    handlers.deleteServo(seededRobotId, servos[0].id);
    assert.fail('expected SERVO_REFERENCED');
  } catch (err) {
    assert.strictEqual(err.status, 409);
    assert.strictEqual(err.code, 'SERVO_REFERENCED');
  }
});
check('delete pose referenced by step is blocked (409 POSE_REFERENCED)', () => {
  const poses = handlers.listPoses(seededRobotId);
  const used = poses.find((p) => p.name === 'rest'); // used in grip_and_release
  try {
    handlers.deletePose(used.id);
    assert.fail('expected POSE_REFERENCED');
  } catch (err) {
    assert.strictEqual(err.code, 'POSE_REFERENCED');
  }
});
check('unknown robot -> 404 NOT_FOUND', () => {
  try {
    handlers.getRobot(9999);
    assert.fail('expected NOT_FOUND');
  } catch (err) {
    assert.strictEqual(err.status, 404);
    assert.strictEqual(err.code, 'NOT_FOUND');
  }
});
check('duplicate step works and keeps contiguity', () => {
  const seqs = handlers.listSequences(seededRobotId);
  const gar = seqs.find((s) => s.name === 'grip_and_release'); // no group
  const seq = handlers.getSequence(gar.id);
  const dup = handlers.duplicateStep(seq.id, seq.steps[0].id);
  assert.strictEqual(dup.position, 1);
  const after = handlers.getSequence(seq.id);
  assert.strictEqual(after.steps.length, 4);
  // positions renumbered 0..3
  assert.deepStrictEqual(after.steps.map((s) => s.position), [0, 1, 2, 3]);
});
check('step group split is rejected (422 GROUP_SPLIT)', () => {
  const seqs = handlers.listSequences(seededRobotId);
  const cycle = seqs.find((s) => s.name === 'door_cycle');
  const seq = handlers.getSequence(cycle.id);
  // Inserting a step at position 1 splits the 0..3 group.
  const step = seq.steps[0];
  try {
    handlers.addStep(seq.id, {
      kind: step.kind, pose_id: step.pose_id, duration_ms: 200, hold_ms: 0,
      position: 1, easing: 'linear',
    });
    assert.fail('expected GROUP_SPLIT');
  } catch (err) {
    assert.strictEqual(err.status, 422);
    assert.strictEqual(err.code, 'GROUP_SPLIT');
  }
});
check('speed/duration mismatch rejected (422 SPEED_DURATION_MISMATCH)', () => {
  const seqs = handlers.listSequences(seededRobotId);
  const gar = seqs.find((s) => s.name === 'grip_and_release');
  try {
    handlers.addStep(gar.id, {
      kind: 'servo', servo_id: handlers.listServos(seededRobotId)[3].id,
      angle: 20, duration_ms: 400, speed: 500, easing: 'linear',
    });
    assert.fail('expected SPEED_DURATION_MISMATCH');
  } catch (err) {
    assert.strictEqual(err.status, 422);
    assert.strictEqual(err.code, 'SPEED_DURATION_MISMATCH');
  }
});
check('reorder requires exactly the sequence steps', () => {
  const seqs = handlers.listSequences(seededRobotId);
  const gar = handlers.getSequence(seqs.find((s) => s.name === 'grip_and_release').id);
  try {
    handlers.reorderSteps(gar.id, { step_ids: [999] });
    assert.fail('expected VALIDATION');
  } catch (err) {
    assert.strictEqual(err.status, 422);
    assert.strictEqual(err.code, 'VALIDATION');
  }
});

console.log('\n[persistence parity]');
check('fresh seed is stable across DB round-trip', () => {
  reset(); // back to the pristine seed state
  const bytes = db.export();
  const clone = new SQL.Database(bytes);
  clone.run('PRAGMA foreign_keys = ON;');
  validateDatabase(clone);
  setDatabase(clone);
  const robots = handlers.listRobots();
  assert.strictEqual(robots.length, 5);
  assert.strictEqual(robots[0].name, 'DoorDurabilityRig');
  setDatabase(db);
});

console.log('\nresults: ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('failures: ' + failures.join(', '));
  process.exit(1);
}