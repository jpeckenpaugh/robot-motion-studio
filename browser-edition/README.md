# Robot Motion Designer — Browser Edition

A **browser-only** build of the Robot Motion Designer (multi-robot servo motion
sequence designer) that runs with **no server at all**. The FastAPI + SQLite
backend is replaced by SQLite running inside a Web Worker via `sql.js`, with
all data persisted in the browser's **Origin Private File System (OPFS)**.
Everything is static files, so it can be hosted on GitHub Pages (or any static
host) and served directly.

The original server-backed application (`backend/`, `frontend/`, `docs/`) is
unchanged; this is a parallel, self-contained build.

## Try it

Local static server (dev only):

```sh
python3 browser-edition/serve.py --port 8012
```

Open <http://127.0.0.1:8012> in a current Chromium-based browser. `localhost`
is an OPFS-compatible secure context. No FastAPI process is needed.

### GitHub Pages

This directory is fully static. To host it at `https://<user>.github.io/<repo>/`:

- Serve the contents of `browser-edition/` as the site root, or
- Copy/publish the directory to a `gh-pages` branch / Pages deployment.

Relative asset paths are used throughout, so it works under a path prefix
(e.g. `/<repo>/`). `localhost` and `https://` are both OPFS-secure contexts;
`file://` may not be (OPFS requires a secure context).

## How it works

```
browser-edition/
├── index.html          SPA (copied from frontend/; adds Workspace view)
├── css/styles.css      shared styles (copied)
├── vendor/
│   ├── bootstrap*      vendored Bootstrap (no CDN)
│   └── sql.js/         sql.js (SQLite compiled to WebAssembly)
├── js/
│   ├── api.js          drop-in window.API bridge -> Web Worker RPC
│   ├── state.js ui.js motion.js simulator.js   (copied from frontend/)
│   ├── views/          (copied; export.js patched to download via worker)
│   └── db/             the "backend", in the browser:
│       ├── worker.js      classic worker: sql.js + OPFS + request router
│       ├── engine.js      sql.js query helpers (rows/one/run/lastId)
│       ├── schema.js      SQLite schema + revision + workspace validation
│       ├── seed.js        door durability rig seed (ported from seed.py)
│       ├── pulse.js       angle<->pulse conversion (ported)
│       ├── validation.js  business rules + error codes (ported)
│       ├── preview.js     extended preview + speed/easing/loop math (ported)
│       ├── export.js      JSON export v2 builder (ported)
│       ├── handlers.js    API handlers mirroring the FastAPI routers
│       ├── client.js      main-thread RPC proxy
│       └── persistence.js OPFS workspace storage
├── serve.py           dev-only static server
├── docs/contract.md   behavior contract + parity notes
└── tests/             Node test suite (no browser needed)
```

The `js/db/` modules are a **faithful port** of the backend domain logic
(`backend/app/`). The worker exposes the same request surface the FastAPI app
exposed, so the SPA views are unchanged: `js/api.js` is the only frontend file
replaced, and the export view's download path was adapted for a static context.

## Boundaries

- **Single-browser, single-tab** POC-grade persistence. OPFS is per-origin and
  can be cleared by the user or the browser; use **Workspace → Export** as a
  backup.
- The workspace stores a full SQLite database. Export produces a standard
  `.db` file; Import validates the expected schema, revision, SQLite integrity,
  and foreign keys before replacing the active workspace.
- First launch creates the schema and seeds the Door Durability Rig exactly
  once; the rig then behaves like ordinary user data (editable, deletable, not
  special-cased).
- No authentication, sync, or cloud storage — intentionally out of scope, same
  as the server edition.
- The Web Worker serializes reads and writes. A successful mutation is reported
  only after its SQLite snapshot has been written to OPFS.

## Differences from the server edition

| Aspect | Server edition | Browser edition |
|--------|----------------|-----------------|
| Backend | FastAPI + Python + SQLite file | sql.js (WASM SQLite) in a Web Worker |
| Persistence | `data/app.db` on disk | OPFS (`workspace.db`) in the browser |
| Transport | HTTP `/api/*` | Worker RPC (`{op:'request', method, path}`) |
| Export | `Content-Disposition` HTTP download | Blob download via `API.downloadExport` |
| Workspace mgmt | n/a (server file) | **Workspace view**: status/export/import/reset |
| Hosting | local server | any static host (GitHub Pages) |

Everything else — schema, domain rules, preview math, export schema, error
codes — is ported 1:1 from the server edition, verified by the test suite.

## Tests

Node-only parity tests exercise the schema, seed, handlers, preview, and
export against the same sql.js the worker uses:

```sh
cd browser-edition && node tests/run.mjs
```

Headless-browser smoke + reload-persistence checks (requires Chrome):

```sh
node tests/headless.mjs http://127.0.0.1:8013
node tests/reload.mjs   http://127.0.0.1:8013
```

## Status

Working: full authoring flow (robots, servos, poses, sequences, timeline
editor, simulator, preview, export) through the worker-backed API, OPFS
persistence across reloads, workspace export/import/reset. See
`docs/contract.md` for the behavior contract.