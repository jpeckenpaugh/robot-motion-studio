/* Shared validation rules and error helpers (ported from
 * backend/app/validation.py; architecture §3, §5, §9).
 *
 * Error responses use the standard shape:
 *     { detail: "human-readable message", code: "MACHINE_CODE" }
 * Error semantics: 400 malformed; 404 not found; 409 reference conflict;
 * 422 validation failure. The worker catches these and turns them into the
 * same {status, code, detail} the HTTP edition returns.
 *
 * Stable `code` vocabulary (recorded in the summaries):
 *     VALIDATION, NOT_FOUND, SERVO_REFERENCED, POSE_REFERENCED, CONFLICT,
 *     SPEED_DURATION_MISMATCH, GROUP_SPLIT
 */
import { one, rows } from './engine.js';

export const EASING_VALUES = ['linear', 'ease_in', 'ease_out', 'ease_in_out'];
export const DEFAULT_EASING = 'linear';

export class ApiError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = statusCode;
    this.code = code;
    this.detail = message;
  }
}

export function httpError(statusCode, code, message) {
  throw new ApiError(statusCode, code, message);
}

export function robotExists(robotId) {
  return one('SELECT 1 FROM robots WHERE id = ?', [robotId]) !== null;
}

export function fetchRobotOr404(robotId) {
  const row = one('SELECT id, name FROM robots WHERE id = ?', [robotId]);
  if (row === null) {
    httpError(404, 'NOT_FOUND', `Robot ${robotId} not found`);
  }
  return row;
}

export function fetchServoOr404(robotId, servoId) {
  const row = one(
    'SELECT * FROM servos WHERE id = ? AND robot_id = ?', [servoId, robotId],
  );
  if (row === null) {
    httpError(404, 'NOT_FOUND', `Servo ${servoId} not found on robot ${robotId}`);
  }
  return row;
}

export function validateServoValues(name, pwmPin, angleMin, angleMax, neutralAngle, pulseMinUs, pulseMaxUs) {
  if (!name || !String(name).trim()) {
    httpError(422, 'VALIDATION', 'Servo name must not be empty');
  }
  if (angleMin >= angleMax) {
    httpError(422, 'VALIDATION', `angle_min (${angleMin}) must be less than angle_max (${angleMax})`);
  }
  if (!(angleMin <= neutralAngle && neutralAngle <= angleMax)) {
    httpError(
      422, 'VALIDATION',
      `neutral_angle (${neutralAngle}) must lie within [angle_min, angle_max] = [${angleMin}, ${angleMax}]`,
    );
  }
  if (pulseMinUs <= 0 || pulseMaxUs <= 0) {
    httpError(422, 'VALIDATION', 'Pulse widths must be greater than zero');
  }
  if (pulseMinUs >= pulseMaxUs) {
    httpError(
      422, 'VALIDATION',
      `pulse_min_us (${pulseMinUs}) must be less than pulse_max_us (${pulseMaxUs})`,
    );
  }
}

export function ensureServoNameAvailable(robotId, name, excludeId = null) {
  let q = 'SELECT 1 FROM servos WHERE robot_id = ? AND name = ?';
  const args = [robotId, name];
  if (excludeId !== null) {
    q += ' AND id != ?';
    args.push(excludeId);
  }
  if (one(q, args) !== null) {
    httpError(409, 'CONFLICT', `A servo named '${name}' already exists on this robot`);
  }
}

export function ensureServoPinAvailable(robotId, pwmPin, excludeId = null) {
  let q = 'SELECT 1 FROM servos WHERE robot_id = ? AND pwm_pin = ?';
  const args = [robotId, pwmPin];
  if (excludeId !== null) {
    q += ' AND id != ?';
    args.push(excludeId);
  }
  if (one(q, args) !== null) {
    httpError(409, 'CONFLICT', `PWM pin ${pwmPin} is already used by another servo on this robot`);
  }
}

export function ensurePoseNameAvailable(robotId, name, excludeId = null) {
  let q = 'SELECT 1 FROM poses WHERE robot_id = ? AND name = ?';
  const args = [robotId, name];
  if (excludeId !== null) {
    q += ' AND id != ?';
    args.push(excludeId);
  }
  if (one(q, args) !== null) {
    httpError(409, 'CONFLICT', `A pose named '${name}' already exists on this robot`);
  }
}

export function ensureSequenceNameAvailable(robotId, name, excludeId = null) {
  let q = 'SELECT 1 FROM sequences WHERE robot_id = ? AND name = ?';
  const args = [robotId, name];
  if (excludeId !== null) {
    q += ' AND id != ?';
    args.push(excludeId);
  }
  if (one(q, args) !== null) {
    httpError(409, 'CONFLICT', `A sequence named '${name}' already exists on this robot`);
  }
}

export function currentRobotId() {
  const row = one('SELECT current_robot_id FROM app_state WHERE id = 1');
  if (row !== null && row.current_robot_id !== null && robotExists(row.current_robot_id)) {
    return row.current_robot_id;
  }
  const low = one('SELECT MIN(id) AS m FROM robots');
  if (low === null || low.m === null) {
    httpError(404, 'NOT_FOUND', 'No robot configured yet');
  }
  return low.m;
}

export function resolveRobotId(robotId) {
  if (robotId !== null && robotId !== undefined) {
    if (!robotExists(robotId)) {
      httpError(404, 'NOT_FOUND', `Robot ${robotId} not found`);
    }
    return robotId;
  }
  return currentRobotId();
}

export function requireName(name) {
  const cleaned = String(name || '').trim();
  if (!cleaned) {
    httpError(422, 'VALIDATION', 'name must not be empty');
  }
  return cleaned;
}

export function validateDescription(description) {
  return description === null || description === undefined ? '' : String(description);
}

export function validateEasing(easing) {
  if (!EASING_VALUES.includes(easing)) {
    httpError(422, 'VALIDATION', `easing must be one of ${EASING_VALUES.join(', ')}`);
  }
  return easing;
}

export function validateRepeat(repeatCount, repeatForever) {
  if (repeatCount !== null && repeatCount !== undefined && repeatCount < 1) {
    httpError(422, 'VALIDATION', 'repeat_count must be null (run once) or >= 1');
  }
  if (repeatForever && repeatCount !== null && repeatCount !== undefined) {
    httpError(422, 'VALIDATION', 'repeat_count and repeat_forever are mutually exclusive');
  }
}

export function validateGroupContiguity(seqId) {
  const groups = rows('SELECT id FROM step_groups WHERE sequence_id = ?', [seqId]);
  if (!groups.length) return;
  const byGroup = {};
  for (const r of rows(
    `SELECT sgm.group_id AS group_id, ss.position AS position
       FROM step_group_members sgm
       JOIN sequence_steps ss ON ss.id = sgm.step_id
      WHERE ss.sequence_id = ?
      ORDER BY sgm.group_id, ss.position`,
    [seqId],
  )) {
    (byGroup[r.group_id] = byGroup[r.group_id] || []).push(r.position);
  }
  for (const gid of Object.keys(byGroup)) {
    const positions = byGroup[gid].sort((a, b) => a - b);
    const expected = positions.map((_, i) => positions[0] + i);
    if (positions.join(',') !== expected.join(',')) {
      httpError(
        422, 'GROUP_SPLIT',
        'This change would split a step group; move or remove the group first.',
      );
    }
  }
}