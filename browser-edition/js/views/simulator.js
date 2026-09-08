/* Simulator view (brief 05; architecture §9.4, §9.5).
 *
 * A read-only, Canvas-based motion simulator for the selected robot and
 * sequence. It fetches the authoritative resolved motion document
 * (GET /api/sequences/{id}/preview) on render, so it always reflects the
 * current saved sequence state, and animates it with the shared motion.js
 * module — the same source the timeline editor plays back, so the two agree.
 * Play / pause / reset and drag-to-scrub are timing-accurate and honor easing,
 * holds, speed, and loop/repeat. The simulator never edits the sequence.
 */
(function (global) {
  'use strict';

  const VIEW = 'simulator';
  let ctrl = null;

  function render(container) {
    container.innerHTML =
      '<h4 class="mb-3">Simulator</h4>' +
      '<div class="row g-3">' +
      '<div class="col-md-4">' +
      '<div class="card"><div class="card-header">Sequences</div>' +
      '<div class="list-group list-group-flush" id="simSeqList"></div></div>' +
      '</div>' +
      '<div class="col-md-8"><div id="simPane"></div></div>' +
      '</div>';

    renderSeqList(container);
    renderPane(container);
    bind(container);
  }

  function renderSeqList(container) {
    const list = container.querySelector('#simSeqList');
    if (STATE.sequences.length === 0) {
      list.innerHTML = '<div class="list-group-item text-muted text-center">No sequences</div>';
      return;
    }
    list.innerHTML = STATE.sequences
      .map((s) =>
        '<div class="list-group-item list-group-item-action' +
        (STATE.selectedSequenceId === s.id ? ' active' : '') +
        '" data-id="' + s.id + '">' +
        '<div class="d-flex justify-content-between align-items-center">' +
        '<span>' + esc(s.name) + '</span>' +
        '<span class="badge text-bg-secondary rounded-pill">' + s.step_count + '</span>' +
        '</div></div>')
      .join('');
  }

  function renderPane(container) {
    const pane = container.querySelector('#simPane');
    const seqId = STATE.selectedSequenceId;

    if (ctrl) { ctrl.destroy(); ctrl = null; }

    if (seqId === null || seqId === undefined) {
      pane.innerHTML =
        '<div class="text-muted border rounded p-4 text-center">Select a sequence to simulate it.</div>';
      return;
    }

    pane.innerHTML =
      '<div class="card"><div class="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">' +
      '<div><span class="fw-semibold">' + esc(sequenceName(seqId)) + '</span>' +
      '<span class="text-muted small ms-2"><i class="bi bi-info-circle me-1"></i>read-only visual playback</span></div>' +
      '<div class="d-flex align-items-center gap-2">' +
      '<button class="btn btn-sm btn-primary" data-act="play"><i class="bi bi-play-fill" id="simPlayIcon"></i> <span id="simPlayLabel">Play</span></button>' +
      '<button class="btn btn-sm btn-outline-secondary" data-act="reset"><i class="bi bi-skip-start-fill"></i> Reset</button>' +
      '<span class="badge text-bg-light border" id="simTime">0 ms</span>' +
      '<span class="text-muted small" id="simTotal"></span>' +
      '</div></div>' +
      '<div class="card-body">' +
      '<canvas id="simCanvas" class="sim-canvas"></canvas>' +
      '<div class="small text-muted mt-2">' +
      '<i class="bi bi-info-circle me-1"></i>Drag on the canvas to scrub; the pose at the scrubbed time is timing-accurate. ' +
      'This is a browser visualization only — no physical motion is performed.</div>' +
      '</div></div>';

    const canvas = pane.querySelector('#simCanvas');
    ctrl = Simulator.create(canvas, {
      servos: STATE.servos,
      simConfig: STATE.simConfig,
      poses: STATE.poses,
    });
    ctrl.setOnTime((ms) => {
      const t = pane.querySelector('#simTime');
      const icon = pane.querySelector('#simPlayIcon');
      const label = pane.querySelector('#simPlayLabel');
      if (t) t.textContent = Math.round(ms) + ' ms';
      if (icon) icon.className = 'bi ' + (ctrl.isPlaying() ? 'bi-pause-fill' : 'bi-play-fill');
      if (label) label.textContent = ctrl.isPlaying() ? 'Pause' : 'Play';
    });

    // Load the authoritative motion document for the selected sequence.
    API.get('/sequences/' + seqId + '/preview')
      .then((doc) => {
        if (!document.getElementById('view-' + VIEW)) return;
        if (STATE.selectedSequenceId !== seqId) return;
        ctrl.setDoc(doc);
        ctrl.resize();
        const total = pane.querySelector('#simTotal');
        if (total) {
          if (ctrl.isForever()) total.textContent = '\u00b7 repeat forever';
          else total.textContent = '\u00b7 ' + Math.round(ctrl.playableMs()) + ' ms total';
        }
        const b = pane.querySelector('#simTime');
        if (b) b.textContent = '0 ms';
      })
      .catch((err) => UI.renderApiError(err));
  }

  function sequenceName(seqId) {
    const s = StateController.sequenceById(seqId);
    return s ? s.name : '#' + seqId;
  }

  function bind(container) {
    container.querySelector('#simSeqList').addEventListener('click', (e) => {
      const item = e.target.closest('[data-id]');
      if (!item) return;
      STATE.selectedSequenceId = Number(item.getAttribute('data-id'));
      render(container);
    });
    const pane = container.querySelector('#simPane');
    pane.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'play' && ctrl) ctrl.toggle();
      else if (act === 'reset' && ctrl) ctrl.reset();
    });
  }

  global.SimulatorView = {
    key: VIEW,
    label: 'Simulator',
    icon: 'bi-easel',
    render: render,
  };
})(window);