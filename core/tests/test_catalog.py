from collections import defaultdict

import pytest

from triage import config, data
from triage.catalog import (
    build_catalog,
    mine_fallback_assignees,
    mine_patterns,
    mine_service_team,
)


@pytest.fixture(scope="module")
def catalog(training, monkeypatch_module):
    # Rule 2: the catalog must not touch the challenge file.
    def _forbidden(*a, **k):
        raise AssertionError("catalog read the challenge file")

    for name in ("find_challenge_path", "load_challenge_raw", "load_challenge"):
        monkeypatch_module.setattr(data, name, _forbidden)
    return build_catalog(training)


@pytest.fixture(scope="module")
def monkeypatch_module():
    with pytest.MonkeyPatch.context() as mp:
        yield mp


def test_service_team_is_one_to_one(training):
    seen = defaultdict(set)
    for r in training:
        assert len(r["Affected Business or IT Services"]) == 1
        assert len(r["Service Team(s)"]) == 1
        seen[r["Affected Business or IT Services"][0]].add(r["Service Team(s)"][0])
    assert all(len(t) == 1 for t in seen.values())
    st = mine_service_team(training)
    assert set(st) == set(config.SERVICES)
    assert len(set(st.values())) == 11
    assert st[config.CATCH_ALL_SERVICE] == "Service Desk"


def test_service_team_raises_on_conflict():
    records = [
        {"Affected Business or IT Services": ["X"], "Service Team(s)": ["A"]},
        {"Affected Business or IT Services": ["X"], "Service Team(s)": ["B"]},
    ]
    with pytest.raises(ValueError):
        mine_service_team(records)


def test_21_patterns_each_single_resolver_and_service(training):
    patterns = mine_patterns(training)
    assert len(patterns) == 21
    for p in patterns:
        assert p["text"].startswith(config.RESOLUTION_PREFIX)
        assert len(p["resolvers"]) == 1, p
        assert len(p["services"]) == 1, p
    assert len({p["id"] for p in patterns}) == 21


def test_pattern_coverage(catalog):
    covered = {p["service"] for p in catalog["patterns"]}
    assert len(covered) == 10
    assert len(catalog["resolvers_by_service"]["Securities Settlement"]) == 2
    assert all(len(v) == 1 for s, v in catalog["resolvers_by_service"].items() if s != "Securities Settlement")


def test_filler_is_not_a_pattern(catalog):
    for p in catalog["patterns"]:
        assert "Problem fixed" not in p["text"]
        assert not p["text"].startswith("Resolution recorded")


def test_four_resolvers_never_assignees(training, catalog):
    assignees = {r["Assignee"] for r in training}
    resolvers = {p["resolver"] for p in catalog["patterns"]}
    assert len(resolvers - assignees) == 4


def test_fallback_for_every_service(training, catalog):
    fb = catalog["fallback_assignee"]
    assert set(fb) == set(config.SERVICES)
    assert fb == mine_fallback_assignees(training)
    for s, entry in fb.items():
        assert entry["assignee"] and entry["count"] >= entry["runner_up_count"]


def test_catalog_is_deterministic(training, catalog):
    assert build_catalog(training) == catalog


def test_catalog_has_no_unexpected_warnings(catalog):
    # Only fallback ties are tolerated; pattern-uniqueness or service-list warnings are failures.
    assert all(w.startswith("fallback tie") for w in catalog["warnings"]), catalog["warnings"]
