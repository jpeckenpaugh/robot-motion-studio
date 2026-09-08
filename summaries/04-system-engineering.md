# Summary: System Engineer (Stage 04)

- **Date:** 2026-09-08
- **Author / Executor:** System Engineer (opencode)
- **Instruction file:** `instructions/build/04-system-engineering.md`
- **Commit:** `stage 04: define reproducible runtime/environment for FastAPI + SQLite backend and static SPA`

## Work Completed

Read the approved technical stack (SPA frontend; FastAPI + SQLite backend;
Bootstrap; Web App baseline; Python runtime) and the seven feature briefs in
`features/briefs/*.md`. Established a reproducible, from-scratch environment
for the backend runtime and documented how the static SPA is served. No
application features, business logic, API endpoints, or UI code were written.
The environment contract is left deliberately open so the backend (Stage 6)
and frontend (Stage 7) roles can fill in the concrete entry point and static
asset layout.

## Outputs Produced

All five environment files at the repository root:

- `requirements.txt` — pinned Python runtime dependencies.
- `install.sh` — idempotent provisioning script (creates `.venv/`, installs deps).
- `run.sh` — starts the FastAPI/uvicorn backend, which also serves the SPA.
- `.gitignore` — excludes venvs, caches, SQLite `.db`/`data/`, `.DS_Store`, `__pycache__`, `tmp/`, logs.
- `environment-notes.md` — prerequisites, runtime assumptions, caveats.
- `summaries/04-system-engineering.md` (this file)

## Key Decisions

- **Python >= 3.9 supported, 3.11/3.12 recommended.** Compatible with the
  macOS system `python3` (3.9.6) while preferring a modern interpreter.
- **Minimal, top-level-only pins:** `fastapi` and `uvicorn[standard]` only.
  SQLite needs no extra dep (stdlib `sqlite3`). ORM/Alembic/settings/test
  tooling is deferred to Stage 6 and must extend `requirements.txt` then.
- **Single-process serving:** the FastAPI backend serves the static SPA via
  StaticFiles, so `run.sh` runs one uvicorn process for both API and UI.
- **Frontend needs no build toolchain** — static SPA + Bootstrap, no bundler.
- **No git remote present:** per directive, this stage committed **locally
  only**; nothing was pushed.

## Open Questions & Concerns

- **Entry-point / asset layout contract:** `run.sh` assumes `app.main:app` and
  a `frontend/` static directory. Stage 6/7 must honor these or set the `APP`
  override. No `app/` or `frontend/` scaffolding was created (that is
  application work, out of scope here).
- **Requirements are intentionally thin** and will need to grow (e.g. SQLAlchemy,
  pytest) when backend/test tooling is decided in Stage 6.
- **Cross-platform:** scripts are bash/POSIX. Windows users need Git Bash/WSL.
- **Data dir:** `data/` is git-ignored and expected to hold the SQLite `.db`;
  its creation is left to Stage 6.

## Status

- [x] Complete
- [ ] Needs review