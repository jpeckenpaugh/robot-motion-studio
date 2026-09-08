/* Sequence Authoring view (brief 03; architecture §5.3).
 * A sequence editor: create/rename/delete sequences, add steps (pose reference
 * or direct servo movement), edit step target + timing, remove steps, and
 * reorder steps. Order is persisted via the reorder endpoint; the backend
 * renumbers positions contiguously.
 */
(function (global) {
  'use strict';

  const VIEW = 'sequences';
  let fullSequence = null; // [{id,name,steps:[Step]}]

  async function loadFullSequence(seqId) {
    if (seqId === null || seqId === undefined) {
      fullSequence = null;
      return;
    }
    fullSequence = await API.get('/sequences/' + seqId);
  }

  function render(container) {
    container.innerHTML =
      '<div class="row g-3">' +
      '<div class="col-md-4">' +
      '<div class="card"><div class="card-header d-flex justify-content-between align-items-center">' +
      '<span>Sequences</span>' +
      '<button class="btn btn-sm btn-primary" data-act="addSeq"><i class="bi bi-plus-lg"></i></button>' +
      '</div><div class="list-group list-group-flush" id="seqList"></div></div>' +
      '</div>' +
      '<div class="col-md-8"><div id="editorPane"></div></div>' +
      '</div>';

    renderSeqList(container);
    renderEditor(container);
    bind(container);
  }

  function renderSeqList(container) {
    const list = container.querySelector('#seqList');
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
          '<span class="badge text-bg-secondary rounded-pill">' + s.step_count + ' step' + (s.step_count === 1 ? '' : 's') + '</span>' +
          '</div></div>'
      )
      .join('');
  }

  function renderEditor(container) {
    const pane = container.querySelector('#editorPane');
    if (fullSequence === null) {
      pane.innerHTML = '<div class="text-muted border rounded p-4 text-center">Select a sequence to edit it, or create a new one.</div>';
      return;
    }
    const steps = fullSequence.steps;
    const stepRows = steps
      .map((st, idx) => {
        const tgt = describeStep(st);
        return '<div class="list-group-item">' +
          '<div class="d-flex justify-content-between align-items-center">' +
          '<div class="me-2">' +
          '<span class="badge text-bg-light border me-2">#' + idx + '</span>' +
          '<span class="badge ' + (st.kind === 'pose' ? 'text-bg-info' : 'text-bg-secondary') + ' me-2">' + st.kind + '</span>' +
          '<span class="fw-semibold">' + tgt + '</span>' +
          '</div>' +
          '<div class="text-nowrap">' +
          '<span class="text-muted small me-2">' + st.duration_ms + 'ms' +
          (st.hold_ms !== null ? ' + ' + st.hold_ms + 'ms hold' : '') + '</span>' +
          '<button class="btn btn-sm btn-outline-secondary me-1" data-act="up" data-id="' + st.id + '" ' +
          (idx === 0 ? 'disabled' : '') + ' title="Move up"><i class="bi bi-arrow-up"></i></button>' +
          '<button class="btn btn-sm btn-outline-secondary me-1" data-act="down" data-id="' + st.id + '" ' +
          (idx === steps.length - 1 ? 'disabled' : '') + ' title="Move down"><i class="bi bi-arrow-down"></i></button>' +
          '<button class="btn btn-sm btn-outline-primary me-1" data-act="edit" data-id="' + st.id + '" title="Edit step"><i class="bi bi-pencil"></i></button>' +
          '<button class="btn btn-sm btn-outline-danger" data-act="remove" data-id="' + st.id + '" title="Remove step"><i class="bi bi-trash"></i></button>' +
          '</div></div></div>';
      })
      .join('');

    pane.innerHTML =
      '<div class="card"><div class="card-header d-flex justify-content-between align-items-center">' +
      '<div><span class="fw-semibold">' + esc(fullSequence.name) + '</span>' +
      '<button class="btn btn-sm btn-link ms-2" data-act="renameSeq"><i class="bi bi-pencil-square"></i> Rename</button>' +
      '<button class="btn btn-sm btn-link text-danger" data-act="deleteSeq"><i class="bi bi-trash"></i> Delete</button></div>' +
      '<button class="btn btn-sm btn-primary" data-act="addStep"><i class="bi bi-plus-lg me-1"></i>Add step</button>' +
      '</div>' +
      '<div class="list-group list-group-flush" id="stepList">' +
      (steps.length === 0 ? '<div class="list-group-item text-muted text-center">No steps yet. Add the first step.</div>' : stepRows) +
      '</div></div>';
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
    container.querySelector('#seqList').addEventListener('click', async (e) => {
      const item = e.target.closest('[data-act="select"]');
      if (!item) return;
      STATE.selectedSequenceId = Number(item.getAttribute('data-id'));
      await loadFullSequence(STATE.selectedSequenceId);
      render(container);
    });
    container.querySelector('[data-act="addSeq"]').addEventListener('click', createSequence);
    const pane = container.querySelector('#editorPane');
    pane.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const id = Number(btn.getAttribute('data-id'));
      if (act === 'addStep') openStepModal(null);
      else if (act === 'renameSeq') renameSequence();
      else if (act === 'deleteSeq') deleteSequence();
      else if (act === 'edit') openStepModal(id);
      else if (act === 'remove') removeStep(id);
      else if (act === 'up') reorderStep(id, -1);
      else if (act === 'down') reorderStep(id, 1);
    });
  }

  async function createSequence() {
    const name = window.prompt('New sequence name');
    if (name === null) return;
    try {
      const seq = await API.post('/sequences', { name: name.trim() });
      STATE.selectedSequenceId = seq.id;
      await StateController.refresh();
      await loadFullSequence(seq.id);
      StateController.refresh(); // re-render list with new step_count
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
      await loadFullSequence(fullSequence.id);
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
      await StateController.refresh();
      UI.success('Sequence deleted.');
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  function openStepModal(stepId) {
    const isEdit = stepId !== null && stepId !== undefined;
    const step = isEdit ? fullSequence.steps.find((s) => s.id === stepId) : null;
    const kind = step ? step.kind : 'pose';
    const duration = step ? step.duration_ms : '';
    const hold = step !== null && step.hold_ms !== null ? step.hold_ms : '';

    const poseOpts = STATE.poses.map((p) =>
      '<option value="' + p.id + '"' + (step && step.pose_id === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
    const servoOpts = STATE.servos.map((s) =>
      '<option value="' + s.id + '"' + (step && step.servo_id === s.id ? ' selected' : '') + '>' + esc(s.name) +
      ' [' + s.angle_min + '\u00b0 \u2013 ' + s.angle_max + '\u00b0]</option>').join('');
    const servoAngle = step && step.kind === 'servo' ? step.angle : '';

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
      '<div class="row g-2">' +
      '<div class="col-6"><label class="form-label">Movement duration (ms)</label>' +
      '<input type="number" min="0" class="form-control" id="stDuration" value="' + escAttr(duration) + '"></div>' +
      '<div class="col-6"><label class="form-label">Hold time (ms) <span class="text-muted">optional</span></label>' +
      '<input type="number" min="0" class="form-control" id="stHold" value="' + escAttr(hold) + '" placeholder="none"></div>' +
      '</div>' +
      '<div class="form-text mt-2">Duration is required (\u2265 0). Hold is optional; leave blank for no hold.</div>';

    openGenericModal(isEdit ? 'Edit step' : 'Add step', body, isEdit ? 'Save changes' : 'Add step', async (root) => {
      const k = root.querySelector('#stKind').value;
      const duration = Number(root.querySelector('#stDuration').value);
      if (isNaN(root.querySelector('#stDuration').value) || duration < 0) {
        throw new Error('Movement duration must be a non-negative number.');
      }
      const holdEl = root.querySelector('#stHold').value;
      const hold = holdEl.trim() === '' ? null : Number(holdEl);
      if (hold !== null && (isNaN(hold) || hold < 0)) {
        throw new Error('Hold time must be a non-negative number or blank.');
      }
      const payload = { kind: k, duration_ms: duration, hold_ms: hold };
      if (k === 'pose') {
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
      if (isEdit) {
        await API.put('/sequences/' + fullSequence.id + '/steps/' + stepId, payload);
      } else {
        await API.post('/sequences/' + fullSequence.id + '/steps', payload);
      }
      await StateController.refresh();
      await loadFullSequence(fullSequence.id);
      UI.success(isEdit ? 'Step updated.' : 'Step added.');
    });

    // Toggle pose/servo fields based on kind.
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

  async function removeStep(stepId) {
    const ok = await UI.confirm('Remove step', 'Remove this step from the sequence?', 'Remove');
    if (!ok) return;
    try {
      await API.del('/sequences/' + fullSequence.id + '/steps/' + stepId);
      await StateController.refresh();
      await loadFullSequence(fullSequence.id);
      UI.success('Step removed.');
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  async function reorderStep(stepId, delta) {
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
      await loadFullSequence(fullSequence.id);
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  global.SequencesView = {
    key: VIEW,
    label: 'Sequences',
    icon: 'bi-list-ol',
    render: render,
  };
})(window);