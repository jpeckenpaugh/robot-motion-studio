"""Sequence preview resolution (brief 04; architecture §5.4).

The preview is derived on every request from the current saved state of the
sequence, its poses, and the robot configuration, so it never shows stale data.
It is read-only: there is no write route for it.
"""
import sqlite3

from . import pulse, validation as v


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


def build_preview(conn: sqlite3.Connection, seq_id: int) -> dict:
    """Build the preview document for a sequence (raises 404 if absent)."""
    seq = conn.execute("SELECT * FROM sequences WHERE id = ?", (seq_id,)).fetchone()
    if seq is None:
        v.http_error(404, "NOT_FOUND", f"Sequence {seq_id} not found")
    robot_id = seq["robot_id"]
    servos = _servo_map(conn, robot_id)

    steps_rows = conn.execute(
        "SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id",
        (seq_id,),
    ).fetchall()

    steps = []
    for order, row in enumerate(steps_rows):
        if row["kind"] == "pose":
            pose = conn.execute(
                "SELECT id, name FROM poses WHERE id = ?", (row["pose_id"],)
            ).fetchone()
            pose_name = pose["name"] if pose is not None else None
            target_rows = conn.execute(
                "SELECT servo_id, angle FROM pose_targets WHERE pose_id = ? "
                "ORDER BY servo_id",
                (row["pose_id"],),
            ).fetchall()
            targets = [
                _target(servos[t["servo_id"]], t["angle"])
                for t in target_rows if t["servo_id"] in servos
            ]
            steps.append({
                "order": order,
                "kind": "pose",
                "pose_id": row["pose_id"],
                "pose_name": pose_name,
                "duration_ms": row["duration_ms"],
                "hold_ms": row["hold_ms"],
                "targets": targets,
            })
        else:  # kind == "servo"
            servo = servos.get(row["servo_id"])
            if servo is None:
                v.http_error(409, "CONFLICT",
                             f"Step {row['id']} references servo "
                             f"{row['servo_id']} which no longer exists")
            target = _target(servo, row["angle"])
            steps.append({
                "order": order,
                "kind": "servo",
                "servo_id": row["servo_id"],
                "servo_name": servo["name"],
                "angle": row["angle"],
                "pulse_us": target["pulse_us"],
                "duration_ms": row["duration_ms"],
                "hold_ms": row["hold_ms"],
                "targets": [target],
            })

    return {
        "sequence_id": seq_id,
        "sequence_name": seq["name"],
        "steps": steps,
    }