"""Lane assignment at the end of a run (docs/CORE_API.md §5). First matching lane wins;
every matching reason is recorded. Thresholds, autonomy, pause and the audit rate come
from a policy (triage.policy); without one, policy p1 from config.py applies."""
import hashlib

from triage import config


def _policy(policy: dict | None) -> dict:
    from triage.policy import default_policy

    return policy or default_policy()


def _autonomy(field: str, service: str, policy: dict) -> str:
    a = policy["autonomy"]
    return a["services"].get(service) or a["fields"].get(field) or a["default"]


def lane_reasons(decisions: dict, policy: dict | None = None) -> tuple[list[str], list[str]]:
    """(human_only reasons, needs_review reasons)."""
    policy = _policy(policy)
    service = decisions["service"].value
    human, review = [], []
    if decisions["priority"].value == "Highest" and config.CRITICALITY.get(service) == "Critical":
        human.append("priority_highest_on_critical")
    if decisions["resolution"].value == "cancelled":
        human.append("cancelled")  # AGENTS: every cancel is human-only (nonsense vs misrouted is not separated)
    if "weak_match" in decisions["service"].flags:
        human.append("weak_match:service")
    human += [f"downgrade_on_critical:{f}" for f, d in decisions.items() if "downgrade_on_critical" in d.flags]

    for field, threshold in policy["field_thresholds"].items():
        if field in decisions and decisions[field].confidence < threshold:
            review.append(f"below_threshold:{field}")
    for flag in ("service_changed", "work_type_changed", "fallback_assignee"):
        if any(flag in d.flags for d in decisions.values()):
            review.append(flag)
    review += [f"policy_suggest_only:{f}" for f in decisions if _autonomy(f, service, policy) == "suggest_only"]
    if policy["paused"]:
        review.append("policy_paused")
    return human, review


def audit_sampled(run_id: str, rate: float = config.AUDIT_SAMPLE_RATE) -> bool:
    """Deterministic 'random' share: the same run id is always sampled the same way."""
    return int(hashlib.sha256(run_id.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF < rate


def assign_lane(decisions: dict, run_id: str, policy: dict | None = None) -> tuple[str, list[str], bool]:
    policy = _policy(policy)
    human, review = lane_reasons(decisions, policy)
    lane = "human_only" if human else "needs_review" if review else "auto_applied"
    return lane, human + review, lane == "auto_applied" and audit_sampled(run_id, policy["audit_sample_rate"])
