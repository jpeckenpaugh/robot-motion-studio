# Verification Report — Robot Servo Sequence Designer

**Stage 8 — Verification Engineer.**
**Date:** 2026-09-08
**Status:** 82 / 83 checks PASS, 1 FAIL (static review, frontend preview freshness).

This report verifies the delivered application (Stage 6 backend, Stage 7
frontend) against the approved specifications: `concept.md`,
`features/briefs/*.md` (briefs 01–07), and `docs/architecture.md` (the
authoritative technical contract). It records pass/fail for every derived check
with the supporting evidence captured from the live API (via `curl` against
`http://127.0.0.1:8000`) and from static review of the frontend rendering logic.

## Verification method

- **Backend / API:** the app was run with `./install.sh` (reused existing
  `.venv`, verified `fastapi==0.115.6` and `uvicorn[standard]==0.34.0` installed)
  and `./run.sh` (uvicorn on `http://127.0.0.1:8000`, entry point
  `app.main:app`, `PYTHONPATH` includes `backend/`). Every endpoint in
  `docs/architecture.md` §5 was exercised with `curl`; status codes, response
  bodies, and headers were captured. Persistence was verified by restarting the
  server and re-querying; fresh-DB seeding was verified by deleting
  `data/app.db` and restarting.
- **Frontend:** static review only. All `frontend/js/*.js`, `frontend/index.html`,
  and the route map from `GET /api/openapi.json` were read and cross-checked
  against the briefs. **Browser interaction was NOT exercised by an automation
  tool in this environment**; nothing below that depends on real rendering in a
  browser is claimed as an automated browser test.
- **Database integrity:** direct SQLite queries against `data/app.db` for
  referential integrity and seed validity.

## Checklist derivation

Each check is traceable to a specific requirement: `concept.md` (overall
product), `features/briefs/01..07`, or `docs/architecture.md` (sections §3 data
model, §5 API contracts, §5.5.1 pulse formula, §5.5.2 export schema). The
"Trace" column lists the source(s).

---

## A. Environment & startup

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| A1 | `install.sh` provisions (or reuses) `.venv` and installs the pinned deps | briefs/Stage-4 `requirements.txt`, arch §1 | **PASS** | `./install.sh` → "Reusing existing virtual environment", "Requirement already satisfied: fastapi==0.115.6 / uvicorn[standard]==0.34.0 … Environment ready." |
| A2 | `run.sh` starts the backend on `http://127.0.0.1:8000` | arch §1, §7 | **PASS** | Server log: "Uvicorn running on http://127.0.0.1:8000", "Application startup complete"; `GET /api/health` → `200 {"status":"ok"}` |
| A3 | Static SPA served at `/` for non-`/api` routes | arch §1, §4 | **PASS** | `GET /` → `HTTP 200`, `text/html`, 1590 bytes, body starts `<!DOCTYPE html>` |
| A4 | All frontend assets served with HTTP 200 | arch §2 | **PASS** | `curl` of `css/styles.css`, `js/*.js` (9 files), `views/*.js` (5 files), `vendor/*` (4 files) all returned `200` |

## B. Robots & servos (brief 01; architecture §5.1)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| B1 | `GET /api/robots` lists the current robot as `[{id, name}]` (no servos) | arch §5.1 | **PASS** | `GET /api/robots` → `200 [{"id":1,"name":"SampleBot"}]` |
| B2 | `GET /api/robots/{id}` returns robot incl. `servos[]` with every field | arch §5.1.1 | **PASS** | `GET /api/robots/1` → 6 servos; each has `id, name, pwm_pin, angle_min, angle_max, neutral_angle, pulse_min_us, pulse_max_us` |
| B3 | `PATCH /api/robots/{id}` renames the robot | arch §5.1 | **PASS** | `PATCH /robots/1 {"name":"VerifyBot"}` → `200 {"id":1,"name":"VerifyBot"}`; reverted to `SampleBot` (200) |
| B4 | `GET /api/robots/{id}/servos` lists all servos | arch §5.1 | **PASS** | `GET /api/robots/1/servos` → 6 servos, field set `['angle_max','angle_min','id','name','neutral_angle','pulse_max_us','pulse_min_us','pwm_pin']` |
| B5 | `GET /api/robots/{id}/servos/{servo_id}` returns one servo | arch §5.1 | **PASS** | `GET /robots/1/servos/1` → `200` full servo object |
| B6 | `POST /api/robots/{id}/servos` creates a servo (201) with all fields | brief 01 "add a new servo"; arch §5.1 | **PASS** | `POST /robots/1/servos {"name":"verify_servo",...}` → `HTTP 201`, body has all 8 fields, `id:7` |
| B7 | `PUT /api/robots/{id}/servos/{id}` full-replace updates every field | brief 01 "edit any field… reflected when viewed again"; arch §5.1 | **PASS** | `PUT /robots/1/servos/7` (rename + new ranges/pulses) → `200`, values persisted (later re-read shows updated values) |
| B8 | `DELETE` unreferenced servo → 204 and it disappears | brief 01 "delete a servo that is not referenced anywhere" | **PASS** | `DELETE /robots/1/servos/7` → `HTTP 204`; `GET /robots/1/servos/7` afterward → `404` |
| B9 | `DELETE` servo referenced by a pose/step → 409 with `SERVO_REFERENCED` | brief 01 "prevent removal… must not silently leave broken references"; arch §3 deletion guards | **PASS** | `DELETE /robots/1/servos/1` → `409 {"detail":"Servo 1 is referenced by one or more pose targets; remove or change those references first.","code":"SERVO_REFERENCED"}` |
| B10 | Duplicate servo name on a robot → 409 | brief 01 "servo names must be unique"; arch §3 | **PASS** | `POST` servo named `verify_servo_renamed` → `409 {"detail":"A servo named 'verify_servo_renamed' already exists on this robot","code":"CONFLICT"}` |
| B11 | Duplicate PWM pin → 409 | brief 01 "no two servos share the same pin"; arch §3 | **PASS** | `POST` with `pwm_pin:40` (in use) → `409 {"detail":"PWM pin 40 is already used by another servo on this robot","code":"CONFLICT"}` |
| B12 | Neutral angle outside `[angle_min, angle_max]` → 422 | brief 01 "neutral position must stay within limits"; arch §3 | **PASS** | `POST` `neutral_angle:120` in `[0,90]` → `422 {"code":"VALIDATION"}` |
| B13 | `angle_min >= angle_max` → 422 | arch §3 integrity rules | **PASS** | `POST` `angle_min:100, angle_max:90` → `422 {"detail":"angle_min (100.0) must be less than angle_max (90.0)","code":"VALIDATION"}` |
| B14 | Missing required servo fields → 422 | brief 01 "must have all required fields"; arch §5.1 | **PASS** | `POST` with only `name,pwm_pin` → `422` listing the 5 missing fields, `code:VALIDATION` |
| B15 | Unknown robot / servo → 404 | arch §5 error semantics | **PASS** | `GET /robots/999` → `404 {"code":"NOT_FOUND"}`; `GET /robots/1/servos/7` (after delete) → `404` |

## C. Poses (brief 02; architecture §5.2)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| C1 | `GET /api/poses` lists all poses with targets | arch §5.2 | **PASS** | `GET /api/poses` → 4 seeded poses, each `{id, name, targets:[{servo_id, angle}]}` |
| C2 | `POST /api/poses` creates a named pose (201) | brief 02 "create a named pose… see it listed afterward" | **PASS** | `POST /poses {"name":"verify_pose","targets":[...]}` → `201`, returned with `id:5` and targets |
| C3 | `GET /api/poses/{id}` returns one pose | arch §5.2 | **PASS** | `GET /poses/5` → `200 {"name":"verify_pose_renamed","targets":[{"servo_id":1,"angle":45.0}]}` |
| C4 | `PUT /api/poses/{id}` renames and replaces targets | brief 02 "edit name or targets… saved pose reflects those edits" | **PASS** | `PUT /poses/5` (rename + single target) → `200`; re-GET confirmed persisted |
| C5 | `DELETE` unreferenced pose → 204 | brief 02 "delete an unreferenced pose and it disappears" | **PASS** | `DELETE /poses/5` → `HTTP 204`; list no longer contains it |
| C6 | `DELETE` pose referenced by a step → 409 `POSE_REFERENCED` | brief 02 "cannot delete a pose a sequence step references and is told why"; arch §3 | **PASS** | `DELETE /poses/1` (used by seq "wave") → `409 {"detail":"Pose 1 is referenced by one or more sequence steps; remove or change those references first.","code":"POSE_REFERENCED"}` |
| C7 | Duplicate pose name → 409 | brief 02 "unique name"; arch §3 | **PASS** | `POST` named `verify_pose_renamed` (existing) → `409 {"code":"CONFLICT"}` |
| C8 | Pose target angle outside servo limits → 422 | brief 02 "target must be a valid angle for that servo" | **PASS** | `POST` head_pan `angle:95` (limit 90) → `422 {"detail":"Angle 95.0 for servo 5 is outside [-90.0, 90.0]","code":"VALIDATION"}` |
| C9 | Pose target references a nonexistent servo → 422 | brief 02 "only servos that exist may be assigned" | **PASS** | `POST` `servo_id:999` → `422 {"detail":"servo_id 999 does not exist on this robot","code":"VALIDATION"}` |
| C10 | Pose with zero targets → 422 | arch §5.2 `PoseInput` ≥1 target | **PASS** | `POST` `targets:[]` → `422 {"detail":"…List should have at least 1 item…","code":"VALIDATION"}` |
| C11 | Duplicate servo in one pose's targets → 422 | arch §3 "no duplicate servo in a pose" | **PASS** | `POST` servo 1 twice → `422` "Duplicate servo 1 in pose targets" |

## D. Sequences & steps (brief 03; architecture §5.3)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| D1 | `GET /api/sequences` lists summaries with `step_count` | arch §5.3 | **PASS** | `GET /api/sequences` → `[{"id":1,"name":"wave","step_count":4},{"id":2,"name":"look_around","step_count":4}]` |
| D2 | `POST /api/sequences` creates a sequence (201) | brief 03 "create a new sequence and give it a name" | **PASS** | `POST /sequences {"name":"verify_seq"}` → `201 {"id":3,"name":"verify_seq","steps":[]}` |
| D3 | `GET /api/sequences/{id}` returns ordered steps | arch §5.3 | **PASS** | `GET /sequences/3` → steps ordered by `position` (0,1) |
| D4 | `PUT /api/sequences/{id}` renames | arch §5.3 | **PASS** | `PUT /sequences/3 {"name":"verify_seq_renamed"}` → `200` with new name |
| D5 | `DELETE /api/sequences/{id}` deletes sequence and its steps (cascade) | arch §5.3, §3 DDL | **PASS** | `DELETE /sequences/3` → `204`; `GET /sequences/3` → `404`; no orphan steps (SQL: `sequence_steps` for seq 3 empty) |
| D6 | `POST …/steps` appends a pose-kind step (201) | brief 03 "step referencing a named pose" | **PASS** | `POST /sequences/3/steps {"kind":"pose","pose_id":2,…}` → `201 {"id":9,"position":0,"kind":"pose","pose_id":2,"servo_id":null,"angle":null,…}` |
| D7 | `POST …/steps` appends a servo-kind step (201) | brief 03 "direct movement targeting a single servo" | **PASS** | `POST /sequences/3/steps {"kind":"servo","servo_id":5,"angle":45,…}` → `201` |
| D8 | `PUT …/steps/{id}` edits kind, target, duration, hold (incl. hold 0) | brief 03 "edit any step" | **PASS** | `PUT /sequences/3/steps/9` changed kind pose→servo, `duration_ms:350, hold_ms:0` → `200`, persisted; re-GET confirmed |
| D9 | `DELETE …/steps/{id}` → 204 and remaining positions renumber contiguous | brief 03 "remove steps"; arch §3 ordering | **PASS** | `DELETE /sequences/3/steps/9` → `204`; re-GET → remaining step `position:0` (was 1) |
| D10 | `POST …/reorder` persists the new execution order | brief 03 "reorder steps… stored order matches displayed order" | **PASS** | `POST /sequences/3/reorder {"step_ids":[10,9]}` → `200`; steps returned `[10@0, 9@1]` |
| D11 | Reorder with a non-exact set of step ids → 422 | arch §5.3 reorder contract | **PASS** | `POST /reorder {"step_ids":[10]}` → `422 {"detail":"step_ids must contain exactly the sequence's step ids, in the new order","code":"VALIDATION"}` |
| D12 | Step referencing a nonexistent pose → 422 | brief 03 "must reference a pose that exists" | **PASS** | `POST …/steps {"kind":"pose","pose_id":999}` → `422 {"detail":"Pose 999 does not exist on this robot","code":"VALIDATION"}` |
| D13 | Step referencing a nonexistent servo → 422 | brief 03 "must reference a servo that exists" | **PASS** | `POST …/steps {"kind":"servo","servo_id":999}` → `422` |
| D14 | Step angle outside servo limits → 422 | brief 03 "position outside the servo's limits" | **PASS** | `POST …/steps` head_pan `angle:100` → `422 {"detail":"Angle 100.0 for servo 5 is outside [-90.0, 90.0]","code":"VALIDATION"}` |
| D15 | Negative movement duration → 422 | brief 03 "duration must be non-negative"; arch §3 `duration_ms >= 0` | **PASS** | `POST …/steps {"duration_ms":-5}` → `422 {"detail":"…Input should be greater than or equal to 0…"}` |
| D16 | Invalid step kind → 422 | arch §3 `CHECK kind IN ('pose','servo')` | **PASS** | `POST …/steps {"kind":"bogus"}` → `422` "kind must be 'pose' or 'servo'" |
| D17 | Duplicate sequence name → 409 | arch §3 `UNIQUE(robot_id, name)` | **PASS** | `POST /sequences {"name":"verify_seq_renamed"}` (existing) → `409 {"code":"CONFLICT"}` |

## E. Preview (brief 04; architecture §5.4)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| E1 | `GET /api/sequences/{id}/preview` returns steps in execution order with targets and timing | brief 04 "every step in order, target + timing"; arch §5.4 | **PASS** | `GET /sequences/1/preview` → `sequence_id/name`, `steps[]` ordered `order 0..3`, each with `duration_ms`/`hold_ms` |
| E2 | Pose-referenced steps are expanded to concrete servo targets | brief 04 "preview makes clear what that pose does"; arch §5.4 | **PASS** | Step 0 (pose `wave_left`) → `targets` with 3 servos incl. `pulse_us`; step 3 (pose `neutral`) → 6 targets |
| E3 | Direct servo steps show single target + `pulse_us` | arch §5.4 | **PASS** | Step 2 (`head_tilt` 60°) → `servo_name:"head_tilt", angle:60, pulse_us:1833, targets:[1 item]` |
| E4 | `pulse_us` computed by the canonical formula (§5.5.1) | arch §5.4, §5.5.1 | **PASS** | left_shoulder 170° → `round(500 + 170·2000/180) = 2389` ✓; head_pan 30° → `500 + 120·2000/180 = 1833` ✓; head_pan 45° → `2000` ✓ |
| E5 | Preview reflects the current saved state (no stale data after edits) | brief 04 "preview updates… accurate picture"; arch §4 | **PASS** | After editing step 9 (pose→servo) and deleting it, `GET /sequences/3/preview` showed the updated single servo step, not the old pose step |
| E6 | Preview for unknown sequence → 404 | arch §5.4 | **PASS** | `GET /sequences/999/preview` → `404 {"code":"NOT_FOUND"}` |
| E7 | Preview is read-only (no write route) | brief 04 "read-only, non-destructive"; arch §5.4 "no write route here" | **PASS** | `openapi.json` lists only `GET /api/sequences/{seq_id}/preview` — no POST/PUT/DELETE preview route |

## F. Export (brief 05; architecture §5.5)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| F1 | `GET /api/export` → 200 with JSON media type | brief 05 "structured JSON"; arch §5.5 | **PASS** | `GET /api/export` → `HTTP/1.1 200`, `content-type: application/json` |
| F2 | Downloadable artifact via `Content-Disposition: attachment` | brief 05 "downloadable/retrievable JSON artifact"; arch §5.5 | **PASS** | Header: `content-disposition: attachment; filename="SampleBot.json"` |
| F3 | Document is versioned: `schema_version:1`, `format:"robot-servo-sequence"` | arch §5.5.2 | **PASS** | Top-level keys `[schema_version, format, exported_at, robot, sequences]`; values `1`, `"robot-servo-sequence"` |
| F4 | Export includes the robot with every servo and all config fields | brief 05 "must not silently omit configuration"; arch §5.5.2 | **PASS** | `robot.SampleBot`, `servos` = 6, each with all 8 fields |
| F5 | Export includes all authored sequences with ordered steps | brief 05 "each sequence's ordered steps with targets and timing" | **PASS** | `sequences` = `[wave(4 steps), look_around(4 steps)]`; each step has `order, duration_ms, hold_ms, targets` |
| F6 | Pose references are resolved to concrete servo targets (self-contained) | brief 05 "express each step's concrete effect… not leaving pose references unresolved"; arch §5.5.2 | **PASS** | `wave` step 0 (pose `wave_left`) exports flat `targets:[{servo_id:1,"left_shoulder",170,pulse_us:2389},…]` — no `pose_id` in export steps |
| F7 | Exported `pulse_us` consistent with the canonical formula | arch §5.5.1 | **PASS** | Same values as preview for identical inputs (e.g. `170° → 2389`) |
| F8 | Export reflects the current saved state at request time | brief 05 "must not include stale or partial data" | **PASS** | After creating `persist_seq`/`persist_servo`, export contained them; after deleting test data and reseeding, export again returned exactly the 2 seed sequences |
| F9 | Per-sequence export uses the same schema for one sequence | arch §5.5 | **PASS** | `GET /sequences/1/export` → `200`, `content-disposition: attachment; filename="SampleBot-wave.json"`, `sequences` = `[wave]` |
| F10 | Export for unknown sequence → 404 | arch §5.5 | **PASS** | `GET /sequences/999/export` → `404 {"detail":"Sequence 999 not found","code":"NOT_FOUND"}` |

## G. Persistence (brief 06)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| G1 | Authored data survives a full server restart | brief 06 "survives reloading and returning in a later session"; "after a full session restart… restored intact" | **PASS** | Created `persist_servo` (servo 7), `persist_pose`, `persist_seq` with a step; killed uvicorn, restarted via `./run.sh`; all three present afterward (`persist_servo present: True`, `persist_pose present: True`, `persist_seq` step intact) |
| G2 | References between persisted objects survive restart | brief 06 "a pose still sets the same servos… a sequence still references the same poses/servos" | **PASS** | After restart, `persist_seq` step still `servo_id:7, angle:90.0, duration_ms:300, hold_ms:50`; pose targets intact |
| G3 | Single source of truth is the SQLite file `data/app.db` | arch §1, §4; brief 06 | **PASS** | `data/app.db` exists (53248 bytes); tables `robots, servos, poses, pose_targets, sequences, sequence_steps`; same data served by API and readable via `sqlite3` |
| G4 | Reloading does not duplicate or reset authored data | brief 06 "Reloading does not lose, duplicate, or reset" | **PASS** | Post-restart counts unchanged (no duplication); seed baseline exactly 1/6/4/2 |

## H. Seed data (brief 07)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| H1 | Fresh DB auto-seeds a sample robot (app is not empty on first use) | brief 07 "comes pre-populated… rather than being empty" | **PASS** | Deleted `data/app.db`, restarted; `GET /api/robots` → `[{"id":1,"name":"SampleBot"}]` immediately |
| H2 | Seed quantity matches architecture: one robot, 4–6 servos, 3–4 poses, 2+ sequences | arch §8; brief 07 | **PASS** | Fresh DB: 1 robot, 6 servos, 4 poses (`neutral, wave_left, wave_right, look_center_up`), 2 sequences (`wave` 4 steps, `look_around` 4 steps) |
| H3 | Every seed servo carries complete, valid calibration values | brief 07 "each with a name, PWM pin, angle limits, neutral, pulse calibration"; arch §3 | **PASS** | SQL: 0 servos missing any required field; all `angle_min<angle_max`, neutral within limits, pulses > 0 and ordered |
| H4 | Seed poses reference only existing servos, within limits | brief 07 "poses reference only seed servos and stay within limits" | **PASS** | SQL: 0 pose targets with missing servo; 0 targets out of angle limits |
| H5 | Seed steps reference existing poses/servos with valid timing | brief 07 "steps reference existing sample poses/servos with valid angles and timing" | **PASS** | SQL: 0 steps with missing pose/servo; 0 servo-step angles out of limits; durations ≥ 0; holds null or ≥ 0 |
| H6 | Seed steps carry contiguous 0-based positions (execution order) | arch §3 ordering invariant | **PASS** | SQL: sequence 1 positions `[0,1,2,3]`, sequence 2 positions `[0,1,2,3]` — both contiguous |
| H7 | Seed data persists across restart | brief 07 "still present after reloading/returning" | **PASS** | Freshly seeded DB re-queried after restart (A2/G) → identical seed state |

## I. Frontend static review (briefs 01–05 rendering logic)

Method: read-only inspection of `frontend/index.html` and `frontend/js/*` plus
the OpenAPI route map. **Browser interaction was not exercised by an automation
tool in this environment**; results below are static findings, not rendered
browser behavior.

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| I1 | `index.html` loads Bootstrap, Bootstrap Icons, `api.js`, `state.js`, `ui.js`, all 5 views, `main.js`; nav + view container present | arch §2; briefs' "user sees a screen…" | **PASS** (static) | `index.html` script order `api → state → ui → views/* → main`; `#navLinks`, `#app` present; `main.js` wires nav buttons to view keys and `renderActive()` |
| I2 | Configuration view renders the robot name and every servo field; rename/add/edit/delete wired to the correct endpoints | brief 01; arch §5.1 | **PASS** (static) | `configuration.js`: table shows name/pin/angle range/neutral/pulse; `PATCH /robots/{id}`, `POST|PUT|DELETE /robots/{id}/servos[/{id}]`; `deleteServo` surfaces 409 via `UI.renderApiError` |
| I3 | Poses view lists poses with servo targets; create/edit/delete wired | brief 02; arch §5.2 | **PASS** (static) | `poses.js`: `GET|POST /api/poses`, `PUT|DELETE /api/poses/{id}`; checkbox-per-servo target rows; `StateController.servoById` for limits; 409 rendered via `UI.renderApiError` |
| I4 | Sequences view is a full editor: add/edit/remove/reorder steps, pose + servo kinds, duration + optional hold | brief 03; arch §5.3 | **PASS** (static) | `sequences.js`: `POST /sequences`, `POST|PUT|DELETE /sequences/{id}/steps[/{step_id}]`, `POST /sequences/{id}/reorder` with `{step_ids}`; up/down buttons compute new order; hold blank ⇒ `null` (matches "absent"); `0` allowed (explicit zero hold) |
| I5 | Preview view renders a read-only ordered step listing with target + timing and pose expansion | brief 04; arch §5.4 | **PASS** (static) | `preview.js`: `GET /sequences/{id}/preview`; card per step with badge/order, target, `move Xms` / `hold Yms` or `no hold`, servo/angle/pulse table; no write buttons |
| I6 | Export view triggers full and per-sequence downloads | brief 05; arch §5.5 | **PASS** (static) | `export.js`: `window.location.href = '/api/export'` and `/api/sequences/{id}/export`; relies on the backend `Content-Disposition` attachment header |
| I7 | Frontend consumes only endpoints the backend exposes (no invented routes) | arch §6 "consumes only the endpoints in §5" | **PASS** (static) | Every URL in the 9 JS files matches a route in `GET /api/openapi.json`; cross-checked all 26 documented routes vs. all `API.*`/`location.href` calls |
| I8 | Backend error messages/codes are rendered; `null` vs `0` hold is interpreted for display | arch §6 | **PASS** (static) | `api.js` throws `Error` with `detail`/`code`; `ui.js renderApiError` toasts `message (code)`; `preview.js`/`sequences.js` render `hold_ms !== null` as a hold badge else "no hold" |
| I9 | Frontend does not persist data and does not compute authoritative pulse widths (backend is the source of truth) | arch §6; brief 06 | **PASS** (static) | No `localStorage`/`indexedDB` usage anywhere; pulse widths only displayed from API (`preview.js` renders `t.pulse_us`) |
| I10 | All frontend assets referenced by `index.html` return HTTP 200 | arch §2 | **PASS** | `curl` of 15 assets (html/css/js/vendor/font) all `200` |
| I11 | The preview view re-requests the preview whenever the underlying data may have changed, so the view never shows stale data | brief 04 "must not show stale… data"; arch §4 "re-requests the preview whenever the sequence/pose/config changes" | **FAIL** (static) | `preview.js:10,12-18,100` — the module-level `doc` is set only by `loadPreview()`, which is invoked only from the preview view's own list-click handler (line 100). `main.js` `switchView`→`renderActive()`→`PreviewView.render()` (lines 29–43, 38–43) re-renders the cached `doc` without re-fetching. Consequence: a user who selects sequence X in Preview, edits sequence X in the Sequences view, and returns to Preview sees the previously fetched `doc` until they click a sequence in the preview list — a stale-state window contradicting brief 04/arch §4. **Not browser-exercised; confirmed by code-path analysis only.** |

## Result tally

- **Total checks:** 83
- **PASS:** 82
- **FAIL:** 1 (I11 — frontend preview freshness, static review)
- Checks not performed: full browser interaction (headless browser automation is
  not available in this environment); per the stage instructions, frontend
  behavior was statically reviewed instead and is labeled as such.

## Failures

**I11 — Preview may show stale data after edits made in another view (static).**
Evidence: `frontend/js/views/preview.js` caches the preview document in the
module-level `doc` variable and refreshes it only from the preview view's
sequence-list click handler (`bind()`, line 100 → `loadPreview`). Navigating back
to the Preview view (`frontend/js/main.js` `switchView`/`renderActive`) calls
`PreviewView.render()` directly, which renders the cached `doc`. This leaves a
window in which the preview does not reflect edits made to the sequence/poses in
other views, until the user re-selects a sequence in the preview list. This
contradicts the brief 04 "no stale data" constraint and architecture §4
("The frontend re-requests the preview whenever the sequence/pose/config
changes"). It was not exercised in a browser; it is a code-path finding. A fix
would re-fetch the preview on view activation (out of scope for this stage).

## Minor observations (not failures)

- `frontend/js/views/sequences.js` `createSequence()` calls
  `StateController.refresh()` twice (lines 141–142); harmless duplicate.
- The reorder UX uses up/down buttons rather than drag-and-drop (stage 7 chose
  this); the brief permits either.
- `GET /api/health` is an ops convenience outside the product contract; the
  frontend does not use it.
- Seed content names/values are backend-authored (arch §8 allows this); they are
  fully valid and behave like user data (verified editable/deletable/persistent).

## Scope notes

- No code was repaired, redesigned, or extended during this stage.
- The SQLite database (`data/app.db`) was regenerated during the fresh-seed test
  and is left in the clean seeded state; `data/` is git-ignored.

---

# ENHANCEMENT PASS — Sprint 01 (multi-robot, timeline, timing, simulation)

**Stage 8 — Verification Engineer (enhancement pass).**
**Date:** 2026-09-08
**Status:** 85 / 86 checks PASS, 1 FAIL (preview `speed_deg_per_s` not recomputed
after a step mutation changes a step's resolved travel context).

This section verifies the Sprint 01 enhancements against the approved
specifications: `enhancements/scope.md`, `features/briefs/01..05.md`, and
`docs/architecture.md` §9 (ENHANCEMENT). The v0.1 results above are preserved
and unchanged. This pass added 86 new checks; **no v0.1 regression was found**
(all v0.1 checks in the earlier sections still hold, and the targeted regression
checks in section J re-confirm them).

## Verification method (enhancement pass)

- **Backend / API:** the app was run with `./install.sh` (reused `.venv`;
  `fastapi==0.115.6`, `uvicorn[standard]==0.34.0`) and `./run.sh` (uvicorn on
  `http://127.0.0.1:8000`). Every enhancement endpoint in architecture §9.3 was
  exercised with `curl`; status codes, bodies, and headers were captured.
  Fresh-DB seeding and seed-once behavior were tested on a separate instance
  (port 8001) against a throwaway `DB_PATH`. Upgraded-v0.1 migration was tested
  on a separate instance (port 8002) against a database built from the v0.1
  schema (from git `5c317be:backend/app/db.py`) populated with sample data.
  The default `data/app.db` was left in the clean seeded state.
- **Frontend:** static review only of `frontend/index.html` and
  `frontend/js/**`. **Browser interaction was NOT exercised by an automation
  tool in this environment**; items labeled "(static)" are code-path findings.
- **Database integrity:** direct SQLite queries for cascades, migration, seed
  counts, and referential integrity.

## Checklist derivation (enhancement pass)

Each check traces to a specific requirement: `enhancements/scope.md` (items
a–f), `features/briefs/01..05.md`, or `docs/architecture.md` §9 (schema §9.2,
API §9.3, responsibilities §9.4, flow §9.5, `sim_config` §9.6, seed §9.7,
migration §9.8). Regression checks trace to the "no regression" constraint
(scope item f, brief 01 constraint, §9.9). The "Trace" column lists the source.

---

## A. Environment & startup

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| A1 | `install.sh` reuses `.venv` and pins the v0.1 deps (unchanged) | §9.9 "no environment changes"; Stage-4 `requirements.txt` | **PASS** | `./install.sh` → "Reusing existing virtual environment … Environment ready."; `fastapi==0.115.6`/`uvicorn[standard]==0.34.0` present |
| A2 | `run.sh` starts the backend on `http://127.0.0.1:8000`; health 200 | arch §1, §9.9 | **PASS** | Server log "Uvicorn running on http://127.0.0.1:8000"; `GET /api/health` → `200 {"status":"ok"}` |
| A3 | Static SPA served at `/` (non-`/api` routes) | arch §1, §4 | **PASS** | `GET /` → `200 text/html`, `<!DOCTYPE html>` |
| A4 | All frontend assets served 200 (18 files incl. new timeline/simulator/robots views + motion.js) | arch §2 | **PASS** | All 18 `css/js/views/vendor` assets returned `200` |

## B. Multi-robot management (brief 01; §9.3.1, §9.3.2)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| B1 | `GET /api/robots` lists robots with `description`, `servo_count`, `current` flag | §9.3.1 | **PASS** | `[{"id":1,"name":"DoorDurabilityRig","description":"…","servo_count":4,"current":true}]` |
| B2 | `POST /api/robots` creates a robot (201); does not change current selection | §9.3.1 | **PASS** | Created `ArmBot` (id 2) → `201`; `GET /robots` still `current:true` on id 1 |
| B3 | `PATCH /api/robots/{id}` updates name/description (≥1 field) | §9.3.1 | **PASS** | `PATCH /robots/2 {"description":"updated arm"}` → `200` with updated description |
| B4 | `GET /api/robots/{id}` returns full robot incl. `description`, `sim_config`, `servos[]` | §5.1.1, §9.2.1 | **PASS** | Door rig returned 4 servos + parsed `sim_config` (arm-chain) + description |
| B5 | `PUT /api/state/current-robot` sets selection (200); unknown → 404 | §9.3.1 | **PASS** | `PUT {robot_id:2}` → `200 {"robot_id":2}`; `{robot_id:999}` → `404 NOT_FOUND` |
| B6 | `GET /api/state/current-robot` returns `{robot_id, robot}` | §9.3.1 | **PASS** | `{"robot_id":2,"robot":{"id":2,"name":"ArmBot",…}}` |
| B7 | Current selection is persisted in `app_state` (survives restart) | §9.5, §9.8 | **PASS** | `app_state.current_robot_id` persisted in DB; upgrade path sets it to lowest robot |
| B8 | `?robot_id=` scoping on poses/sequences; omitted ⇒ current | §9.3.2 | **PASS** | current=2 → `[]`; `?robot_id=1` → door-rig poses; new robot-2 pose only visible under robot 2 |
| B9 | Cross-robot reference rejected (422) | §9.3.2 "cross-robot integrity" | **PASS** | Pose on robot 2 referencing servo 1 (robot 1) → `422 {"detail":"servo_id 1 does not exist on this robot","code":"VALIDATION"}` |
| B10 | `DELETE /api/robots/{id}` cascades poses/sequences/servos; current→NULL; no orphans | §9.3.1, §3 DDL | **PASS** | Deleted robot 2 → `204`; its servo/pose/sequence → `404`; SQL `0|0|0` orphans; `current-robot` → `{"robot_id":null}` |
| B11 | `POST /api/robots` blank name → 422 | §9.3.1 "name non-empty" | **PASS** | `{"name":"  "}` → `422 {"code":"VALIDATION"}` |
| B12 | `PATCH /api/robots/{id}` with no fields → 422 | §9.3.1 "≥1 field" | **PASS** | `PATCH {}` → `422 VALIDATION` ("Provide at least one of name or description") |

## C. Seed rig — door durability tester (brief 02; §9.7)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| C1 | Fresh DB seeds exactly one robot (the door rig), not empty | §9.7 "exactly one robot on first run" | **PASS** | Fresh DB (port 8001) → `GET /robots` → `[{"id":1,"name":"DoorDurabilityRig",…}]`; `app_state.seeded=1` |
| C2 | Rig servo inventory = 4 servos (shoulder/pivot, elbow, wrist-twist, gripper) with complete valid calibration | §9.7, brief 02 | **PASS** | servos `shoulder, elbow, wrist, gripper`; each has all 8 fields; `angle_min<angle_max`; neutral within limits |
| C3 | Rig ships named poses within the rig's servo limits | §9.7 | **PASS** | poses `rest, reach_handle, grip_handle, door_open, door_closed`; all targets within limits |
| C4 | Rig ships example sequences using group/sequence repeat illustrating the door open/close cycle | §9.7 | **PASS** | `door_cycle` (4 steps, group `open_close_cycle` repeat 25) + `grip_and_release` (3 steps, sequence repeat 5) |
| C5 | Rig ships a populated `sim_config` (arm-chain + wall/door/handle) | §9.2.1, §9.6 | **PASS** | `sim_config.kind="arm-chain"`, joints shoulder/elbow/wrist, gripper, environment wall/door/handle |
| C6 | Seed behaves like normal user data (editable/deletable, not read-only) | §9.7 "normal, editable, deletable" | **PASS** | Deleted the rig via API → `204`; it is an ordinary record |
| C7 | Seed-once: deleting the rig does NOT recreate it on restart | §9.7 "never re-seed after delete" | **PASS** | After deleting rig + restart (same DB) → `GET /robots` → `[]`; `seeded` stays 1 |
| C8 | Upgraded v0.1 DB: existing data preserved, no re-seed | §9.7, §9.8 | **PASS** | v0.1 DB with `SampleBot` migrated to `seeded=1`, SampleBot + its poses/sequences intact (no rig added) |

## D. Timeline editor (brief 03; §9.3.3)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| D1 | Step insert at `position` (0-based), later steps renumbered | §9.3.3 | **PASS** | Inserted a servo step at position 1 → returned `position:1`; prior step shifted 1→2; positions contiguous |
| D2 | `POST …/steps/{id}/duplicate` copies adjacent to original, carrying target/timing/speed/easing | §9.3.3 | **PASS** | Duplicated step 8 → new step `position:1` (adjacent), same `angle/duration/speed/easing` |
| D3 | `POST …/reorder` persists the execution order | §5.3, §9.3 | **PASS** | Reorder accepted; order follows `step_ids`; group-split reorder rejected (F8) |
| D4 | Play/pause/scrub timing-accurate via shared motion.js | brief 03, §9.5 | **PASS** (static) | `timeline.js` `wireScrub` maps track fraction → elapsed ms; `togglePlay` animates via `Motion.expand`; playhead position = `elapsed/playable * width` |

## E. Advanced motion timing (brief 04; §9.2.2, §9.2.3, §9.2.4)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| E1 | Per-step `easing` stored (enum linear/ease_in/ease_out/ease_in_out) | §9.2.3 | **PASS** | Seed steps carry `easing` values from the full set; DB `CHECK` present on fresh DB |
| E2 | Invalid easing → 422 | §9.2.3 | **PASS** | `easing:"bogus"` → `422 VALIDATION` ("easing must be one of linear, ease_in, ease_out, ease_in_out") |
| E3 | Only `duration_ms` given → speed derived from travel | §9.2.2 | **PASS** | servo 5 neutral 0→10 over 300ms → `speed:33.333333` (10/0.3) |
| E4 | Only `speed` given → duration derived | §9.2.2 | **PASS** | servo 5 0→20 at 100 deg/s → stored `duration_ms:200`, `speed:100.0` |
| E5 | Both given but inconsistent → 422 `SPEED_DURATION_MISMATCH` | §9.2.2 | **PASS** | `{"duration_ms":200,"speed":999}` → `422 {"code":"SPEED_DURATION_MISMATCH"}` |
| E6 | Sequence `repeat_count`/`repeat_forever` saved and honored in preview | §9.2.4, §9.3.6 | **PASS** | `PUT repeat_count:2` → seq `repeat_count:2`; preview `pass_duration_ms:1400, total_duration_ms:2800` |
| E7 | `repeat_count` + `repeat_forever` mutually exclusive → 422 | §9.2.4, §9.3.4 | **PASS** | `{"repeat_count":3,"repeat_forever":true}` → `422 VALIDATION` |
| E8 | `repeat_count < 1` → 422 | §9.2.4 | **PASS** | `{"repeat_count":0}` → `422 VALIDATION` ("must be null … or >= 1") |
| E9 | Stationary step (travel 0) → `speed` stored NULL | §9.2.2 | **PASS** | servo 5→20 then a second step 5→20 → second step `speed:null`, `duration_ms:500` kept |

## F. Step groups (brief 04; §9.3.5)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| F1 | `POST …/groups` creates a group over contiguous steps (201) | §9.3.5 | **PASS** | `{"name":"g1","step_ids":[8,11],"repeat_count":3}` → `201` with `step_ids` + repeat |
| F2 | `GET …/groups/{id}` returns the group | §9.3.5 | **PASS** | `GET …/groups/2` → group object with `step_ids, repeat_count, repeat_forever` |
| F3 | `PUT …/groups/{id}` updates name and/or repeat fields | §9.3.5 | **PASS** | `PUT {name, repeat_count:7}` → `200` `{"name":"renamed_g","repeat_count":7,…}` |
| F4 | `DELETE …/groups/{id}` removes group; its steps remain | §9.3.5 | **PASS** | `DELETE …/groups/2` → `204`; steps still present; group gone |
| F5 | Non-contiguous `step_ids` → 422 | §9.3.5 contiguity | **PASS** | Group over steps [A,C] with B between → `422 {"detail":"Group steps must be contiguous by position"}` |
| F6 | Overlapping groups → 422 | §9.3.5 non-overlap | **PASS** | Group [B,C] after group [A,B] → `422 {"detail":"Group steps must not overlap another group's steps"}` |
| F7 | `GROUP_SPLIT` guard: inserting a step between group members → 422 | §9.2.4, §9.3.5 | **PASS** | Insert at position 1 (between members) → `422 {"code":"GROUP_SPLIT"}` |
| F8 | `GROUP_SPLIT` guard: reorder that splits a group → 422 | §9.2.4 | **PASS** | Reorder placing an outside step between group members → `422 {"code":"GROUP_SPLIT"}` |
| F9 | Groups reflected in preview (`step_orders` + repeat) | §9.3.6 | **PASS** | `door_cycle` preview `groups:[{step_orders:[0,1,2,3],repeat_count:25}]`, `pass_duration_ms:127500` |

## G. Preview — extended resolved motion source (briefs 03/04/05; §9.3.6)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| G1 | Per-target `from_angle`/`from_pulse_us` carry-through of prior steps | §9.3.6 | **PASS** | `door_cycle` step 1 `shoulder from_angle:-30` (prev step end); `from_pulse_us` matches |
| G2 | Per-step `start_ms`/`end_ms` absolute from pass start | §9.3.6 | **PASS** | `door_cycle` steps `0–800`, `1000–1400`, `1700–2900`, `3400–4600` (end=start+duration) |
| G3 | Per-step `easing` + `speed_deg_per_s` present | §9.3.6 | **PASS** | Steps carry `easing` and `speed_deg_per_s` values |
| G4 | Sequence-level `repeat_count`/`repeat_forever` + `groups[].step_orders` | §9.3.6 | **PASS** | Both seed sequences expose repeat fields; `door_cycle` group with `step_orders` |
| G5 | `pass_duration_ms` and `total_duration_ms` computed (incl. group/sequence repeat) | §9.3.6 | **PASS** | `door_cycle` pass 127500 (5100×25); `grip_and_release` pass 1700, total 8500 (×5) |
| G6 | First mover of a servo resolves `from_angle` to its `neutral_angle` | §9.3.6 | **PASS** | `door_cycle` step 0 shoulder `from_angle:0` (neutral 0), elbow `from_angle:45` (neutral 45) |
| G7 | `speed_deg_per_s` is consistent with the step's resolved travel (no stale speed after a step mutation) | brief 04 "must not store a step with an incoherent speed/duration"; §9.2.2 | **FAIL** | See Failures. After inserting a step before an existing step, the earlier step's stored `speed` (and preview `speed_deg_per_s`) is not recomputed, so it no longer matches its new `from_angle→angle` travel. Concrete: demo seq step 3 (pose home) shows `from_angle:-20 → angle:0`, `duration_ms:500`, yet `speed_deg_per_s:20.0` (should be 40). Playback is unaffected (uses `duration_ms`), so this is a metadata/display inconsistency. |

## H. Export v2 (briefs 01/04/05; §9.3.7)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| H1 | `schema_version: 2`, `format:"robot-servo-sequence"` | §9.3.7 | **PASS** | Top-level `schema_version:2`, `format:"robot-servo-sequence"` |
| H2 | Robot `description` included | §9.3.7 additive | **PASS** | `robot.description` present |
| H3 | Per-step `easing` + `speed_deg_per_s` | §9.3.7 | **PASS** | Export steps carry `easing` and `speed_deg_per_s` |
| H4 | Sequence `repeat_count`/`repeat_forever` | §9.3.7 | **PASS** | `grip_and_release` → `repeat_count:5, repeat_forever:false` |
| H5 | Groups exported as `[{name, step_orders, repeat_count, repeat_forever}]` | §9.3.7 | **PASS** | `door_cycle` → `groups:[{name:"open_close_cycle",step_orders:[0,1,2,3],repeat_count:25,…}]` |
| H6 | Export scoped to the selected robot; `?robot_id=` supported | §9.3.7 | **PASS** | Default export = current robot (DoorDurabilityRig); both endpoints accept `?robot_id` |
| H7 | `Content-Disposition: attachment` | §5.5, §9.3.7 | **PASS** | Header `attachment; filename="DoorDurabilityRig.json"` |
| H8 | Per-sequence export (same schema) | §5.5, §9.3.7 | **PASS** | `GET /sequences/2/export` → `attachment; filename="DoorDurabilityRig-grip_and_release.json"` |
| H9 | v0.1 fields/shape preserved (pose refs resolved to `{servo_id,servo_name,angle,pulse_us}`, no app-only details) | §9.3.7 "unchanged", §5.5.2 | **PASS** | Export `steps[].targets` are flat resolved `{servo_id,servo_name,angle,pulse_us}`; no `pose_id`/`created_at` in steps |

## I. Migration & seed-once (brief 02; §9.7, §9.8)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| I1 | Upgraded v0.1 DB migrates idempotently (additive columns + new tables) | §9.8 | **PASS** | v0.1 DB gained `robots.description/sim_config`, `sequence_steps.speed/easing`, `sequences.repeat_*`, new `step_groups`, `step_group_members`, `app_state` |
| I2 | Existing v0.1 data preserved on migration | §9.8 "existing user data never deleted" | **PASS** | `SampleBot` + its 2 servos/1 pose/1 seq/2 steps intact after migration |
| I3 | Upgraded DB: `seeded=1`, `current_robot_id` = lowest robot | §9.8 | **PASS** | `app_state` → `1|1|1` (id 1, seeded 1, current 1) |
| I4 | Derived speeds backfilled on existing steps | §9.8 backfill | **PASS** | Step 1 (arm 90→120, 500ms) → `speed:60.0`; step 2 (pose wave, head_pan 0→45, 400ms) → `speed:112.5` |
| I5 | Migration is idempotent on re-run (no duplication) | §9.8 | **PASS** | Restarted app against same migrated DB → no error, counts unchanged `1|1|2`, no duplicate rows |
| I6 | Fresh DB full DDL includes new CHECK constraints (easing, repeat) | §9.2, §9.8 | **PASS** | Fresh DB `sequence_steps` has `CHECK(easing IN (…))`; `sequences`/`step_groups` have repeat CHECKs |

## J. Regression — v0.1 behavior preserved (constraint f; §9.9)

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| J1 | Pose management still works (create/list) | brief 01 constraint, §9.9 | **PASS** | `POST /poses` → `201`; `GET /poses` lists |
| J2 | Read-only preview preserved (no write route) | §9.9, §5.4 | **PASS** | `POST /sequences/1/preview` → `405 Method Not Allowed`; only `GET` preview in OpenAPI |
| J3 | Local persistence across restart (immediate, no save step) | scope item f, §9.5 | **PASS** | Door rig + 2 sequences persisted across main-server restart |
| J4 | JSON export works (now extended to v2) | scope item f | **PASS** | `GET /api/export` → `200` attachment JSON (see H) |
| J5 | Deletion guard: servo referenced by a pose → 409 `SERVO_REFERENCED` | §9.9 "deletion guards unchanged" | **PASS** | `DELETE /robots/1/servos/1` → `409 {"code":"SERVO_REFERENCED"}` |
| J6 | Deletion guard: pose referenced by a step → 409 `POSE_REFERENCED` | §9.9 | **PASS** | `DELETE /poses/2` → `409 {"code":"POSE_REFERENCED"}` |
| J7 | Unknown resource → 404 | §5 error semantics | **PASS** | `GET /sequences/999` → `404 NOT_FOUND` |

## K. Frontend static review (briefs 01–05; §9.4, §9.5)

Method: read-only inspection of `frontend/index.html` and `frontend/js/**` plus
the OpenAPI route map. **Browser interaction was not exercised by an automation
tool in this environment**; results below are static findings, not rendered
browser behavior.

| # | Check | Trace | Result | Evidence |
|---|-------|-------|--------|----------|
| K1 | Robot collection switcher in navbar: create/select/edit/delete; delete warns poses/sequences removed and requires confirm | §9.3.1, brief 01 | **PASS** (static) | `robots.js` `mount`/`renderMenu`/`onMenuClick`; `deleteRobot()` uses `UI.confirm("…also removes all of its poses and sequences…")`; create auto-selects (UX permitted) |
| K2 | Current robot always visible and clearly identified | brief 01 | **PASS** (static) | `main.js` sets `brandName` = `STATE.robotName`; `robots.js` `updateLabel` + `current` badge in menu |
| K3 | Switching robots reloads servos/poses/sequences/preview/simulator context | §9.5 | **PASS** (static) | `state.js` `setCurrentRobot` → `PUT /state/current-robot` + `refresh()` reloads robots, robot+servos, poses, sequences; `main.js` `onRefresh` re-renders active view |
| K4 | Visual timeline editor: step extents reflect duration+hold; add/reorder/edit/remove/duplicate; play/pause/scrub | brief 03 | **PASS** (static) | `timeline.js`: `left/width` from `seg.start/(end-start)`; actions left/right/dup/edit/remove; `wireScrub` drag; `togglePlay` |
| K5 | Per-step speed+easing controls; whole-sequence and step-group loop controls | brief 04 | **PASS** (static) | `timeline.js` `openStepModal` has duration+speed+easing inputs; `saveRepeat` (seq), `openGroupModal` (group) |
| K6 | Shared `motion.js` used by BOTH timeline and simulator (canonical easing/loop math) | §9.4 "cannot diverge" | **PASS** (static) | `timeline.js` `rebuildSegments` and `simulator.js` both call `Motion.expand`; easing curves in `motion.js` match §9.2.3 exactly |
| K7 | Simulator renders arm chain + wall/door/handle from `sim_config`; read-only (no edit) | brief 05, §9.4 | **PASS** (static) | `simulator.js` `buildChain`/`drawEnvironment`/`drawArm`; `SimulatorView` fetches `/preview` on render and exposes only play/reset/scrub; no sequence writes |
| K8 | Preview re-fetches on every render (v0.1 I11 fixed — no stale preview) | brief 04 "no stale data", §9.5 | **PASS** (static) | `preview.js` `ensureFresh()` re-fetches `/preview` on `render()` and after list selection; comment documents the v0.1 fix |
| K9 | Frontend consumes only endpoints the backend exposes | §9.4 "consumes only the endpoints in §5/§9" | **PASS** (static) | Every `API.*`/`location.href` call (robots, current-robot, poses, sequences, steps, duplicate, reorder, groups, preview, export) matches a route in `GET /openapi.json`; cross-checked all 19 paths |
| K10 | Frontend never persists locally / never computes authoritative pulse widths | §9.4 | **PASS** (static) | No `localStorage`/`indexedDB`; pulse widths only rendered from backend `pulse_us` |
| K11 | Browser interaction is not automated in this environment | stage instruction | **NOTE** | Play/pause/scrub and canvas rendering were reviewed statically only; not exercised by a browser automation tool |

## Result tally (enhancement pass)

- **Total checks (enhancement pass):** 86
- **PASS:** 85
- **FAIL:** 1 (G7 — preview `speed_deg_per_s` stale after a step mutation)
- Checks not performed: full browser interaction (no headless browser in this
  environment); frontend behavior was statically reviewed and is labeled as such.
- **v0.1 regression:** none found (all earlier sections unchanged; section J
  re-confirms the no-regression constraint).

## Failures (enhancement pass)

**G7 — Stored step `speed` / preview `speed_deg_per_s` is not recomputed after a
step mutation changes the step's resolved travel.**
Evidence: In a sequence, after appending a step, a later structural change was
made by inserting another step earlier in the order. The backend derives each
step's `speed` from its resolved travel **at save time** (§9.2.2) but does not
recompute the `speed` of existing steps when an insert (or delete/reorder)
changes the `from_angle` context of those steps. Concretely:
- Steps: `[servo→10 (300ms), servo→-20 (400ms), pose home (500ms)]`.
- Pose `home` (servo 5 → 0) originally appended after `servo→10` (travel
  `|0−10|=10` → `speed 20`).
- After inserting `servo→-20` between them, the pose's actual travel became
  `|0−(−20)|=20` over 500ms = **40 deg/s**, but `GET /sequences/{id}/preview`
  still reports `speed_deg_per_s:20.0` while the same target shows
  `from_angle:-20 → angle:0`.
This contradicts brief 04's invariant ("must not store a step with an
incoherent speed/duration") and makes the preview's `speed_deg_per_s` disagree
with its own `from_angle→angle`/`duration_ms`. It does **not** affect playback
or scrubbing (both `motion.js` and the simulator use `duration_ms`/`easing`, not
`speed`), so it is a metadata/display-consistency defect rather than a timing
defect. The timeline editor renders the same stale `speed_deg_per_s` from the
preview document.

## Minor observations (enhancement pass, not failures)

- `POST /api/robots` leaves the current selection unchanged (creation does not
  auto-select); the frontend `robots.js` auto-selects the new robot as a UX
  choice, which the architecture explicitly permits.
- After deleting the current robot, `GET /api/state/current-robot` returns
  `robot_id:null` (FK `SET NULL`), matching §9.3.1; `GET /api/poses|sequences`
  without `?robot_id` then falls back to the lowest remaining robot.
- `repeat_count` cannot be cleared back to `null` via `PUT` once set (a `null`
  value is indistinguishable from "not provided"); the frontend clears it by
  sending `repeat_count:null` + `repeat_forever:false`, which is accepted and
  yields a "run once" sequence. Minor API ergonomics only.
- The v0.1 step-list sequence editor (`sequences.js`) remains present alongside
  the new timeline editor; the architecture (§9.10) treats the timeline as the
  editing surface, and coexistence is acceptable.

## Scope notes (enhancement pass)

- No code was repaired, redesigned, or extended during this stage.
- The default `data/app.db` was modified during testing (create/delete of test
  robots/sequences) and restored to the clean seeded baseline
  (1 robot, 4 servos, 5 poses, 2 sequences). `data/` is git-ignored.
- The single FAIL (G7) is left for a future pass/documentation to record; the
  fix (recompute `speed` of affected steps on step mutation, or derive it during
  preview instead of storing it) is out of scope for the verification stage.