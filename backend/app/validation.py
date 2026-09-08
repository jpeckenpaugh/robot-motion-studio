"""Shared validation rules and error helpers (architecture §3, §5, §9).

Error responses use the standard shape:
    { "detail": "human-readable message", "code": "MACHINE_CODE" }

Error semantics: 400 malformed; 404 not found; 409 reference conflict
(deletion blocked / uniqueness clash); 422 validation failure.

Stable `code` vocabulary (recorded in the summary):
    VALIDATION           - a request value violates a business rule (422)
    NOT_FOUND            - referenced resource does not exist (404)
    SERVO_REFERENCED     - deleting a servo still used by a pose/step (409)
    POSE_REFERENCED      - deleting a pose still used by a step (409)
    CONFLICT             - other conflict, incl. name/pin uniqueness clash (409)
    SPEED_DURATION_MISMATCH - step speed and duration disagree (422, §9.2.2)
    GROUP_SPLIT          - a step mutation would split a step group (422, §9.2.4)
"""
from __future__ import annotations

import sqlite3

from fastapi import HTTPException

CODE_DETAIL_KEY = "detail"
CODE_KEY = "code"

# Canonical easing set (architecture §9.2.3).
EASING_VALUES = ("linear", "ease_in", "ease_out", "ease_in_out")
DEFAULT_EASING = "linear"


def conflict(status_code: int, code: str, message: str) -> HTTPException:
    """Build an HTTPException carrying both a message and a stable code."""
    exc = HTTPException(status_code=status_code, detail=message)
    # FastAPI serializes `detail`; we attach the code so it appears in the body.
    exc.detail = message
    exc.__dict__["code"] = code
    return exc


def http_error(status_code: int, code: str, message: str):
    """Helper to raise a coded error inside the routers."""
    raise conflict(status_code, code, message)


def robot_exists(conn: sqlite3.Connection, robot_id: int) -> bool:
    row = conn.execute("SELECT 1 FROM robots WHERE id = ?", (robot_id,)).fetchone()
    return row is not None


def fetch_robot_or_404(conn: sqlite3.Connection, robot_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT id, name FROM robots WHERE id = ?", (robot_id,)).fetchone()
    if row is None:
        http_error(404, "NOT_FOUND", f"Robot {robot_id} not found")
    return row


def fetch_servo_or_404(conn, robot_id: int, servo_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM servos WHERE id = ? AND robot_id = ?", (servo_id, robot_id)
    ).fetchone()
    if row is None:
        http_error(404, "NOT_FOUND", f"Servo {servo_id} not found on robot {robot_id}")
    return row


def servo_belongs_to_robot(conn, servo_id: int, robot_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM servos WHERE id = ? AND robot_id = ?", (servo_id, robot_id)
    ).fetchone()
    return row is not None


def validate_servo_values(name: str, pwm_pin: int, angle_min: float,
                          angle_max: float, neutral_angle: float,
                          pulse_min_us: int, pulse_max_us: int) -> None:
    """Validate servo scalar ranges; raise 422 VALIDATION on failure."""
    if not name or not name.strip():
        http_error(422, "VALIDATION", "Servo name must not be empty")
    if angle_min >= angle_max:
        http_error(422, "VALIDATION",
                   f"angle_min ({angle_min}) must be less than angle_max ({angle_max})")
    if not (angle_min <= neutral_angle <= angle_max):
        http_error(422, "VALIDATION",
                   f"neutral_angle ({neutral_angle}) must lie within "
                   f"[angle_min, angle_max] = [{angle_min}, {angle_max}]")
    if pulse_min_us <= 0 or pulse_max_us <= 0:
        http_error(422, "VALIDATION", "Pulse widths must be greater than zero")
    if pulse_min_us >= pulse_max_us:
        http_error(422, "VALIDATION",
                   f"pulse_min_us ({pulse_min_us}) must be less than pulse_max_us "
                   f"({pulse_max_us})")


def ensure_servo_name_available(conn, robot_id: int, name: str,
                                exclude_id: int | None = None) -> None:
    q = "SELECT 1 FROM servos WHERE robot_id = ? AND name = ?"
    args = [robot_id, name]
    if exclude_id is not None:
        q += " AND id != ?"
        args.append(exclude_id)
    if conn.execute(q, args).fetchone() is not None:
        http_error(409, "CONFLICT", f"A servo named '{name}' already exists on this robot")


def ensure_servo_pin_available(conn, robot_id: int, pwm_pin: int,
                               exclude_id: int | None = None) -> None:
    q = "SELECT 1 FROM servos WHERE robot_id = ? AND pwm_pin = ?"
    args = [robot_id, pwm_pin]
    if exclude_id is not None:
        q += " AND id != ?"
        args.append(exclude_id)
    if conn.execute(q, args).fetchone() is not None:
        http_error(409, "CONFLICT",
                   f"PWM pin {pwm_pin} is already used by another servo on this robot")


def ensure_pose_name_available(conn, robot_id: int, name: str,
                               exclude_id: int | None = None) -> None:
    q = "SELECT 1 FROM poses WHERE robot_id = ? AND name = ?"
    args = [robot_id, name]
    if exclude_id is not None:
        q += " AND id != ?"
        args.append(exclude_id)
    if conn.execute(q, args).fetchone() is not None:
        http_error(409, "CONFLICT", f"A pose named '{name}' already exists on this robot")


def ensure_sequence_name_available(conn, robot_id: int, name: str,
                                   exclude_id: int | None = None) -> None:
    q = "SELECT 1 FROM sequences WHERE robot_id = ? AND name = ?"
    args = [robot_id, name]
    if exclude_id is not None:
        q += " AND id != ?"
        args.append(exclude_id)
    if conn.execute(q, args).fetchone() is not None:
        http_error(409, "CONFLICT", f"A sequence named '{name}' already exists on this robot")


def current_robot_id(conn: sqlite3.Connection) -> int:
    """Return the currently selected robot id (persisted app_state selection).

    Falls back to the lowest robot id if app_state has no selection (e.g. an
    upgraded v0.1 DB before first use). Raises 404 when no robot exists.
    """
    row = conn.execute(
        "SELECT current_robot_id FROM app_state WHERE id = 1"
    ).fetchone()
    if row is not None and row["current_robot_id"] is not None:
        if robot_exists(conn, row["current_robot_id"]):
            return row["current_robot_id"]
    low = conn.execute("SELECT MIN(id) AS m FROM robots").fetchone()
    if low is None or low["m"] is None:
        http_error(404, "NOT_FOUND", "No robot configured yet")
    return low["m"]


def resolve_robot_id(conn: sqlite3.Connection, robot_id: int | None) -> int:
    """Resolve an optional ?robot_id= to an explicit robot, defaulting to the
    current selection. 404 when the explicit id is unknown."""
    if robot_id is not None:
        if not robot_exists(conn, robot_id):
            http_error(404, "NOT_FOUND", f"Robot {robot_id} not found")
        return robot_id
    return current_robot_id(conn)


def require_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        http_error(422, "VALIDATION", "name must not be empty")
    return name


def validate_description(description: str) -> str:
    """Descriptions may be any string (including empty); normalize to a string."""
    return description if description is not None else ""


def validate_easing(easing: str) -> str:
    if easing not in EASING_VALUES:
        http_error(
            422, "VALIDATION",
            f"easing must be one of {', '.join(EASING_VALUES)}",
        )
    return easing


def validate_repeat(repeat_count: int | None, repeat_forever: bool | None) -> None:
    """Validate sequence/group repeat fields (§9.2.4): mutually exclusive and
    repeat_count >= 1 when present."""
    if repeat_count is not None and repeat_count < 1:
        http_error(422, "VALIDATION",
                   "repeat_count must be null (run once) or >= 1")
    if repeat_forever and repeat_count is not None:
        http_error(422, "VALIDATION",
                   "repeat_count and repeat_forever are mutually exclusive")


def validate_group_contiguity(conn: sqlite3.Connection, seq_id: int) -> None:
    """Re-validate that every group of a sequence is still a contiguous run of
    steps. Called after every step mutation (add/update/delete/reorder/
    duplicate); a mutation that splits a group is rejected (422 GROUP_SPLIT)."""
    groups = conn.execute(
        "SELECT id FROM step_groups WHERE sequence_id = ?", (seq_id,)
    ).fetchall()
    if not groups:
        return
    rows = conn.execute(
        """SELECT sgm.group_id AS group_id, ss.position AS position
           FROM step_group_members sgm
           JOIN sequence_steps ss ON ss.id = sgm.step_id
           WHERE ss.sequence_id = ?
           ORDER BY sgm.group_id, ss.position""",
        (seq_id,),
    ).fetchall()
    by_group: dict = {}
    for r in rows:
        by_group.setdefault(r["group_id"], []).append(r["position"])
    for gid, positions in by_group.items():
        positions = sorted(positions)
        expected = list(range(positions[0], positions[0] + len(positions)))
        if positions != expected:
            http_error(
                422, "GROUP_SPLIT",
                "This change would split a step group; move or remove the "
                "group first.",
            )
