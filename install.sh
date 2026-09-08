#!/usr/bin/env bash
# Provision a reproducible development/runtime environment from scratch.
#
# Creates a Python virtual environment in ./.venv and installs the pinned
# dependencies from requirements.txt. Idempotent: safe to re-run.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
PYTHON_BIN="${PYTHON:-python3}"

echo "==> Looking for a suitable Python interpreter..."
if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
    echo "ERROR: no '${PYTHON_BIN}' on PATH. Set PYTHON=/path/to/python3 (>=3.9) and retry." >&2
    exit 1
fi

python_version="$("${PYTHON_BIN}" -c 'import sys; print(".".join(map(str, sys.version_info[:2])))')"
echo "    Using Python ${python_version} (${PYTHON_BIN})"

# Enforce a minimum supported Python (>=3.9) before going further.
if ! "${PYTHON_BIN}" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)'; then
    echo "ERROR: Python >=3.9 is required; found ${python_version}." >&2
    exit 1
fi

# Create a fresh virtual environment if one does not already exist.
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
    echo "==> Creating virtual environment at ${VENV_DIR}"
    "${PYTHON_BIN}" -m venv "${VENV_DIR}"
else
    echo "==> Reusing existing virtual environment at ${VENV_DIR}"
fi

echo "==> Upgrading pip..."
"${VENV_DIR}/bin/python" -m pip install --upgrade pip

echo "==> Installing pinned dependencies from requirements.txt..."
"${VENV_DIR}/bin/python" -m pip install -r "${ROOT_DIR}/requirements.txt"

echo
echo "Environment ready."
echo "  Activate it with:   source ${VENV_DIR}/bin/activate"
echo "  Or run the app with: ./run.sh"
