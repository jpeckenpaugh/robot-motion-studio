/* sql.js is intentionally confined to this worker; the SPA never sees SQL.
 *
 * This is a CLASSIC worker (it uses importScripts to load sql.js) and therefore
 * loads its own ES modules via dynamic import(). Because dynamic import() of
 * the same URL is cached, the engine.js instance resolved here is the SAME
 * module instance that the handlers use, so setDatabase() here is visible to
 * every handler.
 *
 * Dispatch surface mirrors the backend HTTP contract:
 *   { op: 'request', method, path, body }  -> { status, body }
 *   { op: 'workspace.status' }             -> storage metadata
 *   { op: 'workspace.export' }             -> ArrayBuffer of the SQLite file
 *   { op: 'workspace.import', bytes }      -> replace workspace after validation
 *   { op: 'workspace.reset' }              -> re-seed door rig on an empty DB
 *
 * Writes run in a transaction and persist to OPFS only after a successful
 * commit, so a failed mutation never leaves a half-written workspace.
 */
importScripts(new URL('../../vendor/sql.js/sql-wasm.js', self.location.href).href);

let SQL, database, storage, initialized = false, fatal = null;
let queue = Promise.resolve();

const NO_CONTENT = 204;
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function initialize() {
  if (initialized) return;
  if (fatal) throw fatal;

  SQL = await initSqlJs({
    locateFile: () => new URL('../../vendor/sql.js/sql-wasm.wasm', self.location.href).href,
  });

  const [{ WorkspaceStorage }, { SCHEMA_SQL, validateDatabase }, { setDatabase, run, one }] =
    await Promise.all([
      import('./persistence.js'),
      import('./schema.js'),
      import('./engine.js'),
    ]);

  storage = new WorkspaceStorage();
  const bytes = await storage.open();

  if (bytes.byteLength) {
    // Existing workspace: load + validate (PRAGMA re-applied; sql.js may drop it).
    const loaded = new SQL.Database(bytes);
    loaded.run('PRAGMA foreign_keys = ON;');
    try {
      validateDatabase(loaded);
    } catch (error) {
      loaded.close();
      throw error;
    }
    setDatabase(loaded);
    database = loaded;
  } else {
    // Fresh workspace: create schema + seed once.
    const fresh = new SQL.Database();
    fresh.run('PRAGMA foreign_keys = ON;');
    setDatabase(fresh);
    database = fresh;
    fresh.run(SCHEMA_SQL);
    const { seed } = await import('./seed.js');
    const robotId = seed();
    run('UPDATE app_state SET seeded = 1, current_robot_id = ? WHERE id = 1', [robotId]);
    await persist();
  }
  initialized = true;
}

function snapshot() {
  try {
    return database.export();
  } finally {
    database.run('PRAGMA foreign_keys = ON;');
  }
}

async function persist() {
  try {
    await storage.replace(snapshot());
  } catch (error) {
    return recover(error);
  }
}

async function recover(error) {
  try {
    database.close();
    database = new SQL.Database(new Uint8Array(await storage.export()));
    database.run('PRAGMA foreign_keys = ON;');
    const { setDatabase } = await import('./engine.js');
    setDatabase(database);
  } catch (recovery) {
    fatal = new Error(`Workspace recovery failed; reload required: ${recovery.message}`);
    throw fatal;
  }
  throw error;
}

function status() {
  let robotCount = 0;
  try {
    robotCount = database.exec('SELECT COUNT(*) AS c FROM robots')[0].values[0][0];
  } catch (_) {}
  return {
    ...(storage ? storage.metadata : {}),
    workspaceBytes: storage ? storage.workspaceBytes : 0,
    state: fatal ? 'failed' : 'saved',
    robotCount,
  };
}

/* ---- request router (mirrors the HTTP contract) ---- */

function parseQuery(path) {
  const qIndex = path.indexOf('?');
  if (qIndex === -1) return { clean: path, query: {} };
  const clean = path.slice(0, qIndex);
  const query = {};
  for (const pair of path.slice(qIndex + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1));
    query[key] = value;
  }
  return { clean, query };
}

function parsePath(path) {
  const { clean } = parseQuery(path);
  return clean.replace(/^\/+/, '').split('/').map((seg) => decodeURIComponent(seg));
}

function lookup(method, seg) {
  const table = ROUTES[method];
  if (!table) return null;
  for (const [pattern, fn] of table) {
    if (pattern.length !== seg.length) continue;
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === '*') continue;
      if (pattern[i] !== seg[i]) { ok = false; break; }
    }
    if (ok) return fn;
  }
  return null;
}

let HANDLERS = null;
async function handlers() {
  if (!HANDLERS) HANDLERS = await import('./handlers.js');
  return HANDLERS;
}

async function route(method, path, body) {
  const h = await handlers();
  const { clean, query } = parseQuery(path);
  const seg = parsePath(clean);
  const fn = lookup(method, seg);
  if (!fn) throw new Error(`No route for ${method} ${path}`);
  // Merge query params into the body (mirrors FastAPI optional ?robot_id=).
  // Coerce numeric-looking query values (e.g. robot_id) to numbers so handler
  // comparisons against integer columns behave like the FastAPI path params.
  const merged = { ...(body || {}) };
  for (const [k, value] of Object.entries(query)) {
    merged[k] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }
  return fn(h, seg, merged);
}

const GET = 'GET', POST = 'POST', PUT = 'PUT', PATCH = 'PATCH', DELETE = 'DELETE';

const ROUTES = {
  [GET]: [
    [['robots'], (h) => h.listRobots()],
    [['robots', '*'], (h, s) => h.getRobot(Number(s[1]))],
    [['robots', '*', 'servos'], (h, s) => h.listServos(Number(s[1]))],
    [['robots', '*', 'servos', '*'], (h, s) => h.getServo(Number(s[1]), Number(s[3]))],
    [['state', 'current-robot'], (h) => h.getCurrentRobot()],
    [['poses'], (h, s, b) => h.listPoses(b.robot_id)],
    [['poses', '*'], (h, s) => h.getPose(Number(s[1]))],
    [['sequences'], (h, s, b) => h.listSequences(b.robot_id)],
    [['sequences', '*'], (h, s) => h.getSequence(Number(s[1]))],
    [['sequences', '*', 'preview'], (h, s) => h.previewSequence(Number(s[1]))],
    [['sequences', '*', 'groups', '*'], (h, s) => h.getGroup(Number(s[1]), Number(s[3]))],
    [['sequences', '*', 'export'], (h, s, b) => h.exportSequence(Number(s[1]), b.robot_id)],
    [['export'], (h, s, b) => h.exportAll(b.robot_id)],
  ],
  [POST]: [
    [['robots'], (h, s, b) => h.createRobot(b)],
    [['robots', '*', 'servos'], (h, s, b) => h.createServo(Number(s[1]), b)],
    [['poses'], (h, s, b) => h.createPose(b, b.robot_id)],
    [['sequences'], (h, s, b) => h.createSequence(b, b.robot_id)],
    [['sequences', '*', 'steps'], (h, s, b) => h.addStep(Number(s[1]), b)],
    [['sequences', '*', 'steps', '*', 'duplicate'], (h, s) => h.duplicateStep(Number(s[1]), Number(s[3]))],
    [['sequences', '*', 'reorder'], (h, s, b) => h.reorderSteps(Number(s[1]), b)],
    [['sequences', '*', 'groups'], (h, s, b) => h.createGroup(Number(s[1]), b)],
  ],
  [PUT]: [
    [['state', 'current-robot'], (h, s, b) => h.setCurrentRobot(b)],
    [['robots', '*', 'servos', '*'], (h, s, b) => h.updateServo(Number(s[1]), Number(s[3]), b)],
    [['poses', '*'], (h, s, b) => h.updatePose(Number(s[1]), b)],
    [['sequences', '*'], (h, s, b) => h.updateSequence(Number(s[1]), b)],
    [['sequences', '*', 'steps', '*'], (h, s, b) => h.updateStep(Number(s[1]), Number(s[3]), b)],
    [['sequences', '*', 'groups', '*'], (h, s, b) => h.updateGroup(Number(s[1]), Number(s[3]), b)],
  ],
  [PATCH]: [
    [['robots', '*'], (h, s, b) => h.updateRobot(Number(s[1]), b)],
  ],
  [DELETE]: [
    [['robots', '*'], (h, s) => h.deleteRobot(Number(s[1]))],
    [['robots', '*', 'servos', '*'], (h, s) => h.deleteServo(Number(s[1]), Number(s[3]))],
    [['poses', '*'], (h, s) => h.deletePose(Number(s[1]))],
    [['sequences', '*'], (h, s) => h.deleteSequence(Number(s[1]))],
    [['sequences', '*', 'steps', '*'], (h, s) => h.removeStep(Number(s[1]), Number(s[3]))],
    [['sequences', '*', 'groups', '*'], (h, s) => h.deleteGroup(Number(s[1]), Number(s[3]))],
  ],
};

async function dispatch(op, payload) {
  await initialize();
  if (fatal) throw fatal;

  if (op === 'workspace.status') return status();
  if (op === 'workspace.export') return snapshot().buffer;
  if (op === 'workspace.import') {
    const { validateDatabase } = await import('./schema.js');
    const candidate = new SQL.Database(new Uint8Array(payload.bytes));
    candidate.run('PRAGMA foreign_keys = ON;');
    try {
      validateDatabase(candidate);
    } catch (error) {
      candidate.close();
      throw error;
    }
    database.close();
    database = candidate;
    const { setDatabase } = await import('./engine.js');
    setDatabase(database);
    await persist();
    return status();
  }
  if (op === 'workspace.reset') {
    const { one, run } = await import('./engine.js');
    const count = one('SELECT COUNT(*) AS c FROM robots').c;
    if (count === 0) {
      const { seed } = await import('./seed.js');
      const robotId = seed();
      run('UPDATE app_state SET seeded = 1, current_robot_id = ? WHERE id = 1', [robotId]);
      await persist();
    }
    return status();
  }
  if (op === 'request') {
    const { method, path, body } = payload;
    if (WRITE.has(method)) {
      database.run('BEGIN');
      try {
        const result = await route(method, path, body);
        database.run('COMMIT');
        await persist();
        return { status: result === null ? NO_CONTENT : 200, body: result };
      } catch (error) {
        try { database.run('ROLLBACK'); } catch (_) {}
        throw error;
      }
    }
    const result = await route(method, path, body);
    return { status: result === null ? NO_CONTENT : 200, body: result };
  }
  throw new Error(`Unknown operation: ${op}`);
}

self.onmessage = ({ data: { id, op, payload = {} } }) => {
  queue = queue.then(async () => {
    try {
      const result = await dispatch(op, payload);
      self.postMessage({ id, result }, result instanceof ArrayBuffer ? [result] : []);
    } catch (error) {
      let err = { message: error.message, name: error.name };
      if (error.status !== undefined) {
        err = { ...err, status: error.status, code: error.code, detail: error.detail };
      }
      self.postMessage({ id, error: err });
    }
  });
};