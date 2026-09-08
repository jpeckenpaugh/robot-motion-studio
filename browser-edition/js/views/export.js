/* Sequence Export view (brief 05; architecture §5.5).
 * Triggers a downloadable JSON artifact from the backend. Both the full export
 * (robot config + all sequences) and per-sequence export read through the API
 * at request time, so the artifact always reflects the current saved state.
 * The backend sets Content-Disposition so the browser saves the file.
 */
(function (global) {
  'use strict';

  const VIEW = 'export';

  function render(container) {
    container.innerHTML =
      '<div class="row"><div class="col-lg-8">' +
      '<h4 class="mb-3">Export</h4>' +
      '<div class="card mb-3"><div class="card-body">' +
      '<h5 class="card-title"><i class="bi bi-download me-2"></i>Full export</h5>' +
      '<p class="text-muted">Download a self-contained JSON document of the ' +
      'current robot configuration and all authored sequences. Pose references ' +
      'are resolved into concrete servo targets with pulse widths, so the JSON ' +
      'can be consumed directly by firmware without the app.</p>' +
      '<button class="btn btn-primary" id="btnFullExport">' +
      '<i class="bi bi-download me-1"></i>Download full export</button>' +
      '</div></div>' +

      '<div class="card"><div class="card-body">' +
      '<h5 class="card-title"><i class="bi bi-file-earmark-arrow-down me-2"></i>Export a single sequence</h5>' +
      '<p class="text-muted">Choose one sequence to export it as its own JSON ' +
      'document (same schema, including the full robot configuration).</p>' +
      '<div class="input-group">' +
      '<select class="form-select" id="selExportSeq">' +
      '<option value="">Select a sequence\u2026</option>' +
      STATE.sequences.map((s) => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('') +
      '</select>' +
      '<button class="btn btn-outline-primary" id="btnSeqExport" disabled>Download</button>' +
      '</div>' +
      '</div></div>' +
      '</div></div>';

    bind(container);
  }

  function bind(container) {
    container.querySelector('#btnFullExport').addEventListener('click', () => {
      triggerDownload('/export');
    });
    const sel = container.querySelector('#selExportSeq');
    const btn = container.querySelector('#btnSeqExport');
    sel.addEventListener('change', () => {
      btn.disabled = sel.value === '';
    });
    btn.addEventListener('click', () => {
      if (sel.value !== '') triggerDownload('/sequences/' + sel.value + '/export');
    });
  }

  /* Download the JSON artifact via the worker (no HTTP route in this edition). */
  function triggerDownload(path) {
    API.downloadExport(path).catch((err) => UI.renderApiError(err));
  }

  global.ExportView = {
    key: VIEW,
    label: 'Export',
    icon: 'bi-download',
    render: render,
  };
})(window);