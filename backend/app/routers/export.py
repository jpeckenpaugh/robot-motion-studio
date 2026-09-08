"""Export endpoints (brief 05; architecture §5.5, §9.3.7).

Both endpoints return the same versioned, self-contained JSON document with a
Content-Disposition attachment header so the browser can save the artifact.
Export operates on the currently selected robot and accepts an optional
?robot_id= for explicit scope.
"""
import json
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, Request, Response

from .. import export as export_builder

router = APIRouter(tags=["export"])


def get_db(request: Request) -> sqlite3.Connection:
    return request.state.db


def _json_response(doc: dict, filename: str) -> Response:
    body = json.dumps(doc, indent=2, ensure_ascii=False)
    return Response(
        content=body,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/export")
def export_all(robot_id: Optional[int] = None,
               conn: sqlite3.Connection = Depends(get_db)):
    doc = export_builder.build_export(conn, robot_id=robot_id)
    robot_name = doc["robot"]["name"]
    return _json_response(doc, export_builder.filename_for(robot_name))


@router.get("/sequences/{seq_id}/export")
def export_sequence(seq_id: int, robot_id: Optional[int] = None,
                    conn: sqlite3.Connection = Depends(get_db)):
    doc = export_builder.build_export(conn, robot_id=robot_id, seq_id=seq_id)
    robot_name = doc["robot"]["name"]
    seq_name = doc["sequences"][0]["name"] if doc["sequences"] else None
    return _json_response(doc, export_builder.filename_for(robot_name, seq_name))