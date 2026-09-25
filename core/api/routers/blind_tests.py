"""Blind tests: a judge's challenge-format file, triaged by the submission pipeline (and a
reference model when configured) without touching live state. See api/blind_tests.py."""
from fastapi import APIRouter, Request

router = APIRouter(prefix="/blind-tests", tags=["blind-tests"])


@router.post("", status_code=202)
def create(body: dict, request: Request):
    """`{input: <challenge-format object>, source?: <file name>}` -> the test to poll."""
    return request.app.state.core.create_blind_test(body)


@router.get("/{blind_test_id}")
def get(blind_test_id: str, request: Request):
    """Progress per pipeline, per-ticket timings, tokens and cost, and the filled file once done."""
    return request.app.state.core.blind_test(blind_test_id)
