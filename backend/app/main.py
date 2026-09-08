"""FastAPI application entry point (app.main:app).

Assembles the API routers under /api/*, attaches a per-request SQLite
connection, ensures the schema exists and seeds the sample data on first run,
and serves the static SPA frontend from frontend/ for every non-/api route.

The `app` package lives under backend/; run.sh adds backend/ to PYTHONPATH so
`app.main:app` resolves (see docs/architecture.md §1).
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config, db
from .routers import export as export_router
from .routers import poses as poses_router
from .routers import preview as preview_router
from .routers import robot as robot_router
from .routers import sequences as sequences_router

logger = logging.getLogger("robot-servo-designer")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(
    title="Robot Servo Sequence Designer",
    version="1.0.0",
    lifespan=lifespan,
)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    body = {"detail": exc.detail}
    code = getattr(exc, "code", None)
    if code is not None:
        body["code"] = code
    headers = getattr(exc, "headers", None)
    return JSONResponse(status_code=exc.status_code, content=body, headers=headers)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Request validation failed: "
                      + "; ".join(_fmt_validation_error(e) for e in exc.errors()),
            "code": "VALIDATION",
        },
    )


def _fmt_validation_error(err: dict) -> str:
    loc = ".".join(str(p) for p in err.get("loc", ()))
    return f"{loc}: {err.get('msg', 'invalid value')}"


@app.middleware("http")
async def db_session(request: Request, call_next):
    conn = db.connect()
    request.state.db = conn
    try:
        response = await call_next(request)
    finally:
        conn.close()
    return response


# API routers under /api/*. Registered before the static mount so they win.
api_prefix = "/api"
for router in (
    robot_router.router,
    poses_router.router,
    sequences_router.router,
    preview_router.router,
    export_router.router,
):
    app.include_router(router, prefix=api_prefix)


@app.get("/api/health", tags=["health"])
def health():
    """Minimal health probe (not part of the product contract; useful for ops)."""
    return {"status": "ok"}


# Static SPA: every non-/api route falls through to frontend/ (html=True).
frontend_dir = config.FRONTEND_DIR
if not frontend_dir.exists():
    frontend_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/",
    StaticFiles(directory=str(frontend_dir), html=True),
    name="static",
)