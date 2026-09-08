"""First-run seed data — the door durability tester rig (brief 02; §9.7).

On a FRESH database (app_state.seeded = 0) this seeds exactly one robot: a
wall-mounted, non-humanoid servo arm that reaches to a door handle and
repeatedly opens/closes the door. It is created once on first run and then
behaves exactly like user-created data (editable, deletable, not special-cased).
An upgraded v0.1 database is never re-seeded (db.init_db sets seeded=1 there).

The architecture fixes the seed *shape and quantity* (one robot, 4-6 servos
representing shoulder/pivot, elbow, wrist-twist, gripper; a few named poses;
example sequences demonstrating the door open/close cycle; populated
sim_config) but NOT the concrete names/values. All concrete content below is
**BACKEND-AUTHORED** and flagged for downstream roles. The sim_config JSON
schema is frontend-interpreted (architecture §9.2.1); the shape follows the
suggested minimal shape in §9.6 with a few concrete environment hints.
"""
import json
import sqlite3

_DESCRIPTION = (
    "Wall-mounted door durability tester: a servo arm that reaches to the door "
    "handle, grips it, and repeatedly opens and closes the door to stress-test "
    "the hinges and closer over many cycles."
)

# (name, pwm_pin, angle_min, angle_max, neutral_angle, pulse_min_us, pulse_max_us)
_SERVOS = [
    ("shoulder", 2, -90.0, 90.0, 0.0, 500, 2500),   # pivot at the wall mount
    ("elbow",    3, 0.0, 120.0, 45.0, 500, 2500),   # vertical reach to the handle
    ("wrist",    4, -90.0, 90.0, 0.0, 500, 2500),   # wrist twist
    ("gripper",  5, 0.0, 60.0, 30.0, 500, 2500),    # open/close end-effector
]

# Servo indices referenced by name below for readability.
_SHOULDER = 0
_ELBOW = 1
_WRIST = 2
_GRIPPER = 3

_SIM_CONFIG = {
    "kind": "arm-chain",
    "anchor": {"x": 0, "y": 0, "z": 120},
    "joints": [
        {"servo_name": "shoulder", "segment_len": 45},
        {"servo_name": "elbow", "segment_len": 40},
        {"servo_name": "wrist", "segment_len": 10},
    ],
    "gripper": {"servo_name": "gripper", "jaw_len": 8},
    "environment": {
        "wall": {"x": 0},
        "door": {"frame_width": 90, "frame_height": 200, "open_axis": "z"},
        "handle": {"x": 150, "y": 0, "z": 100, "reach_angle": -30},
    },
}


def seed(conn: sqlite3.Connection) -> int:
    """Populate a fresh database with the door rig. Returns the robot id."""
    robot_id = _insert_robot(conn, "DoorDurabilityRig", _DESCRIPTION,
                             _SIM_CONFIG)
    servo_ids = [_insert_servo(conn, robot_id, s) for s in _SERVOS]

    # (pose_name, [(servo_index, angle), ...]) -- angles within each servo's limits.
    poses = [
        ("rest", [
            (_SHOULDER, 0.0), (_ELBOW, 20.0), (_WRIST, 0.0), (_GRIPPER, 30.0),
        ]),
        ("reach_handle", [
            (_SHOULDER, -30.0), (_ELBOW, 90.0), (_WRIST, 0.0), (_GRIPPER, 30.0),
        ]),
        ("grip_handle", [
            (_SHOULDER, -30.0), (_ELBOW, 95.0), (_WRIST, -20.0), (_GRIPPER, 10.0),
        ]),
        ("door_open", [
            (_SHOULDER, -45.0), (_ELBOW, 110.0), (_WRIST, 40.0), (_GRIPPER, 10.0),
        ]),
        ("door_closed", [
            (_SHOULDER, -15.0), (_ELBOW, 80.0), (_WRIST, -30.0), (_GRIPPER, 10.0),
        ]),
    ]
    pose_ids = {}
    for name, targets in poses:
        pose_ids[name] = _insert_pose(conn, robot_id, name,
                                      [(servo_ids[i], ang) for i, ang in targets])

    # door_cycle: the open/close durability cycle, looped via a step group.
    # Speeds are pre-derived constant speeds consistent with each step's
    # resolved travel (degrees) over its duration (ms); easing is illustrative.
    door_cycle_id = _insert_sequence(conn, robot_id, "door_cycle", [
        ("pose", "reach_handle", 800, 200, 56.25, "linear"),
        ("pose", "grip_handle", 400, 300, 50.0, "ease_in"),
        ("pose", "door_open", 1200, 500, 50.0, "ease_out"),
        ("pose", "door_closed", 1200, 500, 58.33, "ease_in_out"),
    ])
    _insert_group(conn, door_cycle_id, "open_close_cycle",
                  repeat_count=25, repeat_forever=0)

    # grip_and_release: per-step speed/easing on direct servo moves + sequence
    # repeat. Speeds are pre-derived constant speeds consistent with each step's
    # travel (degrees) over its duration (ms); easing is illustrative.
    _insert_sequence(conn, robot_id, "grip_and_release", [
        ("servo", _GRIPPER, 10.0, 300, 200, 66.7, "ease_in_out"),
        ("servo", _GRIPPER, 60.0, 400, 100, 125.0, "linear"),
        ("pose", "rest", 600, 100, 50.0, "ease_out"),
    ], repeat_count=5, repeat_forever=0)

    conn.commit()
    return robot_id


def _insert_robot(conn: sqlite3.Connection, name: str, description: str,
                  sim_config: dict) -> int:
    cur = conn.execute(
        "INSERT INTO robots (name, description, sim_config) VALUES (?, ?, ?)",
        (name, description, json.dumps(sim_config)),
    )
    return cur.lastrowid


def _insert_servo(conn: sqlite3.Connection, robot_id: int, s) -> int:
    (name, pin, amin, amax, neutral, pmin, pmax) = s
    cur = conn.execute(
        """INSERT INTO servos
           (robot_id, name, pwm_pin, angle_min, angle_max, neutral_angle,
            pulse_min_us, pulse_max_us)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (robot_id, name, pin, amin, amax, neutral, pmin, pmax),
    )
    return cur.lastrowid


def _insert_pose(conn: sqlite3.Connection, robot_id: int, name: str,
                 targets) -> int:
    cur = conn.execute(
        "INSERT INTO poses (robot_id, name) VALUES (?, ?)", (robot_id, name)
    )
    pose_id = cur.lastrowid
    for servo_id, angle in targets:
        conn.execute(
            "INSERT INTO pose_targets (pose_id, servo_id, angle) VALUES (?, ?, ?)",
            (pose_id, servo_id, angle),
        )
    return pose_id


def _insert_sequence(conn: sqlite3.Connection, robot_id: int, name: str,
                     steps, repeat_count=None, repeat_forever=0) -> int:
    cur = conn.execute(
        "INSERT INTO sequences (robot_id, name, repeat_count, repeat_forever) "
        "VALUES (?, ?, ?, ?)",
        (robot_id, name, repeat_count, repeat_forever),
    )
    seq_id = cur.lastrowid
    for position, step in enumerate(steps):
        kind = step[0]
        if kind == "pose":
            _, pose_name, duration_ms, hold_ms, speed, easing = step
            conn.execute(
                """INSERT INTO sequence_steps
                   (sequence_id, position, kind, pose_id, servo_id, angle,
                    duration_ms, hold_ms, speed, easing)
                   VALUES (?, ?, 'pose', ?, NULL, NULL, ?, ?, ?, ?)""",
                (seq_id, position, _lookup_pose(conn, robot_id, pose_name),
                 duration_ms, hold_ms, speed, easing),
            )
        else:  # kind == "servo"
            _, servo_index, angle, duration_ms, hold_ms, speed, easing = step
            conn.execute(
                """INSERT INTO sequence_steps
                   (sequence_id, position, kind, pose_id, servo_id, angle,
                    duration_ms, hold_ms, speed, easing)
                   VALUES (?, ?, 'servo', NULL, ?, ?, ?, ?, ?, ?)""",
                (seq_id, position, _servo_index_id(conn, robot_id, servo_index),
                 angle, duration_ms, hold_ms, speed, easing),
            )
    return seq_id


def _lookup_pose(conn: sqlite3.Connection, robot_id: int, name: str) -> int:
    row = conn.execute(
        "SELECT id FROM poses WHERE robot_id = ? AND name = ?",
        (robot_id, name),
    ).fetchone()
    return row["id"]


def _servo_index_id(conn: sqlite3.Connection, robot_id: int, index: int) -> int:
    # index into the _SERVOS list above; servo ids are assigned in order.
    row = conn.execute(
        "SELECT id FROM servos WHERE robot_id = ? "
        "ORDER BY id LIMIT 1 OFFSET ?",
        (robot_id, index),
    ).fetchone()
    return row["id"]


def _insert_group(conn: sqlite3.Connection, seq_id: int, name: str,
                  repeat_count, repeat_forever) -> int:
    members = [r["id"] for r in conn.execute(
        "SELECT id FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id",
        (seq_id,),
    ).fetchall()]
    cur = conn.execute(
        "INSERT INTO step_groups (sequence_id, name, repeat_count, "
        "repeat_forever) VALUES (?, ?, ?, ?)",
        (seq_id, name, repeat_count, repeat_forever),
    )
    group_id = cur.lastrowid
    for sid in members:
        conn.execute(
            "INSERT INTO step_group_members (step_id, group_id) VALUES (?, ?)",
            (sid, group_id),
        )
    return group_id