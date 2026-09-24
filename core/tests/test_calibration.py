import pytest

from triage.calibration import apply_map, calibrate, ece, fit, fit_isotonic, recalibrate, validate_calibration
from triage.schemas import DecisionRecord
from triage.state import StateError


def test_isotonic_fit_pools_violators_and_is_monotone():
    pts = [(0.1, 0), (0.2, 1), (0.3, 0), (0.6, 1), (0.9, 1)]
    m = fit_isotonic(pts)
    assert m == [[0.1, 0.0], [0.3, 0.5], [0.9, 1.0]]
    ys = [y for _, y in m]
    assert ys == sorted(ys)
    assert apply_map(m, 0.05) == 0.0 and apply_map(m, 0.25) == 0.5 and apply_map(m, 0.95) == 1.0


def test_ece_improves_after_fit_and_min_points():
    overconfident = [(0.9, i % 2) for i in range(30)]  # says 0.9, right half the time
    out = fit({"service": overconfident, "impact": overconfident[:5]})
    assert out["report"]["service"]["ece_before"] == pytest.approx(0.4)
    assert out["report"]["service"]["ece_after"] == pytest.approx(0.0)
    assert "impact" not in out["calibration"] and "ece_after" not in out["report"]["impact"]
    assert ece([]) is None


def _d(conf, signals=None):
    return DecisionRecord(field="service", value="Tax Reporting", effective_value="Tax Reporting",
                          source="ai_judgment", confidence=conf, reason="r", confidence_signals=signals or {})


def test_calibrate_keeps_raw_and_recalibrate_undoes():
    cal = {"service": [[0.5, 0.2], [1.0, 0.6]]}
    d = calibrate({"service": _d(0.9)}, cal)["service"]
    assert d.confidence == 0.6 and d.confidence_signals["raw_confidence"] == 0.9
    again = calibrate({"service": d}, cal)["service"]            # idempotent: maps the raw value
    assert again.confidence == 0.6
    back = recalibrate({"service": d}, {})["service"]
    assert back.confidence == 0.9 and "raw_confidence" not in back.confidence_signals
    assert calibrate({"service": _d(0.9)}, None)["service"].confidence == 0.9


@pytest.mark.parametrize("bad", [{"service": [[0.5, 0.8], [1.0, 0.2]]}, {"service": [[0.9, 0.5], [0.4, 0.6]]},
                                 {"nope": [[1.0, 0.5]]}, {"service": []}, {"service": [[1.2, 0.5]]}])
def test_invalid_calibration_rejected(bad):
    with pytest.raises(StateError):
        validate_calibration(bad)
