/* Sequence Preview view (brief 04; architecture §5.4, §9.3.6).
 * Read-only, ordered inspection of a selected sequence. Resolves every step to
 * concrete servo targets and timing via GET /api/sequences/{id}/preview so the
 * view always reflects the current saved state. Reflects the enhanced timing
 * fields (easing, speed, from-angle, start/end ms, loop/repeat, groups). No
 * write path. The preview document is re-fetched on every render so it can
 * never show stale data (v0.1 issue I11).
 */
(function (global) {
  'use strict';

  const VIEW = 'preview';
  let doc = null;
  let fetching = false;

  async function ensureFresh() {
    const seqId = STATE.selectedSequenceId;
    if (seqId === null || seqId === undefined) {
      doc = null;
      return;
    }
    if (fetching) return;
    fetching = true;
    try {
      const d = await API.get('/sequences/' + seqId + '/preview');
      if (STATE.selectedSequenceId !== seqId) return;
      doc = d;
      const wrap = document.getElementById('view-' + VIEW);
      if (wrap && wrap.isConnected) global.PreviewView.render(wrap);
    } catch (err) {
      UI.renderApiError(err);
    } finally {
      fetching = false;
    }
  }

  function render(container) {
    container.innerHTML =
      '<h4 class="mb-3">Preview</h4>' +
      '<div class="row g-3">' +
      '<div class="col-md-4">' +
      '<div class="card"><div class="card-header">Sequences</div>' +
      '<div class="list-group list-group-flush" id="pvSeqList"></div></div>' +
      '</div>' +
      '<div class="col-md-8"><div id="pvPane"></div></div>' +
      '</div>';

    const list = container.querySelector('#pvSeqList');
    if (STATE.sequences.length === 0) {
      list.innerHTML = '<div class="list-group-item text-muted text-center">No sequences</div>';
    } else {
      list.innerHTML = STATE.sequences
        .map((s) =>
          '<div class="list-group-item list-group-item-action' +
          (STATE.selectedSequenceId === s.id ? ' active' : '') +
          '" data-id="' + s.id + '">' + esc(s.name) + '</div>')
        .join('');
    }

    renderPane(container);
    bind(container);
    if (STATE.selectedSequenceId !== null && STATE.selectedSequenceId !== undefined) {
      ensureFresh();
    }
  }

  function repeatText(doc) {
    const parts = [];
    if (doc.repeat_forever) parts.push('sequence repeats forever');
    else if (doc.repeat_count && doc.repeat_count > 1) parts.push('sequence repeats ' + doc.repeat_count + 'x');
    (doc.groups || []).forEach((g) => {
      parts.push('group \u201c' + (g.name || '#' + g.id) + '\u201d (steps ' +
        g.step_orders.map((o) => '#' + (o + 1)).join(', ') + ') ' +
        (g.repeat_forever ? 'repeats forever' : 'repeats ' + (g.repeat_count || 1) + 'x'));
    });
    return parts.length ? parts.join('; ') : 'no repeats';
  }

  function renderPane(container) {
    const pane = container.querySelector('#pvPane');
    if (doc === null) {
      pane.innerHTML = '<div class="text-muted border rounded p-4 text-center">Select a sequence to preview it.</div>';
      return;
    }
    const totalTargets = doc.steps.reduce((n, s) => n + s.targets.length, 0);

    const stepCards = doc.steps
      .map((st) => {
        let head;
        if (st.kind === 'pose') {
          head = '<span class="badge text-bg-info me-2">pose</span>Pose \u201c' + esc(st.pose_name) + '\u201d';
        } else {
          head = '<span class="badge text-bg-secondary me-2">servo</span>' + esc(st.servo_name) + ' \u2192 ' + st.angle + '\u00b0';
        }
        const targets = st.targets
          .map((t) =>
            '<tr><td>' + esc(t.servo_name) + '</td>' +
            '<td>' + t.from_angle + '\u00b0 \u2192 ' + t.angle + '\u00b0</td>' +
            '<td>' + t.pulse_us + ' \u00b5s</td></tr>')
          .join('');
        const timing =
          '<span class="badge text-bg-light border me-1">' + st.start_ms + '\u2013' + st.end_ms + 'ms</span>' +
          '<span class="badge text-bg-light border me-1">move ' + st.duration_ms + 'ms</span>' +
          (st.hold_ms !== null && st.hold_ms !== undefined
            ? '<span class="badge text-bg-light border me-1">hold ' + st.hold_ms + 'ms</span>'
            : '<span class="badge text-bg-light border me-1">no hold</span>') +
          '<span class="badge text-bg-light border me-1">' + esc(st.easing || 'linear') + '</span>' +
          (st.speed_deg_per_s != null
            ? '<span class="badge text-bg-light border">' + st.speed_deg_per_s + ' deg/s</span>'
            : '');
        return '<div class="card mb-2"><div class="card-body py-2">' +
          '<div class="d-flex justify-content-between align-items-center flex-wrap gap-1">' +
          '<div><span class="badge text-bg-light border me-2">step ' + (st.order + 1) + '</span>' + head +
          (st.group_id != null ? ' <span class="badge text-bg-primary">in group</span>' : '') +
          '</div>' +
          '<div class="text-nowrap">' + timing + '</div></div>' +
          '<table class="table table-sm table-striped mb-0 mt-2">' +
          '<thead><tr><th>Servo</th><th>From \u2192 To</th><th>Pulse width</th></tr></thead>' +
          '<tbody>' + targets + '</tbody></table>' +
          '</div></div>';
      })
      .join('');

    pane.innerHTML =
      '<div class="card"><div class="card-body">' +
      '<h5 class="mb-1">' + esc(doc.sequence_name) + '</h5>' +
      '<div class="text-muted small mb-1">' + doc.steps.length + ' steps \u00b7 ' +
      totalTargets + ' servo movements</div>' +
      '<div class="text-muted small mb-3">' +
      'Pass: ' + (doc.pass_duration_ms != null ? Math.round(doc.pass_duration_ms) + 'ms' : 'loops forever') +
      (doc.total_duration_ms != null
        ? ' \u00b7 Total: ' + Math.round(doc.total_duration_ms) + 'ms'
        : '') +
      ' \u00b7 ' + repeatText(doc) + '</div>' +
      '<div class="alert alert-info py-2 small mb-3"><i class="bi bi-info-circle me-1"></i>' +
      'Read-only inspection of the current saved state. No physical motion is performed.</div>' +
      '<div>' + stepCards + '</div>' +
      '</div></div>';
  }

  function bind(container) {
    container.querySelector('#pvSeqList').addEventListener('click', async (e) => {
      const item = e.target.closest('[data-id]');
      if (!item) return;
      STATE.selectedSequenceId = Number(item.getAttribute('data-id'));
      doc = null;
      render(container);
    });
  }

  global.PreviewView = {
    key: VIEW,
    label: 'Preview',
    icon: 'bi-eye',
    render: render,
  };
})(window);