"""Export JSON document builder (brief 05; architecture §5.5).

The export is self-contained: pose references are resolved to concrete servo
targets ({servo_id, servo_name, angle, pulse_us}) so a downstream consumer
never needs the app. Pulse widths use the canonical conversion (pulse.py).
"""
from __future__ import annotations

import datetime as _dt
import re
import sqlite3

from . import pulse, validation as v

SCHEMA_VERSION = 1
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
            "targets": targets,
        })
    return steps


def build_export(conn: sqlite3.Connection, seq_id: int | None = None) -> dict:
    """Build the export document for all sequences (seq_id=None) or one."""
    robot = conn.execute(
        "SELECT id, name FROM robots ORDER BY id LIMIT 1"
    ).fetchone()
    if robot is None:
        v.http_error(404, "NOT_FOUND", "No robot configured to export")
    robot_id = robot["id"]
    servos = _servo_map(conn, robot_id)

    if seq_id is None:
        seq_rows = conn.execute(
            "SELECT id, name FROM sequences ORDER BY id"
        ).fetchall()
    else:
        seq_row = conn.execute(
            "SELECT id, name FROM sequences WHERE id = ?", (seq_id,)
        ).fetchone()
        if seq_row is None:
            v.http_error(404, "NOT_FOUND", f"Sequence {seq_id} not found")
        seq_rows = [seq_row]

    sequences = [
        {"id": s["id"], "name": s["name"],
         "steps": _sequence_steps(conn, s["id"], servos)}
        for s in seq_rows
    ]

    return {
        "schema_version": SCHEMA_VERSION,
        "format": FORMAT,
        "exported_at": _exported_at(),
        "robot": {**_robot_row_to_dict(robot), "servos": [_servo_to_dict(s) for s in servos.values()]},
        "sequences": sequences,
    }


def _robot_row_to_dict(row) -> dict:
    return {"id": row["id"], "name": row["name"]}


def filename_for(robot_name: str, seq_name: str | None = None) -> str:
    """Build a safe download filename, e.g. SampleBot.json / SampleBot-wave.json."""
    def safe(s: str) -> str:
        s = re.sub(r"[^A-Za-z0-9._-]+", "-", s).strip(".-")
        return s or "robot"

    base = safe(robot_name)
    if seq_name is not None:
        base = f"{base}-{safe(seq_name)}"
    return f"{base}.json"