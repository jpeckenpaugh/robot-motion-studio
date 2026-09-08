"""Preview endpoint (brief 04; architecture §5.4)."""
import sqlite3

from fastapi import APIRouter, Depends, Request

from .. import preview as preview_builder

router = APIRouter(tags=["preview"])


def get_db(request: Request) -> sqlite3.Connection:
    return request.state.db


@router.get("/sequences/{seq_id}/preview", response_model=dict)
def preview_sequence(seq_id: int, conn: sqlite3.Connection = Depends(get_db)):
    return preview_builder.build_preview(conn, seq_id)