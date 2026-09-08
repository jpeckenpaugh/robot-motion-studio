/* Reload-persistence check: mutate, reload the same tab, verify data survived
 * OPFS. Usage: node tests/reload.mjs http://127.0.0.1:PORT
 */
import assert from 'node:assert';
import { spawn } from 'node:child_process';

const BASE = process.argv[2] || 'http://127.0.0.1:8013';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9444;
const profile = '/tmp/be-reload-' + port;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
  '--disable-dev-shm-usage', '--no-first-run', BASE + '/index.html',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(u) { return (await fetch(u)).json(); }
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json`);
      const p = list.find((t) => t.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error('no chrome');
}

function makeSession(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const cb = pending.get(msg.id);
    if (cb) { pending.delete(msg.id); cb(msg); }
  };
  const open = new Promise((res) => { ws.onopen = res; });
  return {
    async send(method, params = {}) {
      await open;
      return new Promise((resolve) => {
        const mid = ++id;
        pending.set(mid, resolve);
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

async function evaluate(sess, expression) {
  const r = await sess.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  }
  return r.result?.result?.value;
}

const wsUrl = await connect();
const sess = makeSession(wsUrl);
await sess.send('Runtime.enable');
await sess.send('Page.enable');

// wait to boot
let booted = false;
for (let i = 0; i < 100; i++) {
  const st = await evaluate(sess, `({nav:!!document.querySelector('#navLinks')?.children.length, brand:document.querySelector('#brandName')?.textContent})`);
  if (st && st.nav && st.brand && st.brand !== 'No robot') { booted = true; break; }
  await sleep(200);
}
assert.ok(booted, 'booted');

// mutate
await evaluate(sess, `(async()=>{ const r=await window.API.post('/robots',{name:'PersistTest',description:'survives reload'}); await window.API.put('/state/current-robot',{robot_id:r.id}); return r.id; })()`);
await sleep(300);

// reload via CDP (keeps same session/context)
await sess.send('Page.reload', { ignoreCache: true });
await sleep(2000);

// wait for boot again on the SAME session
let ok = false;
for (let i = 0; i < 100; i++) {
  const st = await evaluate(sess, `(async()=>{ try{ const robots=await window.API.get('/robots'); const cur=await window.API.get('/state/current-robot'); return {count:robots.length,names:robots.map(r=>r.name),current:cur.robot?cur.robot.name:null}; }catch(e){ return {err:e.message}; } })()`);
  if (st && (st.count || st.err)) {
    console.log('after reload:', JSON.stringify(st));
    if (st.count === 2 && st.names.includes('PersistTest') && st.current === 'PersistTest') ok = true;
    break;
  }
  await sleep(200);
}
assert.ok(ok, 'data persisted across reload');
console.log('RELOAD PERSISTENCE: PASSED');
sess.close();
chrome.kill();
process.exit(0);