/* Shared UI helpers: Bootstrap toasts, confirmation, error formatting.
 * These are presentation conveniences only; all validation/enforcement
 * happens on the backend.
 */
(function (global) {
  'use strict';

  let toastContainer = null;
  function ensureToastContainer() {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  function toast(message, type) {
    const container = ensureToastContainer();
    const el = document.createElement('div');
    el.className =
      'toast align-items-center text-bg-' + (type || 'secondary') + ' border-0';
    el.setAttribute('role', 'alert');
    el.innerHTML =
      '<div class="d-flex"><div class="toast-body"></div>' +
      '<button type="button" class="btn-close btn-close-white me-2 m-auto" ' +
      'data-bs-dismiss="toast" aria-label="Close"></button></div>';
    el.querySelector('.toast-body').textContent = message;
    container.appendChild(el);
    const t = new bootstrap.Toast(el, { delay: 4000 });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  }

  function error(message) {
    toast(message, 'danger');
  }

  function success(message) {
    toast(message, 'success');
  }

  /* Render a backend error (Error with .status/.code/.body) as a toast. */
  function renderApiError(err) {
    let msg = err && err.message ? err.message : 'Unexpected error';
    if (err && err.code) msg = msg + ' (' + err.code + ')';
    error(msg);
  }

  /* Promise-based confirm via a Bootstrap modal. Resolves true/false. */
  function confirmDialog(title, message, confirmLabel) {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'modal fade';
      el.setAttribute('tabindex', '-1');
      el.innerHTML =
        '<div class="modal-dialog"><div class="modal-content">' +
        '<div class="modal-header"><h5 class="modal-title"></h5>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>' +
        '<div class="modal-body"></div>' +
        '<div class="modal-footer">' +
        '<button type="button" class="btn btn-secondary btn-cancel" data-bs-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-danger btn-confirm"></button>' +
        '</div></div></div>';
      el.querySelector('.modal-title').textContent = title;
      el.querySelector('.modal-body').textContent = message;
      el.querySelector('.btn-confirm').textContent = confirmLabel || 'Confirm';
      document.body.appendChild(el);
      const modal = new bootstrap.Modal(el);
      el.querySelector('.btn-confirm').addEventListener('click', () => {
        modal.hide();
        resolve(true);
      });
      el.addEventListener('hidden.bs.modal', () => {
        el.remove();
        resolve(false);
      });
      modal.show();
    });
  }

  global.UI = {
    toast: toast,
    error: error,
    success: success,
    renderApiError: renderApiError,
    confirm: confirmDialog,
  };
})(window);