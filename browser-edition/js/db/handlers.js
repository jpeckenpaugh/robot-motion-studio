/* API handlers mirroring the FastAPI routers (backend/app/routers/*.py).
 * The worker dispatches {method, path, body} to these; each returns the same
 * body the HTTP edition returns (or throws an ApiError for error codes).
 *
 * Path routing follows the frontend's exact API surface (architecture §5, §9.3).
 */
import { one, rows, run, lastId } from './engine.js';
import * as v from './validation.js';
import * as previewBuilder from './preview.js';
import * as exportBuilder from './export.js';

const SHIFT = 1_000_000;

/* ---------- robots + servos (robot.py) ---------- */

function servoToDict(row) {
  return {
    id: row.id,
    name: row.name,
    pwm_pin: row.pwm_pin,
    angle_min: row.angle_min,
    angle_max: row.angle_max,
    neutral_angle: row.neutral_angle,
    pulse_min_us: row.pulse_min_us,
    pulse_max_us: row.pulse_max_us,
  };
}

function robotRowToDict(row) {
  return { id: row.id, name: row.name, description: row.description };
}

function simConfigToObj(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function currentId() {
  const row = one('SELECT current_robot_id FROM app_state WHERE id = 1');
  return row !== null ? row.current_robot_id : null;
}

function fetchRobot(robotId) {
  const row = one('SELECT id, name, description FROM robots WHERE id = ?', [robotId]);
  if (row === null) {
    v.httpError(404, 'NOT_FOUND', `Robot ${robotId} not found`);
  }
  return row;
}

export function listRobots() {
  const current = currentId();
  return rows(
    `SELECT r.id, r.name, r.description,
            (SELECT COUNT(*) FROM servos s WHERE s.robot_id = r.id) AS servo_count
       FROM robots r ORDER BY r.id`,
  ).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    servo_count: r.servo_count,
    current: r.id === current,
  }));
}

export function createRobot(body) {
  const name = v.requireName(body.name);
  const description = v.validateDescription(body.description);
  run('INSERT INTO robots (name, description) VALUES (?, ?)', [name, description]);
  const row = one('SELECT id, name, description FROM robots WHERE id = ?', [lastId()]);
  return robotRowToDict(row);
}

export function getRobot(robotId) {
  const robot = fetchRobot(robotId);
  const servos = rows('SELECT * FROM servos WHERE robot_id = ? ORDER BY id', [robotId]);
  const row = one('SELECT sim_config FROM robots WHERE id = ?', [robotId]);
  return {
    ...robotRowToDict(robot),
    sim_config: simConfigToObj(row.sim_config),
    servos: servos.map(servoToDict),
  };
}

export function updateRobot(robotId, body) {
  fetchRobot(robotId);
  const sets = [];
  const args = [];
  if (body.name !== null && body.name !== undefined) {
    sets.push('name = ?');
    args.push(v.requireName(body.name));
  }
  if (body.description !== null && body.description !== undefined) {
    sets.push('description = ?');
    args.push(v.validateDescription(body.description));
  }
  args.push(robotId);
  run(`UPDATE robots SET ${sets.join(', ')} WHERE id = ?`, args);
  return robotRowToDict(fetchRobot(robotId));
}

export function deleteRobot(robotId) {
  fetchRobot(robotId);
  run('DELETE FROM robots WHERE id = ?', [robotId]);
  return null;
}

export function getCurrentRobot() {
  const current = currentId();
  let robot = null;
  if (current !== null) {
    const row = one('SELECT id, name, description FROM robots WHERE id = ?', [current]);
    if (row !== null) robot = robotRowToDict(row);
  }
  return { robot_id: current, robot };
}

export function setCurrentRobot(body) {
  v.fetchRobotOr404(body.robot_id);
  run('UPDATE app_state SET current_robot_id = ? WHERE id = 1', [body.robot_id]);
  return { robot_id: body.robot_id };
}

export function listServos(robotId) {
  v.fetchRobotOr404(robotId);
  return rows('SELECT * FROM servos WHERE robot_id = ? ORDER BY id', [robotId]).map(servoToDict);
}

export function createServo(robotId, body) {
  v.fetchRobotOr404(robotId);
  v.validateServoValues(body.name, body.pwm_pin, body.angle_min, body.angle_max,
    body.neutral_angle, body.pulse_min_us, body.pulse_max_us);
  v.ensureServoNameAvailable(robotId, body.name);
  v.ensureServoPinAvailable(robotId, body.pwm_pin);
  run(
    `INSERT INTO servos
       (robot_id, name, pwm_pin, angle_min, angle_max, neutral_angle,
        pulse_min_us, pulse_max_us)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [robotId, body.name, body.pwm_pin, body.angle_min, body.angle_max,
      body.neutral_angle, body.pulse_min_us, body.pulse_max_us],
  );
  const row = one('SELECT * FROM servos WHERE id = ?', [lastId()]);
  return servoToDict(row);
}

export function getServo(robotId, servoId) {
  return servoToDict(v.fetchServoOr404(robotId, servoId));
}

export function updateServo(robotId, servoId, body) {
  v.fetchServoOr404(robotId, servoId);
  v.validateServoValues(body.name, body.pwm_pin, body.angle_min, body.angle_max,
    body.neutral_angle, body.pulse_min_us, body.pulse_max_us);
  v.ensureServoNameAvailable(robotId, body.name, servoId);
  v.ensureServoPinAvailable(robotId, body.pwm_pin, servoId);
  run(
    `UPDATE servos SET name = ?, pwm_pin = ?, angle_min = ?, angle_max = ?,
       neutral_angle = ?, pulse_min_us = ?, pulse_max_us = ?
     WHERE id = ?`,
    [body.name, body.pwm_pin, body.angle_min, body.angle_max,
      body.neutral_angle, body.pulse_min_us, body.pulse_max_us, servoId],
  );
  const row = one('SELECT * FROM servos WHERE id = ?', [servoId]);
  return servoToDict(row);
}

export function deleteServo(robotId, servoId) {
  v.fetchServoOr404(robotId, servoId);
  guardServoDelete(servoId);
  run('DELETE FROM servos WHERE id = ?', [servoId]);
  return null;
}

function guardServoDelete(servoId) {
  const poseRef = one('SELECT 1 FROM pose_targets WHERE servo_id = ? LIMIT 1', [servoId]);
  if (poseRef !== null) {
    v.httpError(409, 'SERVO_REFERENCED',
      `Servo ${servoId} is referenced by one or more pose targets; remove or change those references first.`);
  }
  const stepRef = one('SELECT 1 FROM sequence_steps WHERE servo_id = ? LIMIT 1', [servoId]);
  if (stepRef !== null) {
    v.httpError(409, 'SERVO_REFERENCED',
      `Servo ${servoId} is referenced by one or more sequence steps; remove or change those references first.`);
  }
}

/* ---------- poses (poses.py) ---------- */

function servoLimits(robotId) {
  const m = {};
  for (const r of rows('SELECT id, angle_min, angle_max FROM servos WHERE robot_id = ?', [robotId])) {
    m[r.id] = [r.angle_min, r.angle_max];
  }
  return m;
}

function poseToDict(poseId) {
  const row = one('SELECT id, name FROM poses WHERE id = ?', [poseId]);
  const targets = rows('SELECT servo_id, angle FROM pose_targets WHERE pose_id = ? ORDER BY servo_id', [poseId]);
  return {
    id: row.id,
    name: row.name,
    targets: targets.map((t) => ({ servo_id: t.servo_id, angle: t.angle })),
  };
}

function validateTargets(robotId, poseId, body) {
  v.requireName(body.name);
  v.ensurePoseNameAvailable(robotId, body.name, poseId);
  if (!body.targets || !body.targets.length) {
    v.httpError(422, 'VALIDATION', 'A pose must have at least one target');
  }
  const limits = servoLimits(robotId);
  const seen = new Set();
  for (const t of body.targets) {
    if (!limits[t.servo_id]) {
      v.httpError(422, 'VALIDATION', `servo_id ${t.servo_id} does not exist on this robot`);
    }
    if (seen.has(t.servo_id)) {
      v.httpError(422, 'VALIDATION', `Duplicate servo ${t.servo_id} in pose targets`);
    }
    seen.add(t.servo_id);
    const [amin, amax] = limits[t.servo_id];
    if (!(amin <= t.angle && t.angle <= amax)) {
      v.httpError(422, 'VALIDATION',
        `Angle ${t.angle} for servo ${t.servo_id} is outside [${amin}, ${amax}]`);
    }
  }
}

export function listPoses(robotId) {
  const rid = v.resolveRobotId(robotId);
  return rows('SELECT id FROM poses WHERE robot_id = ? ORDER BY id', [rid]).map((r) => poseToDict(r.id));
}

export function createPose(body, robotId) {
  const rid = v.resolveRobotId(robotId);
  validateTargets(rid, null, body);
  run('INSERT INTO poses (robot_id, name) VALUES (?, ?)', [rid, body.name]);
  const poseId = lastId();
  for (const t of body.targets) {
    run('INSERT INTO pose_targets (pose_id, servo_id, angle) VALUES (?, ?, ?)', [poseId, t.servo_id, t.angle]);
  }
  return poseToDict(poseId);
}

export function getPose(poseId) {
  const row = one('SELECT id FROM poses WHERE id = ?', [poseId]);
  if (row === null) {
    v.httpError(404, 'NOT_FOUND', `Pose ${poseId} not found`);
  }
  return poseToDict(poseId);
}

export function updatePose(poseId, body) {
  const row = one('SELECT id, robot_id FROM poses WHERE id = ?', [poseId]);
  if (row === null) {
    v.httpError(404, 'NOT_FOUND', `Pose ${poseId} not found`);
  }
  const robotId = row.robot_id;
  validateTargets(robotId, poseId, body);
  run("UPDATE poses SET name = ?, updated_at = datetime('now') WHERE id = ?", [body.name, poseId]);
  run('DELETE FROM pose_targets WHERE pose_id = ?', [poseId]);
  for (const t of body.targets) {
    run('INSERT INTO pose_targets (pose_id, servo_id, angle) VALUES (?, ?, ?)', [poseId, t.servo_id, t.angle]);
  }
  return poseToDict(poseId);
}

export function deletePose(poseId) {
  const row = one('SELECT id FROM poses WHERE id = ?', [poseId]);
  if (row === null) {
    v.httpError(404, 'NOT_FOUND', `Pose ${poseId} not found`);
  }
  const stepRef = one('SELECT 1 FROM sequence_steps WHERE pose_id = ? LIMIT 1', [poseId]);
  if (stepRef !== null) {
    v.httpError(409, 'POSE_REFERENCED',
      `Pose ${poseId} is referenced by one or more sequence steps; remove or change those references first.`);
  }
  run('DELETE FROM poses WHERE id = ?', [poseId]);
  return null;
}

/* ---------- sequences + steps + groups (sequences.py) ---------- */

function stepToDict(row) {
  return {
    id: row.id,
    position: row.position,
    kind: row.kind,
    pose_id: row.pose_id,
    servo_id: row.servo_id,
    angle: row.angle,
    duration_ms: row.duration_ms,
    hold_ms: row.hold_ms,
    speed: row.speed,
    easing: row.easing,
  };
}

function sequenceSteps(seqId) {
  return rows('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id', [seqId]).map(stepToDict);
}

function groupToDict(groupId) {
  const row = one('SELECT * FROM step_groups WHERE id = ?', [groupId]);
  const members = rows(
    `SELECT ss.id FROM step_group_members sgm
       JOIN sequence_steps ss ON ss.id = sgm.step_id
      WHERE sgm.group_id = ? ORDER BY ss.position, ss.id`,
    [groupId],
  );
  return {
    id: row.id,
    sequence_id: row.sequence_id,
    name: row.name,
    step_ids: members.map((m) => m.id),
    repeat_count: row.repeat_count,
    repeat_forever: Boolean(row.repeat_forever),
  };
}

function sequenceGroups(seqId) {
  return rows('SELECT id FROM step_groups WHERE sequence_id = ? ORDER BY id', [seqId]).map((r) => groupToDict(r.id));
}

function sequenceToDict(seqId) {
  const row = one('SELECT id, name, repeat_count, repeat_forever FROM sequences WHERE id = ?', [seqId]);
  return {
    id: row.id,
    name: row.name,
    repeat_count: row.repeat_count,
    repeat_forever: Boolean(row.repeat_forever),
    groups: sequenceGroups(seqId),
    steps: sequenceSteps(seqId),
  };
}

function fetchSequence(seqId) {
  const row = one('SELECT * FROM sequences WHERE id = ?', [seqId]);
  if (row === null) {
    v.httpError(404, 'NOT_FOUND', `Sequence ${seqId} not found`);
  }
  return row;
}

function fetchStep(seqId, stepId) {
  const row = one('SELECT * FROM sequence_steps WHERE id = ? AND sequence_id = ?', [stepId, seqId]);
  if (row === null) {
    v.httpError(404, 'NOT_FOUND', `Step ${stepId} not found in sequence ${seqId}`);
  }
  return row;
}

function validateStep(seqId, body) {
  const seq = fetchSequence(seqId);
  const robotId = seq.robot_id;
  if (body.kind === 'pose') {
    const pose = one('SELECT id FROM poses WHERE id = ? AND robot_id = ?', [body.pose_id, robotId]);
    if (pose === null) {
      v.httpError(422, 'VALIDATION', `Pose ${body.pose_id} does not exist on this robot`);
    }
  } else {
    const servo = one('SELECT * FROM servos WHERE id = ? AND robot_id = ?', [body.servo_id, robotId]);
    if (servo === null) {
      v.httpError(422, 'VALIDATION', `Servo ${body.servo_id} does not exist on this robot`);
    }
    if (!(servo.angle_min <= body.angle && body.angle <= servo.angle_max)) {
      v.httpError(422, 'VALIDATION',
        `Angle ${body.angle} for servo ${body.servo_id} is outside [${servo.angle_min}, ${servo.angle_max}]`);
    }
  }
}

function insertStep(seqId, position, body, speed) {
  const easing = v.validateEasing(body.easing || v.DEFAULT_EASING);
  if (body.kind === 'pose') {
    run(
      `INSERT INTO sequence_steps
         (sequence_id, position, kind, pose_id, servo_id, angle,
          duration_ms, hold_ms, speed, easing)
       VALUES (?, ?, 'pose', ?, NULL, NULL, ?, ?, ?, ?)`,
      [seqId, position, body.pose_id, body.duration_ms, body.hold_ms, speed, easing],
    );
  } else {
    run(
      `INSERT INTO sequence_steps
         (sequence_id, position, kind, pose_id, servo_id, angle,
          duration_ms, hold_ms, speed, easing)
       VALUES (?, ?, 'servo', NULL, ?, ?, ?, ?, ?, ?)`,
      [seqId, position, body.servo_id, body.angle, body.duration_ms, body.hold_ms, speed, easing],
    );
  }
  return lastId();
}

function nextPosition(seqId) {
  const row = one('SELECT COALESCE(MAX(position), -1) AS m FROM sequence_steps WHERE sequence_id = ?', [seqId]);
  return row.m + 1;
}

function renumber(seqId) {
  const rowsAll = rows('SELECT id FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id', [seqId]);
  rowsAll.forEach((row, position) => {
    run('UPDATE sequence_steps SET position = ? WHERE id = ?', [position, row.id]);
  });
}

function shiftFrom(seqId, position) {
  run('UPDATE sequence_steps SET position = position + ? WHERE sequence_id = ? AND position >= ?',
    [SHIFT, seqId, position]);
}

export function listSequences(robotId) {
  const rid = v.resolveRobotId(robotId);
  const rowsAll = rows('SELECT id, name, repeat_count, repeat_forever FROM sequences WHERE robot_id = ? ORDER BY id', [rid]);
  const result = [];
  for (const r of rowsAll) {
    const count = one('SELECT COUNT(*) AS c FROM sequence_steps WHERE sequence_id = ?', [r.id]).c;
    result.push({
      id: r.id,
      name: r.name,
      step_count: count,
      repeat_count: r.repeat_count,
      repeat_forever: Boolean(r.repeat_forever),
    });
  }
  return result;
}

export function createSequence(body, robotId) {
  const rid = v.resolveRobotId(robotId);
  const name = v.requireName(body.name);
  v.validateRepeat(body.repeat_count, body.repeat_forever);
  v.ensureSequenceNameAvailable(rid, name);
  run('INSERT INTO sequences (robot_id, name, repeat_count, repeat_forever) VALUES (?, ?, ?, ?)',
    [rid, name, body.repeat_count, body.repeat_forever ? 1 : 0]);
  return sequenceToDict(lastId());
}

export function getSequence(seqId) {
  fetchSequence(seqId);
  return sequenceToDict(seqId);
}

export function updateSequence(seqId, body) {
  const seq = fetchSequence(seqId);
  if (body.name !== null && body.name !== undefined) {
    const name = v.requireName(body.name);
    v.ensureSequenceNameAvailable(seq.robot_id, name, seqId);
    run("UPDATE sequences SET name = ?, updated_at = datetime('now') WHERE id = ?", [name, seqId]);
  }
  if (body.repeat_count !== null && body.repeat_count !== undefined || body.repeat_forever !== null && body.repeat_forever !== undefined) {
    if (body.repeat_count !== null && body.repeat_count !== undefined && body.repeat_forever) {
      v.httpError(422, 'VALIDATION', 'repeat_count and repeat_forever are mutually exclusive');
    }
    const newCount = body.repeat_count;
    const newForever = body.repeat_forever ? 1 : 0;
    v.validateRepeat(newCount, Boolean(newForever));
    run("UPDATE sequences SET repeat_count = ?, repeat_forever = ?, updated_at = datetime('now') WHERE id = ?",
      [newCount, newForever, seqId]);
  }
  return sequenceToDict(seqId);
}

export function deleteSequence(seqId) {
  fetchSequence(seqId);
  run('DELETE FROM sequences WHERE id = ?', [seqId]);
  return null;
}

export function addStep(seqId, body) {
  const seq = fetchSequence(seqId);
  validateStep(seqId, body);
  const targets = previewBuilder.resolveStepTargets(seq.robot_id, body);
  const position = body.position !== null && body.position !== undefined ? body.position : nextPosition(seqId);
  const [speed, durationMs] = previewBuilder.deriveStepTiming(seqId, seq.robot_id, targets,
    body.duration_ms, body.speed, position);
  body.duration_ms = durationMs;
  shiftFrom(seqId, position);
  const stepId = insertStep(seqId, position, body, speed);
  renumber(seqId);
  v.validateGroupContiguity(seqId);
  return stepToDict(one('SELECT * FROM sequence_steps WHERE id = ?', [stepId]));
}

export function updateStep(seqId, stepId, body) {
  const seq = fetchSequence(seqId);
  const step = fetchStep(seqId, stepId);
  validateStep(seqId, body);
  const targets = previewBuilder.resolveStepTargets(seq.robot_id, body);
  const [speed, durationMs] = previewBuilder.deriveStepTiming(seqId, seq.robot_id, targets,
    body.duration_ms, body.speed, step.position, stepId, true);
  const easing = v.validateEasing(body.easing || v.DEFAULT_EASING);
  if (body.kind === 'pose') {
    run(
      `UPDATE sequence_steps SET kind = 'pose', pose_id = ?, servo_id = NULL, angle = NULL,
         duration_ms = ?, hold_ms = ?, speed = ?, easing = ? WHERE id = ?`,
      [body.pose_id, durationMs, body.hold_ms, speed, easing, stepId],
    );
  } else {
    run(
      `UPDATE sequence_steps SET kind = 'servo', pose_id = NULL, servo_id = ?, angle = ?,
         duration_ms = ?, hold_ms = ?, speed = ?, easing = ? WHERE id = ?`,
      [body.servo_id, body.angle, durationMs, body.hold_ms, speed, easing, stepId],
    );
  }
  v.validateGroupContiguity(seqId);
  return stepToDict(one('SELECT * FROM sequence_steps WHERE id = ?', [stepId]));
}

export function removeStep(seqId, stepId) {
  fetchStep(seqId, stepId);
  run('DELETE FROM sequence_steps WHERE id = ?', [stepId]);
  renumber(seqId);
  v.validateGroupContiguity(seqId);
  return null;
}

export function duplicateStep(seqId, stepId) {
  fetchSequence(seqId);
  const step = fetchStep(seqId, stepId);
  const newPosition = step.position + 1;
  shiftFrom(seqId, newPosition);
  run(
    `INSERT INTO sequence_steps
       (sequence_id, position, kind, pose_id, servo_id, angle,
        duration_ms, hold_ms, speed, easing)
     SELECT sequence_id, ?, kind, pose_id, servo_id, angle,
            duration_ms, hold_ms, speed, easing
       FROM sequence_steps WHERE id = ?`,
    [newPosition, stepId],
  );
  const newStepId = lastId();
  renumber(seqId);
  v.validateGroupContiguity(seqId);
  return stepToDict(one('SELECT * FROM sequence_steps WHERE id = ?', [newStepId]));
}

export function reorderSteps(seqId, body) {
  fetchSequence(seqId);
  const current = rows('SELECT id FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id', [seqId]).map((r) => r.id);
  if (JSON.stringify([...body.step_ids].sort((a, b) => a - b)) !== JSON.stringify([...current].sort((a, b) => a - b))) {
    v.httpError(422, 'VALIDATION',
      'step_ids must contain exactly the sequence\'s step ids, in the new order');
  }
  for (const stepId of current) {
    run('UPDATE sequence_steps SET position = position + ? WHERE id = ?', [SHIFT, stepId]);
  }
  body.step_ids.forEach((stepId, position) => {
    run('UPDATE sequence_steps SET position = ? WHERE id = ?', [position, stepId]);
  });
  run("UPDATE sequences SET updated_at = datetime('now') WHERE id = ?", [seqId]);
  v.validateGroupContiguity(seqId);
  return sequenceToDict(seqId);
}

function validateGroupInput(seqId, stepIds) {
  const positions = [];
  for (const sid of stepIds) {
    const row = one('SELECT position FROM sequence_steps WHERE id = ? AND sequence_id = ?', [sid, seqId]);
    if (row === null) {
      v.httpError(422, 'VALIDATION', `Step ${sid} does not exist in sequence ${seqId}`);
    }
    positions.push(row.position);
  }
  positions.sort((a, b) => a - b);
  const expected = positions.map((_, i) => positions[0] + i);
  if (JSON.stringify(positions) !== JSON.stringify(expected)) {
    v.httpError(422, 'VALIDATION', 'Group steps must be contiguous by position');
  }
  const placeholders = stepIds.map(() => '?').join(',');
  const taken = one(
    `SELECT 1 FROM step_group_members sgm
       JOIN step_groups sg ON sg.id = sgm.group_id
      WHERE sg.sequence_id = ? AND sgm.step_id IN (${placeholders}) LIMIT 1`,
    [seqId, ...stepIds],
  );
  if (taken !== null) {
    v.httpError(422, 'VALIDATION', 'Group steps must not overlap another group\'s steps');
  }
}

export function createGroup(seqId, body) {
  fetchSequence(seqId);
  validateGroupInput(seqId, body.step_ids);
  v.validateRepeat(body.repeat_count, body.repeat_forever);
  run('INSERT INTO step_groups (sequence_id, name, repeat_count, repeat_forever) VALUES (?, ?, ?, ?)',
    [seqId, body.name, body.repeat_count, body.repeat_forever ? 1 : 0]);
  const groupId = lastId();
  for (const sid of body.step_ids) {
    run('INSERT INTO step_group_members (step_id, group_id) VALUES (?, ?)', [sid, groupId]);
  }
  return groupToDict(groupId);
}

function fetchGroup(seqId, groupId) {
  const row = one('SELECT id FROM step_groups WHERE id = ? AND sequence_id = ?', [groupId, seqId]);
  if (row === null) {
    v.httpError(404, 'NOT_FOUND', `Group ${groupId} not found in sequence ${seqId}`);
  }
}

export function getGroup(seqId, groupId) {
  fetchGroup(seqId, groupId);
  return groupToDict(groupId);
}

export function updateGroup(seqId, groupId, body) {
  fetchGroup(seqId, groupId);
  const sets = [];
  const args = [];
  if (body.name !== null && body.name !== undefined) {
    sets.push('name = ?');
    args.push(body.name);
  }
  if (body.repeat_count !== null && body.repeat_count !== undefined || body.repeat_forever !== null && body.repeat_forever !== undefined) {
    if (body.repeat_count !== null && body.repeat_count !== undefined && body.repeat_forever) {
      v.httpError(422, 'VALIDATION', 'repeat_count and repeat_forever are mutually exclusive');
    }
    const newCount = body.repeat_count;
    const newForever = body.repeat_forever ? 1 : 0;
    v.validateRepeat(newCount, Boolean(newForever));
    sets.push('repeat_count = ?');
    args.push(newCount);
    sets.push('repeat_forever = ?');
    args.push(newForever);
  }
  args.push(groupId);
  run(`UPDATE step_groups SET ${sets.join(', ')} WHERE id = ?`, args);
  return groupToDict(groupId);
}

export function deleteGroup(seqId, groupId) {
  fetchGroup(seqId, groupId);
  run('DELETE FROM step_groups WHERE id = ?', [groupId]);
  return null;
}

/* ---------- preview + export ---------- */

export function previewSequence(seqId) {
  return previewBuilder.buildPreview(seqId);
}

export function exportAll(robotId) {
  const doc = exportBuilder.buildExport(robotId);
  return { doc, filename: exportBuilder.filenameFor(doc.robot.name) };
}

export function exportSequence(seqId, robotId) {
  const doc = exportBuilder.buildExport(robotId, seqId);
  const seqName = doc.sequences.length ? doc.sequences[0].name : null;
  return { doc, filename: exportBuilder.filenameFor(doc.robot.name, seqName) };
}