/* Main-thread worker proxy. Mirrors the reference browser-POC pattern: a
 * classic worker (importScripts sql.js) with a serialized {id, op, payload}
 * RPC envelope. call() resolves with the worker's result or rejects with the
 * reconstructed error (including {status, code, detail} for API errors).
 */
const worker = new Worker(new URL('./worker.js', import.meta.url));

let next = 1;
const pending = new Map();

worker.onmessage = ({ data }) => {
  const call = pending.get(data.id);
  if (!call) return;
  pending.delete(data.id);
  if (data.error) {
    const err = Object.assign(new Error(data.error.message || 'RPC error'), data.error);
    call.reject(err);
  } else {
    call.resolve(data.result);
  }
};

export const db = {
  call(op, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, op, payload });
    });
  },
};