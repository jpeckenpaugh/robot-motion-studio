"""Export endpoints (brief 05; architecture §5.5).

Both endpoints return the same versioned, self-contained JSON document with a
Content-Disposition attachment header so the browser can save the artifact.
"""
import json
import sqlite3

from fastapi import APIRouter, Depends, Request, Response

from .. import export as export_builder

router = APIRouter(tags=["export"])


def get_db(request: Request) -> sqlite3.Connection:
    return request.state.db


def _json_response(conn: sqlite3.Connection, doc: dict, filename: str) -> Response:
    body = json.dumps(doc, indent=2, ensure_ascii=False)
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/export")
def export_all(conn: sqlite3.Connection = Depends(get_db)):
    doc = export_builder.build_export(conn)
    robot_name = doc["robot"]["name"]
    return _json_response(conn, doc, export_builder.filename_for(robot_name))


@router.get("/sequences/{seq_id}/export")
def export_sequence(seq_id: int, conn: sqlite3.Connection = Depends(get_db)):
    doc = export_builder.build_export(conn, seq_id=seq_id)
    robot_name = doc["robot"]["name"]
    seq_name = doc["sequences"][0]["name"] if doc["sequences"] else None
    return _json_response(conn, doc,
                          export_builder.filename_for(robot_name, seq_name))