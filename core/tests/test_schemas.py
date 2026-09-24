import pytest
from pydantic import ValidationError

from triage.schemas import ResolutionComment, TriageEvidence, TriageOutput, TriageSample

VALID = dict(
    reasoning="NAV breach on a critical service.",
    work_type="Incident",
    service="NAV Calculation",
    urgency="High",
    impact="Medium",
    resolution="done",
)


def test_valid_triage_output():
    assert TriageOutput(**VALID).service == "NAV Calculation"


def test_reasoning_is_first_field():
    assert list(TriageOutput.model_json_schema()["properties"])[0] == "reasoning"


@pytest.mark.parametrize(
    "field,value",
    [
        ("service", "Bloomberg Terminal"),
        ("service", "nav calculation"),
        ("urgency", "Critical"),
        ("urgency", "low"),
        ("impact", "Very High"),
        ("work_type", "Problem"),
        ("resolution", "fixed"),
        ("resolution", "Done"),
    ],
)
def test_triage_output_rejects_invalid(field, value):
    with pytest.raises(ValidationError):
        TriageOutput(**{**VALID, field: value})


def test_triage_output_rejects_extra_fields():
    with pytest.raises(ValidationError):
        TriageOutput(**VALID, priority="High")


def test_schema_enumerates_services_and_levels():
    props = TriageOutput.model_json_schema()["properties"]
    assert len(props["service"]["enum"]) == 20
    assert props["urgency"]["enum"] == ["Highest", "High", "Medium", "Low", "Lowest"]


def test_resolution_comment_valid():
    c = ResolutionComment(text="Resolution: Cleared the stale lock on the staging table, reran the sync and confirmed positions matched.")
    assert c.text.startswith("Resolution: ")


@pytest.mark.parametrize(
    "text",
    ["Cleared the lock and reran the job.", "Resolution: Problem fixed.", "Resolution recorded: service restored.", "Resolution: ", "Problem fixed."],
)
def test_resolution_comment_rejects(text):
    with pytest.raises(ValidationError):
        ResolutionComment(text=text)


def test_samples_have_no_reasoning_and_evidence_is_capped():
    assert "reasoning" not in TriageSample.model_json_schema()["properties"]
    TriageSample(**{k: v for k, v in VALID.items() if k != "reasoning"})
    with pytest.raises(ValidationError):
        TriageSample(**{**VALID, "service": "Nope"})
    TriageEvidence(service=["NAV tolerance check failed"])
    with pytest.raises(ValidationError):
        TriageEvidence(service=["a", "b", "c", "d"])
