"""Path and runtime configuration for the application.

Resolves repository-relative paths from this module's location
(backend/app/config.py -> repository root is two levels up).
"""
import os
from pathlib import Path

# backend/app/config.py -> project root
ROOT_DIR = Path(__file__).resolve().parents[2]

# The directory the static SPA frontend is served from.
FRONTEND_DIR = Path(os.environ.get("FRONTEND_DIR", ROOT_DIR / "frontend"))

# SQLite database file. Git-ignored data/ directory holds it by default.
DB_PATH = Path(os.environ.get("DB_PATH", ROOT_DIR / "data" / "app.db"))


def ensure_db_dir() -> Path:
    """Create the database's parent directory if absent and return the path."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return DB_PATH
