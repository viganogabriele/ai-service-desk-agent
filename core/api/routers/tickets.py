"""Tickets, batches, runs, re-triage and export."""
from fastapi import APIRouter, Header, Request, Response
from pydantic import BaseModel

from triage.state import StateError

router = APIRouter(tags=["tickets"])


class TicketIn(BaseModel):
    external_key: str
    fields: dict


def core(request: Request):
    return request.app.state.core


@router.post("/tickets", status_code=202)
def import_ticket(body: TicketIn, request: Request, response: Response,
                  idempotency_key: str | None = Header(default=None)):
    status, out = core(request).import_ticket(body.external_key, body.fields, idempotency_key)
    response.status_code = status
    return out


@router.post("/batches", status_code=202)
def import_batch(body: dict, request: Request):
    return core(request).import_batch(body)


@router.get("/batches/{batch_id}")
def batch_status(batch_id: str, request: Request):
    return core(request).batch_status(batch_id)


@router.get("/batches/{batch_id}/export")
def export_batch(batch_id: str, request: Request):
    return core(request).export_batch(batch_id)


@router.get("/tickets")
def list_tickets(request: Request, lane: str | None = None, service: str | None = None, flag: str | None = None,
                 status: str | None = None, expand: str | None = None):
    """`expand=view` adds each ticket's view (GET /tickets/{id}) under `view`."""
    return {"tickets": core(request).list_tickets(lane, service, flag, status, expand=expand)}


@router.get("/tickets/{ticket_id}")
def ticket_view(ticket_id: str, request: Request):
    return core(request).ticket_view(ticket_id)


@router.delete("/tickets/{ticket_id}")
def delete_ticket(ticket_id: str, request: Request):
    """The ticket is gone from the source (e.g. deleted in Jira): drop it and its state."""
    return core(request).delete_ticket(ticket_id)


@router.post("/tickets/{ticket_id}/retriage", status_code=202)
def retriage(ticket_id: str, request: Request):
    return core(request).retriage(ticket_id)


@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request):
    c = core(request)
    row = c.db.run_row(run_id)
    if not row:
        raise StateError(404, "not_found", f"unknown run {run_id}", {"run": run_id})
    record = c.db.run(run_id)
    return record.model_dump() if record else {k: row[k] for k in ("run_id", "ticket_id", "snapshot_id", "mode", "status")}


class ClosureIn(BaseModel):
    fields: dict = {}
    resolution_note: str | None = None
    resolver: str | None = None
    actor: str | None = None


@router.post("/tickets/{ticket_id}/closure", status_code=201)
def closure(ticket_id: str, body: ClosureIn, request: Request):
    """Final outcome from Jira, harvested for the KB (CORE_API §6C.2)."""
    return core(request).closure(ticket_id, body.model_dump())


@router.get("/tickets/{ticket_id}/export")
def export_ticket(ticket_id: str, request: Request):
    return core(request).export_ticket(ticket_id)
