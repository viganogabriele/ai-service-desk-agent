"""Policy versions and the kill switch (CORE_API §6D)."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/policy", tags=["policy"])


class PolicyIn(BaseModel):
    actor: str
    content: dict
    note: str | None = None


class PreviewIn(BaseModel):
    content: dict
    days: int = 30


class Switch(BaseModel):
    actor: str
    note: str | None = None


def core(request: Request):
    return request.app.state.core


@router.get("")
def get_policy(request: Request):
    return core(request).policy()


@router.put("")
def put_policy(body: PolicyIn, request: Request):
    """Creates a new policy version (partial content is merged onto the current one)."""
    return core(request).put_policy(body.content, body.actor, body.note)


@router.post("/pause")
def pause(body: Switch, request: Request):
    """Triage keeps running, nothing is auto-applied (lane reason policy_paused)."""
    return core(request).set_paused(True, body.actor, body.note)


@router.post("/resume")
def resume(body: Switch, request: Request):
    return core(request).set_paused(False, body.actor, body.note)


@router.post("/preview")
def preview(body: PreviewIn, request: Request):
    """Estimated auto-apply and error rates of a proposed policy, versus the current one."""
    return core(request).policy_preview(body.content, body.days)
