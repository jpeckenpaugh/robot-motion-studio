"""Robots + servos CRUD and current-robot selection (brief 01; §5.1, §9.3.1).

The v0.1 single current robot is replaced by a persisted selection
(app_state.current_robot_id). A robot is a plain, user-managed record in the
collection; the door-rig seed is one such record. Servo endpoints are
unchanged (v0.1) and robot-scoped.
"""
from __future__ import annotations

import json
import sqlite3
from typing import List

from fastapi import APIRouter, Depends, Request, status

from .. import validation as v
from ..schemas import CurrentRobotSet, RobotCreate, RobotUpdate, ServoInput

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


def _robot_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
    }


def _sim_config_to_obj(raw) -> dict | None:
    """Return the stored sim_config as a parsed JSON object (or None). The
    backend stores/validates well-formed JSON only; it never interprets it."""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _current_id(conn: sqlite3.Connection):
    row = conn.execute(
        "SELECT current_robot_id FROM app_state WHERE id = 1"
    ).fetchone()
    return row["current_robot_id"] if row is not None else None


def _fetch_robot(conn: sqlite3.Connection, robot_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT id, name, description FROM robots WHERE id = ?", (robot_id,)
    ).fetchone()
    if row is None:
        v.http_error(404, "NOT_FOUND", f"Robot {robot_id} not found")
    return row


@router.get("/robots", response_model=List[dict])
def list_robots(conn: sqlite3.Connection = Depends(get_db)):
    current = _current_id(conn)
    rows = conn.execute(
        """SELECT r.id, r.name, r.description,
                  (SELECT COUNT(*) FROM servos s WHERE s.robot_id = r.id)
                      AS servo_count
           FROM robots r ORDER BY r.id"""
    ).fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "description": r["description"],
            "servo_count": r["servo_count"],
            "current": (r["id"] == current),
        }
        for r in rows
    ]


@router.post("/robots", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_robot(body: RobotCreate, conn: sqlite3.Connection = Depends(get_db)):
    name = v.require_name(body.name)
    description = v.validate_description(body.description)
    cur = conn.execute(
        "INSERT INTO robots (name, description) VALUES (?, ?)",
        (name, description),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id, name, description FROM robots WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return _robot_row_to_dict(row)


@router.get("/robots/{robot_id}", response_model=dict)
def get_robot(robot_id: int, conn: sqlite3.Connection = Depends(get_db)):
    robot = _fetch_robot(conn, robot_id)
    servos = conn.execute(
        "SELECT * FROM servos WHERE robot_id = ? ORDER BY id", (robot_id,)
    ).fetchall()
    row = conn.execute(
        "SELECT sim_config FROM robots WHERE id = ?", (robot_id,)
    ).fetchone()
    return {
        **_robot_row_to_dict(robot),
        "sim_config": _sim_config_to_obj(row["sim_config"]),
        "servos": [_servo_to_dict(s) for s in servos],
    }


@router.patch("/robots/{robot_id}", response_model=dict)
def update_robot(robot_id: int, body: RobotUpdate,
                 conn: sqlite3.Connection = Depends(get_db)):
    _fetch_robot(conn, robot_id)
    sets = []
    args = []
    if body.name is not None:
        sets.append("name = ?")
        args.append(v.require_name(body.name))
    if body.description is not None:
        sets.append("description = ?")
        args.append(v.validate_description(body.description))
    args.append(robot_id)
    conn.execute(f"UPDATE robots SET {', '.join(sets)} WHERE id = ?", args)
    conn.commit()
    row = _fetch_robot(conn, robot_id)
    return _robot_row_to_dict(row)


@router.delete("/robots/{robot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_robot(robot_id: int, conn: sqlite3.Connection = Depends(get_db)):
    _fetch_robot(conn, robot_id)
    # FK ON DELETE CASCADE removes the robot's poses, sequences, steps, and
    # step groups; app_state.current_robot_id becomes NULL (ON DELETE SET NULL).
    conn.execute("DELETE FROM robots WHERE id = ?", (robot_id,))
    conn.commit()


@router.get("/state/current-robot", response_model=dict)
def get_current_robot(conn: sqlite3.Connection = Depends(get_db)):
    current = _current_id(conn)
    robot = None
    if current is not None:
        row = conn.execute(
            "SELECT id, name, description FROM robots WHERE id = ?", (current,)
        ).fetchone()
        if row is not None:
            robot = _robot_row_to_dict(row)
    return {"robot_id": current, "robot": robot}


@router.put("/state/current-robot", response_model=dict)
def set_current_robot(body: CurrentRobotSet,
                      conn: sqlite3.Connection = Depends(get_db)):
    v.fetch_robot_or_404(conn, body.robot_id)
    conn.execute(
        "UPDATE app_state SET current_robot_id = ? WHERE id = 1",
        (body.robot_id,),
    )
    conn.commit()
    return {"robot_id": body.robot_id}


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