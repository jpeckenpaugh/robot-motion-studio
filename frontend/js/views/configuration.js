/* Robot Configuration view (brief 01; architecture §5.1).
 * Shows the current robot and its servos with every field, and lets the user
 * rename the robot, add/edit servos, and delete servos (guarded by the
 * backend's 409 reference checks).
 */
(function (global) {
  'use strict';

  const VIEW = 'configuration';

  function formatPulseRange(s) {
    return s.pulse_min_us + ' \u00b5s \u2013 ' + s.pulse_max_us + ' \u00b5s';
  }

  function formatAngleRange(s) {
    return s.angle_min + '\u00b0 \u2013 ' + s.angle_max + '\u00b0';
  }

  function servoRows(container) {
    const tbody = container.querySelector('#servoTableBody');
    if (STATE.servos.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-muted text-center py-3">' +
        'No servos configured yet. Add one below.</td></tr>';
      return;
    }
    tbody.innerHTML = STATE.servos
      .map(
        (s) =>
          '<tr>' +
          '<td><span class="fw-semibold">' + esc(s.name) + '</span></td>' +
          '<td>' + s.pwm_pin + '</td>' +
          '<td>' + formatAngleRange(s) + '</td>' +
          '<td>' + s.neutral_angle + '\u00b0</td>' +
          '<td>' + formatPulseRange(s) + '</td>' +
          '<td class="text-end text-nowrap">' +
          '<button class="btn btn-sm btn-outline-primary me-1" data-act="edit" data-id="' + s.id + '">' +
          '<i class="bi bi-pencil"></i></button>' +
          '<button class="btn btn-sm btn-outline-danger" data-act="delete" data-id="' + s.id + '">' +
          '<i class="bi bi-trash"></i></button>' +
          '</td>' +
          '</tr>'
      )
      .join('');
  }

  function renderRobotHeader(container) {
    container.querySelector('#robotName').textContent = STATE.robotName;
  }

  function render(container) {
    container.innerHTML =
      '<div class="d-flex justify-content-between align-items-center mb-3">' +
      '<div><h4 class="mb-1">Robot Configuration</h4>' +
      '<span class="text-muted">Robot: <strong id="robotName"></strong></span></div>' +
      '<div>' +
      '<button class="btn btn-outline-secondary me-2" data-act="renameRobot">' +
      '<i class="bi bi-pencil-square me-1"></i>Rename robot</button>' +
      '<button class="btn btn-primary" data-act="addServo">' +
      '<i class="bi bi-plus-lg me-1"></i>Add servo</button>' +
      '</div></div>' +
      '<div class="card"><div class="card-body p-0">' +
      '<div class="table-responsive">' +
      '<table class="table table-hover align-middle mb-0">' +
      '<thead><tr>' +
      '<th>Name</th><th>PWM Pin</th><th>Angle Range</th><th>Neutral</th>' +
      '<th>Pulse Calibration</th><th class="text-end">Actions</th>' +
      '</tr></thead><tbody id="servoTableBody"></tbody>' +
      '</table></div></div></div>' +
      '<p class="text-muted small mt-2 mb-0">' +
      'A servo referenced by a pose or sequence step cannot be deleted until ' +
      'those references are removed.</p>';

    renderRobotHeader(container);
    servoRows(container);
    bind(container);
  }

  function bind(container) {
    container.querySelector('#servoTableBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const id = Number(btn.getAttribute('data-id'));
      if (act === 'edit') openServoModal(id);
      else if (act === 'delete') deleteServo(id);
    });
    container.querySelector('[data-act="renameRobot"]').addEventListener('click', openRenameRobotModal);
    container.querySelector('[data-act="addServo"]').addEventListener('click', () => openServoModal(null));
  }

  function openRenameRobotModal() {
    const body = '<div class="mb-3"><label class="form-label">Robot name</label>' +
      '<input type="text" class="form-control" id="rmRobotName" value="' +
      escAttr(STATE.robotName) + '"></div>';
    openGenericModal('Rename robot', body, 'Save', async (root) => {
      const name = root.querySelector('#rmRobotName').value;
      if (!name.trim()) throw new Error('Robot name is required.');
      await API.patch('/robots/' + STATE.currentRobotId, { name: name.trim() });
      await StateController.refresh();
      UI.success('Robot renamed.');
    });
  }

  function openServoModal(servoId) {
    const isEdit = servoId !== null && servoId !== undefined;
    const servo = isEdit ? StateController.servoById(servoId) : null;
    const v = (k) => (servo ? servo[k] : '');
    const body =
      '<div class="mb-2"><label class="form-label">Name</label>' +
      '<input class="form-control" id="sfName" value="' + escAttr(v('name')) + '"></div>' +
      '<div class="mb-2"><label class="form-label">PWM pin / channel</label>' +
      '<input type="number" class="form-control" id="sfPin" value="' + escAttr(v('pwm_pin')) + '"></div>' +
      '<div class="row g-2 mb-2">' +
      '<div class="col-6"><label class="form-label">Angle min</label>' +
      '<input type="number" step="any" class="form-control" id="sfAngleMin" value="' + escAttr(v('angle_min')) + '"></div>' +
      '<div class="col-6"><label class="form-label">Angle max</label>' +
      '<input type="number" step="any" class="form-control" id="sfAngleMax" value="' + escAttr(v('angle_max')) + '"></div>' +
      '</div>' +
      '<div class="mb-2"><label class="form-label">Neutral angle</label>' +
      '<input type="number" step="any" class="form-control" id="sfNeutral" value="' + escAttr(v('neutral_angle')) + '"></div>' +
      '<div class="row g-2 mb-2">' +
      '<div class="col-6"><label class="form-label">Pulse min (\u00b5s)</label>' +
      '<input type="number" class="form-control" id="sfPulseMin" value="' + escAttr(v('pulse_min_us')) + '"></div>' +
      '<div class="col-6"><label class="form-label">Pulse max (\u00b5s)</label>' +
      '<input type="number" class="form-control" id="sfPulseMax" value="' + escAttr(v('pulse_max_us')) + '"></div>' +
      '</div>' +
      '<div class="form-text">All fields are required. The neutral angle and ' +
      'commanded angles must stay within the angle limits.</div>';

    openGenericModal(isEdit ? 'Edit servo' : 'Add servo', body, isEdit ? 'Save changes' : 'Add servo', async (root) => {
      const payload = readServoForm(root);
      if (isEdit) {
        await API.put('/robots/' + STATE.currentRobotId + '/servos/' + servoId, payload);
      } else {
        await API.post('/robots/' + STATE.currentRobotId + '/servos', payload);
      }
      await StateController.refresh();
      UI.success(isEdit ? 'Servo updated.' : 'Servo added.');
    });
  }

  function readServoForm(root) {
    const num = (id) => {
      const el = root.querySelector('#' + id);
      const val = el.value.trim();
      if (val === '') return null;
      return Number(val);
    };
    const name = root.querySelector('#sfName').value.trim();
    const payload = {
      name: name,
      pwm_pin: num('sfPin'),
      angle_min: num('sfAngleMin'),
      angle_max: num('sfAngleMax'),
      neutral_angle: num('sfNeutral'),
      pulse_min_us: num('sfPulseMin'),
      pulse_max_us: num('sfPulseMax'),
    };
    if (!payload.name) throw new Error('Servo name is required.');
    for (const k of ['pwm_pin', 'angle_min', 'angle_max', 'neutral_angle', 'pulse_min_us', 'pulse_max_us']) {
      if (payload[k] === null || isNaN(payload[k])) {
        throw new Error('All numeric fields are required.');
      }
    }
    return payload;
  }

  async function deleteServo(id) {
    const servo = StateController.servoById(id);
    const ok = await UI.confirm(
      'Delete servo',
      'Delete servo "' + (servo ? servo.name : id) + '"? This cannot be undone.',
      'Delete'
    );
    if (!ok) return;
    try {
      await API.del('/robots/' + STATE.currentRobotId + '/servos/' + id);
      await StateController.refresh();
      UI.success('Servo deleted.');
    } catch (err) {
      // Backend blocks deletion of referenced servos (409) with a clear reason.
      UI.renderApiError(err);
    }
  }

  /* Reusable modal helper used by several views. */
  function openGenericModal(title, bodyHtml, confirmLabel, onConfirm) {
    const el = document.createElement('div');
    el.className = 'modal fade';
    el.setAttribute('tabindex', '-1');
    el.innerHTML =
      '<div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content">' +
      '<div class="modal-header"><h5 class="modal-title"></h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>' +
      '<div class="modal-body"></div>' +
      '<div class="modal-footer">' +
      '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>' +
      '<button type="button" class="btn btn-primary btn-confirm"></button>' +
      '</div></div></div>';
    el.querySelector('.modal-title').textContent = title;
    el.querySelector('.modal-body').innerHTML = bodyHtml;
    el.querySelector('.btn-confirm').textContent = confirmLabel || 'Save';
    document.body.appendChild(el);
    const modal = new bootstrap.Modal(el);
    const confirmBtn = el.querySelector('.btn-confirm');
    confirmBtn.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      try {
        await onConfirm(el.querySelector('.modal-body'));
        modal.hide();
      } catch (err) {
        UI.renderApiError(err);
        confirmBtn.disabled = false;
      }
    });
    modal.show();
  }

  global.openGenericModal = openGenericModal;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escAttr(s) {
    return esc(s);
  }
  global.esc = esc;

  global.ConfigurationView = {
    key: VIEW,
    label: 'Configuration',
    icon: 'bi-gear',
    render: render,
  };
})(window);