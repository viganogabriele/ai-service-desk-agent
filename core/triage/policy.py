"""Lane policy (CORE_API §3 "Policy version"): per-field thresholds, autonomy per field and
per service, the audit sample rate and the pause switch. Decision thresholds (assignee
similarity, weak match) belong to the engine and stay in config.py."""
from triage import config
from triage.state import StateError

AUTONOMY = ("suggest_only", "auto_above_threshold", "full_auto")


def default_policy() -> dict:
    """Policy p1, taken from config.py."""
    return {
        "field_thresholds": dict(config.FIELD_THRESHOLDS),
        "autonomy": {"default": config.AUTONOMY_DEFAULT, "fields": dict(config.AUTONOMY_FIELDS),
                     "services": dict(config.AUTONOMY_SERVICES)},
        "audit_sample_rate": config.AUDIT_SAMPLE_RATE,
        "paused": config.POLICY_PAUSED,
        "calibration": {},  # field -> isotonic map (triage.calibration); empty = raw confidence
    }


def validate_policy(content: dict) -> dict:
    """A complete, valid policy (missing keys filled from the defaults) or StateError 422."""
    base = default_policy()
    unknown = set(content) - set(base)
    if unknown:
        raise StateError(422, "invalid_policy", "unknown policy keys", {"keys": sorted(unknown)})
    policy = {**base, **content, "autonomy": {**base["autonomy"], **content.get("autonomy", {})}}
    for field, t in policy["field_thresholds"].items():
        if field not in config.DECISION_FIELDS or not isinstance(t, (int, float)) or not 0 <= t <= 1:
            raise StateError(422, "invalid_policy", "thresholds need a decision field and a value in [0, 1]",
                             {"field": field})
    modes = [policy["autonomy"]["default"], *policy["autonomy"]["fields"].values(), *policy["autonomy"]["services"].values()]
    if any(m not in AUTONOMY for m in modes):
        raise StateError(422, "invalid_policy", "unknown autonomy mode", {"allowed": list(AUTONOMY)})
    if any(f not in config.DECISION_FIELDS for f in policy["autonomy"]["fields"]) or \
            any(s not in config.SERVICES for s in policy["autonomy"]["services"]):
        raise StateError(422, "invalid_policy", "autonomy keys must be decision fields / services")
    if not 0 <= policy["audit_sample_rate"] <= 1 or not isinstance(policy["paused"], bool):
        raise StateError(422, "invalid_policy", "audit_sample_rate must be in [0, 1] and paused a boolean")
    from triage.calibration import validate_calibration

    validate_calibration(policy["calibration"])
    return policy
