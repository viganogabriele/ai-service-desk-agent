"""Shadow evaluations (CORE_API §6D): replay tickets under other versions, compare."""
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/evaluations", tags=["evaluations"])


class EvaluationIn(BaseModel):
    versions: dict = {}
    ticket_set: str = "gold"
    days: int | None = None


@router.post("", status_code=202)
def create(body: EvaluationIn, request: Request):
    return request.app.state.core.create_evaluation(body.model_dump())


@router.get("/{evaluation_id}")
def get(evaluation_id: str, request: Request):
    return request.app.state.core.evaluation(evaluation_id)
