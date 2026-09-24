import json

import pytest

from triage import config
from triage.data import find_challenge_path, load_challenge_raw
from triage.output import fill_challenge


@pytest.fixture(scope="module")
def raw():
    return load_challenge_raw()


def _dummy_predictions(raw):
    return [
        {
            "Work type": "Incident",
            "Affected Business or IT Services": ["Emailed Support Tickets"],
            "Service Team(s)": ["Service Desk"],
            "Assignee": "someone@intcom.com",
            "Urgency": "Low",
            "Impact": "Low",
            "Priority": "Low",
            "Resolution": "done",
            "Status": "done",
            "All Comments": list(r["All Comments"]) + ["someone@intcom.com: Resolution: Did a thing."],
        }
        for r in raw["records"]
    ]


def test_challenge_glob_finds_one_file():
    assert find_challenge_path().name.startswith("jira_hackathon_")


def test_output_keeps_challenge_structure(raw):
    before = json.dumps(raw, sort_keys=True)
    out = fill_challenge(raw, _dummy_predictions(raw))
    assert json.dumps(raw, sort_keys=True) == before  # input untouched
    assert list(out) == list(raw)
    assert {k: v for k, v in out.items() if k != "records"} == {k: v for k, v in raw.items() if k != "records"}
    assert len(out["records"]) == len(raw["records"]) == 20
    for o, r in zip(out["records"], raw["records"]):
        assert list(o) == list(r)  # same keys, same order
        for k in r:
            if k not in config.PREDICTED_FIELDS:
                assert o[k] == r[k]
            else:
                assert type(o[k]) is type(r[k]) or r[k] is None


def test_output_rejects_unknown_or_non_predicted_fields(raw):
    preds = [{} for _ in raw["records"]]
    preds[0] = {"Summary": "changed"}
    with pytest.raises(KeyError):
        fill_challenge(raw, preds)
    preds[0] = {"Confidence": 0.9}
    with pytest.raises(KeyError):
        fill_challenge(raw, preds)


def test_output_rejects_misaligned_predictions(raw):
    with pytest.raises(ValueError):
        fill_challenge(raw, [])
