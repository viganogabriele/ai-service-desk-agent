"""Demo tickets: a newly written incoming ticket for showing the product. Nothing is stored;
the sync layer files it in Jira and it comes back through the normal import."""
from fastapi import APIRouter, Request

from triage import usage
from triage.state import StateError

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post("/tickets")
def demo_ticket(request: Request):
    try:
        with usage.tagged(purpose="demo"):
            return {"fields": request.app.state.core.engine.demo_ticket()}
    except RuntimeError as e:  # the LLM failed after its retries
        raise StateError(503, "llm_unavailable", f"Could not write a demo ticket: {e}") from e
