"""Sequence preview resolution (brief 04; architecture §5.4, §9.3.6).

The preview is derived on every request from the current saved state of the
sequence, its poses, and the robot configuration, so it never shows stale data.
It is read-only: there is no write route for it.

In the enhancement pass the extended preview becomes the **single resolved
motion source** for the read-only preview, the timeline editor, and the
simulator (architecture §9.3.6). Additive fields: per-target `from_angle` /
`from_pulse_us`, per-step `start_ms` / `end_ms`, `easing`, `speed_deg_per_s`,
sequence-level repeat fields, `groups`, `pass_duration_ms`, `total_duration_ms`.

This module also hosts the shared speed/duration derivation rules (§9.2.2) used
by the sequences router on step save and by db.py on migration backfill.
"""
import sqlite3

from . import pulse, validation as v

DEFAULT_EASING = v.DEFAULT_EASING

# Consistency tolerance for client-supplied speed vs. derived speed (§9.2.2):
# within ±0.5% of the derived (travel-based) speed, or 0.05 deg/s absolute.
SPEED_TOLERANCE_FRACTION = 0.005
SPEED_TOLERANCE_ABS = 0.05


def _servo_map(conn: sqlite3.Connection, robot_id: int) -> dict:
    rows = conn.execute(
        "SELECT * FROM servos WHERE robot_id = ?", (robot_id,)
    ).fetchall()
    return {r["id"]: r for r in rows}


def _neutral_map(conn: sqlite3.Connection, robot_id: int) -> dict:
    rows = conn.execute(
        "SELECT id, neutral_angle FROM servos WHERE robot_id = ?", (robot_id,)
    ).fetchall()
    return {r["id"]: r["neutral_angle"] for r in rows}


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


def _resolve_row_targets(conn: sqlite3.Connection, row) -> dict:
    """Resolve one sequence_steps row to a {servo_id: angle} move map."""
    if row["kind"] == "pose":
        rows = conn.execute(
            "SELECT servo_id, angle FROM pose_targets WHERE pose_id = ?",
            (row["pose_id"],),
        ).fetchall()
        return {r["servo_id"]: r["angle"] for r in rows}
    return {row["servo_id"]: row["angle"]}


def resolve_step_targets(conn: sqlite3.Connection, robot_id: int, body) -> list:
    """Resolve a StepInput to a list of (servo_id, angle) targets on the robot."""
    if body.kind == "pose":
        rows = conn.execute(
            "SELECT servo_id, angle FROM pose_targets WHERE pose_id = ?",
            (body.pose_id,),
        ).fetchall()
        return [(r["servo_id"], r["angle"]) for r in rows]
    return [(body.servo_id, body.angle)]


def _carry(moves: list, neutral: dict) -> list:
    """Resolve each move's starting angles given prior moves (first mover of a
    servo => its neutral_angle). `moves` is in execution order."""
    cur = dict(neutral)
    starts = []
    for mv in moves:
        starts.append({s: cur[s] for s in mv})
        for s, a in mv.items():
            cur[s] = a
    return starts


def _apply_timing(travel_deg: float, duration_ms, speed):
    """Apply §9.2.2 to derive the missing value / verify consistency."""
    if travel_deg <= 0:
        if duration_ms is None:
            v.http_error(
                422, "VALIDATION",
                "duration_ms is required for a stationary step (no travel)",
            )
        return None, duration_ms  # stationary: speed is stored NULL
    computed_speed = travel_deg / (duration_ms / 1000.0) if duration_ms else None

    if duration_ms is not None and speed is None:
        return round(computed_speed, 6), duration_ms
    if speed is not None and duration_ms is None:
        if speed <= 0:
            v.http_error(422, "VALIDATION", "speed must be greater than zero")
        new_duration = round(travel_deg / speed * 1000)
        return speed, new_duration
    if duration_ms is not None and speed is not None:
        tolerance = max(SPEED_TOLERANCE_FRACTION * computed_speed,
                        SPEED_TOLERANCE_ABS)
        if abs(speed - computed_speed) > tolerance:
            v.http_error(
                422, "SPEED_DURATION_MISMATCH",
                f"speed ({speed} deg/s) is inconsistent with duration_ms "
                f"({duration_ms}) for the resolved travel "
                f"({round(travel_deg, 3)} deg -> {round(computed_speed, 3)} "
                f"deg/s)",
            )
        return speed, duration_ms
    v.http_error(422, "VALIDATION",
                 "Provide at least one of duration_ms or speed")


def derive_step_timing(conn: sqlite3.Connection, seq_id: int, robot_id: int,
                       targets: list, duration_ms, speed, position: int,
                       step_id=None, is_update: bool = False):
    """Derive (speed, duration_ms) for a step being saved, per §9.2.2.

    `targets` is a list of (servo_id, angle). The step's travel is computed from
    the resolved start angle of each servo at the end of the previous step that
    moved it (or its neutral_angle if none), considering the sequence's current
    steps plus the step being saved at its position.
    """
    rows = conn.execute(
        "SELECT id, position, kind, pose_id, servo_id, angle "
        "FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id",
        (seq_id,),
    ).fetchall()
    entries = []
    for r in rows:
        if is_update and r["id"] == step_id:
            continue
        entries.append((r["position"], r["id"], _resolve_row_targets(conn, r)))
    new_move = dict(targets)
    if is_update:
        entries.append((position, step_id, new_move))
    else:
        entries.append((position, None, new_move))
    entries.sort(key=lambda e: (e[0], e[1] if e[1] is not None else -1))
    moves = [t for (_, _, t) in entries]
    neutral = _neutral_map(conn, robot_id)
    starts = _carry(moves, neutral)
    if is_update:
        idx = next(i for i, (_, sid, _) in enumerate(entries) if sid == step_id)
    else:
        idx = next(i for i, (_, sid, _) in enumerate(entries) if sid is None)
    start = starts[idx]
    travel = 0.0
    for sid, ang in new_move.items():
        travel = max(travel, abs(ang - start.get(sid, neutral.get(sid, 0.0))))
    return _apply_timing(travel, duration_ms, speed)


def backfill_step_speeds(conn: sqlite3.Connection) -> None:
    """Migration backfill (§9.8): store the derived constant speed for existing
    steps with speed NULL. Existing rows keep their v0.1 meaning (constant-speed
    motion); derived speed ≡ that same motion."""
    seq_rows = conn.execute("SELECT id, robot_id FROM sequences").fetchall()
    for seq in seq_rows:
        rows = conn.execute(
            "SELECT * FROM sequence_steps WHERE sequence_id = ? "
            "ORDER BY position, id",
            (seq["id"],),
        ).fetchall()
        if not rows:
            continue
        neutral = _neutral_map(conn, seq["robot_id"])
        moves = [_resolve_row_targets(conn, r) for r in rows]
        starts = _carry(moves, neutral)
        for i, r in enumerate(rows):
            if r["speed"] is not None:
                continue
            move = moves[i]
            start = starts[i]
            travel = max(
                (abs(ang - start.get(sid, neutral.get(sid, 0.0)))
                 for sid, ang in move.items()),
                default=0.0,
            )
            if travel <= 0 or r["duration_ms"] <= 0:
                continue  # stationary / instant jump: no meaningful speed
            speed = travel / (r["duration_ms"] / 1000.0)
            conn.execute(
                "UPDATE sequence_steps SET speed = ? WHERE id = ?",
                (round(speed, 6), r["id"]),
            )


def _group_membership(conn: sqlite3.Connection, seq_id: int) -> dict:
    mem = conn.execute(
        """SELECT sgm.step_id AS step_id, sgm.group_id AS group_id
           FROM step_group_members sgm
           JOIN step_groups sg ON sg.id = sgm.group_id
           WHERE sg.sequence_id = ?""",
        (seq_id,),
    ).fetchall()
    return {m["step_id"]: m["group_id"] for m in mem}


def _pass_duration_ms(conn: sqlite3.Connection, seq_id: int,
                      steps_rows, membership: dict):
    """Duration of one pass including all group expansions (§9.2.4)."""
    group_repeat = {}
    for g in conn.execute(
        "SELECT id, repeat_count, repeat_forever FROM step_groups "
        "WHERE sequence_id = ?",
        (seq_id,),
    ).fetchall():
        group_repeat[g["id"]] = g["repeat_count"] if g["repeat_count"] is not None else 1
    total = 0.0
    i = 0
    n = len(steps_rows)
    while i < n:
        row = steps_rows[i]
        gid = membership.get(row["id"])
        if gid is not None:
            run = 0
            grp_sum = 0.0
            while i + run < n and membership.get(steps_rows[i + run]["id"]) == gid:
                r = steps_rows[i + run]
                grp_sum += r["duration_ms"] + (r["hold_ms"] or 0)
                run += 1
            total += grp_sum * group_repeat.get(gid, 1)
            i += run
        else:
            total += row["duration_ms"] + (row["hold_ms"] or 0)
            i += 1
    return round(total, 3)


def build_preview(conn: sqlite3.Connection, seq_id: int) -> dict:
    """Build the extended preview document for a sequence (404 if absent)."""
    seq = conn.execute("SELECT * FROM sequences WHERE id = ?", (seq_id,)).fetchone()
    if seq is None:
        v.http_error(404, "NOT_FOUND", f"Sequence {seq_id} not found")
    robot_id = seq["robot_id"]
    servos = _servo_map(conn, robot_id)
    neutral = _neutral_map(conn, robot_id)

    steps_rows = conn.execute(
        "SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position, id",
        (seq_id,),
    ).fetchall()
    membership = _group_membership(conn, seq_id)

    moves = [_resolve_row_targets(conn, r) for r in steps_rows]
    starts = _carry(moves, neutral)

    steps = []
    t = 0
    for order, row in enumerate(steps_rows):
        start_angles = starts[order]
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
            targets = []
            for trg in target_rows:
                servo = servos.get(trg["servo_id"])
                if servo is None:
                    continue
                from_angle = start_angles.get(trg["servo_id"],
                                              servo["neutral_angle"])
                targets.append({
                    **_target(servo, trg["angle"]),
                    "from_angle": from_angle,
                    "from_pulse_us": pulse.angle_to_pulse_us(
                        from_angle, servo["angle_min"], servo["angle_max"],
                        servo["pulse_min_us"], servo["pulse_max_us"],
                    ),
                })
            steps.append({
                "order": order,
                "kind": "pose",
                "pose_id": row["pose_id"],
                "pose_name": pose_name,
                "duration_ms": row["duration_ms"],
                "hold_ms": row["hold_ms"],
                "start_ms": t,
                "end_ms": t + row["duration_ms"],
                "easing": row["easing"],
                "speed_deg_per_s": row["speed"],
                "group_id": membership.get(row["id"]),
                "targets": targets,
            })
        else:  # kind == "servo"
            servo = servos.get(row["servo_id"])
            if servo is None:
                v.http_error(409, "CONFLICT",
                             f"Step {row['id']} references servo "
                             f"{row['servo_id']} which no longer exists")
            from_angle = start_angles.get(row["servo_id"], servo["neutral_angle"])
            target = {
                **_target(servo, row["angle"]),
                "from_angle": from_angle,
                "from_pulse_us": pulse.angle_to_pulse_us(
                    from_angle, servo["angle_min"], servo["angle_max"],
                    servo["pulse_min_us"], servo["pulse_max_us"],
                ),
            }
            steps.append({
                "order": order,
                "kind": "servo",
                "servo_id": row["servo_id"],
                "servo_name": servo["name"],
                "angle": row["angle"],
                "pulse_us": target["pulse_us"],
                "duration_ms": row["duration_ms"],
                "hold_ms": row["hold_ms"],
                "start_ms": t,
                "end_ms": t + row["duration_ms"],
                "easing": row["easing"],
                "speed_deg_per_s": row["speed"],
                "group_id": membership.get(row["id"]),
                "targets": [target],
            })
        t += row["duration_ms"] + (row["hold_ms"] or 0)

    groups = []
    for g in conn.execute(
        "SELECT * FROM step_groups WHERE sequence_id = ? ORDER BY id",
        (seq_id,),
    ).fetchall():
        member_pos = [r["position"] for r in conn.execute(
            """SELECT ss.position FROM step_group_members sgm
               JOIN sequence_steps ss ON ss.id = sgm.step_id
               WHERE sgm.group_id = ? ORDER BY ss.position""",
            (g["id"],),
        ).fetchall()]
        groups.append({
            "id": g["id"],
            "name": g["name"],
            "step_orders": member_pos,
            "repeat_count": g["repeat_count"],
            "repeat_forever": bool(g["repeat_forever"]),
        })

    repeat_forever = bool(seq["repeat_forever"])
    forever_group = any(g["repeat_forever"] for g in groups)
    if forever_group:
        pass_ms = None
    else:
        pass_ms = _pass_duration_ms(conn, seq_id, steps_rows, membership)
    if repeat_forever or pass_ms is None:
        total_ms = None
    else:
        total_ms = round(pass_ms * (seq["repeat_count"] or 1), 3)

    return {
        "sequence_id": seq_id,
        "sequence_name": seq["name"],
        "repeat_count": seq["repeat_count"],
        "repeat_forever": repeat_forever,
        "groups": groups,
        "pass_duration_ms": pass_ms,
        "total_duration_ms": total_ms,
        "steps": steps,
    }