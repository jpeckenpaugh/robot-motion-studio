"""Robots + servos CRUD (brief 01; architecture §5.1).

The POC has a single current robot (id=1). The robots table is kept for a
future multi-robot model; all endpoints here are robot-scoped.
"""
import sqlite3
from typing import List

from fastapi import APIRouter, Depends, Request, status

from .. import validation as v
from ..schemas import RobotRename, ServoInput

router = APIRouter(tags=["robots"])


def get_db(request: Request) -> sqlite3.Connection:
    return request.state.db


def _servo_to_dict(row: sqlite3.Row) -> dict:
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


def _robot_to_dict(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "name": row["name"]}


@router.get("/robots", response_model=List[dict])
def list_robots(conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute("SELECT id, name FROM robots ORDER BY id").fetchall()
    return [_robot_to_dict(r) for r in rows]


@router.get("/robots/{robot_id}", response_model=dict)
def get_robot(robot_id: int, conn: sqlite3.Connection = Depends(get_db)):
    robot = v.fetch_robot_or_404(conn, robot_id)
    servos = conn.execute(
        "SELECT * FROM servos WHERE robot_id = ? ORDER BY id", (robot_id,)
    ).fetchall()
    return {**_robot_to_dict(robot), "servos": [_servo_to_dict(s) for s in servos]}


@router.patch("/robots/{robot_id}", response_model=dict)
def rename_robot(robot_id: int, body: RobotRename,
                 conn: sqlite3.Connection = Depends(get_db)):
    name = v.require_name(body.name)
    v.fetch_robot_or_404(conn, robot_id)
    conn.execute("UPDATE robots SET name = ? WHERE id = ?", (name, robot_id))
    conn.commit()
    row = conn.execute("SELECT id, name FROM robots WHERE id = ?", (robot_id,)).fetchone()
    return _robot_to_dict(row)


@router.get("/robots/{robot_id}/servos", response_model=List[dict])
def list_servos(robot_id: int, conn: sqlite3.Connection = Depends(get_db)):
    v.fetch_robot_or_404(conn, robot_id)
    rows = conn.execute(
        "SELECT * FROM servos WHERE robot_id = ? ORDER BY id", (robot_id,)
    ).fetchall()
    return [_servo_to_dict(r) for r in rows]


@router.post("/robots/{robot_id}/servos", response_model=dict,
             status_code=status.HTTP_201_CREATED)
def create_servo(robot_id: int, body: ServoInput,
                 conn: sqlite3.Connection = Depends(get_db)):
    v.fetch_robot_or_404(conn, robot_id)
    v.validate_servo_values(body.name, body.pwm_pin, body.angle_min,
                            body.angle_max, body.neutral_angle,
                            body.pulse_min_us, body.pulse_max_us)
    v.ensure_servo_name_available(conn, robot_id, body.name)
    v.ensure_servo_pin_available(conn, robot_id, body.pwm_pin)
    cur = conn.execute(
        """INSERT INTO servos
           (robot_id, name, pwm_pin, angle_min, angle_max, neutral_angle,
            pulse_min_us, pulse_max_us)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (robot_id, body.name, body.pwm_pin, body.angle_min, body.angle_max,
         body.neutral_angle, body.pulse_min_us, body.pulse_max_us),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM servos WHERE id = ?", (cur.lastrowid,)
    ).fetchone()
    return _servo_to_dict(row)


@router.get("/robots/{robot_id}/servos/{servo_id}", response_model=dict)
def get_servo(robot_id: int, servo_id: int,
              conn: sqlite3.Connection = Depends(get_db)):
    row = v.fetch_servo_or_404(conn, robot_id, servo_id)
    return _servo_to_dict(row)


@router.put("/robots/{robot_id}/servos/{servo_id}", response_model=dict)
def update_servo(robot_id: int, servo_id: int, body: ServoInput,
                 conn: sqlite3.Connection = Depends(get_db)):
    v.fetch_servo_or_404(conn, robot_id, servo_id)
    v.validate_servo_values(body.name, body.pwm_pin, body.angle_min,
                            body.angle_max, body.neutral_angle,
                            body.pulse_min_us, body.pulse_max_us)
    v.ensure_servo_name_available(conn, robot_id, body.name, exclude_id=servo_id)
    v.ensure_servo_pin_available(conn, robot_id, body.pwm_pin, exclude_id=servo_id)
    conn.execute(
        """UPDATE servos SET name = ?, pwm_pin = ?, angle_min = ?, angle_max = ?,
           neutral_angle = ?, pulse_min_us = ?, pulse_max_us = ?
           WHERE id = ?""",
        (body.name, body.pwm_pin, body.angle_min, body.angle_max,
         body.neutral_angle, body.pulse_min_us, body.pulse_max_us, servo_id),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM servos WHERE id = ?", (servo_id,)
    ).fetchone()
    return _servo_to_dict(row)


@router.delete("/robots/{robot_id}/servos/{servo_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def delete_servo(robot_id: int, servo_id: int,
                 conn: sqlite3.Connection = Depends(get_db)):
    v.fetch_servo_or_404(conn, robot_id, servo_id)
    _guard_servo_delete(conn, servo_id)
    conn.execute("DELETE FROM servos WHERE id = ?", (servo_id,))
    conn.commit()


def _guard_servo_delete(conn: sqlite3.Connection, servo_id: int) -> None:
    """Block deleting a servo referenced by a pose target or a step (409)."""
    pose_ref = conn.execute(
        "SELECT 1 FROM pose_targets WHERE servo_id = ? LIMIT 1", (servo_id,)
    ).fetchone()
    if pose_ref is not None:
        v.http_error(409, "SERVO_REFERENCED",
                     f"Servo {servo_id} is referenced by one or more pose "
                     f"targets; remove or change those references first.")
    step_ref = conn.execute(
        "SELECT 1 FROM sequence_steps WHERE servo_id = ? LIMIT 1", (servo_id,)
    ).fetchone()
    if step_ref is not None:
        v.http_error(409, "SERVO_REFERENCED",
                     f"Servo {servo_id} is referenced by one or more sequence "
                     f"steps; remove or change those references first.")