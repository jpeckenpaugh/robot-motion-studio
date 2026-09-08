/* Pose Management view (brief 02; architecture §5.2).
 * Lists poses, shows each pose's servo targets, and lets the user create,
 * edit (rename + change targets), and delete poses. Deleting a pose that a
 * sequence step references is blocked by the backend (409 POSE_REFERENCED).
 */
(function (global) {
  'use strict';

  const VIEW = 'poses';

  function describeTargets(pose) {
    return pose.targets
      .map((t) => {
        const s = StateController.servoById(t.servo_id);
        return (s ? s.name : 'servo#' + t.servo_id) + ' \u2192 ' + t.angle + '\u00b0';
      })
      .join(', ');
  }

  function render(container) {
    container.innerHTML =
      '<div class="d-flex justify-content-between align-items-center mb-3">' +
      '<div><h4 class="mb-0">Poses</h4>' +
      '<span class="text-muted">Reusable servo target positions</span></div>' +
      '<button class="btn btn-primary" data-act="addPose">' +
      '<i class="bi bi-plus-lg me-1"></i>New pose</button>' +
      '</div>';

    const list = document.createElement('div');
    container.appendChild(list);

    if (STATE.poses.length === 0) {
      list.innerHTML =
        '<div class="text-muted text-center py-5">No poses yet. Create one ' +
        'to capture reusable servo positions.</div>';
      return;
    }

    list.innerHTML =
      '<div class="list-group" id="poseList"></div>';
    const poseList = list.querySelector('#poseList');
    poseList.innerHTML = STATE.poses
      .map(
        (p) =>
          '<div class="list-group-item">' +
          '<div class="d-flex justify-content-between align-items-start">' +
          '<div>' +
          '<div class="fw-semibold">' + esc(p.name) + '</div>' +
          '<div class="text-muted small">' + esc(describeTargets(p)) + '</div>' +
          '</div>' +
          '<div class="text-nowrap ms-3">' +
          '<button class="btn btn-sm btn-outline-primary me-1" data-act="edit" data-id="' + p.id + '">' +
          '<i class="bi bi-pencil"></i></button>' +
          '<button class="btn btn-sm btn-outline-danger" data-act="delete" data-id="' + p.id + '">' +
          '<i class="bi bi-trash"></i></button>' +
          '</div>' +
          '</div></div>'
      )
      .join('');

    poseList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const id = Number(btn.getAttribute('data-id'));
      if (act === 'edit') openPoseModal(id);
      else if (act === 'delete') deletePose(id);
    });

    container.querySelector('[data-act="addPose"]').addEventListener('click', () => openPoseModal(null));
  }

  function openPoseModal(poseId) {
    const isEdit = poseId !== null && poseId !== undefined;
    const pose = isEdit ? StateController.poseById(poseId) : null;
    const name = pose ? pose.name : '';
    const targets = pose ? pose.targets : [];

    const rows = STATE.servos
      .map((s) => {
        const existing = targets.find((t) => t.servo_id === s.id);
        const checked = existing ? 'checked' : '';
        const angleVal = existing ? existing.angle : '';
        return '<div class="row g-2 align-items-center py-1" data-servo-row="' + s.id + '">' +
          '<div class="col-8">' +
          '<div class="form-check">' +
          '<input class="form-check-input chk-servo" type="checkbox" value="' + s.id + '" id="chk' + s.id + '" ' + checked + '>' +
          '<label class="form-check-label" for="chk' + s.id + '">' + esc(s.name) +
          ' <span class="text-muted">[' + s.angle_min + '\u00b0 \u2013 ' + s.angle_max + '\u00b0]</span></label>' +
          '</div></div>' +
          '<div class="col-4"><input type="number" step="any" class="form-control form-control-sm target-angle" ' +
          'data-servo="' + s.id + '" placeholder="Angle" value="' + escAttr(angleVal) + '" ' +
          (checked ? '' : 'disabled') + '></div>' +
          '</div>';
      })
      .join('');

    const body =
      '<div class="mb-3"><label class="form-label">Pose name</label>' +
      '<input class="form-control" id="pfName" value="' + escAttr(name) + '"></div>' +
      '<div class="mb-1"><label class="form-label">Servo targets</label>' +
      '<div class="form-text mb-2">Check a servo to include it in the pose and set its target angle.</div>' +
      '<div>' + rows + '</div></div>' +
      '<div class="form-text">A pose must set at least one servo, and each target angle must be within that servo\u2019s limits.</div>';

    openGenericModal(isEdit ? 'Edit pose' : 'New pose', body, isEdit ? 'Save changes' : 'Create pose', async (root) => {
      const pname = root.querySelector('#pfName').value.trim();
      if (!pname) throw new Error('Pose name is required.');
      const targets = [];
      root.querySelectorAll('.chk-servo:checked').forEach((chk) => {
        const servoId = Number(chk.value);
        const angleEl = root.querySelector('.target-angle[data-servo="' + servoId + '"]');
        const angle = Number(angleEl.value);
        if (isNaN(angleEl.value) || angleEl.value.trim() === '') {
          throw new Error('Set a target angle for every checked servo.');
        }
        const servo = StateController.servoById(servoId);
        if (servo && (angle < servo.angle_min || angle > servo.angle_max)) {
          throw new Error('Angle ' + angle + ' for ' + servo.name +
            ' is outside [' + servo.angle_min + ', ' + servo.angle_max + '].');
        }
        targets.push({ servo_id: servoId, angle: angle });
      });
      if (targets.length === 0) {
        throw new Error('A pose must have at least one servo target.');
      }
      const payload = { name: pname, targets: targets };
      if (isEdit) await API.put('/poses/' + poseId, payload);
      else await API.post('/poses', payload);
      await StateController.refresh();
      UI.success(isEdit ? 'Pose updated.' : 'Pose created.');
    });

    rootToggleHelper();
    function rootToggleHelper() {
      // Enable/disable the angle input when its checkbox toggles.
      setTimeout(() => {
        document.querySelectorAll('.chk-servo').forEach((chk) => {
          chk.addEventListener('change', () => {
            const inp = document.querySelector('.target-angle[data-servo="' + chk.value + '"]');
            inp.disabled = !chk.checked;
            if (chk.checked && inp.value === '') inp.value = '';
          });
        });
      }, 0);
    }
  }

  async function deletePose(id) {
    const pose = StateController.poseById(id);
    const ok = await UI.confirm(
      'Delete pose',
      'Delete pose "' + (pose ? pose.name : id) + '"? This cannot be undone.',
      'Delete'
    );
    if (!ok) return;
    try {
      await API.del('/poses/' + id);
      await StateController.refresh();
      UI.success('Pose deleted.');
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  global.PosesView = {
    key: VIEW,
    label: 'Poses',
    icon: 'bi-grid-3x3-gap',
    render: render,
  };
})(window);