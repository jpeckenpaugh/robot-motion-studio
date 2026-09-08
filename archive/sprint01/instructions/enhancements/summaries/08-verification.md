# Summary: Verification Engineer (Stage 8)

- **Date:** 2026-09-08
- **Author / Executor:** opencode (verification stage)
- **Instruction file:** `instructions/enhancements/08-verification.md`
- **Scope reference:** `enhancements/scope.md`, `features/briefs/01..05.md`,
  `docs/architecture.md` §9
- **Commit:** `stage 08: verify sprint 01 enhancements against specs; report 85/86 pass`

## Work Completed

Verified the Sprint 01 enhancement pass (multi-robot management, door
durability tester seed rig, visual timeline editor, advanced motion timing,
motion simulation/preview) against the approved specifications, and confirmed
no regression of v0.1 behavior. The enhanced app was run with the Stage 4
environment scripts (`install.sh` reused the existing `.venv`;
`run.sh`/uvicorn on `http://127.0.0.1:8000`). Every enhancement endpoint in
architecture §9.3 was exercised with `curl`; fresh-DB seeding/seed-once and
upgraded-v0.1 idempotent migration were tested on throwaway databases on
separate ports; the frontend was statically reviewed (browser interaction is not
automated in this environment).

**Outcome:** 85 / 86 enhancement checks PASS, 1 FAIL. No v0.1 regression.

## Outputs Produced / Modified

- `docs/verification-report.md` — **modified** (append): added an
  "ENHANCEMENT PASS — Sprint 01" section (sections A–K) with 86 checks, each
  traced to a spec requirement, with concrete evidence (status codes, bodies,
  headers, static-review notes). The existing v0.1 results (82/83) were
  preserved unchanged.
- `instructions/enhancements/summaries/08-verification.md` — **new** (this file).

## Key Decisions

- Checklist derived from `enhancements/scope.md` (items a–f), the five feature
  briefs, and `docs/architecture.md` §9 (schema §9.2, API §9.3,
  responsibilities §9.4, flow §9.5, `sim_config` §9.6, seed §9.7, migration
  §9.8, unchanged §9.9). Regression checks were derived from the "no
  regression" constraint (scope item f, brief 01, §9.9).
- Destructive seed/migration tests were run against throwaway databases on
  separate ports (8001, 8002) with `DB_PATH` overrides so the default
  `data/app.db` and the primary instance were not disturbed; the default DB was
  restored to the clean seeded baseline afterward.
- Frontend checks are labeled "(static)" because no headless browser automation
  is available; no browser-interaction claims are made.

## Open Questions & Concerns

- **FAIL G7 (metadata consistency, not timing):** the stored per-step `speed`
  (surfaced as preview `speed_deg_per_s`) is computed at step-save time and is
  **not recomputed** when a later insert/delete/reorder changes a step's
  resolved `from_angle` travel. This makes preview `speed_deg_per_s` disagree
  with the step's own `from_angle→angle`/`duration_ms` (e.g. shows 20 deg/s for
  a step whose travel is 40 deg/s after an insert). It does not affect playback
  or scrubbing (both use `duration_ms`/`easing`, not `speed`). A future pass
  should either recompute `speed` of affected steps on step mutation or derive
  it during preview resolution rather than storing it.
- Minor (not failures): `repeat_count` cannot be cleared back to `null` via PUT
  once set (frontend clears via `null` + `repeat_forever:false`); the v0.1
  step-list sequence editor coexists with the new timeline editor (acceptable
  per §9.10).
- Not exercised in this environment: real browser interaction (play/pause/scrub
  of the timeline editor and simulator, canvas rendering) — statically reviewed
  only.

## Status

- [x] Complete
- [ ] Needs review
