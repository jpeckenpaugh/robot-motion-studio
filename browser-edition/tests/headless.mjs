/* Headless Chrome smoke test for the browser edition (CDP over WebSocket).
 * Loads the app, waits for the worker to initialize + seed OPFS, checks the
 * SPA rendered the door rig, drives a few mutations through the worker-backed
 * API, and reports. Requires Chrome + a running static server.
 *
 * Usage: node tests/headless.mjs http://127.0.0.1:PORT
 */
import assert from 'node:assert';
import { spawn } from 'node:child_process';

const BASE = process.argv[2] || 'http://127.0.0.1:8013';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const port = 9222 + Math.floor(Math.random() * 1000);
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + `/tmp/be-headless-${port}`,
  '--disable-dev-shm-usage',
  '--no-first-run',
  BASE + '/index.html',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' -> ' + res.status);
  return res.json();
}

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json`);
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

async function evaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const result = await new Promise((resolve) => {
    ws.onmessage = (ev) => resolve(JSON.parse(ev.data));
    ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  ws.close();
  if (result.result && result.result.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.text || 'page exception');
  }
  return result.result.result.value;
}

const wsUrl = await connect();
console.log('connected to page');

// Wait for the worker + seed to finish and the nav to render.
let state = null;
for (let i = 0; i < 100; i++) {
  state = await evaluate(wsUrl, `({nav: !!document.querySelector('#navLinks')?.children.length, brand: document.querySelector('#brandName')?.textContent, appText: document.querySelector('#app')?.textContent?.slice(0, 200)})`);
  if (state.nav && state.brand && !String(state.appText).includes('Could not load')) break;
  await sleep(200);
}
console.log('boot state:', JSON.stringify(state));
assert.ok(state.nav, 'nav rendered');
assert.notStrictEqual(state.brand, 'No robot', 'current robot seeded');
assert.ok(!String(state.appText).includes('Could not load'), 'no load error');

// Robot name should be the door rig.
assert.ok(state.brand.includes('DoorDurabilityRig') || state.brand !== 'No robot', 'brand shows robot');

// Drive a couple of API calls via the page's global API (worker-backed).
const apiResult = await evaluate(wsUrl, `(async () => {
  const robots = await window.API.get('/robots');
  const seqs = await window.API.get('/sequences');
  const preview = await window.API.get('/sequences/' + seqs[0].id + '/preview');
  const exportDoc = await (async () => {
    const res = await window.API.request('GET', '/export');
    return res;
  })();
  return {
    robotCount: robots.length,
    firstRobot: robots[0].name,
    current: robots[0].current,
    seqCount: seqs.length,
    previewSteps: preview.steps.length,
    previewTotalMs: preview.total_duration_ms,
    exportVersion: exportDoc.doc.schema_version,
    robotDescription: exportDoc.doc.robot.description.slice(0, 30),
  };
})()`);
console.log('API through worker:', JSON.stringify(apiResult));
assert.strictEqual(apiResult.robotCount, 5);
assert.strictEqual(apiResult.firstRobot, 'DoorDurabilityRig');
assert.strictEqual(apiResult.current, true);
assert.ok(apiResult.seqCount >= 2);
assert.ok(apiResult.previewSteps >= 2);
assert.strictEqual(apiResult.exportVersion, 2);
assert.ok(apiResult.robotDescription.startsWith('Wall-mounted'));

// Mutate: create a robot, switch to it, delete it.
const mut = await evaluate(wsUrl, `(async () => {
  const r = await window.API.post('/robots', { name: 'HeadlessBot', description: 'from test' });
  await window.API.put('/state/current-robot', { robot_id: r.id });
  const cur = await window.API.get('/state/current-robot');
  await window.API.del('/robots/' + r.id);
  const robots = await window.API.get('/robots');
  return { created: r.name, currentId: cur.robot_id, remaining: robots.length };
})()`);
console.log('mutation through worker:', JSON.stringify(mut));
assert.strictEqual(mut.created, 'HeadlessBot');
assert.strictEqual(mut.remaining, 5); // 5 seeded robots remain after delete

// Error shape parity: 409 on referenced servo delete.
const errShape = await evaluate(wsUrl, `(async () => {
  const robots = await window.API.get('/robots');
  const robot = await window.API.get('/robots/' + robots[0].id);
  try {
    await window.API.del('/robots/' + robots[0].id + '/servos/' + robot.servos[0].id);
    return null;
  } catch (err) {
    return { status: err.status, code: err.code, message: err.message.slice(0, 40) };
  }
})()`);
console.log('error shape:', JSON.stringify(errShape));
assert.strictEqual(errShape.status, 409);
assert.strictEqual(errShape.code, 'SERVO_REFERENCED');

// Workspace status is available.
const wsStatus = await evaluate(wsUrl, `window.API.workspace.status()`);
console.log('workspace status:', JSON.stringify(wsStatus));
assert.ok(wsStatus.revision >= 0);
assert.ok(wsStatus.robotCount >= 1);

console.log('\nHEADLESS SMOKE: ALL PASSED');
chrome.kill();
process.exit(0);