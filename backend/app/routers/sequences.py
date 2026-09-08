"""Sequences + steps CRUD and reorder (brief 03; architecture §5.3).

A sequence is an ordered list of steps. Order is an explicit 0-based integer
`position`; steps are returned in ascending position order. Adding a step
appends it at the end; reordering rewrites positions to be contiguous from 0.
"""
import sqlite3
from typing import List, Optional

from fastapi import APIRouter, Depends, Request, status

from .. import validation as v
from ..schemas import ReorderBody, SequenceRename, StepInput

router = APIRouter(tags=["sequences"])


def get_db(request: Request) -> sqlite3.Connection:
    return request.state.db


def _step_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "position": row["position"],
        "kind": row["kind"],
        "pose_id": row["pose_id"],
        "servo_id": row["servo_id"],
        "angle": row["angle"],
        "duration_ms": row["duration_ms"],
        "hold_ms": row["hold_ms"],
    }


def _sequence_steps(conn: sqlite3.Connection, seq_id: int) -> List[dict]:
    rows = conn.execute(
        "SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id",
        (seq_id,),
    ).fetchall()
    return [_step_to_dict(r) for r in rows]


def _sequence_to_dict(conn: sqlite3.Connection, seq_id: int) -> dict:
    row = conn.execute("SELECT id, name FROM sequences WHERE id = ?", (seq_id,)).fetchone()
    return {
        "id": row["id"],
        "name": row["name"],
        "steps": _sequence_steps(conn, seq_id),
    }


def _fetch_sequence(conn: sqlite3.Connection, seq_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM sequences WHERE id = ?", (seq_id,)).fetchone()
    if row is None:
        v.http_error(404, "NOT_FOUND", f"Sequence {seq_id} not found")
    return row


def _fetch_step(conn: sqlite3.Connection, seq_id: int, step_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM sequence_steps WHERE id = ? AND sequence_id = ?",
        (step_id, seq_id),
    ).fetchone()
    if row is None:
        v.http_error(404, "NOT_FOUND",
                     f"Step {step_id} not found in sequence {seq_id}")
    return row


def _validate_step(conn: sqlite3.Connection, seq_id: int, body: StepInput) -> None:
    seq = _fetch_sequence(conn, seq_id)
    robot_id = seq["robot_id"]
    if body.kind == "pose":
        pose = conn.execute(
            "SELECT id FROM poses WHERE id = ? AND robot_id = ?",
            (body.pose_id, robot_id),
        ).fetchone()
        if pose is None:
            v.http_error(422, "VALIDATION",
                         f"Pose {body.pose_id} does not exist on this robot")
    else:  # kind == "servo"
        servo = conn.execute(
            "SELECT * FROM servos WHERE id = ? AND robot_id = ?",
            (body.servo_id, robot_id),
        ).fetchone()
        if servo is None:
            v.http_error(422, "VALIDATION",
                         f"Servo {body.servo_id} does not exist on this robot")
        if not (servo["angle_min"] <= body.angle <= servo["angle_max"]):
            v.http_error(422, "VALIDATION",
                         f"Angle {body.angle} for servo {body.servo_id} is "
                         f"outside [{servo['angle_min']}, {servo['angle_max']}]")


def _insert_step(conn: sqlite3.Connection, seq_id: int, position: int,
                 body: StepInput) -> int:
    if body.kind == "pose":
        cur = conn.execute(
            """INSERT INTO sequence_steps
               (sequence_id, position, kind, pose_id, servo_id, angle,
                duration_ms, hold_ms)
               VALUES (?, ?, 'pose', ?, NULL, NULL, ?, ?)""",
            (seq_id, position, body.pose_id, body.duration_ms, body.hold_ms),
        )
    else:
        cur = conn.execute(
            """INSERT INTO sequence_steps
               (sequence_id, position, kind, pose_id, servo_id, angle,
                duration_ms, hold_ms)
               VALUES (?, ?, 'servo', NULL, ?, ?, ?, ?)""",
            (seq_id, position, body.servo_id, body.angle, body.duration_ms,
             body.hold_ms),
        )
    return cur.lastrowid


def _next_position(conn: sqlite3.Connection, seq_id: int) -> int:
    row = conn.execute(
        "SELECT COALESCE(MAX(position), -1) AS m FROM sequence_steps "
        "WHERE sequence_id = ?",
        (seq_id,),
    ).fetchone()
    return row["m"] + 1


@router.get("/sequences", response_model=List[dict])
def list_sequences(conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute("SELECT id, name FROM sequences ORDER BY id").fetchall()
    result = []
    for r in rows:
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM sequence_steps WHERE sequence_id = ?",
            (r["id"],),
        ).fetchone()["c"]
        result.append({"id": r["id"], "name": r["name"], "step_count": count})
    return result


@router.post("/sequences", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_sequence(body: SequenceRename,
                    conn: sqlite3.Connection = Depends(get_db)):
    robot_id = v.current_robot_id(conn)
    name = v.require_name(body.name)
    v.ensure_sequence_name_available(conn, robot_id, name)
    cur = conn.execute(
        "INSERT INTO sequences (robot_id, name) VALUES (?, ?)", (robot_id, name)
    )
    conn.commit()
    return _sequence_to_dict(conn, cur.lastrowid)


@router.get("/sequences/{seq_id}", response_model=dict)
def get_sequence(seq_id: int, conn: sqlite3.Connection = Depends(get_db)):
    _fetch_sequence(conn, seq_id)
    return _sequence_to_dict(conn, seq_id)


@router.put("/sequences/{seq_id}", response_model=dict)
def rename_sequence(seq_id: int, body: SequenceRename,
                    conn: sqlite3.Connection = Depends(get_db)):
    seq = _fetch_sequence(conn, seq_id)
    name = v.require_name(body.name)
    v.ensure_sequence_name_available(conn, seq["robot_id"], name,
                                     exclude_id=seq_id)
    conn.execute(
        "UPDATE sequences SET name = ?, updated_at = datetime('now') WHERE id = ?",
        (name, seq_id),
    )
    conn.commit()
    return _sequence_to_dict(conn, seq_id)


@router.delete("/sequences/{seq_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sequence(seq_id: int, conn: sqlite3.Connection = Depends(get_db)):
    _fetch_sequence(conn, seq_id)
    conn.execute("DELETE FROM sequences WHERE id = ?", (seq_id,))
    conn.commit()


@router.post("/sequences/{seq_id}/steps", response_model=dict,
             status_code=status.HTTP_201_CREATED)
def add_step(seq_id: int, body: StepInput,
             conn: sqlite3.Connection = Depends(get_db)):
    _fetch_sequence(conn, seq_id)
    _validate_step(conn, seq_id, body)
    position = _next_position(conn, seq_id)
    step_id = _insert_step(conn, seq_id, position, body)
    conn.commit()
    row = conn.execute(
        "SELECT * FROM sequence_steps WHERE id = ?", (step_id,)
    ).fetchone()
    return _step_to_dict(row)


@router.put("/sequences/{seq_id}/steps/{step_id}", response_model=dict)
def update_step(seq_id: int, step_id: int, body: StepInput,
                conn: sqlite3.Connection = Depends(get_db)):
    _fetch_step(conn, seq_id, step_id)
    _validate_step(conn, seq_id, body)
    if body.kind == "pose":
        conn.execute(
            """UPDATE sequence_steps SET kind = 'pose', pose_id = ?,
               servo_id = NULL, angle = NULL, duration_ms = ?, hold_ms = ?
               WHERE id = ?""",
            (body.pose_id, body.duration_ms, body.hold_ms, step_id),
        )
    else:
        conn.execute(
            """UPDATE sequence_steps SET kind = 'servo', pose_id = NULL,
               servo_id = ?, angle = ?, duration_ms = ?, hold_ms = ?
               WHERE id = ?""",
            (body.servo_id, body.angle, body.duration_ms, body.hold_ms, step_id),
        )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM sequence_steps WHERE id = ?", (step_id,)
    ).fetchone()
    return _step_to_dict(row)


@router.delete("/sequences/{seq_id}/steps/{step_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def remove_step(seq_id: int, step_id: int,
                conn: sqlite3.Connection = Depends(get_db)):
    _fetch_step(conn, seq_id, step_id)
    conn.execute("DELETE FROM sequence_steps WHERE id = ?", (step_id,))
    _renumber(conn, seq_id)
    conn.commit()


@router.post("/sequences/{seq_id}/reorder", response_model=dict)
def reorder_steps(seq_id: int, body: ReorderBody,
                  conn: sqlite3.Connection = Depends(get_db)):
    _fetch_sequence(conn, seq_id)
    current = [r["id"] for r in conn.execute(
        "SELECT id FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id",
        (seq_id,),
    ).fetchall()]
    if sorted(body.step_ids) != sorted(current):
        v.http_error(422, "VALIDATION",
                     "step_ids must contain exactly the sequence's step ids, "
                     "in the new order")
    # Two-phase rewrite: first move every step to a temp offset so the
    # UNIQUE(sequence_id, position) constraint can't be hit transiently.
    offset = 1_000_000
    for step_id in current:
        conn.execute(
            "UPDATE sequence_steps SET position = position + ? WHERE id = ?",
            (offset, step_id),
        )
    for position, step_id in enumerate(body.step_ids):
        conn.execute(
            "UPDATE sequence_steps SET position = ? WHERE id = ?",
            (position, step_id),
        )
    conn.execute(
        "UPDATE sequences SET updated_at = datetime('now') WHERE id = ?", (seq_id,)
    )
    conn.commit()
    return _sequence_to_dict(conn, seq_id)


def _renumber(conn: sqlite3.Connection, seq_id: int) -> None:
    """Compact step positions to be contiguous from 0 (keeps the invariant)."""
    rows = conn.execute(
        "SELECT id FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id",
        (seq_id,),
    ).fetchall()
    for position, row in enumerate(rows):
        conn.execute(
            "UPDATE sequence_steps SET position = ? WHERE id = ?",
            (position, row["id"]),
        )