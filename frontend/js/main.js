/* App bootstrap, navigation, and view routing (architecture §4).
 * Loads the initial view state from the backend, wires the nav, and re-renders
 * the active view whenever the shared state refreshes.
 */
(function () {
  'use strict';

  const views = [
    window.ConfigurationView,
    window.PosesView,
    window.SequencesView,
    window.PreviewView,
    window.ExportView,
  ];
  let activeKey = 'configuration';
  let rootEl = null;

  function renderNav() {
    const nav = document.getElementById('navLinks');
    nav.innerHTML = views
      .map(
        (v) =>
          '<button class="nav-link' + (v.key === activeKey ? ' active' : '') + '" data-view="' + v.key + '">' +
          '<i class="bi ' + v.icon + ' me-1"></i>' + v.label + '</button>'
      )
      .join('');
  }

  function renderActive() {
    const view = views.find((v) => v.key === activeKey);
    rootEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.id = 'view-' + activeKey;
    rootEl.appendChild(wrap);
    view.render(wrap);
  }

  async function switchView(key) {
    if (!views.some((v) => v.key === key)) return;
    activeKey = key;
    renderNav();
    renderActive();
  }

  async function init() {
    rootEl = document.getElementById('app');
    document.getElementById('navLinks').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-view]');
      if (btn) switchView(btn.getAttribute('data-view'));
    });

    // Re-render the active view whenever the backend state refreshes.
    StateController.onRefresh(() => {
      if (rootEl) renderActive();
    });

    // Cross-view trigger: when the sequences view selects a sequence, the
    // preview view should show the same one if active.
    try {
      await StateController.refresh();
      document.getElementById('brandName').textContent = STATE.robotName;
      renderActive();
    } catch (err) {
      rootEl.innerHTML =
        '<div class="alert alert-danger mt-3"><i class="bi bi-exclamation-triangle me-1"></i>' +
        'Could not load data from the backend: ' + esc(err.message) + '</div>';
    }
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  document.addEventListener('DOMContentLoaded', init);
})();