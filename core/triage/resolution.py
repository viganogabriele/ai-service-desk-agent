"""Resolution comment generation (AGENTS step 5) and its CORE_API §4 record: segments by
origin (ticket / exemplar / generated) and specifics supported by neither source."""
import re

from triage import config
from triage.catalog import split_comment
from triage.llm import chat_structured
from triage.schemas import CommentSegment, ResolutionComment, ResolutionCommentRecord

NGRAM = 3  # a run of >= 3 words found verbatim in a source is attributed to it
TICKET_ID_RE = re.compile(r"\b[A-Z][A-Z0-9]+-\d+\b")
_WORD_RE = re.compile(r"\S+")
_NORM_RE = re.compile(r"[^\w%.:/-]+")

STATUS_GUIDANCE = {
    "done": "Say what the root cause or requested action was, what was fixed or provided, and how it was verified.",
    "cancelled": "Say why the ticket was closed without action (nonsense, test, duplicate or misrouted) and what was checked.",
    "clarification": "Say which missing details were requested from the reporter and that the ticket waits for them.",
    "cannot reproduce": "Say what was checked, that no error or impact was found, and that monitoring continues.",
}

SYSTEM_PROMPT = """You are {name}, an L2 support agent in the {team} team of a pan-European asset manager. Write the resolution note you record when closing this ticket.
Rules:
- One or two sentences, past tense, starting with "Resolution: ". No greeting, no sign-off.
- The ticket closes as "{status}". {guidance}
- Reuse concrete details from the ticket (systems, funds, brokers, entities, times, amounts).
- {exemplar_rule}
- Never write filler such as "Problem fixed." or "Issue resolved.", and never invent ticket numbers, names or amounts that appear neither in the ticket nor in the example notes."""

SAME_SERVICE_RULE = "The example notes are real past resolutions of this service: base the root cause and fix on the closest one when it fits the ticket, and copy its style."
STYLE_ONLY_RULE = "The example notes come from other services: copy only their style and level of detail, not their content."


def pick_exemplars(service: str, catalog: dict, pattern_scores: dict[str, float], k: int = 2) -> tuple[list[dict], bool]:
    """Top-k same-service patterns by similarity; else same-team patterns, else any, as
    style-only exemplars. Returns (patterns, style_only)."""
    def best(ps):
        return sorted(ps, key=lambda p: (-pattern_scores.get(p["id"], 0.0), p["id"]))[:k]

    same = [p for p in catalog["patterns"] if p["service"] == service]
    if same:
        return best(same), False
    team = catalog["service_team"][service]
    same_team = [p for p in catalog["patterns"] if catalog["service_team"][p["service"]] == team]
    return best(same_team or catalog["patterns"]), True


def _ticket_source(record: dict) -> str:
    comments = [split_comment(c)[1] for c in record.get("All Comments") or []]
    return "\n".join([record.get("Summary") or "", record.get("Description") or "", *comments])


def build_comment_messages(record: dict, service: str, team: str, status: str, assignee: str,
                           exemplars: list[dict], style_only: bool) -> list[dict]:
    system = SYSTEM_PROMPT.format(
        name=assignee.split("@")[0].replace(".", " ").title(), team=team, status=status,
        guidance=STATUS_GUIDANCE[status], exemplar_rule=STYLE_ONLY_RULE if style_only else SAME_SERVICE_RULE,
    )
    examples = "\n".join(f"- {p['text']}" for p in exemplars)
    user = (f"Ticket (service: {service}):\n{_ticket_source(record)}\n\n"
            f"Example notes{' (style only)' if style_only else ''}:\n{examples}\n\n"
            'Return JSON: {"text": "Resolution: ..."}')
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _norm(word: str) -> str:
    return _NORM_RE.sub("", word.lower()).strip(".:")


def _ngrams(text: str, n: int = NGRAM) -> set[tuple[str, ...]]:
    words = [w for w in (_norm(m.group(0)) for m in _WORD_RE.finditer(text)) if w]
    return {tuple(words[i:i + n]) for i in range(len(words) - n + 1)}


def attribute_segments(body: str, ticket: str, exemplars: list[str]) -> list[CommentSegment]:
    """Split `body` (the comment after "<assignee>: ") into segments by origin. Words in a
    run of >= NGRAM words found in the ticket are "ticket", else in an exemplar
    "exemplar", else "generated". Segments concatenate back to `body` exactly."""
    matches = list(_WORD_RE.finditer(body))
    norms = [_norm(m.group(0)) for m in matches]
    ticket_ngrams, exemplar_ngrams = _ngrams(ticket), set().union(*(_ngrams(e) for e in exemplars)) if exemplars else set()
    origin = ["generated"] * len(matches)
    for i in range(len(matches) - NGRAM + 1):
        gram = tuple(norms[i:i + NGRAM])
        for j in range(i, i + NGRAM):
            if gram in ticket_ngrams:
                origin[j] = "ticket"
            elif gram in exemplar_ngrams and origin[j] == "generated":
                origin[j] = "exemplar"
    if body.startswith(config.RESOLUTION_PREFIX) and matches:
        origin[0] = "exemplar"  # the "Resolution:" format comes from the historical notes

    segments: list[CommentSegment] = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        start = 0 if i == 0 else m.start()
        piece = body[start:end]
        if segments and segments[-1].origin == origin[i]:
            segments[-1] = CommentSegment(text=segments[-1].text + piece, origin=origin[i])
        else:
            segments.append(CommentSegment(text=piece, origin=origin[i]))
    return segments


_SPECIFIC_RE = re.compile(
    r"\b(?:[A-Z]{2,}[A-Z0-9_]*|[A-Za-z]*\d[\w.:/%-]*|[A-Z][a-z]+(?:[A-Z][a-z]+)+)\b"  # codes, numbers/times, CamelCase
)
_MIDSENTENCE_PROPER_RE = re.compile(r"(?<![.!?:]\s)(?<!^)\b([A-Z][a-z]{2,})\b")
COMMON_CAPITALISED = {"Resolution", "The", "This", "We", "It", "After", "Once", "Then", "Monday", "Tuesday",
                      "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "January", "February", "March",
                      "April", "May", "June", "July", "August", "September", "October", "November", "December"}


def unsupported_specifics(body: str, sources: list[str]) -> list[str]:
    """Named details (codes, numbers, times, proper nouns) in `body` that appear in none
    of `sources` (case-insensitive)."""
    haystack = " ".join(sources).lower()
    candidates = [m.group(0) for m in _SPECIFIC_RE.finditer(body)]
    candidates += [m.group(1) for m in _MIDSENTENCE_PROPER_RE.finditer(body)]
    out = []
    for c in candidates:
        token = c.strip(".,;:")
        if token and token not in COMMON_CAPITALISED and token.lower() not in haystack and token not in out:
            out.append(token)
    return out


def generate_comment(record: dict, decisions: dict, retrieved: dict, catalog: dict,
                     chat=chat_structured) -> ResolutionCommentRecord:
    service, status = decisions["service"].effective_value, decisions["resolution"].effective_value
    assignee, team = decisions["assignee"].effective_value, decisions["team"].effective_value
    exemplars, style_only = pick_exemplars(service, catalog, retrieved.get("pattern_scores", {}))
    messages = build_comment_messages(record, service, team, status, assignee, exemplars, style_only)
    ticket = _ticket_source(record)
    exemplar_texts = [p["text"] for p in exemplars]
    body = None
    for attempt in range(1 + config.LLM_MAX_RETRIES):
        body = chat(messages, ResolutionComment, seed=config.SEED + attempt).text
        invented = [t for t in TICKET_ID_RE.findall(body) if t not in ticket]
        if not invented:
            break  # otherwise retry with another seed; the last attempt is kept and flagged below
    body = " ".join(body.split())
    return ResolutionCommentRecord(
        text=f"{assignee}: {body}",
        segments=attribute_segments(body, ticket, exemplar_texts),
        exemplar_pattern_ids=[p["id"] for p in exemplars],
        unsupported_specifics=unsupported_specifics(body[len(config.RESOLUTION_PREFIX):], [ticket, *exemplar_texts]),
    )
