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
    window.TimelineView,
    window.PreviewView,
    window.SimulatorView,
    window.ExportView,
    window.WorkspaceView,
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

    // Re-render the active view whenever the backend state refreshes, and keep
    // the always-visible current-robot indicators in sync.
    StateController.onRefresh(() => {
      document.getElementById('brandName').textContent = STATE.robotName || 'No robot';
      if (window.RobotsController) window.RobotsController.updateLabel();
      if (rootEl) renderActive();
    });

    // Robot collection switcher (brief 01): always visible in the navbar.
    if (window.RobotsController) {
      const slot = document.getElementById('robotSwitcher');
      if (slot) window.RobotsController.mount(slot);
    }

    try {
      await StateController.refresh();
      document.getElementById('brandName').textContent = STATE.robotName;
      renderNav();      // v0.1 only rendered nav on switch; render it on load too
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