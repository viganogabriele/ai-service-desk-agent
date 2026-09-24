import json

import pytest

from triage import config
from triage.catalog import build_catalog, build_service_cards, check_boundary, load_service_cards
from triage.schemas import ServiceScope


@pytest.fixture(scope="module")
def catalog(training):
    return build_catalog(training)


def fake_chat(messages, model_cls, model=None):
    return ServiceScope(scope="Does things for this service.", boundary="Other things go to Fund Pricing.")


def test_build_service_cards_is_unreviewed_and_complete(catalog):
    cards = build_service_cards(catalog, chat=fake_chat, model="fake")
    assert cards["reviewed"] is False
    assert [c["service"] for c in cards["cards"]] == list(catalog["service_team"])
    for c in cards["cards"]:
        assert c["team"] == catalog["service_team"][c["service"]]
        assert c["criticality"] == config.CRITICALITY[c["service"]]
    fp = next(c for c in cards["cards"] if c["service"] == "Fund Pricing")
    assert fp["boundary"] is None and fp["boundary_dropped"]  # names itself -> dropped


def test_card_prompt_has_no_challenge_content(catalog):
    seen = []
    build_service_cards(catalog, chat=lambda m, *a, **k: seen.append(m) or fake_chat(m, None), model="fake")
    from triage.data import load_challenge
    challenge_summaries = [r["Summary"] for r in load_challenge()]
    for messages in seen:
        text = json.dumps(messages)
        assert not any(s in text for s in challenge_summaries)


@pytest.mark.parametrize("boundary,expected", [
    (None, None),
    ("NAV breaches go to NAV Calculation.", "NAV breaches go to NAV Calculation."),
    ("Price issues go to Fund Pricing.", None),         # names itself
    ("Other things go elsewhere.", None),               # names no service
])
def test_check_boundary(boundary, expected):
    assert check_boundary("Fund Pricing", boundary) == expected


def test_unreviewed_cards_are_refused(tmp_path):
    path = tmp_path / "cards.json"
    path.write_text(json.dumps({"reviewed": False, "cards": []}))
    with pytest.raises(RuntimeError):
        load_service_cards(path)
    assert load_service_cards(path, require_reviewed=False)["cards"] == []


def test_published_kb_is_immutable(tmp_path):
    from triage.catalog import save_catalog, write_manifest
    kb = tmp_path / "v9"
    save_catalog({"a": 1}, kb / "catalog.json", kb / "manifest.json")      # draft: writable
    write_manifest("published", ["test"], kb_dir=kb)
    save_catalog({"a": 1}, kb / "catalog.json", kb / "manifest.json")      # identical: fine
    with pytest.raises(RuntimeError):
        save_catalog({"a": 2}, kb / "catalog.json", kb / "manifest.json")
    assert json.loads((kb / "manifest.json").read_text())["files"]["catalog.json"]
