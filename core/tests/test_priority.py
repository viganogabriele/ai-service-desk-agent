import re

import pytest

from triage import config
from triage.priority import compute_priority, normalize_level, severity_cap


def _readme_matrix() -> dict[tuple[str, str], str]:
    """Parse the Urgency x Impact table from README.md (source of truth)."""
    lines = (config.ROOT / "README.md").read_text(encoding="utf-8").splitlines()
    header = next(l for l in lines if "Major / Widespread" in l)
    impacts = re.findall(r"\*\*(.+?)\*\*", header)
    assert len(impacts) == 5
    matrix = {}
    for line in lines:
        cells = re.findall(r"\*\*(.+?)\*\*", line)
        if line.startswith("| **") and len(cells) == 6 and cells[0] in config.URGENCY_LABELS.values():
            for impact, value in zip(impacts, cells[1:]):
                matrix[(cells[0], impact)] = value
    assert len(matrix) == 25
    return matrix


README_MATRIX = _readme_matrix()


@pytest.mark.parametrize("urgency", config.LEVELS)
@pytest.mark.parametrize("impact", config.LEVELS)
def test_matrix_cell_matches_readme(urgency, impact):
    expected = README_MATRIX[(config.URGENCY_LABELS[urgency], config.IMPACT_LABELS[impact])]
    assert compute_priority(urgency, impact) == expected


def test_priority_accepts_training_casing():
    assert compute_priority("highest", "LOWEST") == "Medium"


@pytest.mark.parametrize("bad", ["Critical", "", "none", "Very High"])
def test_invalid_level_rejected(bad):
    with pytest.raises(ValueError):
        normalize_level(bad)
    with pytest.raises(ValueError):
        compute_priority(bad, "Low")


def test_criticality_matches_readme():
    text = (config.ROOT / "README.md").read_text(encoding="utf-8")
    rows = dict(re.findall(r"^\| ([^|*]+?) \| (Critical|Non-Critical) \|$", text, flags=re.M))
    assert rows == config.CRITICALITY


@pytest.mark.parametrize("field, level, resolution, expected", [
    ("urgency", "High", "cannot reproduce", "Lowest"),
    ("impact", "Medium", "cannot reproduce", "Lowest"),
    ("urgency", "Highest", "clarification", "Medium"),
    ("urgency", "Low", "clarification", "Low"),        # already below the ceiling
    ("impact", "High", "clarification", "Low"),
    ("impact", "Lowest", "clarification", "Lowest"),
    ("impact", "Highest", "done", "Highest"),          # no cap for actionable tickets
    ("urgency", "high", "cancelled", "High"),
])
def test_severity_cap(field, level, resolution, expected):
    assert severity_cap(field, level, resolution) == expected
