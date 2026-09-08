/* Browser-edition schema, migration, and validation (ported from
 * backend/app/db.py and backend/app/seed.py). sql.js is confined to the
 * worker; this module never runs on the main thread.
 *
 * The schema mirrors the backend exactly (architecture §3 + §9.2), plus one
 * additive bookkeeping table `app_meta` holding the workspace revision used
 * by import validation (mirroring the reference browser-POC pattern).
 */
export const REVISION = 'robot-motion-designer-browser-v1';

export const SCHEMA_SQL = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO app_meta VALUES ('schema_revision', '${REVISION}');

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

INSERT INTO app_state (id, current_robot_id, seeded) VALUES (1, NULL, 0);
`;

/* Tables that must exist in any valid workspace (import validation). */
export const REQUIRED_TABLES = [
  'app_meta', 'robots', 'servos', 'poses', 'pose_targets',
  'sequences', 'sequence_steps', 'step_groups', 'step_group_members', 'app_state',
];

export function validateDatabase(db) {
  const result = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const found = new Set((result[0]?.values || []).map(([name]) => name));
  const missing = REQUIRED_TABLES.filter((name) => !found.has(name));
  if (missing.length) {
    throw new Error(`Unsupported workspace: missing ${missing.join(', ')}`);
  }
  const rev = db.exec("SELECT value FROM app_meta WHERE key='schema_revision'");
  if (rev[0]?.values?.[0]?.[0] !== REVISION) {
    throw new Error('Unsupported workspace revision');
  }
  if (db.exec('PRAGMA integrity_check')[0]?.values?.[0]?.[0] !== 'ok') {
    throw new Error('Workspace integrity check failed');
  }
  if ((db.exec('PRAGMA foreign_key_check')[0]?.values || []).length) {
    throw new Error('Workspace foreign-key check failed');
  }
}