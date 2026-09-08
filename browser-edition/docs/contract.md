# Browser Edition Behavior Contract

The browser edition ports the local, single-user data behavior from the server
edition (`backend/`) into the browser. The SPA calls the worker with the same
request surface (method + path + body) the FastAPI app exposed; the worker's
handlers (`js/db/handlers.js`) mirror the FastAPI routers 1:1.

## Request surface (parity with the HTTP API)

The worker accepts `{op:'request', method, path, body}` and routes it against
the same endpoints the frontend used over HTTP:

| Method | Path | Handler (backend source) |
|--------|------|--------------------------|
| GET | `/robots` | `robot.py list_robots` |
| POST | `/robots` | `robot.py create_robot` |
| GET | `/robots/{id}` | `robot.py get_robot` |
| PATCH | `/robots/{id}` | `robot.py update_robot` |
| DELETE | `/robots/{id}` | `robot.py delete_robot` |
| GET | `/robots/{id}/servos` | `robot.py list_servos` |
| POST | `/robots/{id}/servos` | `robot.py create_servo` |
| GET | `/robots/{id}/servos/{sid}` | `robot.py get_servo` |
| PUT | `/robots/{id}/servos/{sid}` | `robot.py update_servo` |
| DELETE | `/robots/{id}/servos/{sid}` | `robot.py delete_servo` |
| GET | `/state/current-robot` | `robot.py get_current_robot` |
| PUT | `/state/current-robot` | `robot.py set_current_robot` |
| GET | `/poses?robot_id=` | `poses.py list_poses` |
| POST | `/poses` | `poses.py create_pose` |
| GET | `/poses/{id}` | `poses.py get_pose` |
| PUT | `/poses/{id}` | `poses.py update_pose` |
| DELETE | `/poses/{id}` | `poses.py delete_pose` |
| GET | `/sequences?robot_id=` | `sequences.py list_sequences` |
| POST | `/sequences` | `sequences.py create_sequence` |
| GET | `/sequences/{id}` | `sequences.py get_sequence` |
| PUT | `/sequences/{id}` | `sequences.py update_sequence` |
| DELETE | `/sequences/{id}` | `sequences.py delete_sequence` |
| POST | `/sequences/{id}/steps` | `sequences.py add_step` |
| PUT | `/sequences/{id}/steps/{sid}` | `sequences.py update_step` |
| DELETE | `/sequences/{id}/steps/{sid}` | `sequences.py remove_step` |
| POST | `/sequences/{id}/steps/{sid}/duplicate` | `sequences.py duplicate_step` |
| POST | `/sequences/{id}/reorder` | `sequences.py reorder_steps` |
| POST | `/sequences/{id}/groups` | `sequences.py create_group` |
| GET | `/sequences/{id}/groups/{gid}` | `sequences.py get_group` |
| PUT | `/sequences/{id}/groups/{gid}` | `sequences.py update_group` |
| DELETE | `/sequences/{id}/groups/{gid}` | `sequences.py delete_group` |
| GET | `/sequences/{id}/preview` | `preview.py preview_sequence` |
| GET | `/export?robot_id=` | `export.py export_all` |
| GET | `/sequences/{id}/export?robot_id=` | `export.py export_sequence` |

The GET export endpoints return `{doc, filename}` (the HTTP edition streamed the
doc with a `Content-Disposition` header); `js/api.js` turns that into a Blob
download.

## Error parity

Errors use the same shape and codes as the server edition:

- `{status, code, detail}`; the SPA's `UI.renderApiError` shows `detail (code)`.
- 404 `NOT_FOUND`; 409 `SERVO_REFERENCED`, `POSE_REFERENCED`, `CONFLICT`;
  422 `VALIDATION`, `SPEED_DURATION_MISMATCH`, `GROUP_SPLIT`.

## Domain rules retained

- Per-step speed/easing derivation and the `SPEED_DURATION_MISMATCH` check
  (`preview.py` §9.2.2).
- Sequence `repeat_count`/`repeat_forever` and step groups with contiguous,
  non-overlapping members; any step mutation re-validates contiguity and
  rejects a split with `GROUP_SPLIT` (`validation.py` §9.2.4).
- Deletion guards: a servo referenced by a pose target or step is refused
  (`SERVO_REFERENCED`); a pose referenced by a step is refused
  (`POSE_REFERENCED`); name/pin uniqueness clashes return `CONFLICT`.
- Robot-scoped references: poses/sequences/steps may only reference servos and
  poses on the same robot; angles must stay within each servo's limits.
- Resolved `from_angle`/`from_pulse_us`, `start_ms`/`end_ms`, easing, and
  speed on every preview; group and sequence repeats folded into
  `pass_duration_ms` / `total_duration_ms`.
- Export `schema_version: 2`, self-contained (pose references resolved to
  concrete servo targets with `pulse_us`), scoped to the selected robot.

## Workspace operations (browser-edition only)

- `workspace.status` — revision, bytes, last-persisted time, robot count, state.
- `workspace.export` — ArrayBuffer of the full SQLite database (backup).
- `workspace.import` — validate then replace the workspace (expected schema,
  revision, integrity, foreign keys).
- `workspace.reset` — re-seed the Door Durability Rig only when the DB is empty
  (mirrors the server's seed-once semantics; user data is never removed).

## Seed parity

First launch seeds exactly the server edition's rig: the wall-mounted
Door Durability Rig (shoulder/elbow/wrist/gripper, pins 2–5), its 5 named
poses, the `door_cycle` sequence (25x group repeat) and `grip_and_release`
(5x sequence repeat), and its `sim_config`. Seeded once; behaves like ordinary
user data afterward.

## Verified parity

- `tests/run.mjs` — 18 Node parity checks: schema, seed, preview timing/repeat,
  export schema v2 + filenames, CRUD, guards, group-split, speed mismatch,
  reorder validation, DB round-trip.
- `tests/headless.mjs` — end-to-end smoke in Chrome: boot/seed, worker-backed
  API, mutation, 409 error shape, workspace status.
- `tests/reload.mjs` — OPFS persistence across a hard reload.

## Limitations (documented, not claimed fixed)

- Single-tab; OPFS storage is per-origin and can be cleared by the browser.
- Browser interaction is exercised only via headless Chrome CDP in the test
  suite, not a full automation harness.
- `file://` may be an insecure context for OPFS; use `localhost` or `https://`.
- The server edition's known issue **G7** (stale `speed_deg_per_s` after a
  step mutation) is ported as-is (same derivation rules), matching the server.