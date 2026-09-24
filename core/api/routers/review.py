"""Review queue, acceptances, overrides (preview/commit with cascades) and comments."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(tags=["review"])


class Change(BaseModel):
    field: str
    value: str | None
    reason_code: str
    note: str | None = None


class OverrideIn(BaseModel):
    base_run_id: str
    actor: str
    changes: list[Change]
    force: bool = False


class AcceptIn(BaseModel):
    run_id: str
    actor: str
    fields: list[str] | None = None


class CommentIn(BaseModel):
    text: str
    actor: str


def core(request: Request):
    return request.app.state.core


@router.get("/queue")
def review_queue(request: Request, lane: str = "needs_review", sort: str = "risk"):
    return {"lane": lane, "tickets": core(request).queue(lane, sort)}


@router.post("/tickets/{ticket_id}/accept")
def accept(ticket_id: str, body: AcceptIn, request: Request):
    return core(request).accept(ticket_id, body.run_id, body.fields, body.actor)


@router.post("/tickets/{ticket_id}/overrides/preview")
def preview(ticket_id: str, body: OverrideIn, request: Request):
    return core(request).preview(ticket_id, body.model_dump())


@router.post("/tickets/{ticket_id}/overrides")
def commit(ticket_id: str, body: OverrideIn, request: Request):
    return core(request).commit(ticket_id, body.model_dump())


@router.post("/tickets/{ticket_id}/resolution-comment/regenerate", status_code=202)
def regenerate_comment(ticket_id: str, request: Request):
    return core(request).request_comment(ticket_id)


@router.put("/tickets/{ticket_id}/resolution-comment")
def edit_comment(ticket_id: str, body: CommentIn, request: Request):
    return core(request).edit_comment(ticket_id, body.text, body.actor)
