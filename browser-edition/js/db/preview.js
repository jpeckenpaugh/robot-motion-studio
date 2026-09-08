/* Sequence preview resolution (ported from backend/app/preview.py; brief 04;
 * architecture §5.4, §9.2.2, §9.3.6). Also hosts the shared speed/duration
 * derivation rules (§9.2.2) used on step save and migration backfill.
 *
 * The preview is derived on every request from the current saved state, so it
 * never shows stale data. It is read-only: there is no write route for it.
 */
import { one, rows, run } from './engine.js';
import { angleToPulseUs } from './pulse.js';
import { httpError, DEFAULT_EASING } from './validation.js';

export const DEFAULT_EASING_VALUE = DEFAULT_EASING;

// Consistency tolerance for client-supplied speed vs. derived speed (§9.2.2).
const SPEED_TOLERANCE_FRACTION = 0.005;
const SPEED_TOLERANCE_ABS = 0.05;

export function round6(x) {
  return Math.round((x + Number.EPSILON) * 1e6) / 1e6;
}

function servoMap(robotId) {
  const map = {};
  for (const r of rows('SELECT * FROM servos WHERE robot_id = ?', [robotId])) {
    map[r.id] = r;
  }
  return map;
}

function neutralMap(robotId) {
  const map = {};
  for (const r of rows('SELECT id, neutral_angle FROM servos WHERE robot_id = ?', [robotId])) {
    map[r.id] = r.neutral_angle;
  }
  return map;
}

function target(servoRow, angle) {
  return {
    servo_id: servoRow.id,
    servo_name: servoRow.name,
    angle: angle,
    pulse_us: angleToPulseUs(angle, servoRow.angle_min, servoRow.angle_max,
      servoRow.pulse_min_us, servoRow.pulse_max_us),
  };
}

function resolveRowTargets(row) {
  if (row.kind === 'pose') {
    const m = {};
    for (const r of rows('SELECT servo_id, angle FROM pose_targets WHERE pose_id = ?', [row.pose_id])) {
      m[r.servo_id] = r.angle;
    }
    return m;
  }
  return { [row.servo_id]: row.angle };
}

export function resolveStepTargets(robotId, body) {
  if (body.kind === 'pose') {
    return rows('SELECT servo_id, angle FROM pose_targets WHERE pose_id = ?', [body.pose_id])
      .map((r) => [r.servo_id, r.angle]);
  }
  return [[body.servo_id, body.angle]];
}

function carry(moves, neutral) {
  const cur = { ...neutral };
  const starts = [];
  for (const mv of moves) {
    const start = {};
    for (const s of Object.keys(mv)) start[s] = cur[s];
    starts.push(start);
    for (const s of Object.keys(mv)) cur[s] = mv[s];
  }
  return starts;
}

function applyTiming(travelDeg, durationMs, speed) {
  if (travelDeg <= 0) {
    if (durationMs === null || durationMs === undefined) {
      httpError(422, 'VALIDATION', 'duration_ms is required for a stationary step (no travel)');
    }
    return [null, durationMs]; // stationary: speed is stored NULL
  }
  const computedSpeed = durationMs ? travelDeg / (durationMs / 1000.0) : null;

  if (durationMs !== null && durationMs !== undefined && speed === null && speed === undefined) {
    return [round6(computedSpeed), durationMs];
  }
  if (speed !== null && speed !== undefined && (durationMs === null || durationMs === undefined)) {
    if (speed <= 0) {
      httpError(422, 'VALIDATION', 'speed must be greater than zero');
    }
    const newDuration = Math.round((travelDeg / speed) * 1000);
    return [speed, newDuration];
  }
  if (durationMs !== null && durationMs !== undefined && speed !== null && speed !== undefined) {
    const tolerance = Math.max(SPEED_TOLERANCE_FRACTION * computedSpeed, SPEED_TOLERANCE_ABS);
    if (Math.abs(speed - computedSpeed) > tolerance) {
      httpError(
        422, 'SPEED_DURATION_MISMATCH',
        `speed (${speed} deg/s) is inconsistent with duration_ms (${durationMs}) ` +
        `for the resolved travel (${round6(travelDeg)} deg -> ${round6(computedSpeed)} deg/s)`,
      );
    }
    return [speed, durationMs];
  }
  httpError(422, 'VALIDATION', 'Provide at least one of duration_ms or speed');
}

export function deriveStepTiming(seqId, robotId, targets, durationMs, speed, position,
  stepId = null, isUpdate = false) {
  const rowsAll = rows(
    'SELECT id, position, kind, pose_id, servo_id, angle FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id',
    [seqId],
  );
  const entries = [];
  for (const r of rowsAll) {
    if (isUpdate && r.id === stepId) continue;
    entries.push([r.position, r.id, resolveRowTargets(r)]);
  }
  const newMove = {};
  for (const [sid, ang] of targets) newMove[sid] = ang;
  if (isUpdate) {
    entries.push([position, stepId, newMove]);
  } else {
    entries.push([position, null, newMove]);
  }
  entries.sort((a, b) => a[0] - b[0] || (a[1] !== null ? a[1] : -1) - (b[1] !== null ? b[1] : -1));
  const moves = entries.map((e) => e[2]);
  const neutral = neutralMap(robotId);
  const starts = carry(moves, neutral);
  const idx = isUpdate
    ? entries.findIndex((e) => e[1] === stepId)
    : entries.findIndex((e) => e[1] === null);
  const start = starts[idx];
  let travel = 0.0;
  for (const sid of Object.keys(newMove)) {
    travel = Math.max(travel, Math.abs(newMove[sid] - (start[sid] !== undefined ? start[sid] : (neutral[sid] !== undefined ? neutral[sid] : 0.0))));
  }
  return applyTiming(travel, durationMs, speed);
}

export function backfillStepSpeeds() {
  for (const seq of rows('SELECT id, robot_id FROM sequences')) {
    const rowsAll = rows(
      'SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id',
      [seq.id],
    );
    if (!rowsAll.length) continue;
    const neutral = neutralMap(seq.robot_id);
    const moves = rowsAll.map((r) => resolveRowTargets(r));
    const starts = carry(moves, neutral);
    for (let i = 0; i < rowsAll.length; i++) {
      const r = rowsAll[i];
      if (r.speed !== null && r.speed !== undefined) continue;
      const move = moves[i];
      const start = starts[i];
      let travel = 0.0;
      for (const sid of Object.keys(move)) {
        travel = Math.max(travel, Math.abs(
          move[sid] - (start[sid] !== undefined ? start[sid] : (neutral[sid] !== undefined ? neutral[sid] : 0.0)),
        ));
      }
      if (travel <= 0 || r.duration_ms <= 0) continue;
      const speed = travel / (r.duration_ms / 1000.0);
      run('UPDATE sequence_steps SET speed = ? WHERE id = ?', [round6(speed), r.id]);
    }
  }
}

function groupMembership(seqId) {
  const mem = {};
  for (const m of rows(
    `SELECT sgm.step_id AS step_id, sgm.group_id AS group_id
       FROM step_group_members sgm
       JOIN step_groups sg ON sg.id = sgm.group_id
      WHERE sg.sequence_id = ?`,
    [seqId],
  )) {
    mem[m.step_id] = m.group_id;
  }
  return mem;
}

function passDurationMs(seqId, stepsRows, membership) {
  const groupRepeat = {};
  for (const g of rows('SELECT id, repeat_count, repeat_forever FROM step_groups WHERE sequence_id = ?', [seqId])) {
    groupRepeat[g.id] = g.repeat_count !== null ? g.repeat_count : 1;
  }
  let total = 0.0;
  let i = 0;
  const n = stepsRows.length;
  while (i < n) {
    const row = stepsRows[i];
    const gid = membership[row.id];
    if (gid !== undefined) {
      let runLen = 0;
      let grpSum = 0.0;
      while (i + runLen < n && membership[stepsRows[i + runLen].id] === gid) {
        const r = stepsRows[i + runLen];
        grpSum += r.duration_ms + (r.hold_ms || 0);
        runLen++;
      }
      total += grpSum * (groupRepeat[gid] !== undefined ? groupRepeat[gid] : 1);
      i += runLen;
    } else {
      total += row.duration_ms + (row.hold_ms || 0);
      i++;
    }
  }
  return Math.round(total * 1000) / 1000;
}

export function buildPreview(seqId) {
  const seq = one('SELECT * FROM sequences WHERE id = ?', [seqId]);
  if (seq === null) {
    httpError(404, 'NOT_FOUND', `Sequence ${seqId} not found`);
  }
  const robotId = seq.robot_id;
  const servos = servoMap(robotId);
  const neutral = neutralMap(robotId);

  const stepsRows = rows(
    'SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id',
    [seqId],
  );
  const membership = groupMembership(seqId);

  const moves = stepsRows.map((r) => resolveRowTargets(r));
  const starts = carry(moves, neutral);

  const steps = [];
  let t = 0;
  for (let order = 0; order < stepsRows.length; order++) {
    const row = stepsRows[order];
    const startAngles = starts[order];
    if (row.kind === 'pose') {
      const pose = one('SELECT id, name FROM poses WHERE id = ?', [row.pose_id]);
      const poseName = pose !== null ? pose.name : null;
      const targetRows = rows('SELECT servo_id, angle FROM pose_targets WHERE pose_id = ? ORDER BY servo_id', [row.pose_id]);
      const targetsArr = [];
      for (const trg of targetRows) {
        const servo = servos[trg.servo_id];
        if (servo === undefined) continue;
        const fromAngle = startAngles[trg.servo_id] !== undefined ? startAngles[trg.servo_id] : servo.neutral_angle;
        targetsArr.push({
          ...target(servo, trg.angle),
          from_angle: fromAngle,
          from_pulse_us: angleToPulseUs(fromAngle, servo.angle_min, servo.angle_max,
            servo.pulse_min_us, servo.pulse_max_us),
        });
      }
      steps.push({
        order,
        kind: 'pose',
        pose_id: row.pose_id,
        pose_name: poseName,
        duration_ms: row.duration_ms,
        hold_ms: row.hold_ms,
        start_ms: t,
        end_ms: t + row.duration_ms,
        easing: row.easing,
        speed_deg_per_s: row.speed,
        group_id: membership[row.id] !== undefined ? membership[row.id] : null,
        targets: targetsArr,
      });
    } else {
      const servo = servos[row.servo_id];
      if (servo === undefined) {
        httpError(409, 'CONFLICT', `Step ${row.id} references servo ${row.servo_id} which no longer exists`);
      }
      const fromAngle = startAngles[row.servo_id] !== undefined ? startAngles[row.servo_id] : servo.neutral_angle;
      const targetRow = {
        ...target(servo, row.angle),
        from_angle: fromAngle,
        from_pulse_us: angleToPulseUs(fromAngle, servo.angle_min, servo.angle_max,
          servo.pulse_min_us, servo.pulse_max_us),
      };
      steps.push({
        order,
        kind: 'servo',
        servo_id: row.servo_id,
        servo_name: servo.name,
        angle: row.angle,
        pulse_us: targetRow.pulse_us,
        duration_ms: row.duration_ms,
        hold_ms: row.hold_ms,
        start_ms: t,
        end_ms: t + row.duration_ms,
        easing: row.easing,
        speed_deg_per_s: row.speed,
        group_id: membership[row.id] !== undefined ? membership[row.id] : null,
        targets: [targetRow],
      });
    }
    t += row.duration_ms + (row.hold_ms || 0);
  }

  const groups = [];
  for (const g of rows('SELECT * FROM step_groups WHERE sequence_id = ? ORDER BY id', [seqId])) {
    const memberPos = rows(
      `SELECT ss.position FROM step_group_members sgm
         JOIN sequence_steps ss ON ss.id = sgm.step_id
        WHERE sgm.group_id = ? ORDER BY ss.position`,
      [g.id],
    ).map((r) => r.position);
    groups.push({
      id: g.id,
      name: g.name,
      step_orders: memberPos,
      repeat_count: g.repeat_count,
      repeat_forever: Boolean(g.repeat_forever),
    });
  }

  const repeatForever = Boolean(seq.repeat_forever);
  const foreverGroup = groups.some((g) => g.repeat_forever);
  let passMs;
  if (foreverGroup) {
    passMs = null;
  } else {
    passMs = passDurationMs(seqId, stepsRows, membership);
  }
  let totalMs;
  if (repeatForever || passMs === null) {
    totalMs = null;
  } else {
    totalMs = Math.round(passMs * (seq.repeat_count || 1) * 1000) / 1000;
  }

  return {
    sequence_id: seqId,
    sequence_name: seq.name,
    repeat_count: seq.repeat_count,
    repeat_forever: repeatForever,
    groups,
    pass_duration_ms: passMs,
    total_duration_ms: totalMs,
    steps,
  };
}