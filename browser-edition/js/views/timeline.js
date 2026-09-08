/* Visual Timeline Editor view (brief 03; architecture §9.3.3–9.3.6, §9.5).
 *
 * The sequence authoring surface. Presents the selected sequence as a visual
 * timeline where each step's extent reflects its movement duration + hold.
 * Supports add (at any position), reorder, edit, remove, and duplicate steps;
 * per-step speed + easing controls (brief 04); whole-sequence and step-group
 * loop/repeat controls (brief 04); and play / pause / scrub with a
 * timing-accurate playhead. Playback and scrubbing are driven by the shared
 * motion.js module so they agree exactly with the simulator.
 *
 * Data flow follows the v0.1 immediate-persistence model: every edit calls the
 * backend step/sequence/group endpoint, then re-syncs from the full sequence
 * (GET /api/sequences/{id}) and the authoritative resolved motion document
 * (GET /api/sequences/{id}/preview), so the timeline, the read-only preview,
 * and the simulator all reflect the same saved state. The view also re-syncs
 * on every render so robot switches and edits made elsewhere (poses, servos)
 * are always reflected.
 */
(function (global) {
  'use strict';

  const VIEW = 'timeline';
  const PX_PER_MS = 0.35; // timeline horizontal scale

  const GROUP_COLORS = ['#0d6efd', '#198754', '#dc3545', '#fd7e14', '#6f42c1', '#0dcaf0'];

  let fullSequence = null;   // GET /sequences/{id} response
  let doc = null;            // preview document (authoritative motion source)
  let segs = [];             // motion.js expanded segments
  let passMs = 0;            // single-pass duration (group repeats expanded)
  let playableMs = 0;        // finite playable duration (or pass when forever)
  let totalMs = 0;           // finite total incl. sequence repeats (0 if forever)
  let isForever = false;
  let truncated = false;
  let elapsedMs = 0;
  let playing = false;
  let rafId = null;
  let lastTs = null;
  let tlWidth = 600;
  let loadedKey = null;      // "<robotId>:<seqId>" this editor is bound to
  let syncing = false;

  function rebuildSegments() {
    const exp = Motion.expand(doc);
    segs = exp.segments;
    passMs = exp.passMs;
    isForever = exp.forever;
    truncated = exp.truncated;
    playableMs = segs.length ? segs[segs.length - 1].end : 0;
    totalMs = isForever ? 0 : Motion.totalDuration(doc, segs);
    if (playableMs === 0) elapsedMs = 0;
    else if (elapsedMs > playableMs) elapsedMs = 0;
  }

  function stopPlayback() {
    playing = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    lastTs = null;
  }

  /* Re-fetch the full sequence + preview from the backend (authoritative) and
   * re-render the live view wrapper. Guarded against concurrent syncs. */
  async function syncFromServer() {
    const seqId = STATE.selectedSequenceId;
    if (seqId === null || seqId === undefined || syncing) return;
    syncing = true;
    try {
      const [seq, prev] = await Promise.all([
        API.get('/sequences/' + seqId),
        API.get('/sequences/' + seqId + '/preview'),
      ]);
      if (STATE.selectedSequenceId !== seqId) return;
      fullSequence = seq;
      doc = prev;
      loadedKey = STATE.currentRobotId + ':' + seqId;
      rebuildSegments();
      const wrap = document.getElementById('view-' + VIEW);
      if (wrap && wrap.isConnected) global.TimelineView.render(wrap);
    } catch (err) {
      UI.renderApiError(err);
    } finally {
      syncing = false;
    }
  }

  function render(container) {
    const key = STATE.currentRobotId + ':' +
      (STATE.selectedSequenceId === null || STATE.selectedSequenceId === undefined
        ? '' : STATE.selectedSequenceId);
    if (loadedKey !== key) {
      // Robot switched or selection changed externally: drop stale editor state.
      fullSequence = null;
      doc = null;
      segs = [];
      stopPlayback();
      loadedKey = key;
    }

    container.innerHTML =
      '<div class="row g-3">' +
      '<div class="col-md-4">' +
      '<div class="card"><div class="card-header d-flex justify-content-between align-items-center">' +
      '<span>Sequences</span>' +
      '<button class="btn btn-sm btn-primary" data-act="addSeq"><i class="bi bi-plus-lg"></i></button>' +
      '</div><div class="list-group list-group-flush" id="tlSeqList"></div></div>' +
      '</div>' +
      '<div class="col-md-8"><div id="tlPane"></div></div>' +
      '</div>';

    renderSeqList(container);
    renderEditor(container);
    bind(container);

    // Keep the editor fresh: re-sync from the backend whenever a sequence is
    // selected (covers robot switches, pose/servo edits, and external changes).
    if (STATE.selectedSequenceId !== null && STATE.selectedSequenceId !== undefined) {
      syncFromServer();
    }
  }

  function renderSeqList(container) {
    const list = container.querySelector('#tlSeqList');
    if (STATE.sequences.length === 0) {
      list.innerHTML = '<div class="list-group-item text-muted text-center">No sequences</div>';
      return;
    }
    list.innerHTML = STATE.sequences
      .map(
        (s) =>
          '<div class="list-group-item list-group-item-action' +
          (STATE.selectedSequenceId === s.id ? ' active' : '') +
          '" data-act="select" data-id="' + s.id + '">' +
          '<div class="d-flex justify-content-between align-items-center">' +
          '<span>' + esc(s.name) + '</span>' +
          '<span class="badge text-bg-secondary rounded-pill">' + s.step_count + '</span>' +
          '</div></div>'
      )
      .join('');
  }

  function renderEditor(container) {
    const pane = container.querySelector('#tlPane');
    if (fullSequence === null) {
      pane.innerHTML =
        '<div class="text-muted border rounded p-4 text-center">Select a sequence to edit it on the timeline, or create a new one.</div>';
      return;
    }

    // Adaptive horizontal scale: fit short sequences at a readable density but
    // keep very long ones (e.g. a 25x group-repeat door cycle) within a
    // scrollable, usable width (~6k px max).
    let px = PX_PER_MS;
    if (playableMs > 0) {
      px = Math.min(PX_PER_MS, Math.max(0.05, 6000 / playableMs));
    }
    tlWidth = Math.max(600, playableMs * px);
    const width = tlWidth;
    const groupColor = {};
    ((doc && doc.groups) || []).forEach((g, i) => {
      groupColor[g.id] = GROUP_COLORS[i % GROUP_COLORS.length];
    });

    const blockHtml = segs
      .map((seg, i) => {
        const st = seg.step;
        const left = playableMs > 0 ? (seg.start / playableMs) * width : 0;
        const w = Math.max(28, ((seg.end - seg.start) / (playableMs || 1)) * width);
        const color = st.group_id != null ? (groupColor[st.group_id] || '') : '';
        const moveW = Math.max(4, (st.duration_ms / (playableMs || 1)) * width);
        return '<div class="tl-step" data-seg="' + i + '" style="left:' + left + 'px;width:' + w + 'px"' +
          (color ? ' data-group="' + st.group_id + '"' : '') + '>' +
          '<div class="tl-step-body" style="' + (color ? 'border-top:3px solid ' + color + ';' : '') + '">' +
          '<div class="tl-step-title">#' + (st.order + 1) + ' ' + describeStep(st) + '</div>' +
          '<div class="tl-step-meta">' + st.duration_ms + 'ms' +
          (st.hold_ms ? ' + ' + st.hold_ms + ' hold' : '') + ' \u00b7 ' +
          esc(st.easing || 'linear') +
          (st.speed_deg_per_s != null ? ' \u00b7 ' + st.speed_deg_per_s + ' deg/s' : '') +
          '</div>' +
          '<div class="tl-step-move" style="width:' + moveW + 'px"></div>' +
          '</div>' +
          '<div class="tl-step-actions">' +
          '<button class="btn btn-sm btn-outline-secondary" data-act="left" data-id="' + st.id + '" ' +
          (st.order === 0 ? 'disabled' : '') + ' title="Move earlier"><i class="bi bi-arrow-left-short"></i></button>' +
          '<button class="btn btn-sm btn-outline-secondary" data-act="right" data-id="' + st.id + '" ' +
          (st.order === doc.steps.length - 1 ? 'disabled' : '') + ' title="Move later"><i class="bi bi-arrow-right-short"></i></button>' +
          '<button class="btn btn-sm btn-outline-secondary" data-act="dup" data-id="' + st.id + '" title="Duplicate"><i class="bi bi-copy"></i></button>' +
          '<button class="btn btn-sm btn-outline-primary" data-act="edit" data-id="' + st.id + '" title="Edit step"><i class="bi bi-pencil"></i></button>' +
          '<button class="btn btn-sm btn-outline-danger" data-act="remove" data-id="' + st.id + '" title="Remove step"><i class="bi bi-trash"></i></button>' +
          '</div>' +
          '</div>';
      })
      .join('');

    const ruler = buildRuler(width);

    const groupList = ((doc && doc.groups) || [])
      .map((g) => {
        const color = groupColor[g.id] || '';
        return '<div class="d-flex justify-content-between align-items-center mb-1">' +
          '<span><span class="group-dot" style="background:' + color + '"></span>' +
          '<strong>' + esc(g.name || 'group #' + g.id) + '</strong> \u2014 steps ' +
          g.step_orders.map((o) => '#' + (o + 1)).join(', ') +
          ' \u00b7 repeat ' + (g.repeat_forever ? '\u221e' : (g.repeat_count || 1)) + '</span>' +
          '<span class="text-nowrap">' +
          '<button class="btn btn-sm btn-outline-primary me-1" data-act="editGroup" data-id="' + g.id + '" title="Edit group"><i class="bi bi-pencil"></i></button>' +
          '<button class="btn btn-sm btn-outline-danger" data-act="delGroup" data-id="' + g.id + '" title="Delete group"><i class="bi bi-trash"></i></button>' +
          '</span></div>';
      })
      .join('');

    pane.innerHTML =
      '<div class="card">' +
      '<div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">' +
      '<div>' +
      '<span class="fw-semibold">' + esc(fullSequence.name) + '</span>' +
      '<button class="btn btn-sm btn-link ms-2" data-act="renameSeq"><i class="bi bi-pencil-square"></i> Rename</button>' +
      '<button class="btn btn-sm btn-link text-danger" data-act="deleteSeq"><i class="bi bi-trash"></i> Delete</button>' +
      '</div>' +
      '<div class="d-flex align-items-center gap-2">' +
      '<label class="form-label mb-0 small">Repeat:</label>' +
      '<input type="number" min="1" class="form-control form-control-sm" style="width:76px" id="tlRepeatCount" placeholder="once" value="' +
      (fullSequence.repeat_count != null ? fullSequence.repeat_count : '') + '">' +
      '<div class="form-check form-switch mb-0 ms-1">' +
      '<input class="form-check-input" type="checkbox" id="tlRepeatForever"' + (fullSequence.repeat_forever ? ' checked' : '') + '>' +
      '<label class="form-check-label small" for="tlRepeatForever">forever</label>' +
      '</div>' +
      '<button class="btn btn-sm btn-outline-secondary" data-act="saveRepeat"><i class="bi bi-check-lg me-1"></i>Save</button>' +
      '</div>' +
      '</div>' +
      '<div class="card-body">' +
      '<div class="transport mb-2 d-flex align-items-center gap-2">' +
      '<button class="btn btn-sm btn-primary" data-act="play"><i class="bi bi-play-fill" id="tlPlayIcon"></i> <span id="tlPlayLabel">Play</span></button>' +
      '<button class="btn btn-sm btn-outline-secondary" data-act="reset"><i class="bi bi-skip-start-fill"></i> Reset</button>' +
      '<span class="badge text-bg-light border" id="tlTime">0 ms</span>' +
      '<span class="text-muted small" id="tlTotal">' +
      (isForever ? 'repeat forever' : 'total ' + Math.round(totalMs) + ' ms') +
      '</span>' +
      (truncated ? '<span class="badge text-bg-warning">very large repeat \u2014 showing first pass</span>' : '') +
      '</div>' +
      '<div class="tl-scroll">' +
      '<div class="tl-ruler" style="width:' + width + 'px">' + ruler + '</div>' +
      '<div class="tl-track" id="tlTrack" style="width:' + width + 'px;height:74px">' +
      blockHtml +
      '<div class="tl-playhead" id="tlPlayhead" style="left:' +
      ((playableMs > 0 ? (elapsedMs / playableMs) * width : 0)) + 'px"></div>' +
      '</div>' +
      '</div>' +
      '<div class="small text-muted mt-2">' +
      '<i class="bi bi-info-circle me-1"></i>Drag the playhead or click the track to scrub. ' +
      'Step width reflects movement duration + hold. Colored blocks belong to a looping step group.</div>' +
      '</div>' +
      '<div class="card-footer">' +
      '<div class="d-flex justify-content-between align-items-center mb-2">' +
      '<div class="d-flex gap-2">' +
      '<button class="btn btn-sm btn-primary" data-act="addStep"><i class="bi bi-plus-lg me-1"></i>Add step</button>' +
      '<button class="btn btn-sm btn-outline-secondary" data-act="newGroup"><i class="bi bi-arrow-repeat me-1"></i>New step group</button>' +
      '</div>' +
      '<div class="text-muted small">' + (doc ? doc.steps.length : 0) + ' step' + ((doc ? doc.steps.length : 0) === 1 ? '' : 's') + '</div>' +
      '</div>' +
      '<div id="tlGroups">' + groupList + '</div>' +
      '</div>' +
      '</div>';
  }

  function buildRuler(width) {
    const stepMs = 1000;
    let html = '';
    for (let t = 0; t <= playableMs; t += stepMs) {
      const left = playableMs > 0 ? (t / playableMs) * width : 0;
      const label = (t / 1000).toFixed(0) + 's';
      html += '<span class="tl-ruler-tick" style="left:' + left + 'px"><i></i>' + label + '</span>';
    }
    return html;
  }

  function describeStep(st) {
    if (st.kind === 'pose') {
      const pose = StateController.poseById(st.pose_id);
      return 'Pose \u201c' + (pose ? pose.name : '#' + st.pose_id) + '\u201d';
    }
    const servo = StateController.servoById(st.servo_id);
    return (servo ? servo.name : 'servo#' + st.servo_id) + ' \u2192 ' + st.angle + '\u00b0';
  }

  function bind(container) {
    container.querySelector('#tlSeqList').addEventListener('click', async (e) => {
      const item = e.target.closest('[data-act="select"]');
      if (!item) return;
      STATE.selectedSequenceId = Number(item.getAttribute('data-id'));
      elapsedMs = 0;
      stopPlayback();
      loadedKey = null; // force re-sync for the newly selected sequence
      render(container);
    });
    container.querySelector('[data-act="addSeq"]').addEventListener('click', createSequence);

    const pane = container.querySelector('#tlPane');
    pane.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const id = btn.getAttribute('data-id');
      if (act === 'addStep') openStepModal(null);
      else if (act === 'renameSeq') renameSequence();
      else if (act === 'deleteSeq') deleteSequence();
      else if (act === 'saveRepeat') await saveRepeat(container);
      else if (act === 'edit') openStepModal(Number(id));
      else if (act === 'dup') duplicateStep(Number(id));
      else if (act === 'remove') removeStep(Number(id));
      else if (act === 'left') reorderStep(Number(id), -1, container);
      else if (act === 'right') reorderStep(Number(id), 1, container);
      else if (act === 'play') togglePlay(container);
      else if (act === 'reset') { elapsedMs = 0; stopPlayback(); updateTransport(container); }
      else if (act === 'newGroup') openGroupModal(null);
      else if (act === 'editGroup') openGroupModal(Number(id));
      else if (act === 'delGroup') deleteGroup(Number(id));
    });

    wireScrub(pane);
  }

  /* Scrubbing: click/drag on the track moves the playhead to the elapsed time
   * at that horizontal position (timing-accurate). */
  function wireScrub(pane) {
    const track = pane.querySelector('#tlTrack');
    if (!track) return;
    let dragging = false;
    const scrubTo = (clientX) => {
      const rect = track.getBoundingClientRect();
      const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      elapsedMs = frac * playableMs;
      stopPlayback();
      updateTransport(pane);
    };
    track.addEventListener('pointerdown', (e) => {
      dragging = true;
      if (e.pointerId !== undefined && e.pointerId !== null) {
        try { track.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ }
      }
      scrubTo(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
      if (dragging) scrubTo(e.clientX);
    });
    track.addEventListener('pointerup', () => { dragging = false; });
    track.addEventListener('pointercancel', () => { dragging = false; });
  }

  function updateTransport(container) {
    const playhead = container.querySelector('#tlPlayhead');
    const time = container.querySelector('#tlTime');
    const playIcon = container.querySelector('#tlPlayIcon');
    const playLabel = container.querySelector('#tlPlayLabel');
    if (playhead) {
      playhead.style.left =
        ((playableMs > 0 ? (elapsedMs / playableMs) * tlWidth : 0)) + 'px';
    }
    if (time) time.textContent = Math.round(elapsedMs) + ' ms';
    if (playIcon) playIcon.className = 'bi ' + (playing ? 'bi-pause-fill' : 'bi-play-fill');
    if (playLabel) playLabel.textContent = playing ? 'Pause' : 'Play';
  }

  function togglePlay(container) {
    if (playing) { stopPlayback(); updateTransport(container); return; }
    if (playableMs <= 0) return;
    playing = true;
    lastTs = null;
    const tick = (ts) => {
      if (!playing) return;
      if (lastTs === null) lastTs = ts;
      const dt = ts - lastTs;
      lastTs = ts;
      elapsedMs += dt;
      if (isForever) {
        if (passMs > 0) elapsedMs = elapsedMs % passMs;
      } else if (elapsedMs >= playableMs) {
        elapsedMs = playableMs;
        stopPlayback();
      }
      updateTransport(container);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    updateTransport(container);
  }

  /* ---- sequence lifecycle ---- */

  async function createSequence() {
    const name = window.prompt('New sequence name');
    if (name === null) return;
    try {
      const seq = await API.post('/sequences', { name: name.trim() });
      STATE.selectedSequenceId = seq.id;
      elapsedMs = 0;
      stopPlayback();
      await StateController.refresh();
      loadedKey = null;
      render(document.getElementById('view-' + VIEW));
      UI.success('Sequence created.');
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  async function renameSequence() {
    const name = window.prompt('Sequence name', fullSequence.name);
    if (name === null) return;
    try {
      await API.put('/sequences/' + fullSequence.id, { name: name.trim() });
      await StateController.refresh();
      loadedKey = null;
      render(document.getElementById('view-' + VIEW));
      UI.success('Sequence renamed.');
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  async function deleteSequence() {
    const ok = await UI.confirm('Delete sequence', 'Delete "' + fullSequence.name + '" and all of its steps?', 'Delete');
    if (!ok) return;
    try {
      await API.del('/sequences/' + fullSequence.id);
      STATE.selectedSequenceId = null;
      fullSequence = null;
      stopPlayback();
      await StateController.refresh();
      UI.success('Sequence deleted.');
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  /* ---- sequence repeat (brief 04) ---- */

  async function saveRepeat(container) {
    const countEl = container.querySelector('#tlRepeatCount');
    const foreverEl = container.querySelector('#tlRepeatForever');
    const countRaw = countEl.value.trim();
    const payload = {};
    if (foreverEl.checked) {
      payload.repeat_count = null;
      payload.repeat_forever = true;
    } else if (countRaw === '') {
      payload.repeat_count = null;
      payload.repeat_forever = false;
    } else {
      const count = Number(countRaw);
      if (isNaN(count) || count < 1) {
        UI.error('Repeat count must be >= 1 or blank.');
        return;
      }
      payload.repeat_count = count;
      payload.repeat_forever = false;
    }
    try {
      await API.put('/sequences/' + fullSequence.id, payload);
      await StateController.refresh();
      loadedKey = null;
      render(document.getElementById('view-' + VIEW));
      UI.success('Repeat settings saved.');
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  /* ---- step lifecycle ---- */

  function openStepModal(stepId) {
    const isEdit = stepId !== null && stepId !== undefined;
    const step = isEdit ? fullSequence.steps.find((s) => s.id === stepId) : null;
    const kind = step ? step.kind : 'pose';
    const duration = step ? step.duration_ms : '';
    const hold = step !== null && step.hold_ms !== null ? step.hold_ms : '';
    const speed = step && step.speed != null ? step.speed : '';
    const easing = step ? (step.easing || 'linear') : 'linear';

    const poseOpts = STATE.poses.map((p) =>
      '<option value="' + p.id + '"' + (step && step.pose_id === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
    const servoOpts = STATE.servos.map((s) =>
      '<option value="' + s.id + '"' + (step && step.servo_id === s.id ? ' selected' : '') + '>' + esc(s.name) +
      ' [' + s.angle_min + '\u00b0 \u2013 ' + s.angle_max + '\u00b0]</option>').join('');
    const servoAngle = step && step.kind === 'servo' ? step.angle : '';
    const easingOpts = Motion.EASING_VALUES.map((ev) =>
      '<option value="' + ev + '"' + (ev === easing ? ' selected' : '') + '>' + ev + '</option>').join('');

    const posOpts = !isEdit
      ? fullSequence.steps.map((s, i) => '<option value="' + i + '">After step #' + (i + 1) + '</option>').join('')
      : '';

    const body =
      '<div class="mb-3"><label class="form-label">Step kind</label>' +
      '<select class="form-select" id="stKind">' +
      '<option value="pose"' + (kind === 'pose' ? ' selected' : '') + '>Reference a pose</option>' +
      '<option value="servo"' + (kind === 'servo' ? ' selected' : '') + '>Direct servo movement</option>' +
      '</select></div>' +
      '<div class="mb-3" id="stPoseWrap"><label class="form-label">Pose</label>' +
      '<select class="form-select" id="stPoseId">' + poseOpts + '</select></div>' +
      '<div class="mb-3 d-none" id="stServoWrap">' +
      '<label class="form-label">Servo</label><select class="form-select mb-2" id="stServoId">' + servoOpts + '</select>' +
      '<label class="form-label">Target angle (\u00b0)</label>' +
      '<input type="number" step="any" class="form-control" id="stAngle" value="' + escAttr(servoAngle) + '"></div>' +
      '<div class="row g-2 mb-2">' +
      '<div class="col-6"><label class="form-label">Movement duration (ms) <span class="text-muted">or</span></label>' +
      '<input type="number" min="0" class="form-control" id="stDuration" value="' + escAttr(duration) + '"></div>' +
      '<div class="col-6"><label class="form-label">Speed (deg/s) <span class="text-muted">optional</span></label>' +
      '<input type="number" step="any" class="form-control" id="stSpeed" value="' + escAttr(speed) + '" placeholder="derived"></div>' +
      '</div>' +
      '<div class="row g-2 mb-2">' +
      '<div class="col-6"><label class="form-label">Hold time (ms) <span class="text-muted">optional</span></label>' +
      '<input type="number" min="0" class="form-control" id="stHold" value="' + escAttr(hold) + '" placeholder="none"></div>' +
      '<div class="col-6"><label class="form-label">Easing</label>' +
      '<select class="form-select" id="stEasing">' + easingOpts + '</select></div>' +
      '</div>' +
      (posOpts
        ? '<div class="mb-2"><label class="form-label">Insert position</label>' +
          '<select class="form-select" id="stPosition"><option value="">At the end</option>' + posOpts + '</select></div>'
        : '') +
      '<div class="form-text">Provide a movement duration OR a speed; the other is derived by the backend. ' +
      'If both are given they must be mutually consistent. Easing applies to the movement phase only.</div>';

    openGenericModal(isEdit ? 'Edit step' : 'Add step', body, isEdit ? 'Save changes' : 'Add step', async (root) => {
      const k = root.querySelector('#stKind').value;
      const payload = buildStepPayload(root, k);
      if (isEdit) {
        await API.put('/sequences/' + fullSequence.id + '/steps/' + stepId, payload);
      } else {
        await API.post('/sequences/' + fullSequence.id + '/steps', payload);
      }
      await StateController.refresh();
      loadedKey = null;
      render(document.getElementById('view-' + VIEW));
      UI.success(isEdit ? 'Step updated.' : 'Step added.');
    });

    setTimeout(() => {
      const kindSel = document.querySelector('#stKind');
      const poseWrap = document.querySelector('#stPoseWrap');
      const servoWrap = document.querySelector('#stServoWrap');
      const sync = () => {
        const isPose = kindSel.value === 'pose';
        poseWrap.classList.toggle('d-none', !isPose);
        servoWrap.classList.toggle('d-none', isPose);
      };
      kindSel.addEventListener('change', sync);
      sync();
    }, 0);
  }

  function buildStepPayload(root, kind) {
    const durRaw = root.querySelector('#stDuration').value.trim();
    const speedRaw = root.querySelector('#stSpeed').value.trim();
    if (!durRaw && !speedRaw) {
      throw new Error('Provide a movement duration or a speed.');
    }
    const holdRaw = root.querySelector('#stHold').value.trim();
    const hold = holdRaw === '' ? null : Number(holdRaw);
    if (hold !== null && (isNaN(hold) || hold < 0)) {
      throw new Error('Hold time must be a non-negative number or blank.');
    }
    const easing = root.querySelector('#stEasing').value || 'linear';
    const payload = { kind: kind, hold_ms: hold, easing: easing };
    if (durRaw !== '') {
      const dur = Number(durRaw);
      if (isNaN(dur) || dur < 0) throw new Error('Movement duration must be a non-negative number.');
      payload.duration_ms = dur;
    }
    if (speedRaw !== '') {
      const spd = Number(speedRaw);
      if (isNaN(spd) || spd <= 0) throw new Error('Speed must be a number greater than zero.');
      payload.speed = spd;
    }
    if (kind === 'pose') {
      payload.pose_id = Number(root.querySelector('#stPoseId').value);
    } else {
      payload.servo_id = Number(root.querySelector('#stServoId').value);
      payload.angle = Number(root.querySelector('#stAngle').value);
      const servo = StateController.servoById(payload.servo_id);
      if (isNaN(payload.angle) || payload.angle === '' || !servo ||
          payload.angle < servo.angle_min || payload.angle > servo.angle_max) {
        throw new Error('Target angle is required and must be within the servo\u2019s limits.');
      }
    }
    const posEl = root.querySelector('#stPosition');
    if (posEl && posEl.value !== '') payload.position = Number(posEl.value);
    return payload;
  }

  async function removeStep(stepId) {
    const ok = await UI.confirm('Remove step', 'Remove this step from the sequence?', 'Remove');
    if (!ok) return;
    try {
      await API.del('/sequences/' + fullSequence.id + '/steps/' + stepId);
      await StateController.refresh();
      loadedKey = null;
      render(document.getElementById('view-' + VIEW));
      UI.success('Step removed.');
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  async function duplicateStep(stepId) {
    try {
      await API.post('/sequences/' + fullSequence.id + '/steps/' + stepId + '/duplicate');
      await StateController.refresh();
      loadedKey = null;
      render(document.getElementById('view-' + VIEW));
      UI.success('Step duplicated.');
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  async function reorderStep(stepId, delta, container) {
    const steps = fullSequence.steps;
    const idx = steps.findIndex((s) => s.id === stepId);
    const target = idx + delta;
    if (target < 0 || target >= steps.length) return;
    const newOrder = steps.map((s) => s.id);
    newOrder.splice(idx, 1);
    newOrder.splice(target, 0, stepId);
    try {
      await API.post('/sequences/' + fullSequence.id + '/reorder', { step_ids: newOrder });
      await StateController.refresh();
      loadedKey = null;
      render(document.getElementById('view-' + VIEW));
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  /* ---- step groups (brief 04) ---- */

  function openGroupModal(groupId) {
    const isEdit = groupId !== null && groupId !== undefined;
    const group = isEdit ? fullSequence.groups.find((g) => g.id === groupId) : null;
    const name = group ? group.name : '';
    const repeatCount = group ? (group.repeat_count != null ? group.repeat_count : '') : '';
    const forever = group ? group.repeat_forever : false;

    const stepOpts = fullSequence.steps.map((s, i) =>
      '<option value="' + i + '">' + describeStep(s) + '</option>').join('');

    const body =
      '<div class="mb-3"><label class="form-label">Group name <span class="text-muted">optional</span></label>' +
      '<input class="form-control" id="grName" value="' + escAttr(name) + '"></div>' +
      (isEdit ? '' :
        '<div class="row g-2 mb-3">' +
        '<div class="col-6"><label class="form-label">First step</label>' +
        '<select class="form-select" id="grStart">' + stepOpts + '</select></div>' +
        '<div class="col-6"><label class="form-label">Last step</label>' +
        '<select class="form-select" id="grEnd">' + stepOpts + '</select></div>' +
        '</div>') +
      '<div class="row g-2 align-items-center">' +
      '<div class="col-6"><label class="form-label">Repeat count <span class="text-muted">blank = once</span></label>' +
      '<input type="number" min="1" class="form-control" id="grCount" value="' + escAttr(repeatCount) + '"></div>' +
      '<div class="col-6"><div class="form-check form-switch mt-4">' +
      '<input class="form-check-input" type="checkbox" id="grForever"' + (forever ? ' checked' : '') + '>' +
      '<label class="form-check-label" for="grForever">Repeat forever</label>' +
      '</div></div></div>' +
      '<div class="form-text">A group loops a contiguous run of steps before the sequence continues.</div>';

    openGenericModal(isEdit ? 'Edit step group' : 'New step group', body, isEdit ? 'Save changes' : 'Create group', async (root) => {
      const payload = {};
      const gname = root.querySelector('#grName').value.trim();
      if (gname) payload.name = gname;
      const countRaw = root.querySelector('#grCount').value.trim();
      const foreverVal = root.querySelector('#grForever').checked;
      if (foreverVal) {
        payload.repeat_forever = true;
        payload.repeat_count = null;
      } else if (countRaw !== '') {
        const count = Number(countRaw);
        if (isNaN(count) || count < 1) throw new Error('Repeat count must be >= 1 or blank.');
        payload.repeat_count = count;
        payload.repeat_forever = false;
      } else {
        payload.repeat_count = null;
        payload.repeat_forever = false;
      }

      if (isEdit) {
        await API.put('/sequences/' + fullSequence.id + '/groups/' + groupId, payload);
      } else {
        const start = Number(root.querySelector('#grStart').value);
        const end = Number(root.querySelector('#grEnd').value);
        if (end < start) throw new Error('Last step must come at or after the first step.');
        const stepIds = fullSequence.steps.slice(start, end + 1).map((s) => s.id);
        payload.step_ids = stepIds;
        await API.post('/sequences/' + fullSequence.id + '/groups', payload);
      }
      await StateController.refresh();
      loadedKey = null;
      render(document.getElementById('view-' + VIEW));
      UI.success(isEdit ? 'Group updated.' : 'Group created.');
    });
  }

  async function deleteGroup(groupId) {
    const ok = await UI.confirm('Delete step group', 'Delete this looping group? Its steps remain in the sequence.', 'Delete');
    if (!ok) return;
    try {
      await API.del('/sequences/' + fullSequence.id + '/groups/' + groupId);
      await StateController.refresh();
      loadedKey = null;
      render(document.getElementById('view-' + VIEW));
      UI.success('Group deleted.');
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  global.TimelineView = {
    key: VIEW,
    label: 'Timeline',
    icon: 'bi-sliders',
    render: render,
  };
})(window);