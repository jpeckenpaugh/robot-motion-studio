/* Browser-edition API bridge. Drop-in replacement for the fetch-backed
 * frontend/js/api.js: exposes the same window.API surface
 * (get/post/put/patch/del/request) but routes every call to the sql.js Web
 * Worker instead of an HTTP backend. Response bodies and error shapes
 * ({message, status, code, detail}) match the HTTP contract exactly, so the
 * SPA views are unchanged.
 *
 * Also adds API.downloadExport(path) for the export view, which in the HTTP
 * edition navigated to a Content-Disposition route; here the worker returns
 * the document + filename and this triggers a Blob download.
 */
(function (global) {
  'use strict';

  let _dbPromise = null;
  function db() {
    if (!_dbPromise) {
      _dbPromise = import('./db/client.js').then((m) => m.db);
    }
    return _dbPromise;
  }

  async function request(method, path, body) {
    const client = await db();
    const res = await client.call('request', { method, path, body });
    if (res.status === 204) return null;
    return res.body;
  }

  async function requestOrThrow(method, path, body) {
    try {
      return await request(method, path, body);
    } catch (err) {
      throw err; // worker rejects with {message, status, code, detail}
    }
  }

  const api = {
    get: (p) => requestOrThrow('GET', p),
    post: (p, b) => requestOrThrow('POST', p, b),
    put: (p, b) => requestOrThrow('PUT', p, b),
    patch: (p, b) => requestOrThrow('PATCH', p, b),
    del: (p) => requestOrThrow('DELETE', p),
    request: requestOrThrow,

    /* Export downloads (replaces navigation to /api/export). */
    async downloadExport(path) {
      const client = await db();
      const { doc, filename } = await client.call('request', { method: 'GET', path });
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },

    /* Workspace controls (browser edition only). */
    workspace: {
      status: () => db().then((c) => c.call('workspace.status')),
      export: () => db().then((c) => c.call('workspace.export')),
      import: (bytes) => db().then((c) => c.call('workspace.import', { bytes })),
      reset: () => db().then((c) => c.call('workspace.reset')),
    },
  };

  global.API = api;
})(window);