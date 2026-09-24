"""Metrics computed on request (docs/CORE_API.md §9) from per-ticket facts:
{"ticket_id", "runs": [completed live RunRecords, oldest first], "overrides": [...],
 "acceptances": [...], "closures": [...], "effective": {field: DecisionRecord} | None}.
Pure functions: the API gathers and filters the facts, this module only counts."""
from collections import Counter, defaultdict

from triage import config

STEP_2 = ("override_rates", "automation_rate", "service_confusion", "calibration", "generic_bucket_rate",
          "fallback_rate", "coverage", "priority_integrity", "audit_error_estimate", "resolver_load")
STEP_3 = ("emerging_issues",)
METRICS = STEP_2 + STEP_3
EMERGING_MAX_PATTERN_SIM = 0.65  # a best past-resolution match below this counts as weak
EMERGING_CLUSTER_SIM = 0.80      # cosine similarity to join a cluster
EMERGING_MIN_CLUSTER = 2


def _user_overrides(t: dict) -> list[dict]:
    return [o for o in t["overrides"] if not o.get("cascaded_from")]


def _rate(n: int, d: int) -> dict:
    return {"count": n, "total": d, "rate": round(n / d, 4) if d else None}


def override_rates(tickets: list[dict]) -> dict:
    by = {"field": defaultdict(lambda: [0, 0]), "service": defaultdict(lambda: [0, 0]), "source": defaultdict(lambda: [0, 0])}
    for t in tickets:
        if not t["runs"]:
            continue
        latest, overridden = t["runs"][-1], {o["field"] for o in _user_overrides(t)}
        service = t["effective"]["service"].effective_value
        for field, d in latest.decisions.items():
            hit = field in overridden
            for dim, key in (("field", field), ("service", service), ("source", d.source)):
                by[dim][key][0] += hit
                by[dim][key][1] += 1
    return {dim: {k: _rate(*v) for k, v in sorted(vals.items())} for dim, vals in by.items()}


def _day(run) -> str:
    return (run.completed_at or run.started_at)[:10]


def automation_rate(tickets: list[dict]) -> dict:
    days: dict[str, Counter] = defaultdict(Counter)
    for t in tickets:
        for run in t["runs"]:
            days[_day(run)][run.lane] += 1
    return {"by_day": {d: dict(c) for d, c in sorted(days.items())},
            "total": dict(sum(days.values(), Counter()))}


def service_confusion(tickets: list[dict]) -> dict:
    """First triage (the first run's service) versus final (effective) service."""
    matrix: dict[str, Counter] = defaultdict(Counter)
    for t in tickets:
        if t["runs"]:
            matrix[t["runs"][0].decisions["service"].value][t["effective"]["service"].effective_value] += 1
    changed = sum(n for a, row in matrix.items() for b, n in row.items() if a != b)
    return {"matrix": {a: dict(row) for a, row in sorted(matrix.items())}, "changed": changed,
            "total": sum(sum(row.values()) for row in matrix.values())}


def reviewed_decisions(tickets: list[dict]):
    """Yield (field, decision, accepted) for every reviewed decision: its run was accepted
    for that field, or the field was overridden on that run."""
    for t in tickets:
        overridden = {(o["base_run_id"], o["field"]) for o in _user_overrides(t)}
        accepted = {(a["run_id"], f) for a in t["acceptances"] for f in a["fields"]}
        for run in t["runs"]:
            for field, d in run.decisions.items():
                key = (run.run_id, field)
                if key in overridden or key in accepted:
                    yield field, d, key in accepted and key not in overridden


def reviewed_points(tickets: list[dict]) -> dict[str, list[tuple[float, int]]]:
    """Per field: (raw confidence, accepted 0/1), the input of the calibration fit."""
    from triage.calibration import raw_confidence

    points: dict[str, list[tuple[float, int]]] = defaultdict(list)
    for field, d, ok in reviewed_decisions(tickets):
        points[field].append((raw_confidence(d), int(ok)))
    return points


def calibration(tickets: list[dict], bins: int = 10) -> dict:
    """Stored confidence bins versus the human acceptance rate, plus a fitted per-field
    isotonic map (step 3) that can be adopted through PUT /policy {"calibration": ...}."""
    from triage.calibration import fit

    counts = [[0, 0] for _ in range(bins)]
    for _, d, ok in reviewed_decisions(tickets):
        b = min(bins - 1, int(d.confidence * bins))
        counts[b][0] += ok
        counts[b][1] += 1
    return {"bins": [{"from": i / bins, "to": (i + 1) / bins, **_rate(*c)} for i, c in enumerate(counts)],
            "fitted": fit(reviewed_points(tickets))}


def _share_by_day(tickets: list[dict], hit) -> dict:
    days: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for t in tickets:
        for run in t["runs"]:
            days[_day(run)][0] += bool(hit(run))
            days[_day(run)][1] += 1
    total = [sum(v[0] for v in days.values()), sum(v[1] for v in days.values())]
    return {"by_day": {d: _rate(*v) for d, v in sorted(days.items())}, "total": _rate(*total)}


def generic_bucket_rate(tickets: list[dict]) -> dict:
    return _share_by_day(tickets, lambda r: r.decisions["service"].value == config.CATCH_ALL_SERVICE)


def fallback_rate(tickets: list[dict]) -> dict:
    return _share_by_day(tickets, lambda r: r.decisions["assignee"].source == "fallback")


def coverage(catalog: dict) -> dict:
    with_patterns = sorted(catalog["resolvers_by_service"])
    return {"with_patterns": with_patterns,
            "without_patterns": sorted(s for s in catalog["service_team"] if s not in with_patterns),
            "patterns": len(catalog["patterns"])}


def priority_integrity(tickets: list[dict]) -> dict:
    forced = downgrades = 0
    dist: Counter = Counter()
    for t in tickets:
        if not t["effective"]:
            continue
        eff = t["effective"]
        forced += "forced_inconsistent" in eff["priority"].flags
        downgrades += any("downgrade_on_critical" in d.flags for d in t["runs"][-1].decisions.values())
        if config.CRITICALITY.get(eff["service"].effective_value) == "Critical" and \
                eff["work_type"].effective_value == "Incident":
            dist[eff["priority"].effective_value] += 1
    return {"forced_inconsistent": forced, "downgrade_on_critical": downgrades,
            "critical_incidents_by_priority": {lvl: dist.get(lvl, 0) for lvl in config.LEVELS}}


def audit_error_estimate(tickets: list[dict]) -> dict:
    """Error rate on audit-sampled auto-applied runs: a sampled run counts as reviewed once
    accepted or overridden, and as an error when any field was overridden."""
    sampled = reviewed = errors = 0
    for t in tickets:
        for run in t["runs"]:
            if not run.audit_sampled:
                continue
            sampled += 1
            overridden = any(o["base_run_id"] == run.run_id for o in _user_overrides(t))
            accepted = any(a["run_id"] == run.run_id for a in t["acceptances"])
            reviewed += overridden or accepted
            errors += overridden
    return {"sampled": sampled, "reviewed": reviewed, **_rate(errors, reviewed)}


def resolver_load(tickets: list[dict], catalog: dict) -> dict:
    """Open tickets (no closure yet) per effective assignee, and services whose documented
    problem classes all depend on a single resolver."""
    load: Counter = Counter()
    for t in tickets:
        if t["effective"] and not t["closures"]:
            load[t["effective"]["assignee"].effective_value] += 1
    single = {s: r[0] for s, r in catalog["resolvers_by_service"].items() if len(r) == 1}
    return {"open_by_resolver": dict(load.most_common()), "single_resolver_services": single}


def is_weak(run) -> bool:
    service = run.decisions["service"]
    best = max((p.similarity for p in service.evidence.patterns), default=0.0)
    return "weak_match" in service.flags or best < EMERGING_MAX_PATTERN_SIM


def cluster(vectors, threshold: float = EMERGING_CLUSTER_SIM) -> list[list[int]]:
    """Greedy single-pass clustering on L2-normalised vectors (cosine = dot product)."""
    import numpy as np

    centroids, members = [], []
    for i, v in enumerate(vectors):
        v = np.asarray(v, dtype=float)
        sims = [float(c @ v / (np.linalg.norm(c) or 1)) for c in centroids]
        j = int(np.argmax(sims)) if sims else -1
        if j >= 0 and sims[j] >= threshold:
            members[j].append(i)
            centroids[j] = centroids[j] + v
        else:
            centroids.append(v.copy())
            members.append([i])
    return members


def emerging_issues(tickets: list[dict], embed, text_of) -> dict:
    """Clusters of recent tickets whose best matches are weak: candidate new problem
    classes or early signs of an outage (step 3)."""
    weak = [t for t in tickets if t["runs"] and is_weak(t["runs"][-1])]
    if not weak:
        return {"weak_tickets": 0, "clusters": []}
    groups = cluster(embed([text_of(t["ticket_id"]) for t in weak]))
    clusters = []
    for g in sorted(groups, key=len, reverse=True):
        if len(g) < EMERGING_MIN_CLUSTER:
            continue
        members = [weak[i] for i in g]
        clusters.append({"size": len(g), "ticket_ids": [t["ticket_id"] for t in members],
                         "services": dict(Counter(t["effective"]["service"].effective_value for t in members)),
                         "example": text_of(members[0]["ticket_id"])[:200]})
    return {"weak_tickets": len(weak), "clusters": clusters,
            "thresholds": {"max_pattern_similarity": EMERGING_MAX_PATTERN_SIM, "cluster_similarity": EMERGING_CLUSTER_SIM}}


def compute(name: str, tickets: list[dict], catalog: dict, embed=None, text_of=None) -> dict:
    if name == "coverage":
        return coverage(catalog)
    if name == "resolver_load":
        return resolver_load(tickets, catalog)
    if name == "emerging_issues":
        return emerging_issues(tickets, embed, text_of)
    return globals()[name](tickets)
