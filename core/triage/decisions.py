"""Build CORE_API §4 decision records from a triage result, and the run versions."""
import hashlib
import json

from triage import config
from triage.confidence import (
    ai_field_signals,
    assignee_confidence,
    combine,
    pattern_assignee_signals,
    rule_confidence,
    self_consistency,
    vote_alternatives,
)
from triage.evidence import locate_quotes
from triage.priority import compute_priority, normalize_level
from triage.schemas import (
    Alternative,
    DecisionRecord,
    Evidence,
    PatternEvidence,
    RunVersions,
    TriageEvidence,
    TriageOutput,
    TriageSample,
)


def _hash(payload) -> str:
    data = payload if isinstance(payload, bytes) else json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    return hashlib.sha256(data).hexdigest()


def snapshot_id(record: dict) -> str:
    return _hash(record)[:16]


def run_versions(prompt_text: str, schema: dict, kb_dir=None, kb_version: str | None = None) -> RunVersions:
    kb_dir = kb_dir or config.KB_DIR
    kb_version = kb_version or config.KB_VERSION
    kb_bytes = b"".join((kb_dir / name).read_bytes() for name in ("catalog.json", "service_cards.json"))
    policy = {
        k: getattr(config, k)
        for k in ("ASSIGNEE_SIM_THRESHOLD", "WEAK_MATCH_THRESHOLD", "FALLBACK_CONFIDENCE", "CONFIDENCE_WEIGHTS",
                  "RETRIEVAL_MARGIN_SCALE", "PATTERN_AGREEMENT_MIN_SIM", "SELF_CONSISTENCY_N", "SAMPLE_TEMPERATURE",
                  "FIELD_THRESHOLDS", "AUTONOMY_DEFAULT", "AUTONOMY_FIELDS", "AUTONOMY_SERVICES", "POLICY_PAUSED",
                  "AUDIT_SAMPLE_RATE")
    }
    return RunVersions(
        model=config.TRIAGE_MODEL,
        prompt=f"triage-{_hash([prompt_text, schema])[:10]}",
        kb=f"{kb_version}-{_hash(kb_bytes)[:8]}",
        policy=f"{config.POLICY_VERSION}-{_hash(policy)[:8]}",
    )


def original_values(record: dict) -> dict[str, str | None]:
    """The ticket's reported values, per decision field (levels in Title Case)."""
    out = {}
    for field, name in config.DECISION_FIELDS.items():
        v = record.get(name)
        if isinstance(v, list):
            v = v[0] if v else None
        if v and field in ("urgency", "impact", "priority"):
            try:
                v = normalize_level(v)
            except ValueError:
                v = None
        out[field] = v or None
    return out


def _lower(level: str, than: str | None) -> bool:
    return than is not None and config.LEVELS.index(level) > config.LEVELS.index(than)


def _agree_text(final: str, samples: list[str]) -> str:
    sc = self_consistency(final, samples)
    return f"; {round(sc * len(samples))} of {len(samples)} samples agree" if sc is not None else ""


def _service_reason(value: str, signals: dict, context: dict) -> str:
    top_card, top_score = max(context["card_scores"].items(), key=lambda kv: kv[1])
    text = f"The LLM placed the ticket in {value}"
    text += "; the closest service card agrees" if signals["card_agreement"] else f"; the closest service card was {top_card} ({top_score:.2f})"
    if "pattern_agreement" in signals:
        top = context["top_pattern"]
        text += (", and so does the closest past resolution" if signals["pattern_agreement"]
                 else f", but the closest past resolution ({top['score']:.2f}) belongs to {top['service']}")
    return text + "."


def _reason(field: str, value: str, samples: list[str], signals: dict, context: dict) -> str:
    agree = _agree_text(value, samples)
    if field == "service":
        return _service_reason(value, signals, context)
    if field == "work_type":
        prior = context.get("prior")
        tail = "" if not prior else (f", in line with the {context['request_type']} prior" if prior == value
                                      else f", overriding the {context['request_type']} prior ({prior})")
        return f"The LLM judged this a {value}{tail}{agree}."
    if field in ("urgency", "impact"):
        label = (config.URGENCY_LABELS if field == "urgency" else config.IMPACT_LABELS)[value]
        return f"The LLM rated {field} {value} ({label}) from the ticket content{agree}."
    return f"The LLM expects the ticket to close as '{value}'{agree}."


def _flags(field: str, value: str, original: dict, service: str, context: dict) -> list[str]:
    flags = []
    if field == "service":
        if original["service"] and original["service"] != value:
            flags.append("service_changed")
        if value == config.CATCH_ALL_SERVICE:
            flags.append("generic_bucket")
        if max(context["card_scores"].values()) < config.WEAK_MATCH_THRESHOLD:
            flags.append("weak_match")
    if field == "work_type" and original["work_type"] and original["work_type"] != value:
        flags.append("work_type_changed")
    if field in ("urgency", "impact", "priority") and config.CRITICALITY.get(service) == "Critical":
        if _lower(value, original[field]):
            flags.append("downgrade_on_critical")
    return flags


def _alternatives(field: str, value: str, samples: list[str], context: dict) -> list[Alternative]:
    if field == "service":
        candidates = {c["service"] for c in context["top_cards"]} | set(samples)
        candidates.discard(value)
        ranked = sorted(candidates, key=lambda s: -context["card_scores"][s])
        return [Alternative(value=s, score=max(0.0, min(1.0, context["card_scores"][s])), source="ai_judgment")
                for s in ranked]
    return [Alternative(value=v, score=share, source="ai_judgment") for v, share in vote_alternatives(value, samples)]


def build_ai_decisions(record: dict, final: TriageOutput, samples: list[TriageSample], retrieved: dict,
                       evidence: TriageEvidence | None = None) -> dict[str, DecisionRecord]:
    original = original_values(record)
    request_type = record.get("Request type")
    context = {
        "card_scores": retrieved["card_scores"],
        "top_cards": retrieved["cards"],
        "top_pattern": retrieved["patterns"][0] if retrieved["patterns"] else None,
        "prior": config.REQUEST_TYPE_PRIOR.get(request_type) if request_type else None,
        "request_type": request_type,
    }
    out = {}
    for field in config.AI_FIELDS:
        value = getattr(final, field)
        sampled = [getattr(s, field) for s in samples]
        signals = ai_field_signals(field, value, sampled, context)
        spans, _missing = locate_quotes(record, getattr(evidence, field) if evidence else [])
        ev = Evidence(ticket_spans=spans)
        if field == "service":
            ev = Evidence(ticket_spans=spans, patterns=_pattern_evidence(retrieved), service_card=value)
        out[field] = DecisionRecord(
            field=field,
            value=value,
            original_value=original[field],
            effective_value=value,
            source="ai_judgment",
            confidence=combine(signals),
            confidence_signals=signals,
            reason=_reason(field, value, sampled, signals, context),
            evidence=ev,
            alternatives=_alternatives(field, value, sampled, context),
            flags=_flags(field, value, original, final.service, context),
        )
    return out


def team_decision(service: DecisionRecord, service_team: dict[str, str], original: dict) -> DecisionRecord:
    team = service_team[service.value]
    return DecisionRecord(
        field="team",
        value=team,
        original_value=original["team"],
        effective_value=team,
        source="rule",
        confidence=rule_confidence([service.confidence]),
        confidence_signals={"service": service.confidence},
        reason=f"{team} owns {service.value} in the service catalogue.",
        rule_trace=f"team_of({service.value}) = {team}",
    )


def priority_decision(urgency: DecisionRecord, impact: DecisionRecord, service: str, original: dict) -> DecisionRecord:
    value = compute_priority(urgency.value, impact.value)
    flags = []
    if config.CRITICALITY.get(service) == "Critical" and _lower(value, original["priority"]):
        flags.append("downgrade_on_critical")
    return DecisionRecord(
        field="priority",
        value=value,
        original_value=original["priority"],
        effective_value=value,
        source="rule",
        confidence=rule_confidence([urgency.confidence, impact.confidence]),
        confidence_signals={"urgency": urgency.confidence, "impact": impact.confidence},
        reason=f"Priority follows the README matrix for urgency {urgency.value} and impact {impact.value}.",
        rule_trace=f"matrix[urgency={urgency.value}][impact={impact.value}] = {value}",
        flags=flags,
    )


def _pattern_evidence(retrieved: dict) -> list[PatternEvidence]:
    return [PatternEvidence(pattern_id=p["id"], similarity=round(p["score"], 4), service=p["service"],
                            resolver=p["resolver"]) for p in retrieved["patterns"]]


def assignee_alternatives(service: str, chosen: str, catalog: dict, pattern_scores: dict[str, float]) -> list[Alternative]:
    """Ranked resolvers from patterns only: same service first, then same team (each by
    best pattern similarity), then the service's fallback. Other training assignees are
    random and never offered. A service without patterns offers no alternatives: its
    fallback is already the value."""
    if not catalog["resolvers_by_service"].get(service):
        return []
    team = catalog["service_team"][service]
    best: dict[tuple[int, str], float] = {}
    for p in catalog["patterns"]:
        tier = 0 if p["service"] == service else 1 if catalog["service_team"][p["service"]] == team else None
        if tier is None or p["resolver"] == chosen:
            continue
        key = (tier, p["resolver"])
        best[key] = max(best.get(key, 0.0), pattern_scores.get(p["id"], 0.0))
    ranked, seen = [], set()
    for (tier, resolver), sim in sorted(best.items(), key=lambda kv: (kv[0][0], -kv[1])):
        if resolver not in seen:
            seen.add(resolver)
            ranked.append(Alternative(value=resolver, score=max(0.0, min(1.0, sim)), source="pattern_match"))
    fb = catalog["fallback_assignee"][service]["assignee"]
    if fb != chosen and fb not in seen:
        ranked.append(Alternative(value=fb, score=config.FALLBACK_CONFIDENCE, source="fallback"))
    return ranked


def assignee_decision(service: DecisionRecord, retrieved: dict, catalog: dict, original: dict) -> DecisionRecord:
    """AGENTS step 4: the assignee follows the chosen service. In training every resolution
    pattern of a service is written by the same person regardless of the ticket's wording,
    so a service with one resolver always routes to that resolver. A service with several
    (Securities Settlement) picks the resolver whose patterns there are most similar on
    average (a max would favour whoever has more patterns). A service with none gets the
    fallback."""
    svc = service.value
    fallback = catalog["fallback_assignee"][svc]["assignee"]
    scores = retrieved["pattern_scores"]
    same = sorted((p for p in catalog["patterns"] if p["service"] == svc), key=lambda p: -scores.get(p["id"], 0.0))
    if same:
        by_resolver: dict[str, list[float]] = {}
        for p in same:
            by_resolver.setdefault(p["resolver"], []).append(scores.get(p["id"], 0.0))
        mean = {r: sum(s) / len(s) for r, s in by_resolver.items()}
        resolver = max(sorted(mean), key=mean.get)
        evidence = Evidence(patterns=[PatternEvidence(pattern_id=p["id"], similarity=round(scores.get(p["id"], 0.0), 4),
                                                      service=svc, resolver=p["resolver"]) for p in same],
                            service_card=svc)
        rivals = [s for r, s in mean.items() if r != resolver]
        if rivals:
            signals = pattern_assignee_signals(mean[resolver], max(rivals))
            ids = ", ".join(p["id"] for p in same if p["resolver"] == resolver)
            reason = (f"{svc} has several resolvers; the past resolutions written by {resolver} ({ids}) are the "
                      f"closest on average (similarity {mean[resolver]:.2f}).")
        else:
            signals = {"unique_resolver": 1.0}
            ids = ", ".join(p["id"] for p in same)
            reason = f"Every past resolution for {svc} ({ids}) was written by {resolver}."
        return DecisionRecord(
            field="assignee", value=resolver, original_value=original["assignee"], effective_value=resolver,
            source="pattern_match", confidence=assignee_confidence("pattern_match", signals, service.confidence),
            confidence_signals={**signals, "service": service.confidence},
            reason=reason, evidence=evidence,
            alternatives=assignee_alternatives(svc, resolver, catalog, scores),
        )
    return DecisionRecord(
        field="assignee", value=fallback, original_value=original["assignee"], effective_value=fallback,
        source="fallback", confidence=assignee_confidence("fallback", {}, service.confidence),
        confidence_signals={"service": service.confidence},
        reason=(f"Fallback: {svc} has no documented resolver; {fallback} is the most frequent training "
                "assignee for the service."),
        evidence=Evidence(patterns=_pattern_evidence(retrieved), service_card=svc),
        alternatives=assignee_alternatives(svc, fallback, catalog, scores),
        flags=["fallback_assignee"],
    )
