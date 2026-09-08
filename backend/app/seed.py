"""First-run seed data (brief 07).

Authors a plausible sample robot so a new user has immediately usable content.
The architecture fixes the shape/quantity (one robot, 4-6 servos, 3-4 poses,
2+ sequences, all mutually consistent and valid) but NOT the exact names and
values. The concrete names/values below are BACKEND-AUTHORED default content,
flagged here so downstream roles know its origin. Seed data behaves exactly
like user-created data once present (it is not read-only or special-cased).

The sample robot is a small humanoid: two shoulder servos, two elbow servos,
a panning head and a tilting head.
"""
import sqlite3

# (name, pwm_pin, angle_min, angle_max, neutral_angle, pulse_min_us, pulse_max_us)
_SERVOS = [
    ("left_shoulder", 2, 0.0, 180.0, 90.0, 500, 2500),
    ("right_shoulder", 3, 0.0, 180.0, 90.0, 500, 2500),
    ("left_elbow", 4, 0.0, 180.0, 90.0, 500, 2500),
    ("right_elbow", 5, 0.0, 180.0, 90.0, 500, 2500),
    ("head_pan", 6, -90.0, 90.0, 0.0, 500, 2500),
    ("head_tilt", 7, 0.0, 90.0, 45.0, 500, 2500),
]

# Servo ids referenced by name below for readability.
_LEFT_SHOULDER = 0  # index into _SERVOS
_RIGHT_SHOULDER = 1
_LEFT_ELBOW = 2
_RIGHT_ELBOW = 3
_HEAD_PAN = 4
_HEAD_TILT = 5


def seed(conn: sqlite3.Connection) -> None:
    """Populate an empty database with the sample robot, poses, and sequences."""
    robot_id = _insert_robot(conn, "SampleBot")
    servo_ids = [_insert_servo(conn, robot_id, s) for s in _SERVOS]

    # (pose_name, [(servo_index, angle), ...])  -- angles within each servo's limits.
    poses = [
        ("neutral", [
            (_LEFT_SHOULDER, 90.0), (_RIGHT_SHOULDER, 90.0),
            (_LEFT_ELBOW, 90.0), (_RIGHT_ELBOW, 90.0),
            (_HEAD_PAN, 0.0), (_HEAD_TILT, 45.0),
        ]),
        ("wave_left", [
            (_LEFT_SHOULDER, 170.0), (_RIGHT_SHOULDER, 10.0), (_HEAD_PAN, 30.0),
        ]),
        ("wave_right", [
            (_LEFT_SHOULDER, 10.0), (_RIGHT_SHOULDER, 170.0), (_HEAD_PAN, -30.0),
        ]),
        ("look_center_up", [
            (_HEAD_PAN, 0.0), (_HEAD_TILT, 70.0),
        ]),
    ]
    pose_ids = {}
    for name, targets in poses:
        pose_ids[name] = _insert_pose(conn, robot_id, name,
                                      [(servo_ids[i], ang) for i, ang in targets])

    # (sequence_name, [step tuples]) where step is one of:
    #   ("pose", pose_name, duration_ms, hold_ms)
    #   ("servo", servo_index, angle, duration_ms, hold_ms)
    sequences = [
        ("wave", [
            ("pose", "wave_left", 600, 100),
            ("pose", "wave_right", 600, 100),
            ("servo", _HEAD_TILT, 60.0, 400, None),
            ("pose", "neutral", 800, None),
        ]),
        ("look_around", [
            ("servo", _HEAD_PAN, -60.0, 500, None),
            ("servo", _HEAD_PAN, 60.0, 500, 200),
            ("servo", _HEAD_PAN, 0.0, 500, None),
            ("pose", "look_center_up", 400, None),
        ]),
    ]
    for seq_name, steps in sequences:
        _insert_sequence(conn, robot_id, seq_name, steps, pose_ids, servo_ids)

    conn.commit()


def _insert_robot(conn: sqlite3.Connection, name: str) -> int:
    cur = conn.execute("INSERT INTO robots (name) VALUES (?)", (name,))
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
                     steps, pose_ids, servo_ids) -> int:
    cur = conn.execute(
        "INSERT INTO sequences (robot_id, name) VALUES (?, ?)", (robot_id, name)
    )
    seq_id = cur.lastrowid
    for position, step in enumerate(steps):
        kind = step[0]
        if kind == "pose":
            _, pose_name, duration_ms, hold_ms = step
            conn.execute(
                """INSERT INTO sequence_steps
                   (sequence_id, position, kind, pose_id, servo_id, angle,
                    duration_ms, hold_ms)
                   VALUES (?, ?, 'pose', ?, NULL, NULL, ?, ?)""",
                (seq_id, position, pose_ids[pose_name], duration_ms, hold_ms),
            )
        else:  # kind == "servo"
            _, servo_index, angle, duration_ms, hold_ms = step
            conn.execute(
                """INSERT INTO sequence_steps
                   (sequence_id, position, kind, pose_id, servo_id, angle,
                    duration_ms, hold_ms)
                   VALUES (?, ?, 'servo', NULL, ?, ?, ?, ?)""",
                (seq_id, position, servo_ids[servo_index], angle, duration_ms, hold_ms),
            )
    return seq_id
