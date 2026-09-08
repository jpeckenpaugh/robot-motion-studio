/* Thin fetch wrapper over the /api/* backend contract (architecture §5).
 * Single client used by every view. Consumes exactly the endpoints the
 * backend exposes; no invented routes.
 */
(function (global) {
  'use strict';

  async function request(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, opts);
    if (res.status === 204) return null;
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (!res.ok) {
      const err = new Error(
        (data && data.detail) || 'Request failed (' + res.status + ')'
      );
      err.status = res.status;
      err.code = data && data.code;
      err.body = data;
      throw err;
    }
    return data;
  }

  const api = {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    put: (p, b) => request('PUT', p, b),
    patch: (p, b) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
    request: request,
  };

  global.API = api;
})(window);