/* Workspace view (browser edition only). The backend edition has no such
 * concept: it persists to a server-side SQLite file. In this edition all data
 * lives in the browser's OPFS storage, so this view exposes the workspace
 * lifecycle: status, export a backup SQLite file, import a previously exported
 * workspace, and re-seed the door rig when the DB is empty.
 */
(function (global) {
  'use strict';

  const VIEW = 'workspace';

  function fmtSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KiB', 'MiB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(1) + ' ' + units[i];
  }

  async function render(container) {
    container.innerHTML =
      '<div class="row"><div class="col-lg-8">' +
      '<h4 class="mb-3"><i class="bi bi-hdd me-2"></i>Workspace</h4>' +
      '<div class="card mb-3"><div class="card-body">' +
      '<p class="text-muted">This browser edition stores all data in your ' +
      'browser\u2019s local OPFS storage \u2014 there is no server. Export a ' +
      'backup regularly; browser storage can be cleared by the user or the ' +
      'browser.</p>' +
      '<div class="d-flex flex-wrap gap-2 align-items-center mb-3">' +
      '<span class="badge text-bg-secondary" id="wsState">Loading\u2026</span>' +
      '</div>' +
      '<button class="btn btn-primary me-2" id="btnWsExport">' +
      '<i class="bi bi-download me-1"></i>Export workspace (.db)</button>' +
      '<button class="btn btn-outline-primary me-2" id="btnWsImport">' +
      '<i class="bi bi-upload me-1"></i>Import workspace</button>' +
      '<button class="btn btn-outline-danger" id="btnWsReset">' +
      '<i class="bi bi-arrow-repeat me-1"></i>Reset sample data</button>' +
      '<input type="file" id="wsImportFile" class="d-none" accept=".db,application/x-sqlite3">' +
      '</div></div></div>' +
      '</div></div>';

    bind(container);
    await refreshStatus(container);
  }

  async function refreshStatus(container) {
    try {
      const st = await API.workspace.status();
      const badge = container.querySelector('#wsState');
      badge.innerHTML =
        'Revision ' + (st.revision || 0) +
        ' · ' + fmtSize(st.workspaceBytes || 0) +
        ' · Robots: ' + st.robotCount +
        ' · Last persisted: ' + (st.lastPersisted ? new Date(st.lastPersisted).toLocaleString() : 'not yet') +
        ' · ' + st.state;
    } catch (err) {
      UI.renderApiError(err);
    }
  }

  function bind(container) {
    container.querySelector('#btnWsExport').addEventListener('click', async () => {
      try {
        const bytes = await API.workspace.export();
        const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'robot-motion-designer-' + new Date().toISOString().slice(0, 10) + '.db';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        UI.success('Workspace exported.');
      } catch (err) {
        UI.renderApiError(err);
      }
    });

    const fileInput = container.querySelector('#wsImportFile');
    container.querySelector('#btnWsImport').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        await API.workspace.import(await file.arrayBuffer());
        UI.success('Workspace imported.');
        await StateController.refresh();
        await refreshStatus(container);
      } catch (err) {
        UI.renderApiError(err);
      } finally {
        fileInput.value = '';
      }
    });

    container.querySelector('#btnWsReset').addEventListener('click', async () => {
      const ok = await UI.confirm(
        'Reset sample data?',
        'Re-seeds the Door Durability Rig only when the workspace has no robots. ' +
        'Your existing data is not touched.'
      );
      if (!ok) return;
      try {
        await API.workspace.reset();
        UI.success('Sample data reset.');
        await StateController.refresh();
        await refreshStatus(container);
      } catch (err) {
        UI.renderApiError(err);
      }
    });
  }

  global.WorkspaceView = {
    key: VIEW,
    label: 'Workspace',
    icon: 'bi-hdd',
    render: render,
  };
})(window);