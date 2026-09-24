"""Per-ticket triage: retrieval (step 2) and the structured triage LLM call (step 3),
plus self-consistency samples for confidence. Post-processing (step 4) is milestone 3."""
from triage import config
from triage.catalog import split_comment
from triage.llm import chat_structured
from triage.schemas import TriageEvidence, TriageOutput, TriageSample

TRIAGE_SYSTEM_PROMPT = """You are an experienced L2 service-desk agent at a pan-European asset manager. Triage one Jira ticket.

Rules:
- Decide from the description and comments. The title can be misleading on purpose.
- Pick the one service whose scope owns what is actually broken or requested. When a past resolution clearly describes the same problem, its service is strong evidence. Use "{catch_all}" only when no specific service can be identified.
- A licence or access request for one specific business application belongs to that application's service.
- Work type: "Incident" = something is broken or degraded; "Service Request" = someone asks for something (licence, access, change, information). The Request type prior below is a strong hint; override it only if the content clearly says otherwise, and say why.
- Urgency and Impact: judge from the content with the definitions below. A failure on a Critical service usually justifies higher values than the same failure on a Non-Critical one. Counterparties, clients, deadlines or regulatory exposure raise them. Routine requests and informational tickets are low.
- Resolution: the status an L2 agent will close this ticket with.
  - done = a real problem or request that can be acted on. This is the normal case, even if the fix is not described yet.
  - cancelled = nonsense, test or accidental input, or nothing actionable at all.
  - clarification = a plausible request that cannot be acted on because essential details (which system, role, approver, scope) are missing.
  - cannot reproduce = an alert or report that has already cleared by itself, with no evidence of a problem left.

Urgency levels:
{urgency}

Impact levels:
{impact}

Reasoning (first, ONE sentence of at most 30 words): what is actually broken or requested, which service owns it, and who is affected."""


def _levels(defs: dict[str, str], labels: dict[str, str]) -> str:
    return "\n".join(f"- {lvl} ({labels[lvl]}): {text}" for lvl, text in defs.items())


def system_prompt() -> str:
    return TRIAGE_SYSTEM_PROMPT.format(
        catch_all=config.CATCH_ALL_SERVICE,
        urgency=_levels(config.URGENCY_DEFINITIONS, config.URGENCY_LABELS),
        impact=_levels(config.IMPACT_DEFINITIONS, config.IMPACT_LABELS),
    )


def _card_line(card: dict) -> str:
    line = f"- {card['service']} [{card['criticality']}]: {card['scope']}"
    return line + (f" Not: {card['boundary']}" if card.get("boundary") else "")


def _ticket_block(record: dict) -> str:
    request_type = record.get("Request type")
    prior = config.REQUEST_TYPE_PRIOR.get(request_type) if request_type else None
    prior_text = prior or "none (decide from the content)"
    lines = [
        f"Request type: {request_type or '-'} (work type prior: {prior_text})",
        f"Title: {record.get('Summary') or '-'}",
        f"Description: {record.get('Description') or '-'}",
        f"Business entity: {', '.join(record.get('Business Entity') or []) or '-'}",
    ]
    if config.SHOW_REPORTED_SERVICE:
        lines.append(f"Reported service (may be wrong): {', '.join(record.get('Affected Business or IT Services') or []) or '-'}")
    if record.get("Business Critical for Entity"):
        lines.append(f"Business critical for entity: {', '.join(record['Business Critical for Entity'])}")
    if config.SHOW_REPORTED_LEVELS:
        lines.append(f"Reported urgency / impact (may be wrong): {record.get('Urgency') or '-'} / {record.get('Impact') or '-'}")
    comments = [split_comment(c)[1] for c in record.get("All Comments") or []]
    lines.append("Comments:\n" + ("\n".join(f"- {c}" for c in comments) if comments else "- (none)"))
    return "\n".join(lines)


def build_triage_messages(record: dict, retrieved: dict, cards: dict) -> list[dict]:
    top_cards = ", ".join(f"{c['service']} ({c['score']:.2f})" for c in retrieved["cards"])
    patterns = "\n".join(
        f"- [{p['service']}] (similarity {p['score']:.2f}) {p['text']}" for p in retrieved["patterns"]
    )
    user = (
        "Service catalogue:\n" + "\n".join(_card_line(c) for c in cards["cards"]) + "\n\n"
        f"Most similar services by text similarity: {top_cards}\n\n"
        f"Most similar past resolutions (hints, may be unrelated):\n{patterns}\n\n"
        f"Ticket:\n{_ticket_block(record)}"
    )
    return [{"role": "system", "content": system_prompt()}, {"role": "user", "content": user}]


EVIDENCE_SYSTEM_PROMPT = """You extract evidence from a Jira ticket. For each decision field, copy up to 3 short phrases (3-12 words) word for word from the ticket text below that support the given decision. Copy exactly; never paraphrase or add words. Use an empty list when nothing in the ticket supports a field."""


def build_evidence_messages(record: dict, final: TriageOutput) -> list[dict]:
    comments = [split_comment(c)[1] for c in record.get("All Comments") or []]
    ticket = "\n".join([f"Title: {record.get('Summary') or '-'}", f"Description: {record.get('Description') or '-'}"]
                       + [f"Comment: {c}" for c in comments])
    decisions = "\n".join(f"- {f}: {getattr(final, f)}" for f in config.AI_FIELDS)
    return [{"role": "system", "content": EVIDENCE_SYSTEM_PROMPT},
            {"role": "user", "content": f"Ticket:\n{ticket}\n\nDecisions:\n{decisions}"}]


def triage_ticket(record: dict, retriever, cards: dict, chat=chat_structured,
                  n_samples: int = config.SELF_CONSISTENCY_N, evidence: bool = config.EVIDENCE_ENABLED) -> dict:
    """Final values from one temperature-0 call with short reasoning; `n_samples` seeded
    samples without reasoning feed self-consistency; an optional small evidence call
    (ticket + decisions only, so it can only quote the ticket) yields the quotes."""
    retrieved = retriever.retrieve(record)
    messages = build_triage_messages(record, retrieved, cards)
    final = chat(messages, TriageOutput)
    samples = [
        chat(messages, TriageSample, temperature=config.SAMPLE_TEMPERATURE, seed=seed)
        for seed in config.SAMPLE_SEEDS[:n_samples]
    ]
    quotes = chat(build_evidence_messages(record, final), TriageEvidence) if evidence else None
    return {"triage": final, "samples": samples, "evidence": quotes, "retrieved": retrieved, "messages": messages}


def utc_now() -> str:
    import datetime as dt

    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def triage_versions(kb_dir=None, kb_version: str | None = None):
    from triage.decisions import run_versions
    from triage.resolution import SYSTEM_PROMPT as COMMENT_PROMPT

    return run_versions(TRIAGE_SYSTEM_PROMPT + EVIDENCE_SYSTEM_PROMPT + COMMENT_PROMPT, TriageOutput.model_json_schema(),
                        kb_dir, kb_version)


def run_ticket(record: dict, ticket_id: str, run_id: str, retriever, cards: dict, catalog: dict,
               versions, chat=chat_structured, n_samples: int = config.SELF_CONSISTENCY_N,
               evidence: bool = config.EVIDENCE_ENABLED, comment: bool = config.COMMENT_ENABLED,
               policy: dict | None = None) -> "RunRecord":
    """One live run for one ticket -> a CORE_API §3 run record. Failures are recorded,
    not raised, so a batch keeps going."""
    from triage.decisions import (
        assignee_decision,
        build_ai_decisions,
        original_values,
        priority_decision,
        snapshot_id,
        team_decision,
    )
    from triage.calibration import calibrate
    from triage.lanes import assign_lane
    from triage.resolution import generate_comment
    from triage.schemas import RunRecord

    started = utc_now()
    base = dict(run_id=run_id, ticket_id=ticket_id, snapshot_id=snapshot_id(record), versions=versions, started_at=started)
    try:
        out = triage_ticket(record, retriever, cards, chat=chat, n_samples=n_samples, evidence=evidence)
        calibration = (policy or {}).get("calibration")
        decisions = build_ai_decisions(record, out["triage"], out["samples"], out["retrieved"], out["evidence"])
        decisions = calibrate(decisions, calibration, config.AI_FIELDS)  # rule fields then inherit calibrated inputs
        original = original_values(record)
        decisions["team"] = team_decision(decisions["service"], catalog["service_team"], original)
        decisions["priority"] = priority_decision(decisions["urgency"], decisions["impact"], decisions["service"].value, original)
        decisions["assignee"] = assignee_decision(decisions["service"], out["retrieved"], catalog, original)
        decisions = calibrate(decisions, calibration, ["assignee"])
        lane, reasons, sampled = assign_lane(decisions, run_id, policy)
        resolution_comment, error = None, None
        if comment:
            try:
                resolution_comment = generate_comment(record, decisions, out["retrieved"], catalog, chat=chat)
            except Exception as e:  # noqa: BLE001 - the decisions stand without a comment
                error = f"comment: {type(e).__name__}: {e}"
        return RunRecord(**base, status="completed", completed_at=utc_now(), decisions=decisions,
                         resolution_comment=resolution_comment, error=error,
                         lane=lane, lane_reasons=reasons, audit_sampled=sampled, reasoning=out["triage"].reasoning)
    except Exception as e:  # noqa: BLE001 - recorded on the run, as the API would
        return RunRecord(**base, status="failed", completed_at=utc_now(), error=f"{type(e).__name__}: {e}")


def run_batch(items: list[tuple[str, dict]], run_id: str, retriever, cards: dict, catalog: dict, versions,
              concurrency: int = config.LLM_CONCURRENCY, **kw) -> list["RunRecord"]:
    """Run tickets through run_ticket with a small thread pool; results keep input order."""
    from concurrent.futures import ThreadPoolExecutor

    def one(item):
        tid, record = item
        return run_ticket(record, tid, f"{run_id}-{tid}", retriever, cards, catalog, versions, **kw)

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as ex:
        return list(ex.map(one, items))
