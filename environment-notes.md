# Environment Notes — Robot Servo Sequence Designer

Runtime/environment contract for the FastAPI + SQLite backend and the static
SPA (Bootstrap) frontend. This stage establishes the reproducible environment
only; no application code is included yet.

## Prerequisites

- A POSIX shell (bash). `install.sh` and `run.sh` are bash scripts.
- A Python interpreter on `PATH` as `python3` (version >= 3.9). On macOS the
  system `python3` (/usr/bin/python3, currently 3.9.6) satisfies this; a
  `PYTHON` environment variable may be set to point at a specific interpreter
  (e.g. from pyenv, python.org, or Homebrew).
- No frontend build toolchain is required. The frontend is a static SPA and is
  served directly by the backend; it is not compiled.

## Provisioning

```
./install.sh
```

- Creates a Python virtual environment at `.venv/`.
- Upgrades `pip`.
- Installs pinned dependencies from `requirements.txt`.
- Idempotent; safe to re-run.

## Running

```
./run.sh
```

- Starts the FastAPI application with `uvicorn` (default entry point
  `app.main:app`).
- Binds to `127.0.0.1:8000` by default. Override with `HOST`, `PORT`, and
  `APP` environment variables.
- The backend is expected to serve the static SPA frontend (a `frontend/`
  directory) via FastAPI `StaticFiles`, so a single process serves both API and
  UI. See "Caveats" below.

## Language / runtime assumptions

- **Python:** >= 3.9 supported; **Python 3.11/3.12 recommended**. Versions are
  pinned in code under Stage 6; `requirements.txt` currently pins FastAPI and
  uvicorn at versions compatible with Python >= 3.9.
- **Virtual environment:** `.venv/` at repository root; never committed.
- **Database:** SQLite via Python stdlib (`sqlite3`). SQLAlchemy/ORM usage, if
  any, is a Stage 6 decision; it is intentionally NOT pinned here.
- **Frontend:** static HTML/CSS/JS + Bootstrap, no build step.

## Caveats / open items for downstream roles

- **Frontend serving contract:** `run.sh` assumes the FastAPI app serves the
  static SPA. The exact entry point (`app.main:app`) and the `frontend/`
  directory location are assumptions the backend (Stage 6) and frontend
  (Stage 7) roles must honor or override. `run.sh` supports an `APP` override
  if the entry point differs.
- **Requirements scope is intentionally minimal:** only runtime packages that
  must exist now (FastAPI + uvicorn) are pinned. If a stage adds an ORM
  (SQLAlchemy), Alembic, pydantic-settings, or test tooling (pytest), it must
  update `requirements.txt` (and this file) accordingly.
- **Platform caveats:** `install.sh`/`run.sh` are bash/POSIX-oriented. macOS
  system Python 3.9.6 will install and run, but the pinned packages may emit
  deprecation warnings; a 3.11/3.12 interpreter is preferred. On Windows these
  scripts will not run directly; use Git Bash/WSL or equivalent.
- **Data directory:** the SQLite `.db` file is expected under `data/`, which is
  git-ignored. `run.sh` does not create it; creation is a Stage 6 concern.
