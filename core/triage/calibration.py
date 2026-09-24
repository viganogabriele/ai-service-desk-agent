"""Confidence calibration against human outcomes (CORE_API §5 step 3). A per-field
monotone (isotonic) map from raw confidence to the observed acceptance rate, fitted with
pool-adjacent-violators. Maps live in a policy version, so adopting one is explicit."""
from triage import config

MIN_POINTS = 20  # per field; below this a field keeps its raw confidence


def fit_isotonic(points: list[tuple[float, int]]) -> list[list[float]]:
    """points: (raw confidence, accepted 0/1). Returns breakpoints [[x_upper, y], ...] with
    x ascending and y non-decreasing: confidence <= x_upper maps to y."""
    by_x: dict[float, list[float]] = {}
    for x, y in points:  # equal confidences form one block: they cannot be ordered
        acc = by_x.setdefault(x, [0.0, 0])
        acc[0] += y
        acc[1] += 1
    blocks = []  # [sum_y, n, x_max]
    for x in sorted(by_x):
        blocks.append([by_x[x][0], by_x[x][1], x])
        # pool while the previous block is not lower (equal blocks merge too: fewer breakpoints)
        while len(blocks) > 1 and blocks[-2][0] / blocks[-2][1] >= blocks[-1][0] / blocks[-1][1]:
            s, n, xm = blocks.pop()
            blocks[-1][0] += s
            blocks[-1][1] += n
            blocks[-1][2] = xm
    return [[round(b[2], 4), round(b[0] / b[1], 4)] for b in blocks]


def apply_map(mapping: list[list[float]], x: float) -> float:
    for upper, y in mapping:
        if x <= upper:
            return y
    return mapping[-1][1] if mapping else x


def ece(points: list[tuple[float, int]], mapping: list[list[float]] | None = None, bins: int = 10) -> float | None:
    """Expected calibration error of raw (or mapped) confidence against outcomes."""
    if not points:
        return None
    acc = [[0.0, 0.0, 0] for _ in range(bins)]
    for x, y in points:
        c = apply_map(mapping, x) if mapping else x
        b = min(bins - 1, int(c * bins))
        acc[b][0] += c
        acc[b][1] += y
        acc[b][2] += 1
    return round(sum(abs(s - a) for s, a, n in acc if n) / len(points), 4)


def fit(points_by_field: dict[str, list[tuple[float, int]]], min_points: int = MIN_POINTS) -> dict:
    """{"calibration": {field: mapping}, "report": {field: {n, ece_before, ece_after}}}."""
    calibration, report = {}, {}
    for field, pts in sorted(points_by_field.items()):
        entry = {"n": len(pts), "ece_before": ece(pts)}
        if len(pts) >= min_points:
            calibration[field] = fit_isotonic(pts)
            entry["ece_after"] = ece(pts, calibration[field])
        report[field] = entry
    return {"calibration": calibration, "report": report, "min_points": min_points}


def raw_confidence(decision) -> float:
    return decision.confidence_signals.get("raw_confidence", decision.confidence)


def calibrate(decisions: dict, calibration: dict | None, fields=None) -> dict:
    """Replace confidence with the calibrated value for mapped fields, keeping the raw one
    as the `raw_confidence` signal. Unmapped fields are returned unchanged."""
    if not calibration:
        return decisions
    out = dict(decisions)
    for field in fields or list(decisions):
        mapping = calibration.get(field)
        if not mapping or field not in out:
            continue
        d = out[field]
        raw = raw_confidence(d)
        out[field] = d.model_copy(update={"confidence": apply_map(mapping, raw),
                                          "confidence_signals": {**d.confidence_signals, "raw_confidence": raw}})
    return out


def validate_calibration(calibration: dict) -> None:
    from triage.state import StateError

    for field, mapping in calibration.items():
        ok = field in config.DECISION_FIELDS and isinstance(mapping, list) and mapping and all(
            isinstance(p, (list, tuple)) and len(p) == 2 and 0 <= p[0] <= 1 and 0 <= p[1] <= 1 for p in mapping)
        if ok:
            xs, ys = [p[0] for p in mapping], [p[1] for p in mapping]
            ok = xs == sorted(xs) and ys == sorted(ys)
        if not ok:
            raise StateError(422, "invalid_policy", "calibration maps need ascending [x_upper, y] pairs in [0, 1] "
                                                    "with non-decreasing y", {"field": field})


def recalibrate(decisions: dict, calibration: dict | None) -> dict:
    """Undo any calibration a run was stored with, then apply `calibration` (policy preview)."""
    raw = {f: d.model_copy(update={"confidence": raw_confidence(d),
                                   "confidence_signals": {k: v for k, v in d.confidence_signals.items()
                                                          if k != "raw_confidence"}})
           for f, d in decisions.items()}
    return calibrate(raw, calibration)
