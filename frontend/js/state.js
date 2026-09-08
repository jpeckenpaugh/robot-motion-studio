/* Client-side view state and refresh orchestration (architecture §4).
 * The frontend is a view over the backend's persisted records. This module
 * loads the current robot, its servos, poses, and sequences from the API,
 * holds them in memory, and exposes a single refresh() that all views call
 * after a mutation so the UI stays in sync with the single source of truth.
 */
(function (global) {
  'use strict';

  const state = {
    currentRobotId: null,
    robotName: '',
    servos: [],        // [{id, name, pwm_pin, angle_min, angle_max, neutral_angle, pulse_min_us, pulse_max_us}]
    poses: [],         // [{id, name, targets: [{servo_id, angle}]}]
    sequences: [],     // [{id, name, step_count}]
    selectedSequenceId: null,
  };

  let _refreshListeners = [];

  function onRefresh(fn) {
    _refreshListeners.push(fn);
  }

  function notify() {
    _refreshListeners.forEach((fn) => {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  /* Load the full view state from the backend. Never persists locally. */
  async function refresh() {
    const [robots, poses, sequences] = await Promise.all([
      API.get('/robots'),
      API.get('/poses'),
      API.get('/sequences'),
    ]);

    if (!robots || robots.length === 0) {
      throw new Error('No robot is configured on the backend.');
    }
    const robotId = robots[0].id;
    const robot = await API.get('/robots/' + robotId);

    state.currentRobotId = robot.id;
    state.robotName = robot.name;
    state.servos = robot.servos || [];
    state.poses = poses;
    state.sequences = sequences;

    if (state.selectedSequenceId !== null) {
      const stillThere = sequences.some((s) => s.id === state.selectedSequenceId);
      if (!stillThere) state.selectedSequenceId = null;
    }

    notify();
    return state;
  }

  function servoById(id) {
    return state.servos.find((s) => s.id === id) || null;
  }

  function poseById(id) {
    return state.poses.find((p) => p.id === id) || null;
  }

  function sequenceById(id) {
    return state.sequences.find((s) => s.id === id) || null;
  }

  global.STATE = state;
  global.StateController = {
    refresh: refresh,
    onRefresh: onRefresh,
    servoById: servoById,
    poseById: poseById,
    sequenceById: sequenceById,
  };
})(window);