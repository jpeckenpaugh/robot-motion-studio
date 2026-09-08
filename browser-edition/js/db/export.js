/* Export JSON document builder (ported from backend/app/export.py; brief 05;
 * architecture §5.5, §9.3.7). The export is self-contained: pose references are
 * resolved to concrete servo targets ({servo_id, servo_name, angle, pulse_us})
 * so a downstream consumer never needs the app. schema_version 2: scoped to the
 * currently selected robot, includes robot description, per-step easing/speed,
 * sequence repeat fields, and step groups by 0-based step order.
 */
import { one, rows } from './engine.js';
import { angleToPulseUs } from './pulse.js';
import { resolveRobotId, httpError } from './validation.js';

export const SCHEMA_VERSION = 2;
export const FORMAT = 'robot-servo-sequence';

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

function exportedAt() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function servoMap(robotId) {
  const map = {};
  for (const r of rows('SELECT * FROM servos WHERE robot_id = ?', [robotId])) {
    map[r.id] = r;
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

function sequenceSteps(seqId, servos) {
  const rowsAll = rows('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id', [seqId]);
  const steps = [];
  for (let order = 0; order < rowsAll.length; order++) {
    const row = rowsAll[order];
    let targetsArr;
    if (row.kind === 'pose') {
      targetsArr = rows('SELECT servo_id, angle FROM pose_targets WHERE pose_id = ? ORDER BY servo_id', [row.pose_id])
        .filter((t) => servos[t.servo_id] !== undefined)
        .map((t) => target(servos[t.servo_id], t.angle));
    } else {
      targetsArr = [target(servos[row.servo_id], row.angle)];
    }
    steps.push({
      order,
      duration_ms: row.duration_ms,
      hold_ms: row.hold_ms,
      easing: row.easing,
      speed_deg_per_s: row.speed,
      targets: targetsArr,
    });
  }
  return steps;
}

function sequenceGroups(seqId) {
  const groups = [];
  for (const g of rows('SELECT * FROM step_groups WHERE sequence_id = ? ORDER BY id', [seqId])) {
    const orders = rows(
      `SELECT ss.position FROM step_group_members sgm
         JOIN sequence_steps ss ON ss.id = sgm.step_id
        WHERE sgm.group_id = ? ORDER BY ss.position`,
      [g.id],
    ).map((r) => r.position);
    groups.push({
      name: g.name,
      step_orders: orders,
      repeat_count: g.repeat_count,
      repeat_forever: Boolean(g.repeat_forever),
    });
  }
  return groups;
}

export function buildExport(robotId = null, seqId = null) {
  const rid = resolveRobotId(robotId);
  const robot = one('SELECT id, name, description FROM robots WHERE id = ?', [rid]);
  if (robot === null) {
    httpError(404, 'NOT_FOUND', `Robot ${rid} not found to export`);
  }
  const servos = servoMap(rid);

  let seqRows;
  if (seqId === null) {
    seqRows = rows('SELECT id, name FROM sequences WHERE robot_id = ? ORDER BY id', [rid]);
  } else {
    const seqRow = one('SELECT id, name FROM sequences WHERE id = ? AND robot_id = ?', [seqId, rid]);
    if (seqRow === null) {
      httpError(404, 'NOT_FOUND', `Sequence ${seqId} not found on this robot`);
    }
    seqRows = [seqRow];
  }

  const sequences = [];
  for (const s of seqRows) {
    const seqFull = one('SELECT * FROM sequences WHERE id = ?', [s.id]);
    sequences.push({
      id: s.id,
      name: s.name,
      repeat_count: seqFull.repeat_count,
      repeat_forever: Boolean(seqFull.repeat_forever),
      groups: sequenceGroups(s.id),
      steps: sequenceSteps(s.id, servos),
    });
  }

  return {
    schema_version: SCHEMA_VERSION,
    format: FORMAT,
    exported_at: exportedAt(),
    robot: {
      id: robot.id,
      name: robot.name,
      description: robot.description,
      servos: Object.values(servos).map((s) => servoToDict(s)),
    },
    sequences,
  };
}

export function filenameFor(robotName, seqName = null) {
  function safe(s) {
    const cleaned = String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
    return cleaned || 'robot';
  }
  let base = safe(robotName);
  if (seqName !== null) {
    base = `${base}-${safe(seqName)}`;
  }
  return `${base}.json`;
}