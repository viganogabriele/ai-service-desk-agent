"""Turn the LLM's verbatim evidence quotes into character spans in the ticket.
Only quotes that can be located are kept, so every span is checkable."""
import re

from triage.schemas import TicketSpan

_STRIP = " \t\n\"'“”‘’.,;:…-"


def ticket_fields(record: dict) -> list[tuple[str, str]]:
    """(field name, text) pairs searched for evidence, in reading order."""
    fields = [("Summary", record.get("Summary") or ""), ("Description", record.get("Description") or "")]
    fields += [(f"All Comments[{i}]", c or "") for i, c in enumerate(record.get("All Comments") or [])]
    return [(f, t) for f, t in fields if t]


def _pattern(quote: str) -> re.Pattern | None:
    words = quote.strip(_STRIP).split()
    if not words:
        return None
    return re.compile(r"\s+".join(re.escape(w) for w in words), re.IGNORECASE)


def locate_quote(record: dict, quote: str) -> TicketSpan | None:
    """First occurrence of `quote` (case- and whitespace-insensitive) in the ticket."""
    pat = _pattern(quote)
    if pat is None:
        return None
    for field, text in ticket_fields(record):
        m = pat.search(text)
        if m:
            return TicketSpan(field=field, start=m.start(), end=m.end(), text=m.group(0))
    return None


def locate_quotes(record: dict, quotes: list[str]) -> tuple[list[TicketSpan], list[str]]:
    """Spans for the quotes that were found (deduplicated), and the quotes that were not."""
    spans, missing, seen = [], [], set()
    for q in quotes:
        span = locate_quote(record, q)
        if span is None:
            missing.append(q)
        elif (span.field, span.start, span.end) not in seen:
            seen.add((span.field, span.start, span.end))
            spans.append(span)
    return spans, missing
