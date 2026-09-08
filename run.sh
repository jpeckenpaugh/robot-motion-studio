#!/usr/bin/env bash
# Start the Robot Servo Sequence Designer application.
#
# Uses the provisioned virtual environment (.venv) created by ./install.sh.
# The backend is a FastAPI application served by uvicorn; it is responsible for
# serving the static SPA frontend from the frontend/ directory (see below).
#
# Environment overrides (optional):
#   HOST        host to bind          (default: 127.0.0.1)
#   PORT        port to bind          (default: 8000)
#   DB_PATH     SQLite database file  (default: data/app.db)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"

if [[ ! -x "${VENV_DIR}/bin/uvicorn" ]]; then
    echo "ERROR: virtual environment not found at ${VENV_DIR}." >&2
    echo "       Run ./install.sh first to provision the environment." >&2
    exit 1
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

# The application entry point. Stage 6 (backend) is expected to provide a
# module importable as `app.main:app` that mounts the FastAPI routes AND serves
# the static SPA frontend (from frontend/ via StaticFiles). Override with APP
# if the entry point differs.
APP="${APP:-app.main:app}"

# Backend code lives under backend/ (docs/architecture.md §1). Add backend/ to
# PYTHONPATH so the `app` package (backend/app) resolves as `app.main:app`.
PYTHONPATH="${ROOT_DIR}/backend${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONPATH

echo "==> Starting backend (FastAPI/uvicorn) on http://${HOST}:${PORT}"
echo "    Entry point : ${APP}"
echo "    PYTHONPATH  : ${PYTHONPATH}"
echo "    Frontend    : served statically by the backend (frontend/ dir)"

exec "${VENV_DIR}/bin/uvicorn" "${APP}" --host "${HOST}" --port "${PORT}" --reload
