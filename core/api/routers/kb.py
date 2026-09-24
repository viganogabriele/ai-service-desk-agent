"""Knowledge-base versions, promotion, proposals and health (CORE_API §6C)."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/kb", tags=["knowledge base"])


class Actor(BaseModel):
    actor: str


class Decision(BaseModel):
    actor: str
    note: str | None = None
    payload: dict | None = None


def core(request: Request):
    return request.app.state.core


@router.post("/build", status_code=202)
def build(body: Actor, request: Request):
    """Mine the training corpus and draft service cards (LLM) into a new draft version."""
    return core(request).request_kb_build(body.actor)


@router.get("/versions")
def versions(request: Request):
    return {"live": core(request).engine.kb_version, "versions": core(request).kb_versions()}


@router.post("/versions", status_code=201)
def new_draft(body: Actor, request: Request):
    """A draft from the live version plus approved proposals (embeddings rebuild on first use)."""
    return core(request).new_kb_draft(body.actor)


@router.get("/versions/{version}")
def version(version: str, request: Request):
    return core(request).kb_version(version)


@router.post("/versions/{version}/publish")
def publish(version: str, body: Actor, request: Request):
    return core(request).publish_kb(version, body.actor)


@router.post("/versions/{version}/promote")
def promote(version: str, body: Actor, request: Request):
    """Make a published version live; promoting the previous version is the rollback."""
    return core(request).promote_kb(version, body.actor)


@router.get("/proposals")
def proposals(request: Request, status: str | None = None):
    return {"proposals": core(request).proposals(status)}


@router.post("/proposals/{proposal_id}/approve")
def approve(proposal_id: str, body: Decision, request: Request):
    return core(request).decide_proposal(proposal_id, True, body.actor, body.note, body.payload)


@router.post("/proposals/{proposal_id}/reject")
def reject(proposal_id: str, body: Decision, request: Request):
    return core(request).decide_proposal(proposal_id, False, body.actor, body.note)


@router.get("/health")
def health(request: Request):
    return core(request).kb_health()
