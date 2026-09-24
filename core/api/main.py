"""FastAPI app: `uvicorn api.main:app --reload`, docs at http://localhost:8000/docs.
Loads the live KB (artifacts/kb/<KB_VERSION>) and policy (config.py) once at startup."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from triage import config
from triage.state import StateError

from api import events
from api.core import Core
from api.db import Database
from api.routers import review, tickets
from api.worker import WorkerPool


def create_app(db_path=config.API_DB_PATH, engine=None, workers: int = config.API_WORKERS) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        from triage.engine import Engine

        core = Core(Database(db_path), engine or Engine())
        pool = WorkerPool(core, workers)
        pool.start()
        app.state.core, app.state.pool = core, pool
        yield
        pool.stop()

    app = FastAPI(title="Triage Core API", version="1", lifespan=lifespan,
                  description="Core integration contract: docs/CORE_API.md")

    @app.exception_handler(StateError)
    async def state_error(request: Request, exc: StateError):
        return JSONResponse(status_code=exc.status,
                            content={"error": exc.code, "message": exc.message, "details": exc.details})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        errors = [{k: v for k, v in e.items() if k in ("loc", "msg", "type")} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"error": "validation_error", "message": "invalid request",
                                                      "details": {"errors": errors}})

    @app.get("/health", tags=["health"])
    def health(request: Request):
        core, pool = request.app.state.core, request.app.state.pool
        return {"status": "ok", "versions": core.engine.versions.model_dump(),
                "queue_depth": core.db.queue_depth(), "workers": pool.workers, "policy_paused": config.POLICY_PAUSED}

    app.include_router(tickets.router)
    app.include_router(review.router)
    app.include_router(events.router)
    return app


app = create_app()
