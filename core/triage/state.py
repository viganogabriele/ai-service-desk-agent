"""Effective state and overrides (docs/CORE_API.md §1, §6B). Pure functions shared by the
API; runs are immutable, overrides append-only, effective state = latest run + overrides."""
from triage import config
from triage.decisions import assignee_alternatives
from triage.output import fill_challenge, predictions_from_run
from triage.priority import compute_priority
from triage.schemas import FIELD_VOCAB, DecisionRecord, ResolutionCommentRecord, RunRecord

REASON_CODES = ["wrong_service", "wrong_work_type", "wrong_assignee", "resolver_unavailable", "wrong_urgency",
                "wrong_impact", "wrong_resolution_status", "inaccurate_comment", "other"]
OVERRIDABLE = ["work_type", "service", "assignee", "urgency", "impact", "priority", "resolution"]  # team follows service
STALES_COMMENT = {"service", "resolution"}


class StateError(Exception):
    """A request the Core refuses; maps onto the API error shape."""

    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details or {}


def assignee_fits(service: str, assignee: str, catalog: dict) -> bool:
    return (assignee in catalog["resolvers_by_service"].get(service, [])
            or assignee == catalog["fallback_assignee"][service]["assignee"])


def effective_decisions(run: RunRecord, overrides: list[dict], catalog: dict) -> dict[str, DecisionRecord]:
    """The run's decisions with the latest override per field layered on top (pinned).
    `overrides` are in creation order."""
    eff = {f: d.model_copy(deep=True) for f, d in run.decisions.items()}
    latest: dict[str, dict] = {}
    for o in overrides:
        latest[o["field"]] = o
    for field, o in latest.items():
        d = eff[field]
        flags = list(d.flags) + (["forced_inconsistent"] if o.get("forced") else [])
        eff[field] = d.model_copy(update={"pinned": True, "effective_value": o["new_value"], "flags": flags})
    service, assignee = eff["service"].effective_value, eff["assignee"]
    if "service" in latest and not assignee_fits(service, assignee.effective_value, catalog):
        if "assignee_needs_review" not in assignee.flags:
            eff["assignee"] = assignee.model_copy(update={"flags": assignee.flags + ["assignee_needs_review"]})
    return eff


def _validate(change: dict, force: bool) -> None:
    field, value = change.get("field"), change.get("value")
    if field == "team":
        raise StateError(422, "team_follows_service", "Team is looked up from the service; change the service instead.")
    if field not in OVERRIDABLE:
        raise StateError(422, "invalid_field", f"{field!r} cannot be overridden", {"field": field})
    vocab = FIELD_VOCAB.get(field)
    if vocab and value not in vocab:
        raise StateError(422, "invalid_value", f"{value!r} is not a valid {field}", {"field": field, "allowed": vocab})
    if field == "assignee" and (not isinstance(value, str) or "@" not in value):
        raise StateError(422, "invalid_value", "assignee must be an email address", {"field": field})
    if change.get("reason_code") not in REASON_CODES:
        raise StateError(422, "invalid_reason_code", "unknown reason_code", {"allowed": REASON_CODES})
    if change["reason_code"] == "other" and not change.get("note"):
        raise StateError(422, "note_required", "reason_code 'other' requires a note")
    if field == "priority" and not (force and change.get("note")):
        raise StateError(422, "priority_follows_matrix",
                         "Priority follows the urgency/impact matrix; set urgency or impact instead, "
                         "or force it with a note.", {"field": "priority"})


def apply_changes(eff: dict[str, DecisionRecord], changes: list[dict], force: bool, catalog: dict,
                  pattern_scores: dict[str, float] | None = None) -> dict:
    """Validate user changes and compute every derived change (cascades). Persists nothing.
    Returns {"changes": [...], "effective": {field: value}, "flags": {...}, "warnings": [...],
    "comment_stale": bool, "assignee_alternatives": [...]}. Derived changes carry
    `cascaded_from` = index of the user change that caused them."""
    if not changes:
        raise StateError(422, "no_changes", "changes must not be empty")
    values = {f: d.effective_value for f, d in eff.items()}
    out_changes, flags, warnings = [], {}, []
    comment_stale, alternatives = False, []
    for i, ch in enumerate(changes):
        _validate(ch, force)
        field, value = ch["field"], ch["value"]
        out_changes.append({"field": field, "old_value": values[field], "new_value": value,
                            "reason_code": ch["reason_code"], "note": ch.get("note"), "forced": field == "priority",
                            "cascaded_from": None})
        values[field] = value
        if field == "priority":
            flags.setdefault("priority", []).append("forced_inconsistent")
            warnings.append("priority no longer follows the matrix (forced)")
        if field in ("urgency", "impact"):
            derived = compute_priority(values["urgency"], values["impact"])
            if derived != values["priority"]:
                out_changes.append({"field": "priority", "old_value": values["priority"], "new_value": derived,
                                    "reason_code": ch["reason_code"], "note": None, "forced": False, "cascaded_from": i})
                values["priority"] = derived
        if field == "service":
            team = catalog["service_team"][value]
            if team != values["team"]:
                out_changes.append({"field": "team", "old_value": values["team"], "new_value": team,
                                    "reason_code": ch["reason_code"], "note": None, "forced": False, "cascaded_from": i})
                values["team"] = team
            if not assignee_fits(value, values["assignee"], catalog):
                flags.setdefault("assignee", []).append("assignee_needs_review")
                warnings.append(f"{values['assignee']} is not a resolver for {value}")
                alternatives = [a.model_dump() for a in assignee_alternatives(value, values["assignee"], catalog,
                                                                              pattern_scores or {})]
                fb = catalog["fallback_assignee"][value]["assignee"]
                if not any(a["value"] == fb for a in alternatives):
                    alternatives.append({"value": fb, "score": config.FALLBACK_CONFIDENCE, "source": "fallback"})
        if field in STALES_COMMENT:
            comment_stale = True
    changed_user = {c["field"] for c in out_changes if c["cascaded_from"] is None}
    if "assignee" in changed_user:
        flags.pop("assignee", None)  # an explicit assignee in the same request resolves the review flag
        alternatives = []
    return {"changes": out_changes, "effective": values, "flags": flags, "warnings": warnings,
            "comment_stale": comment_stale, "assignee_alternatives": alternatives}


def effective_record(fields: dict, run: RunRecord, eff: dict[str, DecisionRecord],
                     comment: ResolutionCommentRecord | None) -> dict:
    """One ticket in the challenge structure with the effective state filled in: the
    same mapping as the CLI output (triage.output), so both entry points agree."""
    view = run.model_copy(update={"decisions": eff, "resolution_comment": comment})
    wrapper = {"records": [fields]}
    pred = predictions_from_run(view)
    if pred and comment is not None:
        pred["All Comments"] = list(fields.get("All Comments") or []) + [comment.text]
    return fill_challenge(wrapper, [pred])["records"][0]
