"""Lane assignment at the end of a run (docs/CORE_API.md §5). First matching lane wins;
every matching reason is recorded."""
import hashlib

from triage import config


def _autonomy(field: str, service: str) -> str:
    return config.AUTONOMY_SERVICES.get(service) or config.AUTONOMY_FIELDS.get(field) or config.AUTONOMY_DEFAULT


def lane_reasons(decisions: dict) -> tuple[list[str], list[str]]:
    """(human_only reasons, needs_review reasons)."""
    service = decisions["service"].value
    human, review = [], []
    if decisions["priority"].value == "Highest" and config.CRITICALITY.get(service) == "Critical":
        human.append("priority_highest_on_critical")
    if decisions["resolution"].value == "cancelled":
        human.append("cancelled")  # AGENTS: every cancel is human-only (nonsense vs misrouted is not separated)
    if "weak_match" in decisions["service"].flags:
        human.append("weak_match:service")
    human += [f"downgrade_on_critical:{f}" for f, d in decisions.items() if "downgrade_on_critical" in d.flags]

    for field, threshold in config.FIELD_THRESHOLDS.items():
        if field in decisions and decisions[field].confidence < threshold:
            review.append(f"below_threshold:{field}")
    for flag in ("service_changed", "work_type_changed", "fallback_assignee"):
        if any(flag in d.flags for d in decisions.values()):
            review.append(flag)
    review += [f"policy_suggest_only:{f}" for f in decisions if _autonomy(f, service) == "suggest_only"]
    if config.POLICY_PAUSED:
        review.append("policy_paused")
    return human, review


def audit_sampled(run_id: str, rate: float = config.AUDIT_SAMPLE_RATE) -> bool:
    """Deterministic 'random' share: the same run id is always sampled the same way."""
    return int(hashlib.sha256(run_id.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF < rate


def assign_lane(decisions: dict, run_id: str) -> tuple[str, list[str], bool]:
    human, review = lane_reasons(decisions)
    lane = "human_only" if human else "needs_review" if review else "auto_applied"
    return lane, human + review, lane == "auto_applied" and audit_sampled(run_id)
