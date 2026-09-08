"""SQLite persistence layer: connection management, schema creation, migration.

Uses the Python stdlib `sqlite3` (no ORM). The canonical fresh-DB schema below
matches docs/architecture.md §3 and the enhancement addendum §9.2. The database
file lives under the git-ignored data/ directory.

Schema evolution (enhancement sprint 01, architecture §9.8):
- Fresh DBs get the full DDL, including the new columns and CHECK constraints.
- Upgraded v0.1 DBs are migrated idempotently: additive `ALTER TABLE` for the
  new columns, `CREATE TABLE IF NOT EXISTS` for the new tables, then backfill
  of derived speeds and the app_state row. Existing rows keep their v0.1
  meaning (constant-speed, non-looping).
"""
import sqlite3

from . import config

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS robots (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    sim_config    TEXT
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
    id             INTEGER PRIMARY KEY,
    robot_id       INTEGER NOT NULL REFERENCES robots(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
    repeat_count   INTEGER,
    repeat_forever INTEGER NOT NULL DEFAULT 0,
    CHECK (repeat_count IS NULL OR repeat_count >= 1),
    CHECK (repeat_forever IN (0, 1)),
    CHECK (repeat_count IS NULL OR repeat_forever = 0),
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
    speed       REAL,
    easing      TEXT NOT NULL DEFAULT 'linear',
    CHECK (kind IN ('pose','servo')),
    CHECK (duration_ms >= 0),
    CHECK (hold_ms IS NULL OR hold_ms >= 0),
    CHECK (easing IN ('linear','ease_in','ease_out','ease_in_out')),
    CHECK (
        (kind = 'pose'  AND pose_id  IS NOT NULL AND servo_id IS NULL AND angle IS NULL) OR
        (kind = 'servo' AND servo_id IS NOT NULL AND angle    IS NOT NULL AND pose_id IS NULL)
    ),
    UNIQUE (sequence_id, position)
);

CREATE TABLE IF NOT EXISTS step_groups (
    id             INTEGER PRIMARY KEY,
    sequence_id    INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    name           TEXT,
    repeat_count   INTEGER,
    repeat_forever INTEGER NOT NULL DEFAULT 0,
    CHECK (repeat_count IS NULL OR repeat_count >= 1),
    CHECK (repeat_forever IN (0, 1)),
    CHECK (repeat_count IS NULL OR repeat_forever = 0)
);

CREATE TABLE IF NOT EXISTS step_group_members (
    step_id  INTEGER PRIMARY KEY REFERENCES sequence_steps(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES step_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_state (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    current_robot_id INTEGER REFERENCES robots(id) ON DELETE SET NULL,
    seeded           INTEGER NOT NULL DEFAULT 0
);
"""

# Enable foreign key enforcement. Must be set per-connection.
_PRAGMAS = ("PRAGMA foreign_keys = ON;",)

# Idempotent additive columns for upgraded v0.1 databases.
_ALTER_COLUMNS = (
    ("robots", "description", "ALTER TABLE robots ADD COLUMN description TEXT NOT NULL DEFAULT ''"),
    ("robots", "sim_config", "ALTER TABLE robots ADD COLUMN sim_config TEXT"),
    ("sequence_steps", "speed", "ALTER TABLE sequence_steps ADD COLUMN speed REAL"),
    ("sequence_steps", "easing", "ALTER TABLE sequence_steps ADD COLUMN easing TEXT NOT NULL DEFAULT 'linear'"),
    ("sequences", "repeat_count", "ALTER TABLE sequences ADD COLUMN repeat_count INTEGER"),
    ("sequences", "repeat_forever", "ALTER TABLE sequences ADD COLUMN repeat_forever INTEGER NOT NULL DEFAULT 0"),
)


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


def _table_columns(conn: sqlite3.Connection, table: str) -> set:
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


def init_db() -> None:
    """Ensure the schema exists (fresh DDL + idempotent migration) and, on a
    fresh database with seeded=0, seed the door durability tester rig."""
    from . import seed  # local import avoids a circular import at module load

    conn = connect()
    try:
        _apply_schema(conn)
        _ensure_app_state_row(conn)

        robot_count = conn.execute(
            "SELECT COUNT(*) AS c FROM robots"
        ).fetchone()["c"]
        if robot_count > 0:
            # Upgraded v0.1 database: preserve existing data, never re-seed,
            # persist the lowest robot as current, backfill derived speeds.
            conn.execute("UPDATE app_state SET seeded = 1 WHERE id = 1")
            row = conn.execute(
                "SELECT current_robot_id FROM app_state WHERE id = 1"
            ).fetchone()
            if row["current_robot_id"] is None:
                lowest = conn.execute(
                    "SELECT MIN(id) AS m FROM robots"
                ).fetchone()["m"]
                conn.execute(
                    "UPDATE app_state SET current_robot_id = ? WHERE id = 1",
                    (lowest,),
                )
            from .preview import backfill_step_speeds
            backfill_step_speeds(conn)
        else:
            # Fresh database (or all robots deleted). Seed only if never seeded;
            # a deleted rig must not reappear (architecture §9.7).
            state = conn.execute(
                "SELECT seeded FROM app_state WHERE id = 1"
            ).fetchone()
            if state["seeded"] == 0:
                robot_id = seed.seed(conn)
                conn.execute(
                    "UPDATE app_state SET seeded = 1, current_robot_id = ? "
                    "WHERE id = 1",
                    (robot_id,),
                )
        conn.commit()
    finally:
        conn.close()


def _apply_schema(conn: sqlite3.Connection) -> None:
    """Run the fresh DDL, then apply idempotent ALTERs for any missing columns
    (upgraded v0.1 databases)."""
    conn.executescript(SCHEMA_SQL)
    for table, column, ddl in _ALTER_COLUMNS:
        if column not in _table_columns(conn, table):
            conn.execute(ddl)


def _ensure_app_state_row(conn: sqlite3.Connection) -> None:
    """Guarantee the single-row app_state table has its row (id=1)."""
    row = conn.execute("SELECT 1 FROM app_state WHERE id = 1").fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO app_state (id, current_robot_id, seeded) VALUES (1, NULL, 0)"
        )