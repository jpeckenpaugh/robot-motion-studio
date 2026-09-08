"""SQLite persistence layer: connection management and schema creation.

Uses the Python stdlib `sqlite3` (no ORM). The schema DDL below is canonical
and matches docs/architecture.md §3 exactly. The database file lives under the
git-ignored data/ directory.
"""
import sqlite3

from . import config

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS robots (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS servos (
    id            INTEGER PRIMARY KEY,
    robot_id      INTEGER NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    pwm_pin       INTEGER NOT NULL,
    angle_min     REAL NOT NULL,
    angle_max     REAL NOT NULL,
    neutral_angle REAL NOT NULL,
    pulse_min_us  INTEGER NOT NULL,
    pulse_max_us  INTEGER NOT NULL,
    UNIQUE (robot_id, name),
    UNIQUE (robot_id, pwm_pin)
);

CREATE TABLE IF NOT EXISTS poses (
    id         INTEGER PRIMARY KEY,
    robot_id   INTEGER NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (robot_id, name)
);

CREATE TABLE IF NOT EXISTS pose_targets (
    id       INTEGER PRIMARY KEY,
    pose_id  INTEGER NOT NULL REFERENCES poses(id) ON DELETE CASCADE,
    servo_id INTEGER NOT NULL REFERENCES servos(id),
    angle    REAL NOT NULL,
    UNIQUE (pose_id, servo_id)
);

CREATE TABLE IF NOT EXISTS sequences (
    id         INTEGER PRIMARY KEY,
    robot_id   INTEGER NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (robot_id, name)
);

CREATE TABLE IF NOT EXISTS sequence_steps (
    id          INTEGER PRIMARY KEY,
    sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    kind        TEXT NOT NULL,
    pose_id     INTEGER REFERENCES poses(id),
    servo_id    INTEGER REFERENCES servos(id),
    angle       REAL,
    duration_ms INTEGER NOT NULL,
    hold_ms     INTEGER,
    CHECK (kind IN ('pose','servo')),
    CHECK (duration_ms >= 0),
    CHECK (hold_ms IS NULL OR hold_ms >= 0),
    CHECK (
        (kind = 'pose'  AND pose_id  IS NOT NULL AND servo_id IS NULL AND angle IS NULL) OR
        (kind = 'servo' AND servo_id IS NOT NULL AND angle    IS NOT NULL AND pose_id IS NULL)
    ),
    UNIQUE (sequence_id, position)
);
"""

# Enable foreign key enforcement. Must be set per-connection.
_PRAGMAS = ("PRAGMA foreign_keys = ON;",)


def _connect(path: str) -> sqlite3.Connection:
    # check_same_thread=False: FastAPI runs sync endpoints in a threadpool
    # different from the middleware thread that opens the connection. Each
    # request gets its own connection and closes it afterward, so there is no
    # concurrent access to a single connection.
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    for pragma in _PRAGMAS:
        conn.execute(pragma)
    return conn


def connect() -> sqlite3.Connection:
    """Open a new connection to the configured database file."""
    return _connect(str(config.ensure_db_dir()))


def init_db() -> None:
    """Ensure the schema exists. Seeds sample data if the DB is empty."""
    from . import seed  # local import avoids a circular import at module load

    conn = connect()
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        if _db_empty(conn):
            seed.seed(conn)
    finally:
        conn.close()


def _db_empty(conn: sqlite3.Connection) -> bool:
    count = conn.execute("SELECT COUNT(*) AS c FROM robots").fetchone()["c"]
    return count == 0
