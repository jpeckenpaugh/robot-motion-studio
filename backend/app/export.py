"""Export JSON document builder (brief 05; architecture §5.5, §9.3.7).

The export is self-contained: pose references are resolved to concrete servo
targets ({servo_id, servo_name, angle, pulse_us}) so a downstream consumer
never needs the app. Pulse widths use the canonical conversion (pulse.py).

Enhancement pass (schema_version 2): export is scoped to the currently selected
robot (optional ?robot_id= override) and additively includes robot description,
per-step `easing` / `speed_deg_per_s`, sequence repeat fields, and step groups
expressed by 0-based step order.
"""
from __future__ import annotations

import datetime as _dt
import re
import sqlite3

from . import pulse, validation as v

SCHEMA_VERSION = 2
FORMAT = "robot-servo-sequence"


def _servo_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "pwm_pin": row["pwm_pin"],
        "angle_min": row["angle_min"],
        "angle_max": row["angle_max"],
        "neutral_angle": row["neutral_angle"],
        "pulse_min_us": row["pulse_min_us"],
        "pulse_max_us": row["pulse_max_us"],
    }


def _exported_at() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _servo_map(conn: sqlite3.Connection, robot_id: int) -> dict:
    rows = conn.execute(
        "SELECT * FROM servos WHERE robot_id = ?", (robot_id,)
    ).fetchall()
    return {r["id"]: r for r in rows}


def _target(servo_row, angle: float) -> dict:
    return {
        "servo_id": servo_row["id"],
        "servo_name": servo_row["name"],
        "angle": angle,
        "pulse_us": pulse.angle_to_pulse_us(
            angle, servo_row["angle_min"], servo_row["angle_max"],
            servo_row["pulse_min_us"], servo_row["pulse_max_us"],
        ),
    }


def _sequence_steps(conn: sqlite3.Connection, seq_id: int, servos: dict) -> list:
    rows = conn.execute(
        "SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id",
        (seq_id,),
    ).fetchall()
    steps = []
    for order, row in enumerate(rows):
        if row["kind"] == "pose":
            target_rows = conn.execute(
                "SELECT servo_id, angle FROM pose_targets WHERE pose_id = ? "
                "ORDER BY servo_id",
                (row["pose_id"],),
            ).fetchall()
            targets = [
                _target(servos[t["servo_id"]], t["angle"])
                for t in target_rows if t["servo_id"] in servos
            ]
        else:  # kind == "servo"
            targets = [_target(servos[row["servo_id"]], row["angle"])]
        steps.append({
            "order": order,
            "duration_ms": row["duration_ms"],
            "hold_ms": row["hold_ms"],
            "easing": row["easing"],
            "speed_deg_per_s": row["speed"],
            "targets": targets,
        })
    return steps


def _sequence_groups(conn: sqlite3.Connection, seq_id: int) -> list:
    groups = []
    for g in conn.execute(
        "SELECT * FROM step_groups WHERE sequence_id = ? ORDER BY id",
        (seq_id,),
    ).fetchall():
        orders = [r["position"] for r in conn.execute(
            """SELECT ss.position FROM step_group_members sgm
               JOIN sequence_steps ss ON ss.id = sgm.step_id
               WHERE sgm.group_id = ? ORDER BY ss.position""",
            (g["id"],),
        ).fetchall()]
        groups.append({
            "name": g["name"],
            "step_orders": orders,
            "repeat_count": g["repeat_count"],
            "repeat_forever": bool(g["repeat_forever"]),
        })
    return groups


def build_export(conn: sqlite3.Connection, robot_id: int | None = None,
                 seq_id: int | None = None) -> dict:
    """Build the export document for one robot (all sequences by default, or a
    single sequence via seq_id). Scoped to the selected robot unless an
    explicit robot_id is given (architecture §9.3.7)."""
    rid = v.resolve_robot_id(conn, robot_id)
    robot = conn.execute(
        "SELECT id, name, description FROM robots WHERE id = ?", (rid,)
    ).fetchone()
    if robot is None:
        v.http_error(404, "NOT_FOUND", f"Robot {rid} not found to export")
    servos = _servo_map(conn, rid)

    if seq_id is None:
        seq_rows = conn.execute(
            "SELECT id, name FROM sequences WHERE robot_id = ? ORDER BY id",
            (rid,),
        ).fetchall()
    else:
        seq_row = conn.execute(
            "SELECT id, name FROM sequences WHERE id = ? AND robot_id = ?",
            (seq_id, rid),
        ).fetchone()
        if seq_row is None:
            v.http_error(404, "NOT_FOUND",
                         f"Sequence {seq_id} not found on this robot")
        seq_rows = [seq_row]

    sequences = []
    for s in seq_rows:
        seq_full = conn.execute(
            "SELECT * FROM sequences WHERE id = ?", (s["id"],)
        ).fetchone()
        sequences.append({
            "id": s["id"],
            "name": s["name"],
            "repeat_count": seq_full["repeat_count"],
            "repeat_forever": bool(seq_full["repeat_forever"]),
            "groups": _sequence_groups(conn, s["id"]),
            "steps": _sequence_steps(conn, s["id"], servos),
        })

    return {
        "schema_version": SCHEMA_VERSION,
        "format": FORMAT,
        "exported_at": _exported_at(),
        "robot": {
            "id": robot["id"],
            "name": robot["name"],
            "description": robot["description"],
            "servos": [_servo_to_dict(s) for s in servos.values()],
        },
        "sequences": sequences,
    }


def filename_for(robot_name: str, seq_name: str | None = None) -> str:
    """Build a safe download filename, e.g. SampleBot.json / SampleBot-wave.json."""
    def safe(s: str) -> str:
        s = re.sub(r"[^A-Za-z0-9._-]+", "-", s).strip(".-")
        return s or "robot"

    base = safe(robot_name)
    if seq_name is not None:
        base = f"{base}-{safe(seq_name)}"
    return f"{base}.json"