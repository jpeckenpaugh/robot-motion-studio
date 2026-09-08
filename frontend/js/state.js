/* Client-side view state and refresh orchestration (architecture §4, §9.5).
 * The frontend is a view over the backend's persisted records. The current
 * robot is the backend-persisted selection (GET /api/state/current-robot);
 * every robot-scoped capability (poses, sequences, preview, export, timeline,
 * simulator) operates against it. This module loads the robot collection, the
 * current robot + its servos, and the current robot's poses and sequences,
 * holds them in memory, and exposes a single refresh() that all views call
 * after a mutation so the UI stays in sync with the single source of truth.
 */
(function (global) {
  'use strict';

  const state = {
    robots: [],          // [{id, name, description, servo_count, current}]
    currentRobotId: null,
    robotName: '',
    robotDescription: '',
    simConfig: null,     // parsed robots.sim_config (frontend-interpreted), if any
    servos: [],          // [{id, name, pwm_pin, angle_min, angle_max, neutral_angle, pulse_min_us, pulse_max_us}]
    poses: [],           // [{id, name, targets: [{servo_id, angle}]}]
    sequences: [],       // [{id, name, step_count, repeat_count, repeat_forever}]
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
    const [robots, current] = await Promise.all([
      API.get('/robots'),
      API.get('/state/current-robot'),
    ]);

    state.robots = robots || [];
    let robotId = (current && current.robot_id != null)
      ? current.robot_id
      : (robots && robots.length ? robots[0].id : null);

    if (robotId == null) {
      // Empty collection (all robots deleted): present an empty state rather
      // than failing. The backend has no current selection (FK SET NULL).
      state.currentRobotId = null;
      state.robotName = '';
      state.robotDescription = '';
      state.simConfig = null;
      state.servos = [];
      state.poses = [];
      state.sequences = [];
      state.selectedSequenceId = null;
      notify();
      return state;
    }

    const robot = await API.get('/robots/' + robotId);
    state.currentRobotId = robot.id;
    state.robotName = robot.name;
    state.robotDescription = robot.description || '';
    state.simConfig = robot.sim_config || null;
    state.servos = robot.servos || [];

    const [poses, sequences] = await Promise.all([
      API.get('/poses?robot_id=' + robotId),
      API.get('/sequences?robot_id=' + robotId),
    ]);
    state.poses = poses || [];
    state.sequences = sequences || [];

    if (state.selectedSequenceId !== null) {
      const stillThere = state.sequences.some((s) => s.id === state.selectedSequenceId);
      if (!stillThere) state.selectedSequenceId = null;
    }

    notify();
    return state;
  }

  /* Select a robot as current (persisted by the backend) and refresh. */
  async function setCurrentRobot(robotId) {
    await API.put('/state/current-robot', { robot_id: robotId });
    state.selectedSequenceId = null;
    await refresh();
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

  function robotById(id) {
    return state.robots.find((r) => r.id === id) || null;
  }

  global.STATE = state;
  global.StateController = {
    refresh: refresh,
    setCurrentRobot: setCurrentRobot,
    onRefresh: onRefresh,
    servoById: servoById,
    poseById: poseById,
    sequenceById: sequenceById,
    robotById: robotById,
  };
})(window);