"""Sequences + steps CRUD, reorder, duplicate, and step groups
(briefs 03/04; architecture §5.3, §9.3.2–§9.3.5).

A sequence is an ordered list of steps. Order is an explicit 0-based integer
`position`; steps are returned in ascending position order. Adding a step
appends it at the end (v0.1) or inserts it at `position` (brief 03). Steps gain
per-step `speed` / `easing` (brief 04; derived per §9.2.2) and sequences gain
whole-sequence loop fields. Step groups are contiguous, non-overlapping runs of
steps that loop independently (§9.2.4); any step mutation re-validates group
contiguity and rejects a split with 422 `GROUP_SPLIT`.
"""
import sqlite3
from typing import List, Optional

from fastapi import APIRouter, Depends, Request, status

from .. import preview as preview_builder
from .. import validation as v
from ..schemas import (GroupInput, GroupUpdate, ReorderBody, SequenceInput,
                       SequenceUpdate, StepInput)

router = APIRouter(tags=["sequences"])

_SHIFT = 1_000_000


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
        "speed": row["speed"],
        "easing": row["easing"],
    }


def _sequence_steps(conn: sqlite3.Connection, seq_id: int) -> List[dict]:
    rows = conn.execute(
        "SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id",
        (seq_id,),
    ).fetchall()
    return [_step_to_dict(r) for r in rows]


def _group_to_dict(conn: sqlite3.Connection, group_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM step_groups WHERE id = ?", (group_id,)
    ).fetchone()
    members = conn.execute(
        """SELECT ss.id FROM step_group_members sgm
           JOIN sequence_steps ss ON ss.id = sgm.step_id
           WHERE sgm.group_id = ? ORDER BY ss.position, ss.id""",
        (group_id,),
    ).fetchall()
    return {
        "id": row["id"],
        "sequence_id": row["sequence_id"],
        "name": row["name"],
        "step_ids": [m["id"] for m in members],
        "repeat_count": row["repeat_count"],
        "repeat_forever": bool(row["repeat_forever"]),
    }


def _sequence_groups(conn: sqlite3.Connection, seq_id: int) -> List[dict]:
    rows = conn.execute(
        "SELECT id FROM step_groups WHERE sequence_id = ? ORDER BY id", (seq_id,)
    ).fetchall()
    return [_group_to_dict(conn, r["id"]) for r in rows]


def _sequence_to_dict(conn: sqlite3.Connection, seq_id: int) -> dict:
    row = conn.execute(
        "SELECT id, name, repeat_count, repeat_forever FROM sequences "
        "WHERE id = ?",
        (seq_id,),
    ).fetchone()
    return {
        "id": row["id"],
        "name": row["name"],
        "repeat_count": row["repeat_count"],
        "repeat_forever": bool(row["repeat_forever"]),
        "groups": _sequence_groups(conn, seq_id),
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
                 body: StepInput, speed) -> int:
    easing = v.validate_easing(body.easing or v.DEFAULT_EASING)
    if body.kind == "pose":
        cur = conn.execute(
            """INSERT INTO sequence_steps
               (sequence_id, position, kind, pose_id, servo_id, angle,
                duration_ms, hold_ms, speed, easing)
               VALUES (?, ?, 'pose', ?, NULL, NULL, ?, ?, ?, ?)""",
            (seq_id, position, body.pose_id, body.duration_ms, body.hold_ms,
             speed, easing),
        )
    else:
        cur = conn.execute(
            """INSERT INTO sequence_steps
               (sequence_id, position, kind, pose_id, servo_id, angle,
                duration_ms, hold_ms, speed, easing)
               VALUES (?, ?, 'servo', NULL, ?, ?, ?, ?, ?, ?)""",
            (seq_id, position, body.servo_id, body.angle, body.duration_ms,
             body.hold_ms, speed, easing),
        )
    return cur.lastrowid


def _next_position(conn: sqlite3.Connection, seq_id: int) -> int:
    row = conn.execute(
        "SELECT COALESCE(MAX(position), -1) AS m FROM sequence_steps "
        "WHERE sequence_id = ?",
        (seq_id,),
    ).fetchone()
    return row["m"] + 1


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


def _shift_from(conn: sqlite3.Connection, seq_id: int, position: int) -> None:
    """Free `position` by shifting later steps up by _SHIFT (avoids transient
    UNIQUE(sequence_id, position) collisions)."""
    conn.execute(
        "UPDATE sequence_steps SET position = position + ? "
        "WHERE sequence_id = ? AND position >= ?",
        (_SHIFT, seq_id, position),
    )


@router.get("/sequences", response_model=List[dict])
def list_sequences(robot_id: Optional[int] = None,
                   conn: sqlite3.Connection = Depends(get_db)):
    rid = v.resolve_robot_id(conn, robot_id)
    rows = conn.execute(
        "SELECT id, name, repeat_count, repeat_forever FROM sequences "
        "WHERE robot_id = ? ORDER BY id",
        (rid,),
    ).fetchall()
    result = []
    for r in rows:
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM sequence_steps WHERE sequence_id = ?",
            (r["id"],),
        ).fetchone()["c"]
        result.append({
            "id": r["id"],
            "name": r["name"],
            "step_count": count,
            "repeat_count": r["repeat_count"],
            "repeat_forever": bool(r["repeat_forever"]),
        })
    return result


@router.post("/sequences", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_sequence(body: SequenceInput, robot_id: Optional[int] = None,
                    conn: sqlite3.Connection = Depends(get_db)):
    rid = v.resolve_robot_id(conn, robot_id)
    name = v.require_name(body.name)
    v.validate_repeat(body.repeat_count, body.repeat_forever)
    v.ensure_sequence_name_available(conn, rid, name)
    cur = conn.execute(
        "INSERT INTO sequences (robot_id, name, repeat_count, repeat_forever) "
        "VALUES (?, ?, ?, ?)",
        (rid, name, body.repeat_count, 1 if body.repeat_forever else 0),
    )
    conn.commit()
    return _sequence_to_dict(conn, cur.lastrowid)


@router.get("/sequences/{seq_id}", response_model=dict)
def get_sequence(seq_id: int, conn: sqlite3.Connection = Depends(get_db)):
    _fetch_sequence(conn, seq_id)
    return _sequence_to_dict(conn, seq_id)


@router.put("/sequences/{seq_id}", response_model=dict)
def update_sequence(seq_id: int, body: SequenceUpdate,
                    conn: sqlite3.Connection = Depends(get_db)):
    seq = _fetch_sequence(conn, seq_id)
    if body.name is not None:
        name = v.require_name(body.name)
        v.ensure_sequence_name_available(conn, seq["robot_id"], name,
                                         exclude_id=seq_id)
        conn.execute(
            "UPDATE sequences SET name = ?, updated_at = datetime('now') "
            "WHERE id = ?",
            (name, seq_id),
        )
    if body.repeat_count is not None or body.repeat_forever is not None:
        if body.repeat_count is not None and body.repeat_forever:
            v.http_error(422, "VALIDATION",
                         "repeat_count and repeat_forever are mutually "
                         "exclusive")
        new_count = body.repeat_count
        new_forever = 1 if body.repeat_forever else 0
        v.validate_repeat(new_count, bool(new_forever))
        conn.execute(
            "UPDATE sequences SET repeat_count = ?, repeat_forever = ?, "
            "updated_at = datetime('now') WHERE id = ?",
            (new_count, new_forever, seq_id),
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
    seq = _fetch_sequence(conn, seq_id)
    _validate_step(conn, seq_id, body)
    targets = preview_builder.resolve_step_targets(conn, seq["robot_id"], body)
    if body.position is None:
        position = _next_position(conn, seq_id)
    else:
        position = body.position
    speed, duration_ms = preview_builder.derive_step_timing(
        conn, seq_id, seq["robot_id"], targets, body.duration_ms, body.speed,
        position,
    )
    # Mutate the validated body's duration to the derived value.
    body.duration_ms = duration_ms
    _shift_from(conn, seq_id, position)
    step_id = _insert_step(conn, seq_id, position, body, speed)
    _renumber(conn, seq_id)
    v.validate_group_contiguity(conn, seq_id)
    conn.commit()
    row = conn.execute(
        "SELECT * FROM sequence_steps WHERE id = ?", (step_id,)
    ).fetchone()
    return _step_to_dict(row)


@router.put("/sequences/{seq_id}/steps/{step_id}", response_model=dict)
def update_step(seq_id: int, step_id: int, body: StepInput,
                conn: sqlite3.Connection = Depends(get_db)):
    seq = _fetch_sequence(conn, seq_id)
    step = _fetch_step(conn, seq_id, step_id)
    _validate_step(conn, seq_id, body)
    targets = preview_builder.resolve_step_targets(conn, seq["robot_id"], body)
    speed, duration_ms = preview_builder.derive_step_timing(
        conn, seq_id, seq["robot_id"], targets, body.duration_ms, body.speed,
        step["position"], step_id=step_id, is_update=True,
    )
    easing = v.validate_easing(body.easing or v.DEFAULT_EASING)
    if body.kind == "pose":
        conn.execute(
            """UPDATE sequence_steps SET kind = 'pose', pose_id = ?,
               servo_id = NULL, angle = NULL, duration_ms = ?, hold_ms = ?,
               speed = ?, easing = ?
               WHERE id = ?""",
            (body.pose_id, duration_ms, body.hold_ms, speed, easing, step_id),
        )
    else:
        conn.execute(
            """UPDATE sequence_steps SET kind = 'servo', pose_id = NULL,
               servo_id = ?, angle = ?, duration_ms = ?, hold_ms = ?,
               speed = ?, easing = ?
               WHERE id = ?""",
            (body.servo_id, body.angle, duration_ms, body.hold_ms, speed,
             easing, step_id),
        )
    v.validate_group_contiguity(conn, seq_id)
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
    v.validate_group_contiguity(conn, seq_id)
    conn.commit()


@router.post("/sequences/{seq_id}/steps/{step_id}/duplicate", response_model=dict,
             status_code=status.HTTP_201_CREATED)
def duplicate_step(seq_id: int, step_id: int,
                   conn: sqlite3.Connection = Depends(get_db)):
    seq = _fetch_sequence(conn, seq_id)
    step = _fetch_step(conn, seq_id, step_id)
    new_position = step["position"] + 1
    _shift_from(conn, seq_id, new_position)
    cur = conn.execute(
        """INSERT INTO sequence_steps
           (sequence_id, position, kind, pose_id, servo_id, angle,
            duration_ms, hold_ms, speed, easing)
           SELECT sequence_id, ?, kind, pose_id, servo_id, angle,
                  duration_ms, hold_ms, speed, easing
           FROM sequence_steps WHERE id = ?""",
        (new_position, step_id),
    )
    new_step_id = cur.lastrowid
    _renumber(conn, seq_id)
    v.validate_group_contiguity(conn, seq_id)
    conn.commit()
    row = conn.execute(
        "SELECT * FROM sequence_steps WHERE id = ?", (new_step_id,)
    ).fetchone()
    return _step_to_dict(row)


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
    for step_id in current:
        conn.execute(
            "UPDATE sequence_steps SET position = position + ? WHERE id = ?",
            (_SHIFT, step_id),
        )
    for position, step_id in enumerate(body.step_ids):
        conn.execute(
            "UPDATE sequence_steps SET position = ? WHERE id = ?",
            (position, step_id),
        )
    conn.execute(
        "UPDATE sequences SET updated_at = datetime('now') WHERE id = ?", (seq_id,)
    )
    v.validate_group_contiguity(conn, seq_id)
    conn.commit()
    return _sequence_to_dict(conn, seq_id)


def _validate_group_input(conn: sqlite3.Connection, seq_id: int,
                          step_ids: List[int]) -> None:
    """Validate a group's steps: non-empty, all in the sequence, contiguous by
    position, and non-overlapping with existing groups (§9.3.5)."""
    positions = []
    for sid in step_ids:
        row = conn.execute(
            "SELECT position FROM sequence_steps WHERE id = ? AND sequence_id = ?",
            (sid, seq_id),
        ).fetchone()
        if row is None:
            v.http_error(422, "VALIDATION",
                         f"Step {sid} does not exist in sequence {seq_id}")
        positions.append(row["position"])
    positions = sorted(positions)
    expected = list(range(positions[0], positions[0] + len(positions)))
    if positions != expected:
        v.http_error(422, "VALIDATION",
                     "Group steps must be contiguous by position")
    taken = conn.execute(
        """SELECT 1 FROM step_group_members sgm
           JOIN step_groups sg ON sg.id = sgm.group_id
           WHERE sg.sequence_id = ? AND sgm.step_id IN (%s) LIMIT 1"""
        % ",".join("?" * len(step_ids)),
        [seq_id] + step_ids,
    ).fetchone()
    if taken is not None:
        v.http_error(422, "VALIDATION",
                     "Group steps must not overlap another group's steps")


@router.post("/sequences/{seq_id}/groups", response_model=dict,
             status_code=status.HTTP_201_CREATED)
def create_group(seq_id: int, body: GroupInput,
                 conn: sqlite3.Connection = Depends(get_db)):
    _fetch_sequence(conn, seq_id)
    _validate_group_input(conn, seq_id, body.step_ids)
    v.validate_repeat(body.repeat_count, body.repeat_forever)
    cur = conn.execute(
        "INSERT INTO step_groups (sequence_id, name, repeat_count, "
        "repeat_forever) VALUES (?, ?, ?, ?)",
        (seq_id, body.name, body.repeat_count,
         1 if body.repeat_forever else 0),
    )
    group_id = cur.lastrowid
    for sid in body.step_ids:
        conn.execute(
            "INSERT INTO step_group_members (step_id, group_id) VALUES (?, ?)",
            (sid, group_id),
        )
    conn.commit()
    return _group_to_dict(conn, group_id)


@router.get("/sequences/{seq_id}/groups/{group_id}", response_model=dict)
def get_group(seq_id: int, group_id: int,
              conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute(
        "SELECT id FROM step_groups WHERE id = ? AND sequence_id = ?",
        (group_id, seq_id),
    ).fetchone()
    if row is None:
        v.http_error(404, "NOT_FOUND",
                     f"Group {group_id} not found in sequence {seq_id}")
    return _group_to_dict(conn, group_id)


@router.put("/sequences/{seq_id}/groups/{group_id}", response_model=dict)
def update_group(seq_id: int, group_id: int, body: GroupUpdate,
                 conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute(
        "SELECT * FROM step_groups WHERE id = ? AND sequence_id = ?",
        (group_id, seq_id),
    ).fetchone()
    if row is None:
        v.http_error(404, "NOT_FOUND",
                     f"Group {group_id} not found in sequence {seq_id}")
    sets = []
    args = []
    if body.name is not None:
        sets.append("name = ?")
        args.append(body.name)
    if body.repeat_count is not None or body.repeat_forever is not None:
        if body.repeat_count is not None and body.repeat_forever:
            v.http_error(422, "VALIDATION",
                         "repeat_count and repeat_forever are mutually "
                         "exclusive")
        new_count = body.repeat_count
        new_forever = 1 if body.repeat_forever else 0
        v.validate_repeat(new_count, bool(new_forever))
        sets.append("repeat_count = ?")
        args.append(new_count)
        sets.append("repeat_forever = ?")
        args.append(new_forever)
    args.append(group_id)
    conn.execute(
        f"UPDATE step_groups SET {', '.join(sets)} WHERE id = ?", args
    )
    conn.commit()
    return _group_to_dict(conn, group_id)


@router.delete("/sequences/{seq_id}/groups/{group_id}",
               status_code=status.HTTP_204_NO_CONTENT)
def delete_group(seq_id: int, group_id: int,
                 conn: sqlite3.Connection = Depends(get_db)):
    row = conn.execute(
        "SELECT id FROM step_groups WHERE id = ? AND sequence_id = ?",
        (group_id, seq_id),
    ).fetchone()
    if row is None:
        v.http_error(404, "NOT_FOUND",
                     f"Group {group_id} not found in sequence {seq_id}")
    conn.execute("DELETE FROM step_groups WHERE id = ?", (group_id,))
    conn.commit()