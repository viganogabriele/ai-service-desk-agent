"""Event log (append-only table) exposed as a paged list and as a resumable SSE stream."""
import asyncio
import json

from fastapi import APIRouter, Header, Query, Request
from sse_starlette.sse import EventSourceResponse

router = APIRouter(tags=["events"])
POLL_S = 0.5


@router.get("/events")
def list_events(request: Request, after_seq: int = 0, limit: int = Query(100, le=1000)):
    events = request.app.state.core.db.events_after(after_seq, limit)
    return {"events": events, "next_seq": events[-1]["seq"] if events else after_seq}


@router.get("/events/stream")
async def stream(request: Request, after_seq: int = 0, max_events: int | None = None,
                 last_event_id: str | None = Header(default=None)):
    """SSE; resumable with the Last-Event-ID header (= seq). `max_events` ends the stream
    after N events (for polling clients and tests)."""
    db = request.app.state.core.db
    last = int(last_event_id) if last_event_id and last_event_id.isdigit() else after_seq

    async def gen():
        nonlocal last
        sent = 0
        while True:
            for e in db.events_after(last, 100):
                last = e["seq"]
                sent += 1
                yield {"id": str(e["seq"]), "event": e["type"], "data": json.dumps(e, ensure_ascii=False)}
                if max_events is not None and sent >= max_events:
                    return
            if await request.is_disconnected():
                return
            await asyncio.sleep(POLL_S)

    return EventSourceResponse(gen())
