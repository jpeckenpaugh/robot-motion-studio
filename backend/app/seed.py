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

# ---------------------------------------------------------------------------
# Additional demo robots. Each entry is a complete, self-consistent robot:
#   name, description, servos (same 8-tuple shape as _SERVOS),
#   sim_config (frontend-interpreted), poses (name -> targets), and sequences
#   (name -> list of ("pose", pose_name, dur_ms, hold_ms, speed, easing) or
#   ("servo", servo_index, angle, dur_ms, hold_ms, speed, easing) steps,
#   plus optional repeat_count/repeat_forever and step groups).
# All speeds are pre-derived constant speeds consistent with each step's
# resolved travel over its duration; all easing values are canonical.
# ---------------------------------------------------------------------------

_DEMO_ROBOTS = [
    {
        "name": "PickPlaceArm",
        "description": (
            "A 6-DOF articulated pick-and-place arm: rotating base, shoulder, "
            "elbow, wrist pitch, wrist roll, and a two-jaw gripper. Demonstrates "
            "multi-axis coordination for moving objects between locations."
        ),
        "servos": [
            ("base_rotate", 2, -180.0, 180.0, 0.0, 500, 2500),
            ("shoulder", 3, 0.0, 180.0, 90.0, 500, 2500),
            ("elbow", 4, 0.0, 150.0, 60.0, 500, 2500),
            ("wrist_pitch", 5, -90.0, 90.0, 0.0, 500, 2500),
            ("wrist_roll", 6, -180.0, 180.0, 0.0, 500, 2500),
            ("gripper", 7, 0.0, 60.0, 30.0, 500, 2500),
        ],
        "sim_config": {
            "kind": "arm-chain",
            "anchor": {"x": 0, "y": 0, "z": 80},
            "joints": [
                {"servo_name": "base_rotate", "segment_len": 10},
                {"servo_name": "shoulder", "segment_len": 55},
                {"servo_name": "elbow", "segment_len": 45},
                {"servo_name": "wrist_pitch", "segment_len": 12},
                {"servo_name": "wrist_roll", "segment_len": 6},
            ],
            "gripper": {"servo_name": "gripper", "jaw_len": 9},
            "environment": {
                "pick_zone": {"x": 40, "z": 60},
                "place_zone": {"x": 120, "z": 60},
            },
        },
        "poses": {
            "home": [
                (0, 0.0), (1, 90.0), (2, 60.0), (3, 0.0), (4, 0.0), (5, 30.0),
            ],
            "reach_pick": [
                (0, 30.0), (1, 70.0), (2, 80.0), (3, -20.0), (4, 0.0), (5, 30.0),
            ],
            "grip": [
                (0, 30.0), (1, 70.0), (2, 80.0), (3, -20.0), (4, 0.0), (5, 10.0),
            ],
            "lift": [
                (0, 30.0), (1, 55.0), (2, 60.0), (3, -10.0), (4, 0.0), (5, 10.0),
            ],
            "carry": [
                (0, 90.0), (1, 55.0), (2, 60.0), (3, -10.0), (4, 60.0), (5, 10.0),
            ],
            "place": [
                (0, 120.0), (1, 65.0), (2, 85.0), (3, -15.0), (4, 60.0), (5, 10.0),
            ],
            "release": [
                (0, 120.0), (1, 65.0), (2, 85.0), (3, -15.0), (4, 60.0), (5, 30.0),
            ],
        },
        "sequences": [
            {
                "name": "pick_and_place",
                "steps": [
                    ("pose", "reach_pick", 900, 150, 33.3, "ease_out"),
                    ("pose", "grip", 500, 250, 40.0, "ease_in"),
                    ("pose", "lift", 700, 150, 50.0, "ease_out"),
                    ("pose", "carry", 1200, 200, 41.7, "ease_in_out"),
                    ("pose", "place", 800, 150, 56.3, "ease_out"),
                    ("pose", "release", 400, 200, 50.0, "linear"),
                ],
                "repeat_count": 2,
                "repeat_forever": 0,
                "groups": [
                    {"name": "grip_cycle", "step_positions": [1, 2, 3, 4],
                     "repeat_count": 3, "repeat_forever": 0},
                ],
            },
        ],
    },
    {
        "name": "QuadTrotter",
        "description": (
            "A quadruped with two servos per leg (hip and knee). Demonstrates "
            "coordination of diagonal limb pairs for a trot gait and a "
            "crouch/sit posture set."
        ),
        "servos": [
            ("FL_hip", 2, -45.0, 45.0, 0.0, 500, 2500),
            ("FL_knee", 3, 0.0, 120.0, 60.0, 500, 2500),
            ("FR_hip", 4, -45.0, 45.0, 0.0, 500, 2500),
            ("FR_knee", 5, 0.0, 120.0, 60.0, 500, 2500),
            ("BL_hip", 6, -45.0, 45.0, 0.0, 500, 2500),
            ("BL_knee", 7, 0.0, 120.0, 60.0, 500, 2500),
            ("BR_hip", 8, -45.0, 45.0, 0.0, 500, 2500),
            ("BR_knee", 9, 0.0, 120.0, 60.0, 500, 2500),
        ],
        "sim_config": {
            "kind": "leg-chain",
            "anchor": {"x": 0, "y": 0, "z": 70},
            "joints": [
                {"servo_name": "FL_hip", "segment_len": 30},
                {"servo_name": "FL_knee", "segment_len": 28},
                {"servo_name": "FR_hip", "segment_len": 30},
                {"servo_name": "FR_knee", "segment_len": 28},
                {"servo_name": "BL_hip", "segment_len": 30},
                {"servo_name": "BL_knee", "segment_len": 28},
                {"servo_name": "BR_hip", "segment_len": 30},
                {"servo_name": "BR_knee", "segment_len": 28},
            ],
            "gripper": None,
            "environment": {
                "ground": {"z": 0},
            },
        },
        "poses": {
            "stand": [
                (0, 0.0), (1, 60.0), (2, 0.0), (3, 60.0),
                (4, 0.0), (5, 60.0), (6, 0.0), (7, 60.0),
            ],
            "crouch": [
                (0, 0.0), (1, 80.0), (2, 0.0), (3, 80.0),
                (4, 0.0), (5, 80.0), (6, 0.0), (7, 80.0),
            ],
            "trot_diag1": [
                (0, 25.0), (1, 50.0), (2, -25.0), (3, 50.0),
                (4, -25.0), (5, 50.0), (6, 25.0), (7, 50.0),
            ],
            "trot_diag2": [
                (0, -25.0), (1, 50.0), (2, 25.0), (3, 50.0),
                (4, 25.0), (5, 50.0), (6, -25.0), (7, 50.0),
            ],
        },
        "sequences": [
            {
                "name": "trot_gait",
                "steps": [
                    ("pose", "trot_diag1", 400, 100, 62.5, "ease_out"),
                    ("pose", "trot_diag2", 400, 100, 125.0, "ease_out"),
                    ("pose", "trot_diag1", 400, 100, 125.0, "ease_out"),
                    ("pose", "trot_diag2", 400, 100, 125.0, "ease_out"),
                ],
                "repeat_count": 3,
                "repeat_forever": 0,
                "groups": [],
            },
            {
                "name": "crouch_and_stand",
                "steps": [
                    ("pose", "crouch", 800, 300, 37.5, "ease_in_out"),
                    ("pose", "stand", 700, 200, 42.9, "ease_out"),
                ],
                "repeat_count": 2,
                "repeat_forever": 0,
                "groups": [],
            },
        ],
    },
    {
        "name": "BipedWalker",
        "description": (
            "A two-legged walker with hip, knee, and ankle on each leg. "
            "Demonstrates weight-shifting and alternating leg swings for a "
            "walking step, plus a crouch and a lunge."
        ),
        "servos": [
            ("L_hip", 2, -30.0, 30.0, 0.0, 500, 2500),
            ("L_knee", 3, 0.0, 130.0, 30.0, 500, 2500),
            ("L_ankle", 4, -20.0, 20.0, 0.0, 500, 2500),
            ("R_hip", 5, -30.0, 30.0, 0.0, 500, 2500),
            ("R_knee", 6, 0.0, 130.0, 30.0, 500, 2500),
            ("R_ankle", 7, -20.0, 20.0, 0.0, 500, 2500),
        ],
        "sim_config": {
            "kind": "leg-chain",
            "anchor": {"x": 0, "y": 0, "z": 95},
            "joints": [
                {"servo_name": "L_hip", "segment_len": 35},
                {"servo_name": "L_knee", "segment_len": 30},
                {"servo_name": "L_ankle", "segment_len": 8},
                {"servo_name": "R_hip", "segment_len": 35},
                {"servo_name": "R_knee", "segment_len": 30},
                {"servo_name": "R_ankle", "segment_len": 8},
            ],
            "gripper": None,
            "environment": {
                "ground": {"z": 0},
            },
        },
        "poses": {
            "stand": [
                (0, 0.0), (1, 30.0), (2, 0.0), (3, 0.0), (4, 30.0), (5, 0.0),
            ],
            "weight_left": [
                (0, 10.0), (1, 25.0), (2, 0.0), (3, -10.0), (4, 45.0), (5, 5.0),
            ],
            "step_right": [
                (0, -5.0), (1, 30.0), (2, 0.0), (3, -25.0), (4, 60.0), (5, -10.0),
            ],
            "weight_right": [
                (0, -10.0), (1, 45.0), (2, 5.0), (3, 10.0), (4, 25.0), (5, 0.0),
            ],
            "step_left": [
                (0, 25.0), (1, 60.0), (2, -10.0), (3, 5.0), (4, 30.0), (5, 0.0),
            ],
            "crouch": [
                (0, 0.0), (1, 70.0), (2, 10.0), (3, 0.0), (4, 70.0), (5, 10.0),
            ],
            "lunge_left": [
                (0, 25.0), (1, 90.0), (2, -15.0), (3, -15.0), (4, 40.0), (5, 10.0),
            ],
        },
        "sequences": [
            {
                "name": "walk_step",
                "steps": [
                    ("pose", "weight_left", 500, 100, 62.5, "ease_out"),
                    ("pose", "step_right", 600, 150, 62.5, "ease_out"),
                    ("pose", "weight_right", 500, 100, 41.7, "ease_out"),
                    ("pose", "step_left", 600, 150, 62.5, "ease_out"),
                ],
                "repeat_count": 2,
                "repeat_forever": 0,
                "groups": [
                    {"name": "step_pair", "step_positions": [0, 1, 2, 3],
                     "repeat_count": 2, "repeat_forever": 0},
                ],
            },
            {
                "name": "crouch_lunge",
                "steps": [
                    ("pose", "crouch", 900, 250, 33.3, "ease_in_out"),
                    ("pose", "lunge_left", 700, 200, 62.5, "ease_out"),
                    ("pose", "stand", 800, 200, 50.0, "ease_out"),
                ],
                "repeat_count": 1,
                "repeat_forever": 0,
                "groups": [],
            },
        ],
    },
    {
        "name": "GimbalCam",
        "description": (
            "A minimal two-servo pan/tilt camera gimbal. Demonstrates that the "
            "tool serves even the simplest rigs, with smooth eased scanning and "
            "a forever-loop patrol."
        ),
        "servos": [
            ("pan", 2, -170.0, 170.0, 0.0, 500, 2500),
            ("tilt", 3, -45.0, 45.0, 0.0, 500, 2500),
        ],
        "sim_config": {
            "kind": "gimbal",
            "anchor": {"x": 0, "y": 0, "z": 60},
            "joints": [
                {"servo_name": "pan", "segment_len": 6},
                {"servo_name": "tilt", "segment_len": 10},
            ],
            "gripper": None,
            "environment": {
                "target": {"x": 100, "z": 60},
            },
        },
        "poses": {
            "home": [(0, 0.0), (1, 0.0)],
            "look_up": [(0, 0.0), (1, -40.0)],
            "scan_left": [(0, -150.0), (1, 0.0)],
            "scan_right": [(0, 150.0), (1, 0.0)],
            "look_down": [(0, 0.0), (1, 40.0)],
        },
        "sequences": [
            {
                "name": "patrol_scan",
                "steps": [
                    ("pose", "scan_left", 1000, 150, 150.0, "ease_in_out"),
                    ("pose", "scan_right", 2000, 150, 150.0, "ease_in_out"),
                    ("pose", "scan_left", 2000, 150, 150.0, "ease_in_out"),
                ],
                "repeat_count": None,
                "repeat_forever": 1,
                "groups": [],
            },
            {
                "name": "look_around",
                "steps": [
                    ("pose", "look_up", 800, 150, 50.0, "ease_out"),
                    ("pose", "home", 600, 150, 66.7, "ease_in"),
                    ("pose", "look_down", 800, 150, 50.0, "ease_out"),
                    ("pose", "home", 600, 150, 66.7, "ease_in"),
                ],
                "repeat_count": 2,
                "repeat_forever": 0,
                "groups": [],
            },
        ],
    },
]


def _seed_demo_robot(conn: sqlite3.Connection, demo: dict) -> int:
    """Insert one full demo robot (servos, sim_config, poses, sequences)."""
    robot_id = _insert_robot(conn, demo["name"], demo["description"],
                             demo["sim_config"])
    servo_ids = [_insert_servo(conn, robot_id, s) for s in demo["servos"]]

    pose_ids = {}
    for pose_name, targets in demo["poses"].items():
        pose_ids[pose_name] = _insert_pose(
            conn, robot_id, pose_name,
            [(servo_ids[i], ang) for i, ang in targets],
        )

    for seq in demo["sequences"]:
        steps = []
        for step in seq["steps"]:
            if step[0] == "pose":
                steps.append(("pose", step[1], step[2], step[3], step[4], step[5]))
            else:
                steps.append(("servo", step[1], step[2], step[3], step[4],
                              step[5], step[6]))
        seq_id = _insert_sequence(
            conn, robot_id, seq["name"], steps,
            repeat_count=seq.get("repeat_count"),
            repeat_forever=seq.get("repeat_forever", 0),
        )
        for group in seq.get("groups", []):
            members = [r["id"] for r in conn.execute(
                "SELECT id FROM sequence_steps WHERE sequence_id = ? "
                "ORDER BY position, id",
                (seq_id,),
            ).fetchall()]
            positions = group["step_positions"]
            member_ids = [members[p] for p in positions]
            _insert_group(conn, seq_id, group["name"], group["repeat_count"],
                          group["repeat_forever"], member_ids=member_ids)

    return robot_id

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

    # Additional demo robots (full metadata; see _DEMO_ROBOTS).
    for demo in _DEMO_ROBOTS:
        _seed_demo_robot(conn, demo)

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
                  repeat_count, repeat_forever, member_ids=None) -> int:
    if member_ids is None:
        member_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM sequence_steps WHERE sequence_id = ? "
            "ORDER BY position, id",
            (seq_id,),
        ).fetchall()]
    cur = conn.execute(
        "INSERT INTO step_groups (sequence_id, name, repeat_count, "
        "repeat_forever) VALUES (?, ?, ?, ?)",
        (seq_id, name, repeat_count, repeat_forever),
    )
    group_id = cur.lastrowid
    for sid in member_ids:
        conn.execute(
            "INSERT INTO step_group_members (step_id, group_id) VALUES (?, ?)",
            (sid, group_id),
        )
    return group_id