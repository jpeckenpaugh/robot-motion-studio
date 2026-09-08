/* Shared motion module (architecture §9.4, §9.5).
 *
 * Holds the canonical easing curves, speed/duration derivation, loop expansion,
 * and elapsed-time → servo-angle mapping used by BOTH the timeline editor
 * playback and the simulator so they cannot diverge. The backend /preview
 * document is the authoritative resolved motion source for saved data; this
 * module animates that document and (optionally) builds drafts for unsaved
 * edits using the same rules (§9.2.2–9.2.4).
 *
 * The easing curves are identical to the backend resolution (§9.2.3):
 *     linear      p = t
 *     ease_in     p = t^3
 *     ease_out    p = 1 − (1−t)^3
 *     ease_in_out p = t < 0.5 ? 4t^3 : 1 − (−2t+2)^3 / 2
 */
(function (global) {
  'use strict';

  const EASING_VALUES = ['linear', 'ease_in', 'ease_out', 'ease_in_out'];
  const DEFAULT_EASING = 'linear';

  function clamp01(t) {
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  function round6(x) {
    return Math.round(x * 1e6) / 1e6;
  }

  /* Canonical easing curves (§9.2.3). t is normalized elapsed time over the
   * movement phase; returns eased progress in [0,1]. */
  function ease(easing, t) {
    t = clamp01(t);
    switch (easing) {
      case 'ease_in':
        return t * t * t;
      case 'ease_out':
        return 1 - Math.pow(1 - t, 3);
      case 'ease_in_out':
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      case 'linear':
      default:
        return t;
    }
  }

  /* Resolve speed (deg/s) and duration_ms from travel + at least one given
   * value, mirroring backend §9.2.2. travel_deg <= 0 → stationary (speed null).
   * Throws on incoherent pair (speed & duration disagree beyond tolerance). */
  const SPEED_TOLERANCE_FRACTION = 0.005;
  const SPEED_TOLERANCE_ABS = 0.05;

  function speedAndDuration(travelDeg, durationMs, speed) {
    const hasDur = durationMs !== null && durationMs !== undefined;
    const hasSpeed = speed !== null && speed !== undefined;
    if (travelDeg <= 0) {
      if (!hasDur) {
        throw new Error('duration_ms is required for a stationary step.');
      }
      return { speed: null, duration_ms: durationMs };
    }
    if (!hasDur) {
      if (speed <= 0) throw new Error('speed must be greater than zero');
      return { speed: speed, duration_ms: Math.round(travelDeg / speed * 1000) };
    }
    const computedSpeed = travelDeg / (durationMs / 1000);
    if (!hasSpeed) {
      return { speed: round6(computedSpeed), duration_ms: durationMs };
    }
    const tolerance = Math.max(
      SPEED_TOLERANCE_FRACTION * computedSpeed, SPEED_TOLERANCE_ABS
    );
    if (Math.abs(speed - computedSpeed) > tolerance) {
      const err = new Error(
        'speed (' + speed + ' deg/s) is inconsistent with duration_ms (' +
        durationMs + ') for the resolved travel (' + round6(travelDeg) +
        ' deg → ' + round6(computedSpeed) + ' deg/s)'
      );
      err.code = 'SPEED_DURATION_MISMATCH';
      throw err;
    }
    return { speed: speed, duration_ms: durationMs };
  }

  function makeSeg(step, start) {
    const dur = step.duration_ms || 0;
    const hold = step.hold_ms || 0;
    return {
      step: step,
      start: start,
      moveEnd: start + dur,
      end: start + dur + hold,
      duration: dur,
      hold: hold,
    };
  }

  function offsetSeg(seg, delta) {
    return {
      step: seg.step,
      start: seg.start + delta,
      moveEnd: seg.moveEnd + delta,
      end: seg.end + delta,
      duration: seg.duration,
      hold: seg.hold,
    };
  }

  /* Expand one pass of the preview document into segments honoring step-group
   * repeats (§9.2.4). Each segment: { step, start, moveEnd, end, duration,
   * hold } with absolute ms from pass start (group repeats already expanded).
   * The last segment's `end` is the pass duration. */
  function buildPassSegments(doc) {
    const steps = (doc.steps || []).slice().sort((a, b) => a.order - b.order);
    const gRepeat = {};
    (doc.groups || []).forEach((g) => {
      gRepeat[g.id] = g.repeat_count !== null && g.repeat_count !== undefined
        ? g.repeat_count : 1;
    });

    const segments = [];
    let t = 0;
    let i = 0;
    const n = steps.length;
    while (i < n) {
      const step = steps[i];
      const gid = step.group_id;
      if (gid !== null && gid !== undefined) {
        const run = [];
        while (i < n && steps[i].group_id === gid) {
          run.push(steps[i]);
          i++;
        }
        const rep = gRepeat[gid] || 1;
        for (let r = 0; r < rep; r++) {
          for (const s of run) {
            segments.push(makeSeg(s, t));
            t += s.duration_ms + (s.hold_ms || 0);
          }
        }
      } else {
        segments.push(makeSeg(step, t));
        t += step.duration_ms + (step.hold_ms || 0);
        i++;
      }
    }
    return segments;
  }

  /* Full expansion honoring BOTH step-group repeats and the whole-sequence
   * repeat (§9.2.4). Returns { segments, passSegments, forever, truncated,
   * passMs }. Finite sequence repeats are expanded up to `cap` segments (the
   * playable timeline is clamped to what was rendered; `truncated` is set when
   * the cap was hit). A `repeat_forever` sequence/group is NOT expanded —
   * callers wrap the single pass. */
  function expand(doc, cap) {
    const passSegments = buildPassSegments(doc);
    const passMs = passSegments.length ? passSegments[passSegments.length - 1].end : 0;
    const forever = !!(doc.repeat_forever ||
      (doc.groups || []).some((g) => g.repeat_forever));
    if (forever) {
      return {
        segments: passSegments,
        passSegments: passSegments,
        forever: true,
        truncated: false,
        passMs: passMs,
      };
    }
    const repeat = doc.repeat_count && doc.repeat_count >= 1 ? doc.repeat_count : 1;
    if (repeat <= 1 || passMs <= 0) {
      return {
        segments: passSegments,
        passSegments: passSegments,
        forever: false,
        truncated: false,
        passMs: passMs,
      };
    }
    const limit = cap && cap > 0 ? cap : 4096;
    const segments = [];
    let truncated = false;
    for (let r = 0; r < repeat; r++) {
      const delta = r * passMs;
      for (const seg of passSegments) {
        if (segments.length >= limit) { truncated = true; break; }
        segments.push(offsetSeg(seg, delta));
      }
      if (truncated) break;
    }
    return {
      segments: segments,
      passSegments: passSegments,
      forever: false,
      truncated: truncated,
      passMs: passMs,
    };
  }

  /* Total duration of a set of segments (the last segment's end). */
  function passDuration(segs) {
    if (!segs || !segs.length) return 0;
    return segs[segs.length - 1].end;
  }

  /* Total finite duration honoring the sequence-level repeat, or null when the
   * sequence (or a group) repeats forever. */
  function totalDuration(doc, segs) {
    if (doc.repeat_forever) return null;
    const pass = passDuration(segs);
    if (pass === 0) return 0;
    return round6(pass * (doc.repeat_count || 1));
  }

  /* Map an elapsed time (ms from sequence start) to the resolved servo angles,
   * honoring easing, holds, and carry-through of prior steps.
   * Returns { servos: {servoId: angle}, step, seg, eased, holding, done }.
   * `segs` should come from expand()/buildPassSegments. `initServos` is an
   * optional {servoId: angle} map for servos not yet moved (default empty;
   * the simulator passes neutral angles for all robot servos). */
  function resolveState(doc, elapsed, segs, initServos) {
    const servos = Object.assign({}, initServos || {});
    if (!segs || !segs.length) {
      return { servos: servos, step: null, seg: null, eased: 0, holding: false, done: true };
    }
    const lastEnd = segs[segs.length - 1].end;
    const t = Math.min(Math.max(elapsed || 0, 0), lastEnd);
    let activeSeg = null;
    for (const s of segs) {
      if (t > s.end) {
        for (const tg of s.step.targets) servos[tg.servo_id] = tg.angle;
        continue;
      }
      activeSeg = s;
      if (t <= s.moveEnd) {
        const p = s.duration > 0 ? (t - s.start) / s.duration : 1;
        const eased = ease(s.step.easing || DEFAULT_EASING, p);
        for (const tg of s.step.targets) {
          servos[tg.servo_id] = tg.from_angle + (tg.angle - tg.from_angle) * eased;
        }
      } else {
        for (const tg of s.step.targets) servos[tg.servo_id] = tg.angle;
      }
      break;
    }
    return {
      servos: servos,
      step: activeSeg ? activeSeg.step : null,
      seg: activeSeg,
      eased: activeSeg
        ? ease(activeSeg.step.easing || DEFAULT_EASING,
            activeSeg.duration > 0
              ? clamp01((Math.min(t, activeSeg.moveEnd) - activeSeg.start) / activeSeg.duration)
              : 1)
        : 0,
      holding: activeSeg ? t > activeSeg.moveEnd : false,
      done: t >= lastEnd,
    };
  }

  /* Whether the sequence loops at all (group or sequence repeat). */
  function loops(doc) {
    if (doc.repeat_forever) return true;
    if (doc.repeat_count && doc.repeat_count > 1) return true;
    return (doc.groups || []).some((g) => {
      if (g.repeat_forever) return true;
      return g.repeat_count !== null && g.repeat_count !== undefined && g.repeat_count > 1;
    });
  }

  global.Motion = {
    EASING_VALUES: EASING_VALUES,
    DEFAULT_EASING: DEFAULT_EASING,
    ease: ease,
    speedAndDuration: speedAndDuration,
    buildPassSegments: buildPassSegments,
    expand: expand,
    passDuration: passDuration,
    totalDuration: totalDuration,
    resolveState: resolveState,
    loops: loops,
  };
})(window);