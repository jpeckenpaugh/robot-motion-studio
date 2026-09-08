/* Motion simulator renderer (brief 05; architecture §9.4).
 *
 * A Canvas-based, dependency-free, read-only visualizer that renders a robot's
 * servos/arm and, for the door durability tester rig, its environment (wall,
 * door, handle) and animates the resolved /preview motion document via the
 * shared motion.js module — so play, pause, and scrub are timing-accurate and
 * agree exactly with the timeline editor.
 *
 * Geometry is schematic and frontend-interpreted (§9.2.1): the arm chain is
 * computed exactly from the configured servo angles (joint order + segment
 * lengths from sim_config); the environment primitives are drawn from
 * sim_config. The door handle is placed at the gripper tip of a "grip" pose
 * (falling back to the neutral reach, then to sim_config) so the arm visibly
 * reaches, grips, and works the handle. Robots without sim_config get an
 * abstract servo-chain render.
 */
(function (global) {
  'use strict';

  const D2R = Math.PI / 180;

  function servoByName(servos, name) {
    return servos.find((s) => s.name === name) || null;
  }

  /* Build the arm chain from sim_config (or an abstract chain from the servos
   * in order when sim_config is absent). Returns
   * { joints, gripper, anchor, generic } where joints are
   * { name, servoId, len, neutral }. */
  function buildChain(simConfig, servos) {
    if (simConfig && Array.isArray(simConfig.joints) && simConfig.joints.length) {
      const joints = simConfig.joints
        .map((j) => {
          const servo = servoByName(servos, j.servo_name);
          if (!servo) return null;
          return {
            name: j.servo_name,
            servoId: servo.id,
            len: j.segment_len || 40,
            neutral: servo.neutral_angle,
          };
        })
        .filter(Boolean);
      let gripper = null;
      if (simConfig.gripper) {
        const g = servoByName(servos, simConfig.gripper.servo_name);
        if (g) gripper = { servoId: g.id, len: simConfig.gripper.jaw_len || 8, neutral: g.neutral_angle };
      }
      const anchor = simConfig.anchor
        ? { x: simConfig.anchor.x || 0, z: simConfig.anchor.z || 0 }
        : { x: 0, z: 0 };
      return { joints: joints, gripper: gripper, anchor: anchor, generic: false };
    }
    const joints = servos.map((s) => ({
      name: s.name,
      servoId: s.id,
      len: 80 / Math.max(servos.length, 1),
      neutral: s.neutral_angle,
    }));
    return { joints: joints, gripper: null, anchor: { x: 0, z: 50 }, generic: true };
  }

  /* Forward-kinematics of the planar arm chain (world: x right, z up).
   * `joints` is the ordered joint list; the first joint's angle is the
   * absolute limb angle from +x; every later joint bends the next segment by
   * its angle. Returns { points, tipAngle }. */
  function chainPoints(joints, angles, anchor) {
    const points = [{ x: anchor.x, z: anchor.z }];
    let a = 0;
    joints.forEach((j, i) => {
      const deg = angles[j.servoId] != null ? angles[j.servoId] : j.neutral;
      if (i === 0) a = deg * D2R;
      else a += deg * D2R;
      const prev = points[points.length - 1];
      points.push({ x: prev.x + j.len * Math.cos(a), z: prev.z + j.len * Math.sin(a) });
    });
    return { points: points, tipAngle: a };
  }

  function gripTipPoint(chain, angles, anchor, gripper) {
    const c = chainPoints(chain.joints, angles, anchor);
    const last = c.points[c.points.length - 1];
    if (!gripper) return last;
    const deg = angles[gripper.servoId] != null ? angles[gripper.servoId] : gripper.neutral;
    const a = c.tipAngle + deg * D2R;
    return { x: last.x + gripper.len * Math.cos(a), z: last.z + gripper.len * Math.sin(a) };
  }

  function servoAnglesForPose(servos, pose) {
    const map = {};
    servos.forEach((s) => { map[s.id] = s.neutral_angle; });
    (pose.targets || []).forEach((t) => { map[t.servo_id] = t.angle; });
    return map;
  }

  /* Pick a "grip" pose (name contains "grip"), else the neutral reach. */
  function pickHandlePose(poses) {
    const grip = (poses || []).find((p) => /grip/i.test(p.name || ''));
    if (grip) return grip;
    return (poses || []).find((p) => /reach/i.test(p.name || '')) || null;
  }

  function create(canvas, opts) {
    const ctx = canvas.getContext('2d');
    const servos = (opts && opts.servos) || [];
    const simConfig = (opts && opts.simConfig) || null;
    const poses = (opts && opts.poses) || [];
    const chain = buildChain(simConfig, servos);
    const neutral = {};
    servos.forEach((s) => { neutral[s.id] = s.neutral_angle; });

    // Handle home position: the gripper tip of the grip/reach pose (or the
    // neutral reach); falls back to sim_config coordinates.
    const handlePose = pickHandlePose(poses);
    const handleAngles = handlePose ? servoAnglesForPose(servos, handlePose) : neutral;
    let handleHome = gripTipPoint(chain, handleAngles, chain.anchor, chain.gripper);
    const env = (simConfig && simConfig.environment) || {};
    if (!handlePose && env.handle && env.handle.x != null && env.handle.z != null) {
      handleHome = { x: env.handle.x, z: env.handle.z };
    }

    const hinge = { x: chain.anchor.x, z: handleHome.z };
    const door = {
      hinge: hinge,
      handle: { x: handleHome.x, z: handleHome.z },
      frameW: (env.door && env.door.frame_width) || 90,
      frameH: (env.door && env.door.frame_height) || 200,
      wallX: (env.wall && env.wall.x != null) ? env.wall.x : chain.anchor.x,
    };

    let doc = null;
    let expansion = null;
    let elapsedMs = 0;
    let playing = false;
    let rafId = null;
    let lastTs = null;
    let dragging = false;
    let scene = null;
    let onTime = null;

    function setDoc(d) {
      doc = d || null;
      expansion = doc ? Motion.expand(doc) : null;
      elapsedMs = 0;
      stop();
      update();
    }

    function setOnTime(fn) { onTime = fn; }

    function playableMs() {
      if (!expansion || !expansion.segments.length) return 0;
      return expansion.segments[expansion.segments.length - 1].end;
    }

    function passMs() { return expansion ? expansion.passMs : 0; }

    function isForever() { return !!(expansion && expansion.forever); }

    function isPlaying() { return playing; }

    function stop() {
      playing = false;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      lastTs = null;
    }

    function play() {
      if (!expansion || !expansion.segments.length) return;
      playing = true;
      lastTs = null;
      rafId = requestAnimationFrame(tick);
    }

    function toggle() {
      if (playing) stop();
      else play();
    }

    function reset() {
      elapsedMs = 0;
      stop();
      update();
    }

    function scrubFrac(frac) {
      const total = playableMs();
      if (total <= 0) return;
      stop();
      const target = frac * total;
      if (isForever() && passMs() > 0) elapsedMs = target % passMs();
      else elapsedMs = Math.min(Math.max(target, 0), total);
      update();
    }

    function tick(ts) {
      if (!playing) return;
      if (lastTs === null) lastTs = ts;
      const dt = ts - lastTs;
      lastTs = ts;
      elapsedMs += dt;
      if (isForever()) {
        const pass = passMs();
        if (pass > 0) elapsedMs = elapsedMs % pass;
      } else {
        const total = playableMs();
        if (elapsedMs >= total) { elapsedMs = total; stop(); }
      }
      update();
      if (playing) rafId = requestAnimationFrame(tick);
    }

    /* ---- scene fitting: world (x right, z up) → canvas (x right, y down) ---- */

    function worldPoints() {
      const pts = [];
      chainPoints(chain.joints, neutral, chain.anchor).points.forEach((p) => pts.push(p));
      if (chain.gripper) pts.push(gripTipPoint(chain, neutral, chain.anchor, chain.gripper));
      pts.push(hinge);
      pts.push(handleHome);
      pts.push({ x: door.wallX, z: 0 });
      pts.push({ x: door.wallX + door.frameW, z: door.frameH });
      return pts;
    }

    function computeScene() {
      const W = canvas.clientWidth || canvas.width || 640;
      const H = canvas.clientHeight || canvas.height || 400;
      const pts = worldPoints();
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      pts.forEach((p) => {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.z < z0) z0 = p.z;
        if (p.z > z1) z1 = p.z;
      });
      const padX = Math.max(20, (x1 - x0) * 0.12);
      const padZ = Math.max(20, (z1 - z0) * 0.12);
      x0 -= padX; x1 += padX; z0 -= padZ; z1 += padZ;
      const scale = Math.min(W / (x1 - x0), H / (z1 - z0));
      scene = {
        scale: scale,
        ox: (W - (x1 - x0) * scale) / 2 - x0 * scale,
        oy: (H - (z1 - z0) * scale) / 2 + z1 * scale,
      };
    }

    function sx(x) { return scene.ox + x * scene.scale; }
    function sy(z) { return scene.oy - z * scene.scale; }

    function resize() {
      const dpr = global.devicePixelRatio || 1;
      const W = canvas.clientWidth || canvas.parentElement.clientWidth || 640;
      const H = canvas.clientHeight || 400;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      computeScene();
      update();
    }

    /* ---- drawing ---- */

    function drawEnvironment(W, H) {
      // Wall
      ctx.strokeStyle = '#adb5bd';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sx(door.wallX), 0);
      ctx.lineTo(sx(door.wallX), H);
      ctx.stroke();
      ctx.fillStyle = '#6c757d';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('wall', sx(door.wallX) + 4, 14);

      // Door panel: hinged on the wall, rotated to follow the handled point.
      const dx = door.handle.x - door.hinge.x;
      const dz = door.handle.z - door.hinge.z;
      const len = Math.max(30, Math.hypot(dx, dz) + 15);
      const ang = Math.atan2(dz, dx);
      const panelH = Math.max(20, door.frameH * scene.scale * 0.18);
      ctx.save();
      ctx.translate(sx(door.hinge.x), sy(door.hinge.z));
      ctx.rotate(-ang); // screen y-down flips the world rotation
      ctx.fillStyle = '#dee2e6';
      ctx.strokeStyle = '#ced4da';
      ctx.lineWidth = 1;
      ctx.fillRect(0, -panelH / 2, len * scene.scale, panelH);
      ctx.strokeRect(0, -panelH / 2, len * scene.scale, panelH);
      ctx.restore();

      // Handle
      const hpx = sx(door.handle.x), hpy = sy(door.handle.z);
      ctx.beginPath();
      ctx.arc(hpx, hpy, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#0d6efd';
      ctx.fill();
      ctx.strokeStyle = '#0b5ed7';
      ctx.stroke();
      ctx.fillStyle = '#495057';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText('handle', hpx + 8, hpy - 6);
    }

    function drawArm(W, H) {
      const state = Motion.resolveState(doc, elapsedMs,
        expansion ? expansion.segments : [], neutral);
      const angles = state.servos;
      const c = chainPoints(chain.joints, angles, chain.anchor);
      const pts = c.points;

      // Link segments
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#212529';
      ctx.lineWidth = 10;
      for (let i = 1; i < pts.length; i++) {
        ctx.beginPath();
        ctx.moveTo(sx(pts[i - 1].x), sy(pts[i - 1].z));
        ctx.lineTo(sx(pts[i].x), sy(pts[i].z));
        ctx.stroke();
      }

      // Gripper jaws (spread proportional to the gripper angle, 0..60)
      if (chain.gripper) {
        const last = pts[pts.length - 1];
        const gDeg = angles[chain.gripper.servoId] != null
          ? angles[chain.gripper.servoId] : chain.gripper.neutral;
        const spread = 0.10 + 0.40 * (gDeg / 60);
        const jawLen = chain.gripper.len * scene.scale;
        ctx.strokeStyle = '#198754';
        ctx.lineWidth = 4;
        for (const dir of [-1, 1]) {
          const a = c.tipAngle + dir * spread;
          ctx.beginPath();
          ctx.moveTo(sx(last.x), sy(last.z));
          ctx.lineTo(sx(last.x) + jawLen * Math.cos(a),
            sy(last.z) - jawLen * Math.sin(a));
          ctx.stroke();
        }
      }

      // Joints + per-servo labels
      ctx.font = '10px system-ui, sans-serif';
      for (let i = 0; i < pts.length; i++) {
        ctx.beginPath();
        ctx.arc(sx(pts[i].x), sy(pts[i].z), 5, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? '#6f42c1' : '#0d6efd';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (i > 0 && chain.joints[i - 1]) {
          const j = chain.joints[i - 1];
          const ang = angles[j.servoId] != null ? angles[j.servoId] : j.neutral;
          ctx.fillStyle = '#495057';
          ctx.fillText(j.name + ' ' + Math.round(ang) + '\u00b0',
            sx(pts[i].x) + 8, sy(pts[i].z) - 6);
        }
      }
    }

    function drawInfo(W, H) {
      if (!doc) return;
      const state = Motion.resolveState(doc, elapsedMs,
        expansion ? expansion.segments : [], neutral);
      const info = (doc.sequence_name || '') +
        ' \u00b7 ' + Math.round(elapsedMs) + ' ms' +
        (isForever() ? ' \u00b7 looping' : ' \u00b7 ' + Math.round(playableMs()) + ' ms total');
      ctx.fillStyle = 'rgba(33,37,41,0.75)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(info, 10, H - 8);
      if (state.step) {
        ctx.fillStyle = 'rgba(33,37,41,0.55)';
        ctx.fillText('step ' + (state.step.order + 1) + ' \u00b7 ' +
          (state.step.easing || 'linear') +
          (state.holding ? ' \u00b7 holding' : ''), 10, H - 22);
      }
    }

    function draw() {
      if (!scene) computeScene();
      const W = canvas.clientWidth || 640;
      const H = canvas.clientHeight || 400;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#f8f9fa';
      ctx.fillRect(0, 0, W, H);

      // Door handle tracks the grip tip while the gripper is closed.
      const state = Motion.resolveState(doc, elapsedMs,
        expansion ? expansion.segments : [], neutral);
      const gDeg = chain.gripper
        ? (state.servos[chain.gripper.servoId] != null
            ? state.servos[chain.gripper.servoId] : chain.gripper.neutral)
        : 60;
      if (chain.gripper && gDeg < 30) {
        const tip = gripTipPoint(chain, state.servos, chain.anchor, chain.gripper);
        door.handle = { x: tip.x, z: tip.z };
      } else {
        door.handle = { x: handleHome.x, z: handleHome.z };
      }

      drawEnvironment(W, H);
      drawArm(W, H);
      drawInfo(W, H);
    }

    function update() {
      if (!doc) {
        const W = canvas.clientWidth || 640;
        const H = canvas.clientHeight || 400;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#adb5bd';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('No sequence selected.', 12, 20);
        return;
      }
      draw();
      if (onTime) onTime(elapsedMs);
    }

    /* ---- interaction: click/drag on the canvas scrubs ---- */
    function posFromEvent(e) {
      const rect = canvas.getBoundingClientRect();
      return Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    }
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      if (e.pointerId !== undefined && e.pointerId !== null) {
        try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ }
      }
      scrubFrac(posFromEvent(e));
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) scrubFrac(posFromEvent(e));
    });
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('pointercancel', () => { dragging = false; });

    return {
      setDoc: setDoc,
      setOnTime: setOnTime,
      play: play,
      pause: stop,
      toggle: toggle,
      reset: reset,
      scrubFrac: scrubFrac,
      playableMs: playableMs,
      isForever: isForever,
      isPlaying: isPlaying,
      resize: resize,
      destroy: () => { stop(); },
    };
  }

  global.Simulator = { create: create };
})(window);