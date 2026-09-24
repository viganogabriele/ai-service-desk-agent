"""Metrics computed on request (CORE_API §9) and the audit trail."""
from fastapi import APIRouter, Query, Request

router = APIRouter(tags=["metrics"])


def core(request: Request):
    return request.app.state.core


@router.get("/metrics/{name}")
def metric(name: str, request: Request, from_: str | None = Query(None, alias="from"),
           to: str | None = None, service: str | None = None):
    return core(request).metric(name, from_, to, service)


@router.get("/audit")
def audit(request: Request, ticket_id: str | None = None, actor: str | None = None, type: str | None = None,
          from_: str | None = Query(None, alias="from"), to: str | None = None, limit: int = Query(200, le=5000)):
    """Decisions, overrides, acceptances and KB/policy changes, from the event log."""
    return {"events": core(request).audit(ticket_id, actor, type, from_, to, limit)}
