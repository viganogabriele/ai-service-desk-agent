import pytest
from pydantic import ValidationError

from triage import config
from triage.schemas import TriageEvidence, TriageOutput, TriageSample
from triage.triage import build_evidence_messages, build_triage_messages, system_prompt, triage_ticket

CARDS = {"cards": [
    {"service": s, "criticality": c, "scope": f"Scope of {s}.", "boundary": None}
    for s, c in config.CRITICALITY.items()
]}
RETRIEVED = {
    "patterns": [{"id": "P01", "service": "SimCorp Dimension", "text": "Resolution: Cleared a lock.", "score": 0.71}],
    "cards": [{"service": "SimCorp Dimension", "score": 0.66}],
}
RECORD = {
    "Request type": "Machine Created Alert",
    "Summary": "Sync job failing",
    "Description": "Position sync keeps timing out.",
    "Affected Business or IT Services": ["Emailed Support Tickets"],
    "Business Entity": ["Germany"],
    "Priority": "SENTINEL-PRIORITY",
    "Urgency": "Low",
    "Impact": "Low",
    "All Comments": ["x@intcom.com: Seen again at 06:00."],
}


def test_prompt_contains_catalogue_rubric_and_definitions():
    sys_msg, user_msg = (m["content"] for m in build_triage_messages(RECORD, RETRIEVED, CARDS))
    for s in config.SERVICES:
        assert f"- {s} [" in user_msg
    for word in ("cancelled", "clarification", "cannot reproduce", "done"):
        assert word in sys_msg
    for text in list(config.URGENCY_DEFINITIONS.values()) + list(config.IMPACT_DEFINITIONS.values()):
        assert text in sys_msg
    assert "work type prior: Incident" in user_msg
    assert "Cleared a lock." in user_msg and "x@intcom.com" not in user_msg


def test_prompt_never_shows_priority():
    # Rule 4: priority is computed, never predicted, so the LLM never sees it.
    assert "SENTINEL-PRIORITY" not in str(build_triage_messages(RECORD, RETRIEVED, CARDS))


def test_readme_definitions_are_verbatim():
    readme = (config.ROOT / "README.md").read_text(encoding="utf-8")
    for text in list(config.URGENCY_DEFINITIONS.values()) + list(config.IMPACT_DEFINITIONS.values()):
        assert text in readme


def test_triage_ticket_final_at_t0_plus_seeded_samples():
    class R:
        def retrieve(self, record):
            return RETRIEVED

    calls = []

    def chat(messages, model_cls, **kw):
        calls.append((model_cls, kw))
        if model_cls is TriageEvidence:
            return TriageEvidence(service=["Position sync keeps timing out"])
        data = {"work_type": "Incident", "service": "SimCorp Dimension",
                "urgency": "High", "impact": "Medium", "resolution": "done"}
        if model_cls is TriageOutput:
            data["reasoning"] = "r"
        return model_cls.model_validate(data)

    out = triage_ticket(RECORD, R(), CARDS, chat=chat, n_samples=3, evidence=True)
    assert isinstance(out["triage"], TriageOutput) and len(out["samples"]) == 3
    assert calls[0] == (TriageOutput, {})  # final call: defaults, i.e. temperature 0
    sample_calls = calls[1:4]
    assert all(cls is TriageSample and kw["temperature"] == config.SAMPLE_TEMPERATURE for cls, kw in sample_calls)
    assert [kw["seed"] for _, kw in sample_calls] == config.SAMPLE_SEEDS[:3]
    assert calls[4][0] is TriageEvidence and out["evidence"].service
    calls.clear()
    out = triage_ticket(RECORD, R(), CARDS, chat=chat, n_samples=0, evidence=False)
    assert len(calls) == 1 and out["samples"] == [] and out["evidence"] is None


def test_evidence_prompt_contains_only_ticket_and_decisions():
    final = TriageOutput(reasoning="r", work_type="Incident", service="SimCorp Dimension", urgency="High",
                         impact="Medium", resolution="done")
    text = str(build_evidence_messages(RECORD, final))
    assert "Position sync keeps timing out." in text and "Seen again at 06:00." in text
    assert "Scope of" not in text and "Cleared a lock." not in text and "x@intcom.com" not in text


def test_optional_call_errors_keep_final_triage():
    class R:
        def retrieve(self, record):
            return RETRIEVED

    def chat(messages, model_cls, **kw):
        if model_cls is TriageOutput:
            return TriageOutput(reasoning="r", work_type="Incident", service="SimCorp Dimension",
                                urgency="High", impact="Medium", resolution="done")
        raise RuntimeError("backend error")

    out = triage_ticket(RECORD, R(), CARDS, chat=chat, n_samples=1, evidence=True)
    assert out["triage"].service == "SimCorp Dimension"
    assert out["samples"] == [] and out["evidence"] is None
    assert len(out["warnings"]) == 2


def test_prompt_hides_reported_service_and_levels():
    text = str(build_triage_messages({**RECORD, "Urgency": "SENTINEL-U"}, RETRIEVED, CARDS))
    assert "SENTINEL-U" not in text and "Reported service" not in text
