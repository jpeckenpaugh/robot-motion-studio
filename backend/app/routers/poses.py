"""Poses + pose targets CRUD (brief 02; architecture §5.2, §9.3.2).

Poses are scoped to a robot: list/create operate on the currently selected
robot by default and accept an optional ?robot_id= for explicit scoping.
Targets reference servos by id; every target must exist on the pose's robot
and stay within that servo's angle limits (cross-robot references rejected).
"""
from __future__ import annotations

import sqlite3
from typing import List, Optional

from fastapi import APIRouter, Depends, Request, status

from .. import validation as v
from ..schemas import PoseInput

router = APIRouter(tags=["poses"])


def get_db(request: Request) -> sqlite3.Connection:
    return request.state.db


def _servo_limits(conn: sqlite3.Connection, robot_id: int):
    rows = conn.execute(
        "SELECT id, angle_min, angle_max FROM servos WHERE robot_id = ?",
        (robot_id,),
    ).fetchall()
    return {r["id"]: (r["angle_min"], r["angle_max"]) for r in rows}


def _pose_to_dict(conn: sqlite3.Connection, pose_id: int) -> dict:
    row = conn.execute("SELECT id, name FROM poses WHERE id = ?", (pose_id,)).fetchone()
    targets = conn.execute(
        """SELECT servo_id, angle FROM pose_targets
           WHERE pose_id = ? ORDER BY servo_id""",
        (pose_id,),
    ).fetchall()
    return {
        "id": row["id"],
        "name": row["name"],
        "targets": [{"servo_id": t["servo_id"], "angle": t["angle"]} for t in targets],
    }


def _validate_targets(conn: sqlite3.Connection, robot_id: int, pose_id: int | None,
                      body: PoseInput) -> None:
    """Validate pose name uniqueness and every target's servo/angle."""
    v.require_name(body.name)
    v.ensure_pose_name_available(conn, robot_id, body.name, exclude_id=pose_id)
    if not body.targets:
        v.http_error(422, "VALIDATION", "A pose must have at least one target")
    limits = _servo_limits(conn, robot_id)
    seen = set()
    for t in body.targets:
        if t.servo_id not in limits:
            v.http_error(422, "VALIDATION",
                         f"servo_id {t.servo_id} does not exist on this robot")
        if t.servo_id in seen:
            v.http_error(422, "VALIDATION",
                         f"Duplicate servo {t.servo_id} in pose targets")
        seen.add(t.servo_id)
        amin, amax = limits[t.servo_id]
        if not (amin <= t.angle <= amax):
            v.http_error(422, "VALIDATION",
                         f"Angle {t.angle} for servo {t.servo_id} is outside "
                         f"[{amin}, {amax}]")


@router.get("/poses", response_model=List[dict])
def list_poses(robot_id: Optional[int] = None,
               conn: sqlite3.Connection = Depends(get_db)):
    rid = v.resolve_robot_id(conn, robot_id)
    rows = conn.execute(
        "SELECT id FROM poses WHERE robot_id = ? ORDER BY id", (rid,)
    ).fetchall()
    return [_pose_to_dict(conn, r["id"]) for r in rows]


@router.post("/poses", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_pose(body: PoseInput, robot_id: Optional[int] = None,
                conn: sqlite3.Connection = Depends(get_db)):
    rid = v.resolve_robot_id(conn, robot_id)
    _validate_targets(conn, rid, None, body)
    cur = conn.execute(
        "INSERT INTO poses (robot_id, name) VALUES (?, ?)", (rid, body.name)
    )
    pose_id = cur.lastrowid
    for t in body.targets:
        conn.execute(
            "INSERT INTO pose_targets (pose_id, servo_id, angle) VALUES (?, ?, ?)",
            (pose_id, t.servo_id, t.angle),
        )
    conn.commit()
    return _pose_to_dict(conn, pose_id)


@router.get("/poses/{pose_id}", response_model=dict)
def get_pose(pose_id: int, conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute("SELECT id FROM poses WHERE id = ?", (pose_id,)).fetchone()
    if row is None:
        v.http_error(404, "NOT_FOUND", f"Pose {pose_id} not found")
    return _pose_to_dict(conn, pose_id)


@router.put("/poses/{pose_id}", response_model=dict)
def update_pose(pose_id: int, body: PoseInput,
                conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute(
        "SELECT id, robot_id FROM poses WHERE id = ?", (pose_id,)
    ).fetchone()
    if row is None:
        v.http_error(404, "NOT_FOUND", f"Pose {pose_id} not found")
    robot_id = row["robot_id"]
    _validate_targets(conn, robot_id, pose_id, body)
    conn.execute(
        "UPDATE poses SET name = ?, updated_at = datetime('now') WHERE id = ?",
        (body.name, pose_id),
    )
    conn.execute("DELETE FROM pose_targets WHERE pose_id = ?", (pose_id,))
    for t in body.targets:
        conn.execute(
            "INSERT INTO pose_targets (pose_id, servo_id, angle) VALUES (?, ?, ?)",
            (pose_id, t.servo_id, t.angle),
        )
    conn.commit()
    return _pose_to_dict(conn, pose_id)


@router.delete("/poses/{pose_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pose(pose_id: int, conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute("SELECT id FROM poses WHERE id = ?", (pose_id,)).fetchone()
    if row is None:
        v.http_error(404, "NOT_FOUND", f"Pose {pose_id} not found")
    step_ref = conn.execute(
        "SELECT 1 FROM sequence_steps WHERE pose_id = ? LIMIT 1", (pose_id,)
    ).fetchone()
    if step_ref is not None:
        v.http_error(409, "POSE_REFERENCED",
                     f"Pose {pose_id} is referenced by one or more sequence "
                     f"steps; remove or change those references first.")
    conn.execute("DELETE FROM poses WHERE id = ?", (pose_id,))
    conn.commit()