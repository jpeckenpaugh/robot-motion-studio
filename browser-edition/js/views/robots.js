/* Robot collection UI (brief 01; architecture §9.3.1, §9.5).
 *
 * A global switcher mounted in the navbar that always shows the current robot
 * and exposes the robot collection: switch robot, create a new robot (name +
 * description), edit the current robot, and delete a robot with a confirmation
 * that warns its poses and sequences are removed. Selection is persisted by the
 * backend (GET/PUT /api/state/current-robot); switching reloads the whole view
 * state so every downstream capability operates against the new selection.
 */
(function (global) {
  'use strict';

  function mount(container) {
    container.innerHTML =
      '<div class="dropdown">' +
      '<button class="btn btn-outline-light btn-sm dropdown-toggle" type="button" ' +
      'data-bs-toggle="dropdown" aria-expanded="false" id="robotSwitcherBtn">' +
      '<i class="bi bi-robot me-1"></i><span id="robotSwitcherLabel">Robot</span>' +
      '</button>' +
      '<ul class="dropdown-menu dropdown-menu-end" id="robotSwitcherMenu"></ul>' +
      '</div>';
    container.querySelector('[data-bs-toggle="dropdown"]').addEventListener('click', renderMenu);
    container.addEventListener('click', onMenuClick);
  }

  function renderMenu() {
    const menu = document.getElementById('robotSwitcherMenu');
    if (!menu) return;
    const items = STATE.robots
      .map(
        (r) =>
          '<li><button class="dropdown-item' + (r.current ? ' active' : '') + '" ' +
          'data-act="switch" data-id="' + r.id + '">' +
          '<i class="bi ' + (r.current ? 'bi-dot-circle-fill' : 'bi-dot') + ' me-2"></i>' +
          esc(r.name) + (r.current ? ' <span class="badge text-bg-secondary">current</span>' : '') +
          '</button></li>'
      )
      .join('');
    menu.innerHTML =
      '<li><h6 class="dropdown-header">Robots</h6></li>' +
      items +
      '<li><hr class="dropdown-divider"></li>' +
      '<li><button class="dropdown-item" data-act="create"><i class="bi bi-plus-lg me-2"></i>New robot</button></li>' +
      '<li><button class="dropdown-item" data-act="edit"><i class="bi bi-pencil-square me-2"></i>Edit current robot</button></li>' +
      '<li><button class="dropdown-item text-danger" data-act="delete"><i class="bi bi-trash me-2"></i>Delete current robot</button></li>';
  }

  async function onMenuClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    if (act === 'switch') await switchRobot(Number(btn.getAttribute('data-id')));
    else if (act === 'create') openCreateModal();
    else if (act === 'edit') openEditModal();
    else if (act === 'delete') await deleteRobot();
  }

  async function switchRobot(robotId) {
    if (robotId === STATE.currentRobotId) return;
    try {
      await StateController.setCurrentRobot(robotId);
      UI.success('Switched to "' + STATE.robotName + '".');
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  function openCreateModal() {
    const body =
      '<div class="mb-3"><label class="form-label">Robot name</label>' +
      '<input class="form-control" id="rbName"></div>' +
      '<div class="mb-3"><label class="form-label">Description</label>' +
      '<textarea class="form-control" id="rbDesc" rows="2"></textarea></div>' +
      '<div class="form-text">A new robot starts with an empty servo inventory. ' +
      'You can add servos from the Configuration view after creating it.</div>';

    openGenericModal('New robot', body, 'Create robot', async (root) => {
      const name = root.querySelector('#rbName').value.trim();
      if (!name) throw new Error('Robot name is required.');
      const description = root.querySelector('#rbDesc').value.trim();
      const robot = await API.post('/robots', { name: name, description: description });
      // Auto-select the newly created robot so it can be configured immediately.
      await StateController.setCurrentRobot(robot.id);
      UI.success('Robot "' + robot.name + '" created and selected.');
    });
  }

  function openEditModal() {
    const body =
      '<div class="mb-3"><label class="form-label">Robot name</label>' +
      '<input class="form-control" id="rbName" value="' + escAttr(STATE.robotName) + '"></div>' +
      '<div class="mb-3"><label class="form-label">Description</label>' +
      '<textarea class="form-control" id="rbDesc" rows="3">' + escAttr(STATE.robotDescription) + '</textarea></div>';

    openGenericModal('Edit robot', body, 'Save changes', async (root) => {
      const payload = {};
      const name = root.querySelector('#rbName').value.trim();
      if (!name) throw new Error('Robot name is required.');
      if (name !== STATE.robotName) payload.name = name;
      const description = root.querySelector('#rbDesc').value.trim();
      if (description !== STATE.robotDescription) payload.description = description;
      if (Object.keys(payload).length === 0) {
        UI.toast('No changes to save.', 'secondary');
        return;
      }
      await API.patch('/robots/' + STATE.currentRobotId, payload);
      await StateController.refresh();
      UI.success('Robot updated.');
    });
  }

  async function deleteRobot() {
    const robot = STATE.robotById(STATE.currentRobotId);
    const ok = await UI.confirm(
      'Delete robot',
      'Delete robot "' + (robot ? robot.name : STATE.robotName) + '"? This also ' +
        'removes all of its poses and sequences and cannot be undone.',
      'Delete'
    );
    if (!ok) return;
    try {
      await API.del('/robots/' + STATE.currentRobotId);
      UI.success('Robot deleted.');
      // The backend clears the current selection (FK SET NULL); refresh picks
      // the first remaining robot, or renders the empty state if none remain.
      await StateController.refresh();
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  /* Update the always-visible switcher label to the current robot. */
  function updateLabel() {
    const label = document.getElementById('robotSwitcherLabel');
    if (label) label.textContent = STATE.robotName || 'No robot';
  }

  global.RobotsController = {
    mount: mount,
    updateLabel: updateLabel,
  };
})(window);